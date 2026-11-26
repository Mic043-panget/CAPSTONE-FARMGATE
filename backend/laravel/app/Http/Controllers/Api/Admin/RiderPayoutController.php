<?php

namespace App\Http\Controllers\Api\Admin;

use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\RiderPayout;
use App\Models\RiderPayoutDestination;
use App\Rules\ValidFarmgateImage;
use App\Services\ImageUploadService;
use App\Services\RiderPayoutService;
use App\Services\SystemSettingsService;
use App\Support\FarmgateImage;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Throwable;

class RiderPayoutController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $this->admin($request);
        $data = $request->validate([
            'group' => ['nullable', Rule::in(['queue', 'recorded'])],
            'search' => ['nullable', 'string', 'max:120'],
            'method' => ['nullable', Rule::in(['BANK_TRANSFER', 'GCASH'])],
            'destination_status' => ['nullable', Rule::in(['VERIFIED', 'NEEDS_REVIEW'])],
            'from_date' => ['nullable', 'date'],
            'to_date' => ['nullable', 'date', 'after_or_equal:from_date'],
            'sort' => ['nullable', Rule::in(['newest', 'oldest', 'amount_desc', 'amount_asc'])],
            'per_page' => ['nullable', 'integer', 'min:5', 'max:50'],
        ]);
        $group = $data['group'] ?? 'queue';
        $query = RiderPayout::query()
            ->where('status', $group === 'recorded' ? 'PAID' : 'PENDING')
            ->with([
                'rider:id,name',
                'recorder:id,name',
                'destination',
                'earning.delivery:id,delivery_reference,order_id,delivery_verified_at,status',
                'earning.order:id,order_reference,delivery_fee',
                'histories.actor:id,name',
            ]);
        if (filled($data['search'] ?? null)) {
            $term = trim($data['search']);
            $query->where(function (Builder $search) use ($term): void {
                $search->whereHas('rider', fn (Builder $rider) => $rider->where('name', 'like', '%'.$term.'%'))
                    ->orWhereHas('earning.delivery', fn (Builder $delivery) => $delivery->where('delivery_reference', 'like', '%'.$term.'%'))
                    ->orWhereHas('earning.order', fn (Builder $order) => $order->where('order_reference', 'like', '%'.$term.'%'));
                if (ctype_digit($term)) {
                    $search->orWhere('id', (int) $term);
                } elseif (preg_match('/^RPO-(\d+)$/i', $term, $referenceMatch) === 1) {
                    $search->orWhere('id', (int) $referenceMatch[1]);
                }
            });
        }
        if (filled($data['method'] ?? null)) {
            $query->where('method', $data['method']);
        }
        if ($group === 'queue' && ($data['destination_status'] ?? null) === 'VERIFIED') {
            $query->whereHas('destination', fn (Builder $destination) => $destination
                ->where('status', 'VERIFIED')
                ->where('is_current', true));
        } elseif ($group === 'queue' && ($data['destination_status'] ?? null) === 'NEEDS_REVIEW') {
            $query->where(fn (Builder $queue) => $queue
                ->whereDoesntHave('destination')
                ->orWhereHas('destination', fn (Builder $destination) => $destination
                    ->where('status', '!=', 'VERIFIED')
                    ->orWhere('is_current', false)));
        }
        if ($group === 'recorded') {
            if (filled($data['from_date'] ?? null)) {
                $query->whereDate('paid_at', '>=', $data['from_date']);
            }
            if (filled($data['to_date'] ?? null)) {
                $query->whereDate('paid_at', '<=', $data['to_date']);
            }
        }
        $query = match ($data['sort'] ?? 'newest') {
            'oldest' => $query->orderBy('created_at')->orderBy('id'),
            'amount_desc' => $query->orderByDesc('amount_cents')->orderByDesc('id'),
            'amount_asc' => $query->orderBy('amount_cents')->orderBy('id'),
            default => $query->orderByDesc($group === 'recorded' ? 'paid_at' : 'created_at')->orderByDesc('id'),
        };
        $payouts = $query
            ->paginate((int) ($data['per_page'] ?? 10))
            ->withQueryString();
        $payouts->getCollection()->each(function (RiderPayout $payout): void {
            $payout->setAttribute('payout_reference', $this->payoutReference($payout->id));
            $payout->setAttribute('destination_masked', $this->destinationSummary($payout->destination));
            $payout->setAttribute('receipt_url', $payout->status === 'PAID' && filled($payout->receipt_path)
                ? route('rider-payouts.receipt', $payout)
                : null);
            $payout->unsetRelation('destination');
        });

        return response()->json(['payouts' => $payouts])->header('Cache-Control', 'private, no-store');
    }

    public function confirmManual(
        Request $request,
        RiderPayout $payout,
        RiderPayoutService $service,
        SystemSettingsService $settings,
    ): JsonResponse {
        $this->admin($request);
        $data = $request->validate([
            'external_reference' => ['required', 'string', 'min:4', 'max:100', 'regex:/^[A-Za-z0-9._:-]+$/'],
            'method' => ['required', Rule::in(['BANK_TRANSFER', 'GCASH'])],
            'amount_cents' => ['required', 'integer', 'min:1', 'max:999999999999'],
            'paid_at' => ['required', 'date', 'after_or_equal:'.$payout->created_at->toDateString(), 'before_or_equal:today'],
            'reason' => ['required', 'string', 'min:8', 'max:500'],
            'externally_completed_confirmed' => ['required', 'accepted'],
            'receipt' => ['required', 'file', 'mimes:jpg,jpeg,png,webp,pdf', 'max:10240', new ValidFarmgateImage(['application/pdf'])],
        ]);
        $reason = $settings->sanitizeFinancialReason($data['reason']);
        $reason = $this->safeReason($reason, $payout->destination);
        abort_if(mb_strlen((string) $reason) < 8, 422, 'The sanitized payout reason must contain at least eight characters.');
        $request->merge(['reason' => $reason]);
        $file = $request->file('receipt');
        if (FarmgateImage::isImage($file)) {
            $stored = app(ImageUploadService::class)->storeEvidence($file, 'rider-payout-receipts', 'delivery_proofs');
            $receiptPath = $stored['path'];
            $receiptMime = $stored['mime_type'];
        } else {
            $extension = $file->guessExtension();
            abort_if(! $extension, 422, 'The payout receipt type could not be identified.');
            $receiptPath = 'rider-payout-receipts/'.Str::random(40).'.'.$extension;
            abort_unless(
                $file->storeAs('rider-payout-receipts', basename($receiptPath), 'delivery_proofs') === $receiptPath,
                503,
                'The payout receipt could not be securely stored. Please retry.',
            );
            $receiptMime = $file->getMimeType() ?? $file->getClientMimeType() ?? 'application/octet-stream';
        }

        try {
            $updated = $service->confirmManualPayout(
                $payout,
                $request->user(),
                $data['external_reference'],
                $data['method'],
                $reason,
                $data['paid_at'],
                $receiptPath,
                $receiptMime,
                (int) $data['amount_cents'],
            );
        } catch (Throwable $exception) {
            app(ImageUploadService::class)->deleteEvidence($receiptPath, 'delivery_proofs');
            throw $exception;
        }
        $updated->setAttribute('payout_reference', $this->payoutReference($updated->id));
        $updated->setAttribute('destination_masked', $this->destinationSummary($updated->destination));
        $updated->setAttribute('receipt_url', route('rider-payouts.receipt', $updated));
        $updated->unsetRelation('destination');

        return response()->json([
            'message' => 'Externally completed rider payout recorded. Farmgate did not initiate a transfer.',
            'payout' => $updated,
        ], 201)->header('Cache-Control', 'private, no-store');
    }

    public function receipt(Request $request, RiderPayout $payout): StreamedResponse
    {
        $user = $request->user();
        abort_unless(
            $user && ($user->role === Role::ADMIN
                || $user->role === Role::RIDER && (int) $payout->rider_id === (int) $user->id),
            403,
        );
        abort_unless($payout->status === 'PAID', 404, 'Rider payout receipt is unavailable.');

        $path = $payout->receipt_path;
        abort_unless(filled($path), 404, 'Rider payout receipt is unavailable.');
        $disk = Storage::disk('delivery_proofs');
        $previewPath = app(ImageUploadService::class)->previewPath($path);
        $usePreview = $disk->exists($previewPath);
        $streamPath = $usePreview ? $previewPath : $path;
        abort_unless($disk->exists($streamPath), 404, 'Rider payout receipt is unavailable.');

        return response()->stream(function () use ($disk, $streamPath): void {
            $stream = $disk->readStream($streamPath);
            if (! is_resource($stream)) {
                throw new \RuntimeException('The private rider payout receipt could not be opened.');
            }
            try {
                fpassthru($stream);
            } finally {
                fclose($stream);
            }
        }, 200, [
            'Content-Type' => $usePreview ? 'image/webp' : ($payout->receipt_mime_type ?? 'application/octet-stream'),
            'Content-Disposition' => 'inline; filename="farmgate-rider-payout-receipt"',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
            'X-Frame-Options' => 'DENY',
        ]);
    }

    /**
     * @return array<string, string|null>|null
     */
    private function destinationSummary(?RiderPayoutDestination $destination): ?array
    {
        return $destination?->maskedSummary();
    }

    private function payoutReference(int $id): string
    {
        return 'RPO-'.str_pad((string) $id, 8, '0', STR_PAD_LEFT);
    }

    private function safeReason(string $reason, ?RiderPayoutDestination $destination): string
    {
        if ($destination) {
            foreach ([$destination->account_holder, $destination->bank_name, $destination->account_number, $destination->wallet_number] as $privateValue) {
                if (filled($privateValue)) {
                    $reason = str_ireplace((string) $privateValue, '[destination detail redacted]', $reason);
                    $normalized = preg_replace('/\\s+/', '', (string) $privateValue) ?? (string) $privateValue;
                    if ($normalized !== $privateValue) {
                        $reason = str_ireplace($normalized, '[destination detail redacted]', $reason);
                    }
                }
            }
        }

        return trim(preg_replace('/(?<!\\d)(?:\\d[ -]?){3,}\\d(?!\\d)/u', '[masked digits]', $reason) ?? $reason);
    }

    private function admin(Request $request): void
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
    }
}
