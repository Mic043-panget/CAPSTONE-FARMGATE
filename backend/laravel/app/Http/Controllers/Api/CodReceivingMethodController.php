<?php

namespace App\Http\Controllers\Api;

use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\CodReceivingMethod;
use App\Models\CodReceivingMethodHistory;
use App\Services\PaymentProviderReadinessService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Throwable;

class CodReceivingMethodController extends Controller
{
    public function adminIndex(Request $request): JsonResponse
    {
        $this->admin($request);

        return response()->json([
            'methods' => CodReceivingMethod::query()->with(['histories.actor:id,name'])->latest()->get()
                ->map(fn (CodReceivingMethod $method): array => $this->adminPayload($method)),
        ]);
    }

    public function riderIndex(Request $request, PaymentProviderReadinessService $providers): JsonResponse
    {
        abort_unless($request->user()?->role === Role::RIDER, 403);
        $paymongoReady = $providers->paymongo()['qr_receiving_ready'];

        return response()->json([
            'methods' => CodReceivingMethod::query()
                ->where('status', 'ACTIVE')
                ->where(function ($query) use ($paymongoReady): void {
                    $query->whereIn('method_type', ['BANK_TRANSFER', 'BANK_QR']);
                    if ($paymongoReady) {
                        $query->orWhere('method_type', 'PAYMONGO_QR');
                    }
                })
                ->orderBy('label')->get()
                ->map(fn (CodReceivingMethod $method): array => [
                    'id' => $method->id,
                    'method_type' => $method->method_type,
                    'label' => $method->label,
                    'instructions' => $method->instructions,
                    'account_holder' => $method->account_holder,
                    'bank_name' => $method->bank_name,
                    'account_number' => $method->account_number,
                    'account_number_masked' => $this->mask($method->account_number),
                    'qr_url' => $method->qr_path ? route('cod-receiving-methods.qr', $method) : null,
                ]),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $this->admin($request);
        $data = $request->validate([
            'method_type' => ['required', Rule::in(['BANK_TRANSFER', 'BANK_QR', 'PAYMONGO_QR'])],
            'label' => ['required', 'string', 'max:100'],
            'instructions' => ['required', 'string', 'max:1000'],
            'account_holder' => ['required', 'string', 'max:120'],
            'bank_name' => ['required', 'string', 'max:100'],
            'account_number' => ['required', 'string', 'min:5', 'max:40', 'regex:/^[A-Za-z0-9 -]+$/'],
            'qr' => ['nullable', 'image', 'mimes:jpeg,jpg,png,webp', 'max:5120'],
        ]);
        if (in_array($data['method_type'], ['BANK_QR', 'PAYMONGO_QR'], true) && ! $request->hasFile('qr')) {
            abort(422, 'A bank receiving QR image is required.');
        }

        $path = null;
        $mime = null;
        if ($request->hasFile('qr')) {
            $file = $request->file('qr');
            $extension = $file->guessExtension();
            abort_if(! $extension, 422, 'The receiving QR image type could not be identified.');
            $path = 'cod-receiving-qr/'.Str::random(40).'.'.$extension;
            $mime = $file->getMimeType() ?? 'application/octet-stream';
            try {
                abort_unless($file->storeAs('cod-receiving-qr', basename($path), 'delivery_proofs') === $path, 500, 'The receiving QR image could not be securely stored.');
            } catch (Throwable $exception) {
                Storage::disk('delivery_proofs')->delete($path);
                throw $exception;
            }
        }

        try {
            $method = DB::transaction(function () use ($data, $request, $path, $mime): CodReceivingMethod {
                $method = CodReceivingMethod::query()->create([
                    'method_type' => $data['method_type'],
                    'label' => trim($data['label']),
                    'instructions' => trim($data['instructions']),
                    'account_holder' => trim($data['account_holder']),
                    'bank_name' => trim($data['bank_name']),
                    'account_number' => trim($data['account_number']),
                    'qr_path' => $path,
                    'qr_mime_type' => $mime,
                    'status' => 'PENDING_VERIFICATION',
                    'configured_by' => $request->user()->id,
                ]);
                CodReceivingMethodHistory::query()->create([
                    'cod_receiving_method_id' => $method->id,
                    'actor_id' => $request->user()->id,
                    'action' => 'CONFIGURED',
                    'to_status' => $method->status,
                    'reason' => 'Receiving method saved and requires a separate administrator verification.',
                ]);

                return $method;
            });
        } catch (Throwable $exception) {
            if ($path !== null) {
                Storage::disk('delivery_proofs')->delete($path);
            }
            throw $exception;
        }

        return response()->json([
            'message' => 'Receiving method saved inactive. A different administrator must verify that the details direct funds to Farmgate.',
            'method' => $this->adminPayload($method),
        ], 201);
    }

    public function verify(Request $request, CodReceivingMethod $method, PaymentProviderReadinessService $providers): JsonResponse
    {
        $this->admin($request);
        $data = $request->validate([
            'reason' => ['required', 'string', 'min:12', 'max:1000'],
            'receiving_only_confirmed' => ['required', 'accepted'],
        ]);
        if ($method->method_type === 'PAYMONGO_QR') {
            abort_unless(
                $providers->paymongo()['qr_receiving_ready'],
                503,
                'PayMongo receiving QR is pending until server credentials, webhook signing configuration, and provider verification are complete.',
            );
        }

        DB::transaction(function () use ($request, $method, $data): void {
            $locked = CodReceivingMethod::query()->lockForUpdate()->findOrFail($method->id);
            abort_unless($locked->status === 'PENDING_VERIFICATION', 409, 'Only a pending receiving method can be verified.');
            abort_unless($locked->configured_by !== $request->user()->id, 409, 'A different administrator must verify the receiving destination.');
            abort_unless(filled($locked->account_number) && filled($locked->account_holder), 409, 'Receiving account details are incomplete.');
            abort_unless(! in_array($locked->method_type, ['BANK_QR', 'PAYMONGO_QR'], true) || filled($locked->qr_path), 409, 'The receiving QR is missing.');
            $reason = $this->safeReason($locked, $data['reason']);
            $request->merge(['reason' => $reason]);
            $locked->forceFill([
                'status' => 'ACTIVE',
                'verified_by' => $request->user()->id,
                'verified_at' => now(),
                'verification_reason' => $reason,
            ])->save();
            CodReceivingMethodHistory::query()->create([
                'cod_receiving_method_id' => $locked->id,
                'actor_id' => $request->user()->id,
                'action' => 'VERIFIED',
                'from_status' => 'PENDING_VERIFICATION',
                'to_status' => 'ACTIVE',
                'reason' => $reason,
            ]);
        });

        return response()->json(['method' => $this->adminPayload($method->fresh(['histories.actor:id,name']))]);
    }

    public function update(Request $request, CodReceivingMethod $method): JsonResponse
    {
        $this->admin($request);
        $data = $request->validate([
            'label' => ['sometimes', 'required', 'string', 'max:100'],
            'instructions' => ['sometimes', 'required', 'string', 'max:1000'],
            'account_holder' => ['sometimes', 'nullable', 'string', 'max:120'],
            'bank_name' => ['sometimes', 'required', 'string', 'max:100'],
            'account_number' => ['sometimes', 'nullable', 'string', 'min:5', 'max:40', 'regex:/^[A-Za-z0-9 -]+$/'],
            'qr' => ['nullable', 'image', 'mimes:jpeg,jpg,png,webp', 'max:5120'],
            'reason' => ['required', 'string', 'min:8', 'max:1000'],
        ]);
        if (array_key_exists('account_holder', $data) && blank($data['account_holder'])) {
            unset($data['account_holder']);
        }
        if (array_key_exists('account_number', $data) && blank($data['account_number'])) {
            unset($data['account_number']);
        }

        $path = null;
        $mime = null;
        if ($request->hasFile('qr')) {
            $file = $request->file('qr');
            $extension = $file->guessExtension();
            abort_unless($extension, 422, 'The receiving QR image type could not be identified.');
            $path = 'cod-receiving-qr/'.Str::random(40).'.'.$extension;
            $mime = $file->getMimeType() ?? 'application/octet-stream';
            try {
                abort_unless($file->storeAs('cod-receiving-qr', basename($path), 'delivery_proofs') === $path, 500, 'The receiving QR image could not be securely stored.');
            } catch (Throwable $exception) {
                Storage::disk('delivery_proofs')->delete($path);
                throw $exception;
            }
        }

        try {
            $oldPath = DB::transaction(function () use ($request, $method, $data, $path, $mime): ?string {
                $locked = CodReceivingMethod::query()->lockForUpdate()->findOrFail($method->id);
                $changes = array_intersect_key($data, array_flip(['label', 'instructions', 'account_holder', 'bank_name', 'account_number']));
                foreach (['label', 'instructions', 'account_holder', 'bank_name', 'account_number'] as $field) {
                    if (isset($changes[$field])) {
                        $changes[$field] = trim($changes[$field]);
                    }
                }
                abort_if($changes === [] && $path === null, 422, 'Change at least one receiving detail or QR image.');
                $reason = $this->safeReason($locked, $data['reason']);
                $request->merge(['reason' => $reason]);
                $previous = $locked->status;
                $oldPath = $path !== null ? $locked->qr_path : null;
                $locked->forceFill([
                    ...$changes,
                    ...($path !== null ? ['qr_path' => $path, 'qr_mime_type' => $mime] : []),
                    'status' => 'PENDING_VERIFICATION',
                    'configured_by' => $request->user()->id,
                    'verified_by' => null,
                    'verified_at' => null,
                    'verification_reason' => null,
                ])->save();
                CodReceivingMethodHistory::query()->create([
                    'cod_receiving_method_id' => $locked->id,
                    'actor_id' => $request->user()->id,
                    'action' => 'CONFIGURATION_UPDATED',
                    'from_status' => $previous,
                    'to_status' => 'PENDING_VERIFICATION',
                    'reason' => $reason,
                ]);

                return $oldPath;
            });
        } catch (Throwable $exception) {
            if ($path !== null) {
                Storage::disk('delivery_proofs')->delete($path);
            }
            throw $exception;
        }
        if ($oldPath !== null) {
            Storage::disk('delivery_proofs')->delete($oldPath);
        }

        return response()->json([
            'message' => 'Receiving details updated and returned to pending verification. A different administrator must verify them.',
            'method' => $this->adminPayload($method->fresh(['histories.actor:id,name'])),
        ]);
    }

    public function deactivate(Request $request, CodReceivingMethod $method): JsonResponse
    {
        $this->admin($request);
        $data = $request->validate(['reason' => ['required', 'string', 'min:8', 'max:1000']]);

        DB::transaction(function () use ($request, $method, $data): void {
            $locked = CodReceivingMethod::query()->lockForUpdate()->findOrFail($method->id);
            abort_unless($locked->status === 'ACTIVE', 409, 'Only an active receiving method can be disabled.');
            $reason = $this->safeReason($locked, $data['reason']);
            $request->merge(['reason' => $reason]);
            $previous = $locked->status;
            $locked->forceFill(['status' => 'DISABLED'])->save();
            CodReceivingMethodHistory::query()->create([
                'cod_receiving_method_id' => $locked->id,
                'actor_id' => $request->user()->id,
                'action' => 'DISABLED',
                'from_status' => $previous,
                'to_status' => 'DISABLED',
                'reason' => $reason,
            ]);
        });

        return response()->json(['method' => $this->adminPayload($method->fresh(['histories.actor:id,name']))]);
    }

    public function enable(Request $request, CodReceivingMethod $method): JsonResponse
    {
        $this->admin($request);
        $data = $request->validate(['reason' => ['required', 'string', 'min:8', 'max:1000']]);

        DB::transaction(function () use ($request, $method, $data): void {
            $locked = CodReceivingMethod::query()->lockForUpdate()->findOrFail($method->id);
            abort_unless($locked->status === 'DISABLED', 409, 'Only a disabled receiving method can be re-enabled.');
            $reason = $this->safeReason($locked, $data['reason']);
            $previous = $locked->status;
            $locked->forceFill([
                'status' => 'PENDING_VERIFICATION',
                'configured_by' => $request->user()->id,
                'verified_by' => null,
                'verified_at' => null,
                'verification_reason' => null,
            ])->save();
            CodReceivingMethodHistory::query()->create([
                'cod_receiving_method_id' => $locked->id,
                'actor_id' => $request->user()->id,
                'action' => 'REACTIVATION_REQUESTED',
                'from_status' => $previous,
                'to_status' => 'PENDING_VERIFICATION',
                'reason' => $reason,
            ]);
        });

        return response()->json([
            'message' => 'Reactivation requested. A different administrator must verify this receiving method before it is available to riders.',
            'method' => $this->adminPayload($method->fresh(['histories.actor:id,name'])),
        ]);
    }

    public function qr(Request $request, CodReceivingMethod $method, PaymentProviderReadinessService $providers): StreamedResponse
    {
        $user = $request->user();
        abort_unless($user && ($user->role === Role::ADMIN || $user->role === Role::RIDER), 403);
        abort_if(
            $method->method_type === 'PAYMONGO_QR' && ! $providers->paymongo()['qr_receiving_ready'],
            404,
            'PayMongo receiving QR is unavailable until provider configuration is ready.',
        );
        abort_unless($method->status === 'ACTIVE' || $user->role === Role::ADMIN && $method->status === 'PENDING_VERIFICATION', 404);
        abort_unless(filled($method->qr_path), 404, 'Receiving QR is unavailable.');
        $disk = Storage::disk('delivery_proofs');
        abort_unless($disk->exists($method->qr_path), 404, 'Receiving QR could not be found.');

        return response()->stream(function () use ($disk, $method): void {
            $stream = $disk->readStream($method->qr_path);
            if (! is_resource($stream)) {
                throw new \RuntimeException('Receiving QR could not be opened.');
            }
            try {
                fpassthru($stream);
            } finally {
                fclose($stream);
            }
        }, 200, [
            'Content-Type' => $method->qr_mime_type ?? 'application/octet-stream',
            'Content-Disposition' => 'inline; filename="farmgate-cod-receiving-qr"',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
            'X-Frame-Options' => 'DENY',
        ]);
    }

    private function adminPayload(CodReceivingMethod $method): array
    {
        return [
            'id' => $method->id,
            'method_type' => $method->method_type,
            'label' => $method->label,
            'instructions' => $method->instructions,
            'account_holder_masked' => $this->mask($method->account_holder),
            'bank_name' => $method->bank_name,
            'account_number_masked' => $this->mask($method->account_number),
            'qr_url' => $method->qr_path ? route('cod-receiving-methods.qr', $method) : null,
            'status' => $method->status,
            'configured_by' => $method->configured_by,
            'verified_by' => $method->verified_by,
            'verified_at' => $method->verified_at?->toISOString(),
            'verification_reason' => $method->verification_reason,
            'histories' => $method->histories ?? [],
        ];
    }

    private function mask(?string $value): ?string
    {
        if (! filled($value)) {
            return null;
        }

        return '•••• '.substr(preg_replace('/\s+/', '', $value) ?: '', -4);
    }

    private function safeReason(CodReceivingMethod $method, string $reason): string
    {
        $reason = preg_replace('/(?<!\d)(?:\d[ -]?){7,}\d(?!\d)/u', '[masked digits]', $reason) ?? $reason;
        foreach ([$method->account_holder, $method->bank_name, $method->account_number] as $privateValue) {
            if (filled($privateValue)) {
                $reason = str_ireplace((string) $privateValue, '[receiving detail redacted]', $reason);
            }
        }

        return trim($reason);
    }

    private function admin(Request $request): void
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
    }
}
