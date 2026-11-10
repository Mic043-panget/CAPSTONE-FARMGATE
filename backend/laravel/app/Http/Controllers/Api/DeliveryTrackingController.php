<?php

namespace App\Http\Controllers\Api;

use App\Enums\DeliveryStatus;
use App\Enums\OrderStatus;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\Delivery;
use App\Models\DeliveryProofCorrection;
use App\Models\Order;
use App\Notifications\DeliveryAssignmentNotification;
use App\Services\DeliveryVerificationService;
use App\Services\MapTrackingService;
use App\Services\SystemSettingsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Throwable;

class DeliveryTrackingController extends Controller
{
    public function issueCode(Request $request, Order $order, DeliveryVerificationService $verification): JsonResponse
    {
        $user = $request->user();
        abort_unless($user && (
            $user->role === Role::BUYER && $order->buyer_id === $user->id
            || $user->role === Role::SELLER && $order->seller_id === $user->id
        ), 403);
        abort_unless($order->delivery_method === 'STANDARD_DELIVERY', 422, 'QR verification is only available for standard deliveries.');

        $purpose = $user->role === Role::SELLER ? 'pickup' : 'delivery';

        return response()->json($verification->issueCode($order, $purpose));
    }

    public function updateLocation(Request $request, Delivery $delivery): JsonResponse
    {
        abort_unless($request->user()?->role === Role::RIDER, 403);
        abort_if($delivery->rider_id !== $request->user()->id, 403);

        $data = $request->validate([
            'latitude' => ['required', 'numeric', 'between:-90,90'],
            'longitude' => ['required', 'numeric', 'between:-180,180'],
            'observed_at' => ['required', 'date', 'before_or_equal:now'],
        ]);

        $updated = DB::transaction(function () use ($delivery, $request, $data): Delivery {
            $locked = Delivery::query()->lockForUpdate()->findOrFail($delivery->id);
            abort_if($locked->rider_id !== $request->user()->id, 403);
            abort_unless(in_array($locked->status, [
                DeliveryStatus::RIDER_ACCEPTED,
                DeliveryStatus::PICKUP_PENDING,
                DeliveryStatus::PICKED_UP,
                DeliveryStatus::IN_TRANSIT,
            ], true), 409, 'Location sharing is only available for an active delivery.');
            $capturedAt = Carbon::parse($data['observed_at']);
            abort_if(
                $locked->rider_location_captured_at
                    && $capturedAt->lessThanOrEqualTo($locked->rider_location_captured_at),
                409,
                'A duplicate or older delivery location was ignored.',
            );

            $locked->forceFill([
                'rider_location_latitude' => $data['latitude'],
                'rider_location_longitude' => $data['longitude'],
                'rider_location_captured_at' => $capturedAt,
                'rider_location_updated_at' => now(),
            ])->save();

            return $locked;
        });

        return response()->json([
            'message' => 'Rider location updated.',
            'delivery' => $updated,
        ]);
    }

    public function tracking(Request $request, Delivery $delivery, MapTrackingService $mapService): JsonResponse
    {
        $user = $request->user();
        abort_unless(
            $user && (
                $user->role === Role::RIDER && $delivery->rider_id === $user->id
                || $user->role === Role::SELLER && $delivery->order->seller_id === $user->id
                || $user->role === Role::BUYER && $delivery->order->buyer_id === $user->id
            ),
            403,
        );

        $delivery->loadMissing('rider:id,name');
        $pickupLat = $delivery->pickup_latitude;
        $pickupLng = $delivery->pickup_longitude;
        $riderLat = $delivery->rider_location_latitude;
        $riderLng = $delivery->rider_location_longitude;
        $map = $pickupLat !== null && $pickupLng !== null
            ? $mapService->getMapMetadata(
                (float) $pickupLat,
                (float) $pickupLng,
                (float) ($riderLat ?? $pickupLat),
                (float) ($riderLng ?? $pickupLng),
            )
            : null;

        return response()->json([
            'delivery' => [
                'id' => $delivery->id,
                'status' => $delivery->status->value,
                'pickup_address' => $delivery->pickup_address,
                'rider' => $delivery->rider ? ['name' => $delivery->rider->name] : null,
                'rider_location_latitude' => $riderLat,
                'rider_location_longitude' => $riderLng,
                'rider_location_updated_at' => $delivery->rider_location_updated_at?->toISOString(),
                'rider_location_captured_at' => $delivery->rider_location_captured_at?->toISOString(),
                'pickup_verified_at' => $delivery->pickup_verified_at?->toISOString(),
                'delivery_verified_at' => $delivery->delivery_verified_at?->toISOString(),
                'has_delivery_proof' => $delivery->has_delivery_proof,
                'recipient_confirmed' => $delivery->recipient_confirmed,
                'delivery_recipient_name' => $delivery->delivery_recipient_name,
                'proof_captured_at' => $delivery->proof_captured_at?->toISOString(),
                'proof_recorded_at' => $delivery->proof_recorded_at?->toISOString(),
                'proof_url' => $delivery->has_delivery_proof ? route('deliveries.proof', $delivery) : null,
            ],
            'map' => $map,
            'route' => ['distance_km' => $map['route']['distance_km'] ?? null],
        ]);
    }

    public function verifyPickup(Request $request, Delivery $delivery, DeliveryVerificationService $verification, SystemSettingsService $settings): JsonResponse
    {
        return $this->verify($request, $delivery, 'pickup', $verification, $settings);
    }

    public function verifyDropoff(Request $request, Delivery $delivery, DeliveryVerificationService $verification, SystemSettingsService $settings): JsonResponse
    {
        abort_unless($request->user()?->role === Role::RIDER, 403);
        abort_if($delivery->rider_id !== $request->user()->id, 403);
        $data = $request->validate([
            'qr_token' => ['required', 'string', 'regex:/^[A-Za-z0-9]{64}$/'],
            'latitude' => ['required', 'numeric', 'between:-90,90'],
            'longitude' => ['required', 'numeric', 'between:-180,180'],
        ]);
        $updated = $verification->verify($delivery, $request->user(), 'delivery', $data);

        $this->notifyDeliveryProgress($updated, 'The rider verified drop-off after recording recipient confirmation and delivery photo proof.', $settings, false);

        return response()->json([
            'message' => 'Delivery QR verified. The order was marked delivered.',
            'delivery' => $updated,
        ]);
    }

    public function recordProof(Request $request, Delivery $delivery, SystemSettingsService $settings): JsonResponse
    {
        abort_unless($request->user()?->role === Role::RIDER, 403);
        abort_if($delivery->rider_id !== $request->user()->id, 403, 'This delivery is not assigned to your rider account.');
        $data = $request->validate([
            'photo' => ['required', 'file', 'image', 'mimes:jpeg,jpg,png,webp', 'max:10240'],
            'recipient_confirmed' => ['required', 'accepted'],
            'recipient_name' => ['required', 'string', 'min:1', 'max:120'],
            'captured_at' => ['required', 'date', 'before_or_equal:now'],
        ]);
        $storedProof = $this->storeProof($request->file('photo'));
        $path = $storedProof['path'];

        try {
            $updated = DB::transaction(function () use ($data, $delivery, $path, $request, $storedProof): Delivery {
                $order = Order::query()->lockForUpdate()->findOrFail($delivery->order_id);
                $locked = Delivery::query()->lockForUpdate()->findOrFail($delivery->id);
                abort_if($locked->rider_id !== $request->user()->id, 403, 'This delivery is no longer assigned to your rider account.');
                abort_unless($order->status === OrderStatus::FULFILLING
                    && in_array($locked->status, [DeliveryStatus::PICKED_UP, DeliveryStatus::IN_TRANSIT], true),
                    409,
                    'Proof can only be recorded after pickup and before the delivery is completed.',
                );
                abort_if($locked->has_delivery_proof, 409, 'Proof of delivery has already been saved for this order.');

                $locked->forceFill([
                    'delivery_proof_path' => $path,
                    'delivery_proof_sha256' => $storedProof['sha256'],
                    'delivery_proof_mime_type' => $storedProof['mime_type'],
                    'recipient_confirmed' => true,
                    'delivery_recipient_name' => trim($data['recipient_name']),
                    'proof_captured_at' => Carbon::parse($data['captured_at']),
                    'proof_recorded_at' => now(),
                ])->save();

                return $locked->load('order.buyer', 'order.seller');
            });
        } catch (Throwable $exception) {
            $this->removeProofFile($path);
            throw $exception;
        }

        $this->notifyDeliveryProgress($updated, 'The rider saved delivery photo proof and recipient confirmation.', $settings, true);

        return response()->json([
            'message' => 'Delivery proof saved. Scan the same order QR at the buyer location to complete delivery.',
            'delivery' => $updated,
        ]);
    }

    public function proof(Request $request, Delivery $delivery): StreamedResponse|Response
    {
        $user = $request->user();
        $order = $delivery->order;
        abort_unless($user && (
            $user->role === Role::ADMIN
            || $user->role === Role::RIDER && $delivery->rider_id === $user->id
            || $user->role === Role::SELLER && $order->seller_id === $user->id
            || $user->role === Role::BUYER && $order->buyer_id === $user->id
        ), 403);
        abort_unless($delivery->has_delivery_proof, 404);
        $disk = Storage::disk('delivery_proofs');
        abort_unless($disk->exists($delivery->delivery_proof_path), 404, 'The saved delivery proof could not be found.');

        $path = $delivery->delivery_proof_path;

        return response()->stream(function () use ($disk, $path): void {
            $stream = $disk->readStream($path);
            if (! is_resource($stream)) {
                throw new \RuntimeException('The saved delivery proof could not be opened.');
            }

            try {
                fpassthru($stream);
            } finally {
                fclose($stream);
            }
        }, 200, [
            'Content-Type' => $delivery->delivery_proof_mime_type,
            'Content-Disposition' => 'inline; filename="delivery-proof"',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
            'X-Frame-Options' => 'DENY',
        ]);
    }

    public function correctProof(Request $request, Delivery $delivery): JsonResponse
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
        $data = $request->validate([
            'reason' => ['required', 'string', 'min:5', 'max:500'],
            'recipient_name' => ['sometimes', 'required', 'string', 'min:1', 'max:120'],
            'photo' => ['sometimes', 'required', 'file', 'image', 'mimes:jpeg,jpg,png,webp', 'max:10240'],
            'captured_at' => ['nullable', 'required_with:photo', 'date', 'before_or_equal:now'],
        ]);
        abort_unless(array_key_exists('recipient_name', $data) || $request->hasFile('photo'), 422, 'Provide a corrected recipient name or replacement photo.');
        $replacement = $request->file('photo');
        $newCapturedAt = $replacement ? Carbon::parse($data['captured_at']) : null;
        $storedProof = $replacement ? $this->storeProof($replacement) : null;
        $newPath = $storedProof['path'] ?? null;
        $newHash = $storedProof['sha256'] ?? null;

        try {
            $updated = DB::transaction(function () use ($delivery, $request, $data, $newPath, $newHash, $newCapturedAt, $storedProof, $replacement): Delivery {
                $locked = Delivery::query()->lockForUpdate()->findOrFail($delivery->id);
                abort_unless($locked->status === DeliveryStatus::DELIVERED && $locked->has_delivery_proof, 409, 'Only a completed delivery with existing proof can be corrected.');
                $oldPath = $locked->delivery_proof_path;
                $oldName = $locked->delivery_recipient_name;
                $oldCapturedAt = $locked->proof_captured_at;
                $oldRecordedAt = $locked->proof_recorded_at;
                if ($replacement) {
                    $locked->forceFill([
                        'delivery_proof_path' => $newPath,
                        'delivery_proof_sha256' => $newHash,
                        'delivery_proof_mime_type' => $storedProof['mime_type'],
                        'proof_captured_at' => $newCapturedAt,
                        'proof_recorded_at' => now(),
                    ]);
                }
                if (array_key_exists('recipient_name', $data)) {
                    $locked->delivery_recipient_name = trim($data['recipient_name']);
                }
                $locked->save();
                DeliveryProofCorrection::query()->create([
                    'delivery_id' => $locked->id,
                    'corrected_by' => $request->user()->id,
                    'old_proof_path' => $oldPath,
                    'new_proof_path' => $locked->delivery_proof_path,
                    'old_recipient_name' => $oldName,
                    'new_recipient_name' => $locked->delivery_recipient_name,
                    'old_proof_captured_at' => $oldCapturedAt,
                    'new_proof_captured_at' => $locked->proof_captured_at,
                    'old_proof_recorded_at' => $oldRecordedAt,
                    'new_proof_recorded_at' => $locked->proof_recorded_at,
                    'reason' => trim($data['reason']),
                    'created_at' => now(),
                ]);

                return $locked;
            });
        } catch (Throwable $exception) {
            $this->removeProofFile($newPath);
            throw $exception;
        }

        return response()->json([
            'message' => 'Delivery proof corrected. The original delivery time and verification remain unchanged.',
            'delivery' => $updated,
        ]);
    }

    private function verify(
        Request $request,
        Delivery $delivery,
        string $purpose,
        DeliveryVerificationService $verification,
        SystemSettingsService $settings,
    ): JsonResponse {
        abort_unless($request->user()?->role === Role::RIDER, 403);
        abort_if($delivery->rider_id !== $request->user()->id, 403);
        $data = $request->validate([
            'qr_token' => ['required', 'string', 'regex:/^[A-Za-z0-9]{64}$/'],
            'latitude' => ['required', 'numeric', 'between:-90,90'],
            'longitude' => ['required', 'numeric', 'between:-180,180'],
        ]);

        $updated = $verification->verify($delivery, $request->user(), $purpose, $data);
        $this->notifyDeliveryProgress(
            $updated,
            $purpose === 'pickup' ? 'The rider verified pickup and is continuing the delivery.' : 'The rider verified delivery at the saved drop-off location.',
            $settings,
            false,
        );

        return response()->json([
            'message' => $purpose === 'pickup' ? 'Pickup verified.' : 'Delivery verified.',
            'delivery' => $updated,
        ]);
    }

    private function notifyDeliveryProgress(Delivery $updated, string $message, SystemSettingsService $settings, bool $proofRecorded): void
    {
        $recipients = [$updated->order->buyer, $updated->order->seller];
        if ($proofRecorded) {
            $recipients[] = $updated->rider;
        }
        foreach ($recipients as $recipient) {
            if ($settings->getBoolean('in_app_notifications_enabled')
                && $settings->getBoolean('order_notifications_enabled')
                && $recipient) {
                try {
                    $recipient->notify(new DeliveryAssignmentNotification(
                        $proofRecorded ? 'delivery_proof_recorded' : 'order_delivery_status_changed',
                        $updated->order_id,
                        $updated->order->order_reference,
                        $updated->id,
                        $updated->delivery_reference,
                        $message,
                    ));
                } catch (Throwable $exception) {
                    Log::warning('A delivery progress notification could not be saved.', [
                        'delivery_id' => $updated->id,
                        'recipient_id' => $recipient->id,
                        'exception' => $exception,
                    ]);
                }
            }
        }
    }

    /**
     * @return array{path: string, sha256: string, mime_type: string}
     */
    private function storeProof(UploadedFile $file): array
    {
        $extension = $file->guessExtension();
        abort_if(! $extension, 422, 'The uploaded image type could not be identified.');
        $path = Str::random(40).'.'.$extension;

        try {
            $storedPath = $file->storeAs('', $path, 'delivery_proofs');
            $persisted = $storedPath === $path && Storage::disk('delivery_proofs')->exists($path);
            $sha256 = hash_file('sha256', $file->getRealPath());
        } catch (Throwable $exception) {
            $this->removeProofFile($path);
            Log::error('A private delivery proof upload could not be persisted.', [
                'exception' => $exception::class,
            ]);
            abort(500, 'The delivery photo could not be persisted. Please retry the upload.');
        }

        if (! $persisted || ! is_string($sha256)) {
            $this->removeProofFile($path);
            abort(500, 'The delivery photo could not be persisted. Please retry the upload.');
        }

        return [
            'path' => $path,
            'sha256' => $sha256,
            'mime_type' => $file->getMimeType() ?: 'application/octet-stream',
        ];
    }

    private function removeProofFile(?string $path): void
    {
        if (! $path) {
            return;
        }
        try {
            Storage::disk('delivery_proofs')->delete($path);
        } catch (Throwable $exception) {
            Log::error('An uncommitted private delivery proof file could not be removed.', [
                'exception' => $exception::class,
            ]);
        }
    }
}
