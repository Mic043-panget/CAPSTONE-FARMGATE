<?php

namespace App\Services;

use App\Enums\DeliveryStatus;
use App\Enums\OrderStatus;
use App\Models\Delivery;
use App\Models\Order;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class DeliveryVerificationService
{
    private const VERIFICATION_RADIUS_METERS = 250;

    /**
     * Issue a one-time purpose-specific QR code to an order participant.
     *
     * @return array{purpose: string, code: string, expires_at: string}
     */
    public function issueCode(Order $order, string $purpose): array
    {
        return DB::transaction(function () use ($order, $purpose): array {
            $lockedOrder = Order::query()->lockForUpdate()->findOrFail($order->id);
            abort_unless($lockedOrder->delivery_method === 'STANDARD_DELIVERY', 422, 'QR verification is only available for standard deliveries.');
            $delivery = Delivery::query()->where('order_id', $lockedOrder->id)->lockForUpdate()->firstOrFail();
            $token = Str::random(64);
            $expiresAt = now()->addMinutes(30);

            if ($purpose === 'pickup') {
                abort_unless(in_array($lockedOrder->status, [OrderStatus::READY_FOR_PICKUP, OrderStatus::FULFILLING], true), 409, 'Pickup QR verification is only available when the order is ready for pickup.');
                abort_if($delivery->pickup_verified_at || ! in_array($delivery->status, [
                    DeliveryStatus::RIDER_ACCEPTED,
                    DeliveryStatus::PICKUP_PENDING,
                ], true), 409, 'Pickup verification is not currently available.');
                $delivery->forceFill([
                    'pickup_qr_token_hash' => hash('sha256', $token),
                    'pickup_qr_expires_at' => $expiresAt,
                ])->save();
            } else {
                abort_unless($lockedOrder->status === OrderStatus::FULFILLING, 409, 'Delivery QR verification is only available while the order is being fulfilled.');
                abort_if($delivery->delivery_verified_at || ! in_array($delivery->status, [
                    DeliveryStatus::PICKED_UP,
                    DeliveryStatus::IN_TRANSIT,
                ], true), 409, 'Delivery verification is not currently available.');
                $delivery->forceFill([
                    'delivery_qr_token_hash' => hash('sha256', $token),
                    'delivery_qr_expires_at' => $expiresAt,
                ])->save();
            }

            return [
                'purpose' => $purpose,
                'code' => 'FARMGATE:'.strtoupper($purpose).':'.$token,
                'expires_at' => $expiresAt->toISOString(),
            ];
        });
    }

    /**
     * Validate the active step, consume the QR exactly once, and persist scan evidence atomically.
     *
     * @param  array{qr_token: string, latitude?: int|float|string|null, longitude?: int|float|string|null}  $data
     * @param  array{path?: string, sha256?: string, mime_type?: string, recipient_confirmed?: bool, recipient_name?: string, captured_at?: Carbon, recorded_at?: Carbon}|null  $proof
     */
    public function verify(Delivery $delivery, User $rider, string $purpose, array $data, ?array $proof = null): Delivery
    {
        $updated = DB::transaction(function () use ($delivery, $data, $purpose, $rider, $proof): Delivery {
            $order = Order::query()->lockForUpdate()->findOrFail($delivery->order_id);
            $locked = Delivery::query()->lockForUpdate()->findOrFail($delivery->id);
            abort_if($locked->rider_id !== $rider->id, 403);
            abort_unless($order->delivery_method === 'STANDARD_DELIVERY', 409, 'QR verification is only available for standard deliveries.');

            if ($purpose === 'pickup') {
                abort_unless(in_array($order->status, [OrderStatus::READY_FOR_PICKUP, OrderStatus::FULFILLING], true), 409, 'The order is not ready for pickup.');
                abort_unless(in_array($locked->status, [DeliveryStatus::RIDER_ACCEPTED, DeliveryStatus::PICKUP_PENDING], true), 409, 'Pickup is not the current delivery step.');
                abort_if($locked->pickup_verified_at, 409, 'Pickup has already been verified.');
                $hash = $locked->pickup_qr_token_hash;
                $expiresAt = $locked->pickup_qr_expires_at;
                $latitude = $locked->pickup_latitude;
                $longitude = $locked->pickup_longitude;
                $verifiedAt = 'pickup_verified_at';
                $verifiedLatitude = 'pickup_verification_latitude';
                $verifiedLongitude = 'pickup_verification_longitude';
                $hashField = 'pickup_qr_token_hash';
                $expiryField = 'pickup_qr_expires_at';
                $nextStatus = DeliveryStatus::PICKED_UP;
            } else {
                abort_unless($order->status === OrderStatus::FULFILLING, 409, 'The order is not currently being fulfilled.');
                abort_unless(in_array($locked->status, [DeliveryStatus::PICKED_UP, DeliveryStatus::IN_TRANSIT], true), 409, 'Delivery is not ready for drop-off verification.');
                abort_if($locked->delivery_verified_at || $locked->delivery_proof_path, 409, 'Drop-off has already been verified.');
                abort_unless(
                    $proof
                        && filled($proof['path'] ?? null)
                        && filled($proof['sha256'] ?? null)
                        && filled($proof['mime_type'] ?? null)
                        && ($proof['recipient_confirmed'] ?? false) === true
                        && filled($proof['recipient_name'] ?? null)
                        && ($proof['captured_at'] ?? null) instanceof Carbon,
                    422,
                    'A persisted delivery photo, capture time, and recipient confirmation are required.',
                );
                $address = $order->shipping_address;
                $latitude = is_array($address) ? ($address['latitude'] ?? null) : null;
                $longitude = is_array($address) ? ($address['longitude'] ?? null) : null;
                $hash = $locked->delivery_qr_token_hash;
                $expiresAt = $locked->delivery_qr_expires_at;
                $verifiedAt = 'delivery_verified_at';
                $verifiedLatitude = 'delivery_verification_latitude';
                $verifiedLongitude = 'delivery_verification_longitude';
                $hashField = 'delivery_qr_token_hash';
                $expiryField = 'delivery_qr_expires_at';
                $nextStatus = DeliveryStatus::DELIVERED;
            }

            abort_if($hash === null || ! $expiresAt || $expiresAt->isPast(), 422, 'The verification QR code is missing or has expired. Ask the order participant to refresh it.');
            abort_if(! hash_equals($hash, hash('sha256', $data['qr_token'])), 422, 'Invalid QR code.');
            $verificationLatitude = $data['latitude'] ?? null;
            $verificationLongitude = $data['longitude'] ?? null;
            if ($purpose === 'pickup' || $verificationLatitude !== null) {
                abort_if($latitude === null || $longitude === null, 422, 'The saved verification pin is unavailable, so distance verification cannot be completed.');
                abort_if(
                    $this->distanceMeters(
                        (float) $latitude,
                        (float) $longitude,
                        (float) $verificationLatitude,
                        (float) $verificationLongitude,
                    ) > self::VERIFICATION_RADIUS_METERS,
                    422,
                    'You are too far from the saved verification location.',
                );
            }

            $fromStatus = $locked->status;
            $attributes = [
                $verifiedAt => now(),
                $verifiedLatitude => $verificationLatitude,
                $verifiedLongitude => $verificationLongitude,
                $hashField => null,
                $expiryField => null,
                'status' => $nextStatus,
            ];
            if ($purpose === 'delivery') {
                $attributes = array_merge($attributes, [
                    'delivery_proof_path' => $proof['path'],
                    'delivery_proof_sha256' => $proof['sha256'],
                    'delivery_proof_mime_type' => $proof['mime_type'],
                    'recipient_confirmed' => true,
                    'delivery_recipient_name' => $proof['recipient_name'],
                    'proof_captured_at' => $proof['captured_at'],
                    'proof_recorded_at' => $proof['recorded_at'],
                    'delivery_proof_latitude' => $verificationLatitude,
                    'delivery_proof_longitude' => $verificationLongitude,
                ]);
            }
            $locked->forceFill($attributes)->save();
            $locked->statusHistory()->create([
                'changed_by' => $rider->id,
                'from_status' => $fromStatus->value,
                'to_status' => $nextStatus->value,
                'reason' => $purpose === 'pickup' ? 'PICKUP_QR_VERIFIED' : 'DELIVERY_QR_VERIFIED',
                'created_at' => now(),
            ]);

            return $locked->load('order.buyer', 'order.seller');
        });

        return $updated;
    }

    private function distanceMeters(float $fromLatitude, float $fromLongitude, float $toLatitude, float $toLongitude): float
    {
        $earthRadius = 6_371_000;
        $latitudeDelta = deg2rad($toLatitude - $fromLatitude);
        $longitudeDelta = deg2rad($toLongitude - $fromLongitude);
        $a = sin($latitudeDelta / 2) ** 2
            + cos(deg2rad($fromLatitude)) * cos(deg2rad($toLatitude)) * sin($longitudeDelta / 2) ** 2;
        $a = min(1, max(0, $a));

        return $earthRadius * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }
}
