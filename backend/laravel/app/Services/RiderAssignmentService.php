<?php

namespace App\Services;

use App\Enums\DeliveryStatus;
use App\Enums\OrderStatus;
use App\Models\Delivery;
use App\Models\Order;
use App\Models\RiderOffer;
use App\Models\RiderProfile;
use App\Models\User;
use App\Notifications\DeliveryAssignmentNotification;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;

class RiderAssignmentService
{
    public function __construct(private readonly SystemSettingsService $settings) {}

    public function findEligibleRiders(float $latitude, float $longitude): Collection
    {
        $activeDeliveryStatuses = [
            DeliveryStatus::RIDER_ACCEPTED->value,
            DeliveryStatus::PICKUP_PENDING->value,
            DeliveryStatus::PICKED_UP->value,
            DeliveryStatus::IN_TRANSIT->value,
        ];

        return RiderProfile::query()
            ->where('is_verified', true)
            ->where('availability', 'AVAILABLE')
            ->whereNotNull('latitude')
            ->whereNotNull('longitude')
            ->whereNotNull('last_location_at')
            ->where('last_location_at', '>=', now()->subMinutes(30))
            ->whereNotIn('user_id', Delivery::query()
                ->select('rider_id')
                ->whereNotNull('rider_id')
                ->whereIn('status', $activeDeliveryStatuses))
            ->orderByRaw('ABS(latitude - ?) + ABS(longitude - ?) ASC', [$latitude, $longitude])
            ->get();
    }

    public function dispatchForOrder(int $orderId): ?Delivery
    {
        $order = Order::query()->with('delivery')->find($orderId);
        if (! $order || $order->delivery_method !== 'STANDARD_DELIVERY') {
            return null;
        }
        if (! in_array($order->status, [
            OrderStatus::READY_FOR_PICKUP,
            OrderStatus::FULFILLING,
        ], true)) {
            return $order->delivery;
        }

        $delivery = $order->delivery;
        if (! $delivery) {
            return null;
        }

        return $this->processAndNotify($delivery->id);
    }

    public function processPendingDeliveries(): void
    {
        Delivery::query()
            ->whereIn('status', [
                DeliveryStatus::WAITING_FOR_RIDER->value,
                DeliveryStatus::RIDER_OFFERED->value,
            ])
            ->whereHas('order', fn ($query) => $query
                ->where('delivery_method', 'STANDARD_DELIVERY')
                ->whereIn('status', [
                    OrderStatus::READY_FOR_PICKUP->value,
                    OrderStatus::FULFILLING->value,
                ]))
            ->orderBy('id')
            ->pluck('id')
            ->each(function (int $id): void {
                $delivery = Delivery::query()->find($id);
                if ($delivery) {
                    $this->dispatchForOrder($delivery->order_id);
                }
            });
    }

    public function assignForOrder(Order $order): Delivery
    {
        abort_unless(in_array($order->status, [
            OrderStatus::READY_FOR_PICKUP,
            OrderStatus::FULFILLING,
        ], true), 409, 'Rider assignment can start when the order is ready for pickup.');

        $sellerProfile = $order->seller()->with('sellerProfile')->first()?->sellerProfile;
        $delivery = $order->delivery()->firstOrCreate(
            ['order_id' => $order->id],
            [
                'status' => DeliveryStatus::WAITING_FOR_RIDER,
                'pickup_latitude' => $sellerProfile?->latitude,
                'pickup_longitude' => $sellerProfile?->longitude,
                'pickup_address' => $sellerProfile?->address ?: 'Pickup location pending',
            ],
        );

        return $this->processAndNotify($delivery->id) ?? $delivery->refresh();
    }

    private function processAndNotify(int $deliveryId): ?Delivery
    {
        $delivery = $this->processDelivery($deliveryId);
        if (! $delivery) {
            return null;
        }

        $delivery->loadMissing('order', 'offers.rider');
        if ($delivery->status === DeliveryStatus::WAITING_FOR_RIDER) {
            $seller = $delivery->order?->seller;
            if ($seller && $this->notificationsEnabled($seller)
                && ! $this->notificationExists($seller, 'rider_assignment_waiting', $delivery->id)) {
                $seller->notify(new DeliveryAssignmentNotification(
                    'rider_assignment_waiting',
                    $delivery->order_id,
                    $delivery->order->order_reference,
                    $delivery->id,
                    'No eligible rider is currently available. Assignment can be retried.',
                ));
            }
        }

        if (in_array($delivery->status, [DeliveryStatus::RIDER_OFFERED, DeliveryStatus::SEARCHING_FOR_RIDER], true)) {
            foreach ($delivery->offers->where('status', 'OPEN') as $offer) {
                $rider = $offer->rider;
                if ($rider && $this->notificationsEnabled($rider)
                    && ! $this->notificationExists($rider, 'rider_offer_available', $delivery->id, $offer->id)) {
                    $rider->notify(new DeliveryAssignmentNotification(
                        'rider_offer_available',
                        $delivery->order_id,
                        $delivery->order->order_reference,
                        $delivery->id,
                        'A delivery offer is available for review.',
                        $offer->id,
                    ));
                }
            }
        }

        return $delivery;
    }

    public function notifyAssignmentConfirmed(Delivery $delivery): void
    {
        $delivery->loadMissing('order.buyer', 'order.seller');
        $order = $delivery->order;
        if (! $order || $delivery->status !== DeliveryStatus::RIDER_ACCEPTED) {
            return;
        }

        foreach ([$order->buyer, $order->seller] as $recipient) {
            if ($recipient && $this->notificationsEnabled($recipient)
                && ! $this->notificationExists($recipient, 'order_rider_assigned', $delivery->id)) {
                $recipient->notify(new DeliveryAssignmentNotification(
                    'order_rider_assigned',
                    $order->id,
                    $order->order_reference,
                    $delivery->id,
                    'A rider has accepted the delivery.',
                ));
            }
        }
    }

    public function notifyRiderAssignmentAccepted(Delivery $delivery, User $rider): void
    {
        $delivery->loadMissing('order');
        $order = $delivery->order;
        if (! $order || $delivery->rider_id !== $rider->id
            || $delivery->status !== DeliveryStatus::RIDER_ACCEPTED
            || ! $this->notificationsEnabled($rider)
            || $this->notificationExists($rider, 'rider_assignment_confirmed', $delivery->id)) {
            return;
        }

        $rider->notify(new DeliveryAssignmentNotification(
            'rider_assignment_confirmed',
            $order->id,
            $order->order_reference,
            $delivery->id,
            'Your delivery acceptance is confirmed. Open your delivery queue for the next steps.',
        ));
    }

    public function notifyAssignmentFailure(Order $order, string $message): void
    {
        $order->loadMissing('seller', 'delivery');
        $delivery = $order->delivery;
        $seller = $order->seller;
        if (! $delivery || ! $seller || ! $this->notificationsEnabled($seller)
            || $this->notificationExists($seller, 'rider_assignment_waiting', $delivery->id)) {
            return;
        }

        $seller->notify(new DeliveryAssignmentNotification(
            'rider_assignment_waiting',
            $order->id,
            $order->order_reference,
            $delivery->id,
            $message,
        ));
    }

    public function declineOffer(RiderOffer $offer, User $rider): Delivery
    {
        abort_unless($offer->rider_id === $rider->id, 403);

        $deliveryId = DB::transaction(function () use ($offer, $rider): int {
            $snapshot = Delivery::query()->findOrFail($offer->delivery_id);
            $order = Order::query()->lockForUpdate()->findOrFail($snapshot->order_id);
            $delivery = Delivery::query()->lockForUpdate()->findOrFail($snapshot->id);
            $lockedOffer = RiderOffer::query()->lockForUpdate()->findOrFail($offer->id);

            abort_unless($lockedOffer->rider_id === $rider->id, 403);
            if ($lockedOffer->status === 'DECLINED') {
                return $delivery->id;
            }

            abort_unless($lockedOffer->status === 'OPEN', 409, 'This delivery offer is no longer available.');
            abort_if($lockedOffer->expires_at?->isPast(), 409, 'This delivery offer has expired.');
            abort_unless(in_array($delivery->status, [
                DeliveryStatus::RIDER_OFFERED,
                DeliveryStatus::SEARCHING_FOR_RIDER,
            ], true), 409, 'This delivery is no longer available for a response.');
            abort_unless(
                ($order->delivery_method === null || $order->delivery_method === 'STANDARD_DELIVERY')
                    && in_array($order->status, [OrderStatus::READY_FOR_PICKUP, OrderStatus::FULFILLING], true)
                    && ($order->payment_method === null || $order->payment_method === 'COD' || $order->payment_status === 'PAID'),
                409,
                'This delivery is no longer available for a response.',
            );

            $lockedOffer->forceFill([
                'status' => 'DECLINED',
                'expires_at' => now(),
            ])->save();
            if ($delivery->rider_id === $rider->id) {
                $delivery->forceFill(['rider_id' => null])->save();
            }

            return $delivery->id;
        });

        return $this->processAndNotify($deliveryId) ?? Delivery::query()->findOrFail($deliveryId);
    }

    private function notificationsEnabled(User $user): bool
    {
        return $this->settings->getBoolean('in_app_notifications_enabled')
            && $this->settings->getBoolean('order_notifications_enabled')
            && $user->accountPreferenceEnabled('order_notifications');
    }

    private function notificationExists(User $user, string $type, int $deliveryId, ?int $offerId = null): bool
    {
        return $user->notifications()
            ->where('data->type', $type)
            ->where('data->delivery_id', $deliveryId)
            ->when($offerId !== null, fn ($query) => $query->where('data->offer_id', $offerId))
            ->exists();
    }

    private function processDelivery(int $deliveryId): ?Delivery
    {
        return DB::transaction(function () use ($deliveryId): ?Delivery {
            $deliverySnapshot = Delivery::query()->find($deliveryId);
            if (! $deliverySnapshot) {
                return null;
            }

            $order = Order::query()->lockForUpdate()->find($deliverySnapshot->order_id);
            $delivery = Delivery::query()->lockForUpdate()->find($deliveryId);
            if (! $delivery) {
                return null;
            }
            if (in_array($delivery->status, [
                DeliveryStatus::RIDER_ACCEPTED,
                DeliveryStatus::PICKUP_PENDING,
                DeliveryStatus::PICKED_UP,
                DeliveryStatus::IN_TRANSIT,
                DeliveryStatus::DELIVERED,
                DeliveryStatus::CANCELLED,
            ], true)) {
                return $delivery;
            }

            if (! $order || in_array($order->status, [OrderStatus::CANCELLED, OrderStatus::REJECTED], true)) {
                RiderOffer::query()->where('delivery_id', $delivery->id)->where('status', 'OPEN')->update(['status' => 'REVOKED']);
                $delivery->forceFill(['status' => DeliveryStatus::CANCELLED, 'rider_id' => null])->save();

                return $delivery;
            }

            if (! in_array($order->status, [
                OrderStatus::READY_FOR_PICKUP,
                OrderStatus::FULFILLING,
            ], true)) {
                return $delivery;
            }

            if (($order->delivery_method !== null && $order->delivery_method !== 'STANDARD_DELIVERY')
                || ($order->payment_method !== null && $order->payment_method !== 'COD' && $order->payment_status !== 'PAID')) {
                return $delivery;
            }

            if ($delivery->pickup_latitude === null || $delivery->pickup_longitude === null
                || ((float) $delivery->pickup_latitude === 0.0 && (float) $delivery->pickup_longitude === 0.0)) {
                $delivery->forceFill(['status' => DeliveryStatus::WAITING_FOR_RIDER, 'rider_id' => null])->save();

                return $delivery;
            }

            RiderOffer::query()
                ->where('delivery_id', $delivery->id)
                ->where('status', 'OPEN')
                ->whereNotNull('expires_at')
                ->where('expires_at', '<=', now())
                ->update(['status' => 'EXPIRED']);

            if (RiderOffer::query()->where('delivery_id', $delivery->id)->where('status', 'OPEN')->exists()) {
                return $delivery->load('offers.rider');
            }

            if (! $this->settings->getBoolean('automatic_rider_assignment_enabled')) {
                $delivery->forceFill(['status' => DeliveryStatus::WAITING_FOR_RIDER, 'rider_id' => null])->save();

                return $delivery;
            }

            $pickupLatitude = (float) $delivery->pickup_latitude;
            $pickupLongitude = (float) $delivery->pickup_longitude;
            $candidates = $this->findEligibleRiders($pickupLatitude, $pickupLongitude);
            if ($pickupLatitude !== 0.0 || $pickupLongitude !== 0.0) {
                $candidates = $candidates->filter(fn (RiderProfile $rider): bool => $this->settings->distanceKm(
                    $pickupLatitude,
                    $pickupLongitude,
                    (float) $rider->latitude,
                    (float) $rider->longitude,
                ) <= $this->settings->number('rider_offer_radius_km'));
            }

            $previousRiderIds = RiderOffer::query()
                ->where('delivery_id', $delivery->id)
                ->pluck('rider_id')
                ->all();
            $candidates = $candidates->reject(fn (RiderProfile $rider): bool => in_array($rider->user_id, $previousRiderIds, true));
            $firstOffer = RiderOffer::query()
                ->where('delivery_id', $delivery->id)
                ->whereNotNull('expires_at')
                ->oldest('id')
                ->first();

            if ($firstOffer === null && $candidates->isNotEmpty()) {
                $candidate = $candidates->first();
                $distance = max(0.5, $this->settings->distanceKm(
                    $pickupLatitude,
                    $pickupLongitude,
                    (float) $candidate->latitude,
                    (float) $candidate->longitude,
                ));
                $delivery->offers()->create([
                    'rider_id' => $candidate->user_id,
                    'status' => 'OPEN',
                    'distance_km' => $distance,
                    'expires_at' => Carbon::now()->addHours(8),
                ]);
                $delivery->forceFill([
                    'rider_id' => $candidate->user_id,
                    'status' => DeliveryStatus::RIDER_OFFERED,
                ])->save();

                return $delivery->load('offers.rider');
            }

            if ($firstOffer === null) {
                $delivery->forceFill(['status' => DeliveryStatus::WAITING_FOR_RIDER, 'rider_id' => null])->save();

                return $delivery;
            }

            if ($firstOffer->expires_at && $firstOffer->expires_at->isFuture()) {
                return $delivery;
            }

            foreach ($candidates as $candidate) {
                $distance = max(0.5, $this->settings->distanceKm(
                    $pickupLatitude,
                    $pickupLongitude,
                    (float) $candidate->latitude,
                    (float) $candidate->longitude,
                ));
                $delivery->offers()->create([
                    'rider_id' => $candidate->user_id,
                    'status' => 'OPEN',
                    'distance_km' => $distance,
                    'expires_at' => null,
                ]);
            }

            $delivery->forceFill([
                'rider_id' => null,
                'status' => $candidates->isNotEmpty() ? DeliveryStatus::SEARCHING_FOR_RIDER : DeliveryStatus::WAITING_FOR_RIDER,
            ])->save();

            return $delivery->load('offers.rider');
        });
    }
}
