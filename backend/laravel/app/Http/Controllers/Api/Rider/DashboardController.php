<?php

namespace App\Http\Controllers\Api\Rider;

use App\Enums\DeliveryStatus;
use App\Enums\OrderStatus;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\Delivery;
use App\Models\DeliveryStatusHistory;
use App\Models\RiderOffer;
use App\Services\SystemSettingsService;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class DashboardController extends Controller
{
    public function __invoke(Request $request, SystemSettingsService $settings): JsonResponse
    {
        abort_unless($request->user()?->role === Role::RIDER, 403);

        $riderId = $request->user()->id;
        $activeStatuses = [
            DeliveryStatus::RIDER_ACCEPTED->value,
            DeliveryStatus::PICKUP_PENDING->value,
            DeliveryStatus::PICKED_UP->value,
            DeliveryStatus::IN_TRANSIT->value,
        ];
        $statuses = array_map(fn (DeliveryStatus $status): string => $status->value, DeliveryStatus::cases());
        $filters = $request->validate([
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:from'],
            'status' => ['nullable', 'string', Rule::in($statuses)],
            'search' => ['nullable', 'string', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:20'],
        ]);
        $timezone = $settings->getString('timezone');

        $applyDeliveryFilters = function (Builder $query) use ($filters, $timezone): void {
            if (! empty($filters['from'])) {
                $query->where('deliveries.created_at', '>=', CarbonImmutable::parse($filters['from'], $timezone)->startOfDay()->utc());
            }
            if (! empty($filters['to'])) {
                $query->where('deliveries.created_at', '<', CarbonImmutable::parse($filters['to'], $timezone)->addDay()->startOfDay()->utc());
            }
            if (! empty($filters['status'])) {
                $query->where('deliveries.status', $filters['status']);
            }
            if (! empty($filters['search'])) {
                $search = mb_strtolower(trim($filters['search']));
                $query->whereHas('order', fn (Builder $order) => $order
                    ->whereRaw('LOWER(order_reference) LIKE ?', ['%'.$search.'%']));
            }
        };

        $deliveries = Delivery::query()
            ->where('deliveries.rider_id', $riderId)
            ->whereNotIn('deliveries.status', [
                DeliveryStatus::PENDING_ASSIGNMENT->value,
                DeliveryStatus::WAITING_FOR_RIDER->value,
                DeliveryStatus::RIDER_OFFERED->value,
                DeliveryStatus::SEARCHING_FOR_RIDER->value,
            ]);
        $applyDeliveryFilters($deliveries);

        $filteredCount = (clone $deliveries)->count();
        $statusCounts = (clone $deliveries)
            ->selectRaw('deliveries.status, COUNT(*) as total')
            ->groupBy('deliveries.status')
            ->pluck('total', 'status')
            ->map(fn ($count): int => (int) $count)
            ->all();

        $openOffers = RiderOffer::query()
            ->where('rider_id', $riderId)
            ->where('status', 'OPEN')
            ->where(fn (Builder $query) => $query->whereNull('expires_at')->orWhere('expires_at', '>', now()))
            ->whereHas('delivery', fn (Builder $delivery) => $delivery->whereIn('status', [
                DeliveryStatus::RIDER_OFFERED->value,
                DeliveryStatus::SEARCHING_FOR_RIDER->value,
            ])->whereHas('order', fn (Builder $order) => $order
                ->where('delivery_method', 'STANDARD_DELIVERY')
                ->whereIn('status', [
                    OrderStatus::READY_FOR_PICKUP->value,
                    OrderStatus::FULFILLING->value,
                ])));
        if (! empty($filters['from'])) {
            $openOffers->where('created_at', '>=', CarbonImmutable::parse($filters['from'], $timezone)->startOfDay()->utc());
        }
        if (! empty($filters['to'])) {
            $openOffers->where('created_at', '<', CarbonImmutable::parse($filters['to'], $timezone)->addDay()->startOfDay()->utc());
        }
        if (! empty($filters['status'])) {
            if (in_array($filters['status'], [
                DeliveryStatus::RIDER_OFFERED->value,
                DeliveryStatus::SEARCHING_FOR_RIDER->value,
                DeliveryStatus::WAITING_FOR_RIDER->value,
            ], true)) {
                $openOffers->whereHas('delivery', fn (Builder $delivery) => $delivery->where('status', $filters['status']));
            } else {
                $openOffers->whereRaw('1 = 0');
            }
        }
        if (! empty($filters['search'])) {
            $search = mb_strtolower(trim($filters['search']));
            $openOffers->whereHas('delivery.order', fn (Builder $order) => $order
                ->whereRaw('LOWER(order_reference) LIKE ?', ['%'.$search.'%']));
        }

        $durationExpression = match (Delivery::query()->getConnection()->getDriverName()) {
            'sqlite' => 'AVG((julianday(delivery_verified_at) - julianday(pickup_verified_at)) * 1440)',
            'pgsql' => 'AVG(EXTRACT(EPOCH FROM (delivery_verified_at - pickup_verified_at)) / 60)',
            default => 'AVG(TIMESTAMPDIFF(SECOND, pickup_verified_at, delivery_verified_at)) / 60',
        };
        $averageDeliveryMinutes = (clone $deliveries)
            ->where('deliveries.status', DeliveryStatus::DELIVERED->value)
            ->whereNotNull('deliveries.pickup_verified_at')
            ->whereNotNull('deliveries.delivery_verified_at')
            ->selectRaw($durationExpression.' as average_minutes')
            ->value('average_minutes');

        $recentDeliveries = (clone $deliveries)
            ->with(['order:id,order_reference,shipping_address'])
            ->latest('deliveries.created_at')
            ->paginate($filters['per_page'] ?? 5, ['deliveries.*'], 'page', $filters['page'] ?? 1)
            ->through(fn (Delivery $delivery): array => $this->deliverySummary($delivery));

        $recentActivity = DeliveryStatusHistory::query()
            ->with(['delivery.order:id,order_reference'])
            ->whereHas('delivery', function (Builder $delivery) use ($riderId, $applyDeliveryFilters): void {
                $delivery->where('rider_id', $riderId);
                $applyDeliveryFilters($delivery);
            })
            ->latest('created_at')
            ->limit(6)
            ->get(['id', 'delivery_id', 'from_status', 'to_status', 'reason', 'created_at'])
            ->map(fn (DeliveryStatusHistory $history): array => [
                'id' => $history->id,
                'delivery_reference' => $history->delivery?->delivery_reference,
                'order_reference' => $history->delivery?->order?->order_reference,
                'from_status' => $history->from_status,
                'to_status' => $history->to_status,
                'reason' => $history->reason,
                'created_at' => $history->created_at?->toISOString(),
            ]);

        $profile = $request->user()->riderProfile()->first();

        return response()->json([
            'summary' => [
                'availability' => $profile?->availability ?? 'OFFLINE',
                'offers' => $openOffers->count(),
                'pending_offers' => $openOffers->count(),
                'accepted' => (clone $deliveries)->whereNotNull('deliveries.assigned_at')->count(),
                'active' => (clone $deliveries)->whereIn('deliveries.status', $activeStatuses)->count(),
                'active_assignments' => (clone $deliveries)->whereIn('deliveries.status', $activeStatuses)->count(),
                'delivered' => (clone $deliveries)->where('deliveries.status', DeliveryStatus::DELIVERED->value)->count(),
                'delivered_with_proof' => (clone $deliveries)->where('deliveries.status', DeliveryStatus::DELIVERED->value)->whereNotNull('deliveries.delivery_proof_path')->count(),
                'delivered_without_proof' => (clone $deliveries)->where('deliveries.status', DeliveryStatus::DELIVERED->value)->whereNull('deliveries.delivery_proof_path')->count(),
                'completed_deliveries' => (clone $deliveries)->where('deliveries.status', DeliveryStatus::DELIVERED->value)->count(),
                'cancellations' => (clone $deliveries)->where('deliveries.status', DeliveryStatus::CANCELLED->value)->count(),
                'average_delivery_minutes' => $averageDeliveryMinutes === null ? null : round((float) $averageDeliveryMinutes, 1),
                'filtered_deliveries' => $filteredCount,
            ],
            'status_counts' => $statusCounts,
            'deliveries' => $recentDeliveries,
            'recent_activity' => $recentActivity,
            'filters' => $filters,
            'timezone' => $timezone,
        ]);
    }

    private function deliverySummary(Delivery $delivery): array
    {
        $address = $delivery->order?->shipping_address ?? [];
        $dropoffArea = collect([
            $address['barangay'] ?? null,
            $address['city_municipality'] ?? null,
            $address['province'] ?? null,
        ])->filter(fn ($part): bool => is_string($part) && trim($part) !== '')
            ->implode(', ');

        return [
            'id' => $delivery->id,
            'delivery_reference' => $delivery->delivery_reference,
            'order_reference' => $delivery->order?->order_reference,
            'status' => $delivery->status->value,
            'pickup_area' => 'Bongabong, Oriental Mindoro',
            'dropoff_area' => $dropoffArea !== '' ? $dropoffArea : 'Area details unavailable',
            'assigned_at' => $delivery->assigned_at?->toISOString(),
            'pickup_verified_at' => $delivery->pickup_verified_at?->toISOString(),
            'delivery_verified_at' => $delivery->delivery_verified_at?->toISOString(),
            'created_at' => $delivery->created_at?->toISOString(),
        ];
    }
}
