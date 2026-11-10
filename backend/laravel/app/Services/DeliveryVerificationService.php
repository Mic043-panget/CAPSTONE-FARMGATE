<?php

namespace App\Services;

use App\Enums\DeliveryStatus;
use App\Enums\OrderStatus;
use App\Models\Delivery;
use App\Models\Order;
use App\Models\User;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class DeliveryVerificationService
{
    public function __construct(
        private readonly SystemSettingsService $settings,
        private readonly OrderWorkflowService $orders,
    ) {}

    /**
     * Issue a persistent order QR code to an order participant.
     *
     * @return array{purpose: string, code: string}
     */
    public function issueCode(Order $order, string $purpose): array
    {
        return DB::transaction(function () use ($order, $purpose): array {
            $lockedOrder = Order::query()->lockForUpdate()->findOrFail($order->id);
            abort_unless($lockedOrder->delivery_method === 'STANDARD_DELIVERY', 422, 'QR verification is only available for standard deliveries.');
            $delivery = Delivery::query()->where('order_id', $lockedOrder->id)->lockForUpdate()->firstOrFail();
            abort_unless(
                $purpose === 'pickup'
                    ? in_array($lockedOrder->status, [OrderStatus::READY_FOR_PICKUP, OrderStatus::FULFILLING], true)
                    : $lockedOrder->status === OrderStatus::FULFILLING,
                409,
                'The order is not in the required delivery state.',
            );
            abort_unless($delivery->rider_id !== null && in_array($delivery->status, [
                DeliveryStatus::RIDER_ACCEPTED,
                DeliveryStatus::PICKUP_PENDING,
                DeliveryStatus::PICKED_UP,
                DeliveryStatus::IN_TRANSIT,
            ], true), 409, 'A rider must accept this delivery before its order QR can be issued.');
            abort_if($delivery->status === DeliveryStatus::DELIVERED, 409, 'This delivery workflow is already complete.');

            if ($delivery->order_qr_token_encrypted && $delivery->order_qr_token_hash
                && $delivery->order_qr_rider_id === $delivery->rider_id) {
                $token = Crypt::decryptString($delivery->order_qr_token_encrypted);
            } else {
                $token = Str::random(64);
                $delivery->forceFill([
                    'order_qr_token_encrypted' => Crypt::encryptString($token),
                    'order_qr_token_hash' => hash('sha256', $token),
                    'order_qr_rider_id' => $delivery->rider_id,
                    'pickup_qr_token_hash' => null,
                    'pickup_qr_expires_at' => null,
                    'delivery_qr_token_hash' => null,
                    'delivery_qr_expires_at' => null,
                ])->save();
            }

            return [
                'purpose' => 'order',
                'code' => 'FARMGATE:ORDER:'.$token,
            ];
        });
    }

    /**
     * Validate the active step, consume the QR exactly once, and persist scan evidence atomically.
     *
     * @param  array{qr_token: string, latitude: int|float|string, longitude: int|float|string}  $data
     */
    public function verify(Delivery $delivery, User $rider, string $purpose, array $data): Delivery
    {
        $updated = DB::transaction(function () use ($delivery, $data, $purpose, $rider): Delivery {
            $order = Order::query()->lockForUpdate()->findOrFail($delivery->order_id);
            $locked = Delivery::query()->lockForUpdate()->findOrFail($delivery->id);
            abort_if($locked->rider_id !== $rider->id, 403, 'This delivery is not assigned to your rider account.');
            abort_if(
                $locked->order_qr_rider_id !== null
                    && $locked->order_qr_rider_id !== $rider->id
                    && $locked->order_qr_token_hash !== null,
                403,
                'This order QR was issued for a different assigned rider. Ask the seller to refresh the receipt QR.',
            );
            abort_unless($order->delivery_method === 'STANDARD_DELIVERY', 409, 'QR verification is only available for standard deliveries.');
            abort_unless(! in_array($order->status, [OrderStatus::CANCELLED, OrderStatus::REJECTED, OrderStatus::COMPLETED], true)
                && $locked->status !== DeliveryStatus::CANCELLED,
                409,
                'This order is cancelled or its delivery workflow is complete.',
            );

            if ($purpose === 'pickup') {
                abort_unless(in_array($order->status, [OrderStatus::READY_FOR_PICKUP, OrderStatus::FULFILLING], true), 409, 'The order is not ready for pickup.');
                abort_unless(in_array($locked->status, [DeliveryStatus::RIDER_ACCEPTED, DeliveryStatus::PICKUP_PENDING], true), 409, 'Pickup is not the current delivery step.');
                abort_if($locked->pickup_verified_at, 409, 'Pickup has already been verified.');
                $hash = $locked->order_qr_token_hash ?? $locked->pickup_qr_token_hash;
                $expiresAt = $locked->order_qr_token_hash ? null : $locked->pickup_qr_expires_at;
                $latitude = $locked->pickup_latitude;
                $longitude = $locked->pickup_longitude;
                $verifiedAt = 'pickup_verified_at';
                $verifiedLatitude = 'pickup_verification_latitude';
                $verifiedLongitude = 'pickup_verification_longitude';
                $nextStatus = DeliveryStatus::PICKED_UP;
            } else {
                abort_unless($order->status === OrderStatus::FULFILLING, 409, 'The order is not currently being fulfilled.');
                abort_unless(in_array($locked->status, [DeliveryStatus::PICKED_UP, DeliveryStatus::IN_TRANSIT], true), 409, 'Delivery is not ready for drop-off verification.');
                abort_if($locked->delivery_verified_at, 409, 'Drop-off has already been verified.');
                abort_unless(
                    $locked->has_delivery_proof && $locked->recipient_confirmed && filled($locked->delivery_recipient_name),
                    422,
                    'Save a delivery photo and recipient confirmation from My Deliveries before scanning the order QR at drop-off.',
                );
                $address = $order->shipping_address;
                $latitude = is_array($address) ? ($address['latitude'] ?? null) : null;
                $longitude = is_array($address) ? ($address['longitude'] ?? null) : null;
                $hash = $locked->order_qr_token_hash ?? $locked->delivery_qr_token_hash;
                $expiresAt = $locked->order_qr_token_hash ? null : $locked->delivery_qr_expires_at;
                $verifiedAt = 'delivery_verified_at';
                $verifiedLatitude = 'delivery_verification_latitude';
                $verifiedLongitude = 'delivery_verification_longitude';
                $nextStatus = DeliveryStatus::DELIVERED;
            }

            abort_if($hash === null || ($expiresAt && $expiresAt->isPast()), 422, 'The order QR is missing or has expired. Ask the seller to open the receipt and print a current QR.');
            abort_if(! hash_equals($hash, hash('sha256', $data['qr_token'])), 422, 'Invalid QR code.');
            $verificationLatitude = $data['latitude'] ?? null;
            $verificationLongitude = $data['longitude'] ?? null;
            abort_if($verificationLatitude === null || $verificationLongitude === null, 422, 'Allow device location to verify the scan at the pickup or delivery location.');
            abort_if($latitude === null || $longitude === null, 422, 'The saved '.($purpose === 'pickup' ? 'seller pickup' : 'buyer delivery').' pin is unavailable, so distance verification cannot be completed.');
            $verificationRadius = max(0, $this->settings->getDecimal('delivery_verification_radius_meters'));
            abort_if(
                $this->distanceMeters(
                    (float) $latitude,
                    (float) $longitude,
                    (float) $verificationLatitude,
                    (float) $verificationLongitude,
                ) > $verificationRadius,
                422,
                'You are outside the configured '.number_format($verificationRadius).' metre verification radius for this '.($purpose === 'pickup' ? 'seller pickup' : 'buyer delivery').' location.',
            );

            $fromStatus = $locked->status;
            $attributes = [
                $verifiedAt => now(),
                $verifiedLatitude => $verificationLatitude,
                $verifiedLongitude => $verificationLongitude,
                'status' => $nextStatus,
            ];
            if ($purpose === 'delivery') {
                $attributes = array_merge($attributes, [
                    'order_qr_token_encrypted' => null,
                    'order_qr_token_hash' => null,
                    'order_qr_rider_id' => null,
                    'delivery_qr_token_hash' => null,
                    'delivery_qr_expires_at' => null,
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
            $fromOrderStatus = $order->status;
            if ($purpose === 'pickup' && $order->status === OrderStatus::READY_FOR_PICKUP) {
                $order->forceFill(['status' => OrderStatus::FULFILLING])->save();
            }
            $completedByDelivery = $purpose === 'delivery'
                && $order->status === OrderStatus::FULFILLING;
            if ($completedByDelivery) {
                $this->orders->completeAfterVerifiedDelivery(
                    $order,
                    $rider,
                    'DELIVERY_QR_VERIFIED at '.number_format((float) $verificationLatitude, 7, '.', '').','.number_format((float) $verificationLongitude, 7, '.', ''),
                );
            } else {
                $order->statusHistory()->create([
                    'changed_by' => $rider->id,
                    'from_status' => $fromOrderStatus->value,
                    'to_status' => $order->fresh()->status->value,
                    'reason' => strtoupper($purpose).'_QR_VERIFIED at '.number_format((float) $verificationLatitude, 7, '.', '').','.number_format((float) $verificationLongitude, 7, '.', ''),
                    'created_at' => now(),
                ]);
            }

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
