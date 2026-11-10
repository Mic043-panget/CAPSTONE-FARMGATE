<?php

namespace App\Http\Controllers\Api;

use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\CodCollection;
use App\Models\CodReceivingMethod;
use App\Models\CodRemittance;
use App\Models\Delivery;
use App\Models\Order;
use App\Models\SellerPayout;
use App\Models\SellerPayoutDestination;
use App\Models\SellerPayoutPolicy;
use App\Services\CodRemittanceService;
use App\Services\PaymentProviderReadinessService;
use App\Services\SellerPayoutPolicyService;
use App\Services\SystemSettingsService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Throwable;

class CodRemittanceController extends Controller
{
    public function riderCollections(Request $request, CodRemittanceService $service): JsonResponse
    {
        abort_unless($request->user()?->role === Role::RIDER, 403);
        $collections = $service->pendingCollections($request->user());
        $collections->each(fn ($collection) => $collection->setAttribute(
            'proof_url',
            filled($collection->proof_path) ? route('cod-collections.proof', $collection) : null,
        ));

        return response()->json([
            'collections' => $collections,
            'total_amount_cents' => $collections->sum('collected_amount_cents'),
        ]);
    }

    public function collect(Request $request, Delivery $delivery, CodRemittanceService $service): JsonResponse
    {
        abort_unless($request->user()?->role === Role::RIDER, 403);
        $data = $request->validate([
            'amount_cents' => ['required', 'integer', 'min:1', 'max:99999999999'],
            'proof' => ['required', 'file', 'image', 'mimes:jpeg,jpg,png,webp', 'max:10240'],
        ]);
        $file = $request->file('proof');
        $extension = $file->guessExtension();
        abort_if(! $extension, 422, 'The uploaded COD proof type could not be identified.');
        $path = Str::random(40).'.'.$extension;
        try {
            $storedPath = $file->storeAs('cod-collection-proofs', $path, 'delivery_proofs');
            $sha256 = hash_file('sha256', $file->getRealPath());
            abort_unless($storedPath === 'cod-collection-proofs/'.$path && Storage::disk('delivery_proofs')->exists($storedPath) && is_string($sha256), 500, 'The COD proof could not be securely stored.');
            $collection = $service->collectCash(
                $delivery,
                $request->user(),
                (int) $data['amount_cents'],
                $storedPath,
                $sha256,
                $file->getMimeType() ?? 'application/octet-stream',
            );
        } catch (Throwable $exception) {
            Storage::disk('delivery_proofs')->delete('cod-collection-proofs/'.$path);
            throw $exception;
        }

        return response()->json([
            'message' => $collection->status === 'NEEDS_REVIEW'
                ? 'Cash collection recorded with a difference. It remains unpaid and requires admin review.'
                : 'Cash collection evidence saved. The buyer payment remains unpaid until Farmgate admin reconciles the remittance.',
            'collection' => $collection,
        ], 201);
    }

    public function collectionProof(Request $request, CodCollection $collection): StreamedResponse
    {
        abort_unless($request->user()?->role === Role::ADMIN
            || $request->user()?->role === Role::RIDER && $collection->rider_id === $request->user()->id, 403);
        abort_unless(filled($collection->proof_path), 404, 'COD collection proof is unavailable.');
        $disk = Storage::disk('delivery_proofs');
        abort_unless($disk->exists($collection->proof_path), 404, 'COD collection proof could not be found.');
        $proofPath = $collection->proof_path;

        return response()->stream(function () use ($disk, $proofPath): void {
            $stream = $disk->readStream($proofPath);
            if (! is_resource($stream)) {
                throw new \RuntimeException('COD collection proof could not be opened.');
            }
            try {
                fpassthru($stream);
            } finally {
                fclose($stream);
            }
        }, 200, [
            'Content-Type' => $collection->proof_mime_type ?? 'application/octet-stream',
            'Content-Disposition' => 'inline; filename="cod-collection-proof"',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
            'X-Frame-Options' => 'DENY',
        ]);
    }

    public function submit(Request $request, CodRemittanceService $service): JsonResponse
    {
        abort_unless($request->user()?->role === Role::RIDER, 403);
        $data = $request->validate([
            'method_type' => ['required', Rule::in(['CASH_HANDOVER', 'BANK_TRANSFER', 'BANK_QR', 'PAYMONGO_QR'])],
            'receiver_name' => ['required_if:method_type,CASH_HANDOVER', 'prohibited_unless:method_type,CASH_HANDOVER', 'nullable', 'string', 'min:2', 'max:120'],
            'receiving_method_id' => ['required_if:method_type,BANK_TRANSFER,BANK_QR,PAYMONGO_QR', 'prohibited_unless:method_type,BANK_TRANSFER,BANK_QR,PAYMONGO_QR', 'nullable', 'integer', 'min:1'],
            'transaction_reference' => ['required_if:method_type,BANK_TRANSFER,BANK_QR,PAYMONGO_QR', 'prohibited_unless:method_type,BANK_TRANSFER,BANK_QR,PAYMONGO_QR', 'nullable', 'string', 'min:4', 'max:120', 'regex:/^[A-Za-z0-9._:-]+$/'],
            'proof' => ['required_if:method_type,BANK_TRANSFER,BANK_QR,PAYMONGO_QR', 'nullable', 'file', 'image', 'mimes:jpeg,jpg,png,webp', 'max:10240'],
        ]);
        $method = filled($data['receiving_method_id'] ?? null)
            ? CodReceivingMethod::query()->whereKey($data['receiving_method_id'])->where('status', 'ACTIVE')->firstOrFail()
            : null;
        $file = $request->file('proof');
        $path = null;
        $sha256 = null;
        $mime = null;
        if ($file) {
            $extension = $file->guessExtension();
            abort_if(! $extension, 422, 'The remittance proof type could not be identified.');
            $path = 'cod-remittance-proofs/'.Str::random(40).'.'.$extension;
            $mime = $file->getMimeType() ?? 'application/octet-stream';
            $storedPath = $file->storeAs('cod-remittance-proofs', basename($path), 'delivery_proofs');
            $sha256 = hash_file('sha256', $file->getRealPath());
            abort_unless($storedPath === $path && Storage::disk('delivery_proofs')->exists($path) && is_string($sha256), 500, 'The remittance proof could not be securely stored.');
        }
        try {
            $remittance = $service->submitRemittance(
                $request->user(),
                $data['method_type'],
                $method,
                $data['receiver_name'] ?? null,
                $data['transaction_reference'] ?? null,
                $path,
                $sha256,
                $mime,
            );
        } catch (Throwable $exception) {
            if ($path !== null) {
                Storage::disk('delivery_proofs')->delete($path);
            }
            throw $exception;
        }

        return response()->json([
            'message' => 'COD cash remittance submitted for admin reconciliation. Submitted proof is not confirmation of receipt.',
            'remittance' => $this->remittancePayload($remittance),
        ], 201);
    }

    public function riderRemittances(Request $request): JsonResponse
    {
        abort_unless($request->user()?->role === Role::RIDER, 403);
        $remittances = CodRemittance::query()
            ->where('rider_id', $request->user()->id)
            ->latest('submitted_at')
            ->limit(100)
            ->get();

        return response()->json(['remittances' => $remittances->map(fn (CodRemittance $item): array => $this->remittancePayload($item))])
            ->header('Cache-Control', 'private, no-store');
    }

    public function adminRemittances(Request $request): JsonResponse
    {
        $this->admin($request);
        $data = $request->validate([
            'search' => ['nullable', 'string', 'max:120'],
            'status' => ['nullable', Rule::in(['SUBMITTED', 'DISPUTED', 'RECONCILED'])],
            'method' => ['nullable', Rule::in(['CASH_HANDOVER', 'BANK_TRANSFER', 'BANK_QR', 'PAYMONGO_QR'])],
            'sort' => ['nullable', Rule::in(['newest', 'oldest', 'amount_desc', 'amount_asc', 'reference_asc', 'reference_desc'])],
            'per_page' => ['nullable', 'integer', 'min:5', 'max:50'],
        ]);
        $query = CodRemittance::query()
            ->with(['rider:id,name', 'submitter:id,name', 'receiver:id,name', 'histories.actor:id,name', 'receivingMethod', 'collections.order:id,order_reference,total_amount', 'collections.delivery:id,delivery_reference'])
            ->withCount('collections');
        if (filled($data['status'] ?? null)) {
            $query->where('status', $data['status']);
        }
        if (filled($data['method'] ?? null)) {
            if ($data['method'] === 'BANK_QR') {
                $query->whereIn('method_type', ['BANK_QR', 'PAYMONGO_QR']);
            } else {
                $query->where('method_type', $data['method']);
            }
        }
        if (filled($data['search'] ?? null)) {
            $term = trim($data['search']);
            $query->where(function (Builder $search) use ($term): void {
                $search->where('reference', 'like', '%'.$term.'%')
                    ->orWhereHas('rider', fn (Builder $rider) => $rider->where('name', 'like', '%'.$term.'%'))
                    ->orWhereHas('collections.order', fn (Builder $order) => $order->where('order_reference', 'like', '%'.$term.'%'))
                    ->orWhereHas('collections.delivery', fn (Builder $delivery) => $delivery->where('delivery_reference', 'like', '%'.$term.'%'));
            });
        }
        $query = match ($data['sort'] ?? 'newest') {
            'oldest' => $query->orderBy('submitted_at')->orderBy('id'),
            'amount_desc' => $query->orderByDesc('expected_amount_cents')->orderByDesc('id'),
            'amount_asc' => $query->orderBy('expected_amount_cents')->orderBy('id'),
            'reference_asc' => $query->orderBy('reference')->orderBy('id'),
            'reference_desc' => $query->orderByDesc('reference')->orderByDesc('id'),
            default => $query->orderByDesc('submitted_at')->orderByDesc('id'),
        };
        $remittances = $query->paginate((int) ($data['per_page'] ?? 10))->withQueryString();
        $remittances->getCollection()->each(function ($remittance): void {
            $remittance->setAttribute('evidence_url', filled($remittance->evidence_path) ? route('cod-remittances.proof', $remittance) : null);
            $remittance->collections->each(fn ($collection) => $collection->setAttribute(
                'proof_url',
                filled($collection->proof_path) ? route('cod-collections.proof', $collection) : null,
            ));
        });

        return response()->json(['remittances' => $remittances]);
    }

    public function reconcile(Request $request, CodRemittance $remittance, CodRemittanceService $service): JsonResponse
    {
        $this->admin($request);
        $data = $request->validate([
            'received_amount_cents' => ['required', 'integer', 'min:0', 'max:99999999999'],
            'verification_confirmed' => ['required', 'accepted'],
            'reason' => ['required', 'string', 'min:8', 'max:1000'],
        ]);

        return response()->json([
            'message' => 'Cash receipt and reconciliation recorded.',
            'remittance' => $service->reconcile($remittance, $request->user(), (int) $data['received_amount_cents'], $data['reason']),
        ]);
    }

    public function adminPayouts(Request $request): JsonResponse
    {
        $this->admin($request);
        $data = $request->validate([
            'group' => ['nullable', Rule::in(['queue', 'recorded'])],
            'search' => ['nullable', 'string', 'max:120'],
            'status' => ['nullable', Rule::in(['PENDING_SETUP', 'PENDING', 'PROCESSING', 'FAILED', 'PAID', 'RETURNED', 'DISPUTED'])],
            'sort' => ['nullable', Rule::in(['newest', 'oldest', 'amount_desc', 'amount_asc'])],
            'per_page' => ['nullable', 'integer', 'min:5', 'max:50'],
        ]);
        $group = $data['group'] ?? 'queue';
        $query = SellerPayout::query()
            ->with(['order:id,order_reference', 'seller:id,name', 'recorder:id,name', 'destination', 'histories.actor:id,name'])
            ->when(
                $group === 'recorded',
                fn (Builder $payouts) => $payouts->whereIn('status', ['PAID', 'RETURNED', 'DISPUTED']),
                fn (Builder $payouts) => $payouts->whereIn('status', ['PENDING_SETUP', 'PENDING', 'PROCESSING', 'FAILED']),
            );
        if (filled($data['status'] ?? null)) {
            $query->where('status', $data['status']);
        }
        if (filled($data['search'] ?? null)) {
            $term = trim($data['search']);
            $query->where(function (Builder $search) use ($term): void {
                $search->whereHas('order', fn (Builder $order) => $order->where('order_reference', 'like', '%'.$term.'%'))
                    ->orWhereHas('seller', fn (Builder $seller) => $seller->where('name', 'like', '%'.$term.'%'));
            });
        }
        $query = match ($data['sort'] ?? 'newest') {
            'oldest' => $query->orderBy('created_at')->orderBy('id'),
            'amount_desc' => $query->orderByDesc('amount_cents')->orderByDesc('id'),
            'amount_asc' => $query->orderBy('amount_cents')->orderBy('id'),
            default => $query->orderByDesc('created_at')->orderByDesc('id'),
        };
        $payouts = $query->paginate((int) ($data['per_page'] ?? 10))->withQueryString();
        $payouts->getCollection()->each(function (SellerPayout $payout): void {
            $payout->setAttribute('receipt_url', filled($payout->receipt_path) ? route('seller-payouts.receipt', $payout) : null);
            $destination = $payout->destination ?? SellerPayoutDestination::query()
                ->where('seller_id', $payout->seller_id)
                ->where('status', 'VERIFIED')
                ->first();
            $payout->setAttribute('destination_masked', $this->destinationSummary($destination));
            $eligibility = app(SellerPayoutPolicyService::class)->eligibility($payout->seller_id);
            $payout->setAttribute('seller_payout_eligible', $eligibility['eligible']);
            $payout->setAttribute('eligibility_unmet', $eligibility['unmet']);
            $payout->unsetRelation('destination');
        });

        return response()->json(['payouts' => $payouts]);
    }

    public function adminSummary(
        Request $request,
        SystemSettingsService $settings,
        SellerPayoutPolicyService $policies,
        PaymentProviderReadinessService $providers,
    ): JsonResponse {
        $this->admin($request);

        $awaiting = CodRemittance::query()->whereIn('status', ['SUBMITTED', 'DISPUTED']);
        $confirmed = CodRemittance::query()->where('status', 'RECONCILED');
        $pendingPayouts = SellerPayout::query()->whereIn('status', ['PENDING_SETUP', 'PENDING', 'PROCESSING', 'FAILED']);
        $recordedPayouts = SellerPayout::query()->whereIn('status', ['PAID', 'RETURNED', 'DISPUTED']);
        $effectivePolicy = $policies->effective();
        $paymongo = $providers->paymongo();
        $verifiedDestinations = SellerPayoutDestination::query()->where('status', 'VERIFIED')->count();
        $payoutPrerequisites = [];
        if (! $effectivePolicy) {
            $payoutPrerequisites[] = 'Publish an approved seller payout policy that is effective today.';
        }
        if ($verifiedDestinations < 1) {
            $payoutPrerequisites[] = 'Verify at least one seller payout destination.';
        }

        return response()->json([
            'remittances_awaiting_review' => [
                'count' => (clone $awaiting)->count(),
                'amount_cents' => (int) (clone $awaiting)->sum('expected_amount_cents'),
            ],
            'confirmed_cod_received' => [
                'count' => (clone $confirmed)->count(),
                'amount_cents' => (int) (clone $confirmed)->sum('received_amount_cents'),
            ],
            'seller_payouts_pending' => [
                'count' => (clone $pendingPayouts)->count(),
                'amount_cents' => (int) (clone $pendingPayouts)->sum('amount_cents'),
            ],
            'recorded_payouts' => [
                'count' => (clone $recordedPayouts)->count(),
                'amount_cents' => (int) (clone $recordedPayouts)->sum('amount_cents'),
            ],
            'receiving_methods' => [
                'active_bank' => CodReceivingMethod::query()->where('status', 'ACTIVE')->where('method_type', 'BANK_TRANSFER')->count(),
                'active_qr' => CodReceivingMethod::query()->where('status', 'ACTIVE')->where('method_type', 'BANK_QR')->count()
                    + ($paymongo['qr_receiving_ready']
                        ? CodReceivingMethod::query()->where('status', 'ACTIVE')->where('method_type', 'PAYMONGO_QR')->count()
                        : 0),
                'pending_verification' => CodReceivingMethod::query()->where('status', 'PENDING_VERIFICATION')->count(),
            ],
            'seller_destinations' => [
                'verified' => SellerPayoutDestination::query()->where('status', 'VERIFIED')->count(),
                'pending_verification' => SellerPayoutDestination::query()->where('status', 'PENDING_VERIFICATION')->count(),
            ],
            'manual_seller_payouts_enabled' => $settings->getBoolean('manual_seller_payouts_enabled'),
            'payment_providers' => [
                'paymongo' => $paymongo,
            ],
            'paymongo_payouts_enabled' => $paymongo['seller_payouts_enabled'],
            'seller_payout_policy' => [
                'effective_policy_id' => $effectivePolicy?->id,
                'effective_version' => $effectivePolicy?->version,
                'effective_date' => $effectivePolicy?->effective_date?->toDateString(),
                'draft_count' => SellerPayoutPolicy::query()->where('status', 'DRAFT')->count(),
                'approved_count' => SellerPayoutPolicy::query()->where('status', 'APPROVED')->count(),
                'published_count' => SellerPayoutPolicy::query()->where('status', 'PUBLISHED')->count(),
            ],
            'manual_payout_prerequisites' => [
                'destination_approval_active' => true,
                'verified_destination_count' => $verifiedDestinations,
                'unmet' => $payoutPrerequisites,
            ],
        ])->header('Cache-Control', 'private, no-store');
    }

    public function payout(Request $request, Order $order, CodRemittanceService $service): JsonResponse
    {
        $this->admin($request);
        $data = $request->validate([
            'amount_cents' => ['required', 'integer', 'min:1', 'max:99999999999'],
            'reason' => ['required', 'string', 'min:8', 'max:500'],
        ]);
        $destination = SellerPayoutDestination::query()
            ->where('seller_id', $order->seller_id)
            ->where('status', 'VERIFIED')
            ->first();
        $data['reason'] = $this->safePayoutReason($data['reason'], $destination);
        $request->merge(['reason' => $data['reason']]);
        $payout = $service->recordManualPayout(
            $order,
            $request->user(),
            (int) $data['amount_cents'],
            $data['reason'],
        );

        return response()->json([
            'message' => 'Seller payout created as pending. No transfer was initiated or recorded.',
            'payout' => $payout,
        ], 201);
    }

    public function confirmManualPayout(Request $request, SellerPayout $payout, CodRemittanceService $service): JsonResponse
    {
        $this->admin($request);
        $data = $request->validate([
            'external_reference' => ['required', 'string', 'min:4', 'max:100', 'regex:/^[A-Za-z0-9._:-]+$/'],
            'amount_cents' => ['required', 'integer', 'min:1', 'max:99999999999'],
            'paid_at' => ['required', 'date', 'after_or_equal:'.$payout->created_at->toDateString(), 'before_or_equal:today'],
            'reason' => ['required', 'string', 'min:8', 'max:500'],
            'externally_completed_confirmed' => ['required', 'accepted'],
            'receipt' => ['nullable', 'file', 'mimes:jpg,jpeg,png,webp,pdf', 'max:10240'],
        ]);
        $data['reason'] = $this->safePayoutReason($data['reason'], $payout->payout_destination_id
            ? SellerPayoutDestination::query()->find($payout->payout_destination_id)
            : null);
        $request->merge(['reason' => $data['reason']]);
        $file = $request->file('receipt');
        $path = null;
        if ($file) {
            $extension = $file->guessExtension();
            abort_if(! $extension, 422, 'The payout receipt type could not be identified.');
            $path = 'seller-payout-receipts/'.Str::random(40).'.'.$extension;
            $storedPath = $file->storeAs('seller-payout-receipts', basename($path), 'delivery_proofs');
            abort_unless($storedPath === $path && Storage::disk('delivery_proofs')->exists($path), 500, 'The payout receipt could not be securely stored.');
        }

        try {
            $updated = $service->confirmManualPayout(
                $payout,
                $request->user(),
                $data['external_reference'],
                $data['reason'],
                $data['paid_at'],
                $path,
                $file?->getMimeType(),
                (int) $data['amount_cents'],
            );
        } catch (Throwable $exception) {
            if ($path) {
                Storage::disk('delivery_proofs')->delete($path);
            }
            throw $exception;
        }

        $request->merge(['reason' => $data['reason']]);

        return response()->json(['message' => 'Externally completed seller payout recorded in Farmgate.', 'payout' => $updated], 201);
    }

    public function updatePayoutStatus(Request $request, SellerPayout $payout, CodRemittanceService $service): JsonResponse
    {
        $this->admin($request);
        $data = $request->validate([
            'status' => ['required', Rule::in(['PENDING', 'FAILED', 'RETURNED', 'DISPUTED'])],
            'reason' => ['required', 'string', 'min:8', 'max:500'],
        ]);
        $destination = $payout->payout_destination_id
            ? SellerPayoutDestination::query()->find($payout->payout_destination_id)
            : null;
        $data['reason'] = $this->safePayoutReason($data['reason'], $destination);
        $request->merge(['reason' => $data['reason']]);

        return response()->json([
            'payout' => $service->updatePayoutStatus($payout, $request->user(), $data['status'], $data['reason']),
        ]);
    }

    public function sellerPayouts(Request $request): JsonResponse
    {
        abort_unless($request->user()?->role === Role::SELLER, 403);
        $payouts = SellerPayout::query()
            ->where('seller_id', $request->user()->id)
            ->with(['order:id,order_reference', 'destination', 'histories.actor:id,name'])
            ->latest()
            ->paginate(20);
        $payouts->getCollection()->each(function (SellerPayout $payout): void {
            $payout->setAttribute('receipt_url', filled($payout->receipt_path) ? route('seller-payouts.receipt', $payout) : null);
            $payout->setAttribute('destination_masked', $this->destinationSummary($payout->destination));
            $payout->unsetRelation('destination');
            $payout->unsetRelation('histories');
        });

        return response()->json(['payouts' => $payouts]);
    }

    public function remittanceProof(Request $request, CodRemittance $remittance): StreamedResponse
    {
        $user = $request->user();
        abort_unless($user && ($user->role === Role::ADMIN || $user->role === Role::RIDER && $remittance->rider_id === $user->id), 403);

        return $this->privateProofResponse($remittance->evidence_path, $remittance->evidence_mime_type, 'COD remittance proof is unavailable.');
    }

    public function payoutReceipt(Request $request, SellerPayout $payout): StreamedResponse
    {
        $user = $request->user();
        abort_unless($user && ($user->role === Role::ADMIN || $user->role === Role::SELLER && $payout->seller_id === $user->id), 403);

        return $this->privateProofResponse($payout->receipt_path, $payout->receipt_mime_type, 'Seller payout receipt is unavailable.');
    }

    private function remittancePayload(CodRemittance $remittance): array
    {
        return [
            'id' => $remittance->id,
            'reference' => $remittance->reference,
            'status' => $remittance->status,
            'method' => $remittance->method_type,
            'expected_amount_cents' => $remittance->expected_amount_cents,
            'received_amount_cents' => $remittance->received_amount_cents,
            'submitted_at' => $remittance->submitted_at?->toISOString(),
            'reconciled_at' => $remittance->reconciled_at?->toISOString(),
            'proof_url' => filled($remittance->evidence_path) ? route('cod-remittances.proof', $remittance) : null,
        ];
    }

    private function destinationSummary(?SellerPayoutDestination $destination): ?array
    {
        if (! $destination) {
            return null;
        }

        $number = $destination->destination_type === 'BANK' ? $destination->account_number : $destination->wallet_number;
        $digits = preg_replace('/\s+/', '', (string) $number) ?? '';

        return [
            'type' => $destination->destination_type,
            'account_holder' => collect(preg_split('/\s+/', trim((string) $destination->account_holder)) ?: [])
                ->filter()->map(fn (string $part): string => mb_substr($part, 0, 1).'***')->implode(' '),
            'institution' => $destination->destination_type === 'BANK'
                ? mb_substr(trim((string) $destination->bank_name), 0, 1).'***'
                : 'GCash',
            'identifier' => filled($digits) ? '•••• '.mb_substr($digits, -4) : null,
            'status' => $destination->status,
        ];
    }

    private function safePayoutReason(string $reason, ?SellerPayoutDestination $destination): string
    {
        if ($destination) {
            foreach ([$destination->account_holder, $destination->bank_name, $destination->account_number, $destination->wallet_number] as $privateValue) {
                if (filled($privateValue)) {
                    $reason = str_ireplace((string) $privateValue, '[destination detail redacted]', $reason);
                }
            }
        }

        return trim(preg_replace('/(?<!\d)(?:\d[ -]?){7,}\d(?!\d)/u', '[masked digits]', $reason) ?? $reason);
    }

    private function privateProofResponse(?string $path, ?string $mime, string $missingMessage): StreamedResponse
    {
        abort_unless(filled($path), 404, $missingMessage);
        $disk = Storage::disk('delivery_proofs');
        abort_unless($disk->exists($path), 404, $missingMessage);

        return response()->stream(function () use ($disk, $path): void {
            $stream = $disk->readStream($path);
            if (! is_resource($stream)) {
                throw new \RuntimeException('The private payment evidence could not be opened.');
            }
            try {
                fpassthru($stream);
            } finally {
                fclose($stream);
            }
        }, 200, [
            'Content-Type' => $mime ?? 'application/octet-stream',
            'Content-Disposition' => 'inline; filename="farmgate-payment-evidence"',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
            'X-Frame-Options' => 'DENY',
        ]);
    }

    private function admin(Request $request): void
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
    }
}
