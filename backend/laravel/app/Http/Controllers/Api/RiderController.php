<?php

namespace App\Http\Controllers\Api;

use App\Enums\DeliveryStatus;
use App\Enums\OrderStatus;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\Delivery;
use App\Models\Order;
use App\Models\RiderOffer;
use App\Models\RiderProfile;
use App\Models\RiderVehicleChange;
use App\Services\RiderAssignmentService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class RiderController extends Controller
{
    public function deliveries(Request $request): JsonResponse
    {
        abort_unless($request->user()?->role === Role::RIDER, 403);
        $statuses = array_map(fn (DeliveryStatus $status): string => $status->value, DeliveryStatus::cases());
        $filters = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', 'string', Rule::in($statuses)],
            'page' => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:50'],
        ]);

        $query = Delivery::query()
            ->where('rider_id', $request->user()->id)
            ->whereNotIn('status', [
                DeliveryStatus::PENDING_ASSIGNMENT->value,
                DeliveryStatus::WAITING_FOR_RIDER->value,
                DeliveryStatus::RIDER_OFFERED->value,
                DeliveryStatus::SEARCHING_FOR_RIDER->value,
            ])
            ->with([
                'order:id,order_reference,status,total_amount,delivery_fee,delivery_distance_km,delivery_distance_method,shipping_address,delivery_method,buyer_id,seller_id,payment_method,payment_status',
                'order.codCollection:id,order_id,status,remittance_id,collected_at,expected_amount_cents,collected_amount_cents',
                'order.buyer:id,name,phone_number',
                'order.seller:id,name',
            ]);

        if (! empty($filters['status'])) {
            $query->where('status', $filters['status']);
        }
        if (! empty($filters['search'])) {
            $search = mb_strtolower(trim($filters['search']));
            $query->where(function ($builder) use ($search): void {
                $builder->whereRaw('LOWER(delivery_reference) LIKE ?', ['%'.$search.'%'])
                    ->orWhereHas('order', fn ($order) => $order
                        ->whereRaw('LOWER(order_reference) LIKE ?', ['%'.$search.'%'])
                        ->orWhereHas('buyer', fn ($buyer) => $buyer->whereRaw('LOWER(name) LIKE ?', ['%'.$search.'%']))
                        ->orWhereHas('seller', fn ($seller) => $seller->whereRaw('LOWER(name) LIKE ?', ['%'.$search.'%'])));
            });
        }

        $deliveries = $query->latest('deliveries.updated_at')
            ->paginate($filters['per_page'] ?? 10)
            ->withQueryString();

        return response()->json(['deliveries' => $deliveries]);
    }

    public function updateLocation(Request $request): JsonResponse
    {
        abort_unless($request->user()?->role === Role::RIDER, 403);

        $data = $request->validate([
            'latitude' => ['required', 'numeric', 'between:-90,90'],
            'longitude' => ['required', 'numeric', 'between:-180,180'],
        ]);

        $profile = $request->user()->riderProfile()->firstOrCreate(['user_id' => $request->user()->id]);
        $profile->update([
            'latitude' => $data['latitude'],
            'longitude' => $data['longitude'],
            'last_location_at' => now(),
        ]);

        return response()->json([
            'message' => 'Location updated.',
            'profile' => $profile,
        ]);
    }

    public function preferences(Request $request): JsonResponse
    {
        abort_unless($request->user()?->role === Role::RIDER, 403);
        $profile = $request->user()->riderProfile()->firstOrCreate(['user_id' => $request->user()->id]);
        $latestVehicleChange = RiderVehicleChange::query()
            ->where('user_id', $request->user()->id)
            ->latest()
            ->first();

        return response()->json(['settings' => [
            'availability' => $profile->availability,
            'vehicle_type' => $profile->vehicle_type,
            'plate_number' => $profile->plate_number,
            'vehicle_make_model' => $profile->vehicle_make_model,
            'vehicle_color' => $profile->vehicle_color,
            'license_expires_on' => $profile->license_expires_on?->toDateString(),
            'vehicle_registration_expires_on' => $profile->vehicle_registration_expires_on?->toDateString(),
            'pending_vehicle_change' => $latestVehicleChange ? [
                'id' => $latestVehicleChange->id,
                'vehicle_reference' => $latestVehicleChange->vehicle_reference,
                'status' => $latestVehicleChange->status,
                'created_at' => $latestVehicleChange->created_at?->toISOString(),
                'decision_reason' => $latestVehicleChange->decision_reason,
            ] : null,
            'is_verified' => $profile->is_verified,
            'last_location_at' => $profile->last_location_at?->toISOString(),
        ]]);
    }

    public function updatePreferences(Request $request): JsonResponse
    {
        abort_unless($request->user()?->role === Role::RIDER, 403);
        $data = $request->validate([
            'availability' => ['sometimes', 'required', Rule::in(['AVAILABLE', 'OFFLINE'])],
            'vehicle_type' => ['prohibited'],
            'plate_number' => ['prohibited'],
            'vehicle_make_model' => ['prohibited'],
            'vehicle_color' => ['prohibited'],
            'license_expires_on' => ['prohibited'],
            'vehicle_registration_expires_on' => ['prohibited'],
        ]);
        abort_if($data === [], 422, 'Choose at least one delivery setting to update.');

        $settings = DB::transaction(function () use ($request, $data): array {
            $profile = $request->user()->riderProfile()->firstOrCreate(['user_id' => $request->user()->id]);
            $profile = RiderProfile::query()->whereKey($profile->id)->lockForUpdate()->firstOrFail();

            if (($data['availability'] ?? null) === 'AVAILABLE') {
                abort_unless($profile->is_verified, 403, 'Your rider profile must be verified before you can become available for assignments.');
            }
            if (($data['availability'] ?? null) === 'OFFLINE') {
                $hasActiveDelivery = Delivery::query()
                    ->where('rider_id', $request->user()->id)
                    ->whereIn('status', [
                        DeliveryStatus::RIDER_ACCEPTED->value,
                        DeliveryStatus::PICKUP_PENDING->value,
                        DeliveryStatus::PICKED_UP->value,
                        DeliveryStatus::IN_TRANSIT->value,
                    ])
                    ->lockForUpdate()
                    ->exists();
                abort_if($hasActiveDelivery, 409, 'Complete your active delivery before going offline.');
            }

            $profile->fill($data)->save();

            return [
                'availability' => $profile->availability,
                'vehicle_type' => $profile->vehicle_type,
                'plate_number' => $profile->plate_number,
                'vehicle_make_model' => $profile->vehicle_make_model,
                'vehicle_color' => $profile->vehicle_color,
                'license_expires_on' => $profile->license_expires_on?->toDateString(),
                'vehicle_registration_expires_on' => $profile->vehicle_registration_expires_on?->toDateString(),
                'is_verified' => $profile->is_verified,
                'last_location_at' => $profile->last_location_at?->toISOString(),
            ];
        });

        return response()->json(['settings' => $settings]);
    }

    public function offers(Request $request, RiderAssignmentService $assignment): JsonResponse
    {
        abort_unless($request->user()?->role === Role::RIDER, 403);

        $assignment->processPendingDeliveries();

        $profile = $request->user()->riderProfile()->first();
        $offers = RiderOffer::query()
            ->with(['delivery.order:id,order_reference,shipping_address,delivery_fee,delivery_distance_km,delivery_distance_method'])
            ->where('rider_id', $request->user()->id)
            ->where('status', 'OPEN')
            ->where(fn ($query) => $query->whereNull('expires_at')->orWhere('expires_at', '>', now()))
            ->whereHas('delivery', fn ($query) => $query->whereIn('status', [
                DeliveryStatus::RIDER_OFFERED->value,
                DeliveryStatus::SEARCHING_FOR_RIDER->value,
            ]))
            ->whereHas('delivery.order', fn ($query) => $query
                ->where('delivery_method', 'STANDARD_DELIVERY')
                ->whereIn('status', [
                    OrderStatus::READY_FOR_PICKUP->value,
                    OrderStatus::FULFILLING->value,
                ]))
            ->latest()
            ->get()
            ->map(function (RiderOffer $offer): array {
                $delivery = $offer->delivery;
                $order = $delivery->order;
                $address = $order->shipping_address ?? [];
                $dropoffArea = collect([
                    $address['barangay'] ?? null,
                    $address['city_municipality'] ?? null,
                    $address['province'] ?? null,
                ])->filter(fn ($part): bool => is_string($part) && trim($part) !== '')
                    ->implode(', ');

                return [
                    'id' => $offer->id,
                    'distance_km' => $offer->distance_km,
                    'checkout_distance_km' => $order->delivery_distance_km === null
                        ? null
                        : round((float) $order->delivery_distance_km, 1),
                    'checkout_distance_method' => $order->delivery_distance_method,
                    'checkout_delivery_fee' => $order->delivery_fee,
                    'expires_at' => $offer->expires_at?->toISOString(),
                    'delivery' => [
                        'id' => $delivery->id,
                        'pickup_area' => 'Bongabong, Oriental Mindoro',
                        'pickup_latitude_approximate' => $this->approximateCoordinate($delivery->pickup_latitude),
                        'pickup_longitude_approximate' => $this->approximateCoordinate($delivery->pickup_longitude),
                        'order' => [
                            'id' => $order->id,
                            'order_reference' => $order->order_reference,
                            'dropoff_area' => $dropoffArea !== '' ? $dropoffArea : 'Area details available after acceptance',
                            'dropoff_latitude_approximate' => $this->approximateCoordinate($address['latitude'] ?? null),
                            'dropoff_longitude_approximate' => $this->approximateCoordinate($address['longitude'] ?? null),
                        ],
                    ],
                ];
            })->values();

        return response()->json([
            'offers' => $offers,
            'rider_location' => $profile && $profile->latitude !== null && $profile->longitude !== null
                ? [
                    'latitude' => $profile->latitude,
                    'longitude' => $profile->longitude,
                    'updated_at' => $profile->last_location_at?->toISOString(),
                ]
                : null,
        ]);
    }

    public function acceptOffer(Request $request, RiderOffer $offer, RiderAssignmentService $assignment): JsonResponse
    {
        abort_unless($request->user()?->role === Role::RIDER, 403);
        abort_if($offer->rider_id !== $request->user()->id, 403);

        $delivery = DB::transaction(function () use ($offer, $request): Delivery {
            $deliverySnapshot = Delivery::query()->findOrFail($offer->delivery_id);
            $order = Order::query()->lockForUpdate()->findOrFail($deliverySnapshot->order_id);
            $riderProfile = RiderProfile::query()->where('user_id', $request->user()->id)->lockForUpdate()->firstOrFail();
            abort_unless($riderProfile->is_verified && $riderProfile->availability === 'AVAILABLE', 409, 'Set your verified rider profile to available before accepting delivery offers.');
            $lockedDelivery = Delivery::query()->lockForUpdate()->findOrFail($offer->delivery_id);
            $lockedOffer = RiderOffer::query()->lockForUpdate()->findOrFail($offer->id);

            if ($lockedOffer->status === 'ACCEPTED' && $lockedDelivery->rider_id === $request->user()->id) {
                return $lockedDelivery;
            }

            abort_if(
                $lockedOffer->status !== 'OPEN',
                409,
                $lockedDelivery->rider_id !== null && $lockedDelivery->rider_id !== $request->user()->id
                    ? 'Another rider has already accepted this delivery.'
                    : ($lockedOffer->status === 'EXPIRED' || $lockedOffer->expires_at?->isPast()
                        ? 'This delivery offer has expired.'
                        : 'This delivery is no longer available.'),
            );
            abort_if($lockedOffer->expires_at?->isPast(), 409, 'This delivery offer has expired.');
            abort_if(($lockedDelivery->rider_id !== null && $lockedDelivery->rider_id !== $request->user()->id) || ! in_array($lockedDelivery->status, [
                DeliveryStatus::RIDER_OFFERED,
                DeliveryStatus::SEARCHING_FOR_RIDER,
            ], true), 409, $lockedDelivery->rider_id !== null && $lockedDelivery->rider_id !== $request->user()->id
                ? 'Another rider has already accepted this delivery.'
                : 'This delivery is no longer available for acceptance.');
            abort_if(
                Delivery::query()
                    ->where('rider_id', $request->user()->id)
                    ->whereIn('status', [
                        DeliveryStatus::RIDER_ACCEPTED->value,
                        DeliveryStatus::PICKUP_PENDING->value,
                        DeliveryStatus::PICKED_UP->value,
                        DeliveryStatus::IN_TRANSIT->value,
                    ])
                    ->exists(),
                409,
                'You already have an active delivery assigned.',
            );

            abort_if(
                ($order->delivery_method !== null && $order->delivery_method !== 'STANDARD_DELIVERY')
                    || ! in_array($order->status, [
                        OrderStatus::READY_FOR_PICKUP,
                        OrderStatus::FULFILLING,
                    ], true)
                    || ($order->payment_method !== null && $order->payment_method !== 'COD' && $order->payment_status !== 'PAID'),
                409,
                'This delivery is no longer available for acceptance.',
            );

            $lockedDelivery->forceFill([
                'status' => DeliveryStatus::RIDER_ACCEPTED,
                'rider_id' => $request->user()->id,
                'assigned_at' => now(),
            ])->save();

            RiderOffer::query()
                ->where('delivery_id', $lockedDelivery->id)
                ->where('status', 'OPEN')
                ->where('id', '!=', $lockedOffer->id)
                ->update(['status' => 'REVOKED']);
            $lockedOffer->forceFill(['status' => 'ACCEPTED'])->save();

            return $lockedDelivery;
        });
        try {
            $assignment->notifyAssignmentConfirmed($delivery);
        } catch (\Throwable $exception) {
            report($exception);
        }
        try {
            $assignment->notifyRiderAssignmentAccepted($delivery, $request->user());
        } catch (\Throwable $exception) {
            report($exception);
        }

        return response()->json([
            'message' => 'Delivery assignment confirmed.',
            'delivery' => [
                'id' => $delivery->id,
                'status' => $delivery->status->value,
                'order_id' => $delivery->order_id,
            ],
        ]);
    }

    public function declineOffer(Request $request, RiderOffer $offer, RiderAssignmentService $assignment): JsonResponse
    {
        abort_unless($request->user()?->role === Role::RIDER, 403);
        abort_if($offer->rider_id !== $request->user()->id, 403);

        $delivery = $assignment->declineOffer($offer, $request->user());

        return response()->json([
            'message' => 'Delivery offer declined.',
            'delivery' => [
                'id' => $delivery->id,
                'status' => $delivery->status->value,
                'order_id' => $delivery->order_id,
            ],
        ]);
    }

    private function approximateCoordinate(mixed $coordinate): ?float
    {
        if (! is_numeric($coordinate)) {
            return null;
        }

        $value = (float) $coordinate;
        if (! is_finite($value) || $value < -180 || $value > 180) {
            return null;
        }

        return round($value, 2);
    }
}
