<?php

namespace App\Http\Controllers\Api;

use App\Enums\ListingStatus;
use App\Enums\OrderStatus;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\Category;
use App\Models\Complaint;
use App\Models\Delivery;
use App\Models\LivestockListing;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\OrderStatusHistory;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class AnalyticsController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless(in_array($user?->role, [Role::SELLER, Role::ADMIN], true), 403);
        $data = $request->validate([
            'from' => ['required', 'date_format:Y-m-d'],
            'to' => ['required', 'date_format:Y-m-d', 'after_or_equal:from'],
            'category_id' => ['nullable', 'integer', 'min:1'],
            'listing_id' => ['nullable', 'integer', 'min:1'],
            'seller_id' => ['nullable', 'integer', 'min:1'],
            'status' => ['nullable', Rule::in(array_map(fn (OrderStatus $status): string => $status->value, OrderStatus::cases()))],
            'sort' => ['nullable', Rule::in(['revenue_desc', 'revenue_asc', 'quantity_desc', 'quantity_asc', 'name_asc', 'name_desc', 'listed_newest', 'listed_oldest'])],
        ]);
        $from = CarbonImmutable::parse($data['from'])->startOfDay();
        $to = CarbonImmutable::parse($data['to'])->endOfDay();
        abort_if($from->diffInDays($to) > 366, 422, 'Choose a date range of one year or less.');

        $sellerId = $user->role === Role::SELLER ? $user->id : ($data['seller_id'] ?? null);
        $orders = $this->orderQuery($sellerId, $from, $to, $data);
        $completed = (clone $orders)->where('status', OrderStatus::COMPLETED->value);
        $completedIds = (clone $completed)->select('id');
        $dailyOrders = (clone $orders)
            ->selectRaw('DATE(created_at) as day, COUNT(*) as orders, SUM(total_amount) as total')
            ->groupByRaw('DATE(created_at)')
            ->orderBy('day')
            ->get()
            ->keyBy('day');
        $itemQuery = OrderItem::query()
            ->whereIn('orders.id', $completedIds)
            ->join('orders', 'orders.id', '=', 'order_items.order_id')
            ->join('livestock_listings', 'livestock_listings.id', '=', 'order_items.listing_id')
            ->when($data['category_id'] ?? null, fn ($query, $categoryId) => $query->where('livestock_listings.category_id', $categoryId))
            ->when($data['listing_id'] ?? null, fn ($query, $listingId) => $query->where('livestock_listings.id', $listingId));
        $dailySales = (clone $itemQuery)
            ->selectRaw('DATE(orders.created_at) as day, SUM(order_items.total_amount) as revenue, SUM(order_items.quantity) as units')
            ->groupByRaw('DATE(orders.created_at)')
            ->get()
            ->keyBy('day');
        $productRows = (clone $itemQuery)
            ->join('categories', 'categories.id', '=', 'livestock_listings.category_id')
            ->selectRaw('livestock_listings.id, livestock_listings.name, livestock_listings.created_at as listed_at, categories.name as category_name, SUM(order_items.quantity) as units, SUM(order_items.total_amount) as revenue')
            ->groupBy('livestock_listings.id', 'livestock_listings.name', 'livestock_listings.created_at', 'categories.name')
            ->get();
        $categorySales = (clone $itemQuery)
            ->join('categories', 'categories.id', '=', 'livestock_listings.category_id')
            ->selectRaw('categories.name as category, SUM(order_items.total_amount) as revenue, SUM(order_items.quantity) as units')
            ->groupBy('categories.name')
            ->orderByDesc('revenue')
            ->get();
        $categorySupply = LivestockListing::query()
            ->join('categories', 'categories.id', '=', 'livestock_listings.category_id')
            ->where('livestock_listings.status', ListingStatus::ACTIVE)
            ->when($sellerId !== null, fn ($query) => $query->where('livestock_listings.seller_id', $sellerId))
            ->when($data['category_id'] ?? null, fn ($query, $categoryId) => $query->where('livestock_listings.category_id', $categoryId))
            ->when($data['listing_id'] ?? null, fn ($query, $listingId) => $query->where('livestock_listings.id', $listingId))
            ->selectRaw('categories.name as category, SUM(livestock_listings.quantity) as units')
            ->groupBy('categories.name')
            ->orderByDesc('units')
            ->get();
        $sort = $data['sort'] ?? 'revenue_desc';
        $sortKey = match ($sort) {
            'revenue_asc' => 'revenue',
            'quantity_desc' => 'units',
            'quantity_asc' => 'units',
            'name_asc', 'name_desc' => 'name',
            'listed_newest', 'listed_oldest' => 'listed_at',
            default => 'revenue',
        };
        $sortOptions = in_array($sortKey, ['name', 'listed_at'], true) ? SORT_NATURAL | SORT_FLAG_CASE : SORT_REGULAR;
        $products = $productRows->sortBy(
            $sortKey,
            $sortOptions,
            in_array($sort, ['revenue_desc', 'quantity_desc', 'name_desc', 'listed_newest'], true),
        )->values();
        $priorFrom = $from->subDays($from->diffInDays($to) + 1);
        $priorTo = $from->subSecond();
        $priorCompleted = $this->orderQuery($sellerId, $priorFrom, $priorTo, $data)->where('status', OrderStatus::COMPLETED->value);
        $priorItems = OrderItem::query()
            ->join('orders', 'orders.id', '=', 'order_items.order_id')
            ->join('livestock_listings', 'livestock_listings.id', '=', 'order_items.listing_id')
            ->whereIn('orders.id', (clone $priorCompleted)->select('id'))
            ->when($data['category_id'] ?? null, fn ($query, $categoryId) => $query->where('livestock_listings.category_id', $categoryId))
            ->when($data['listing_id'] ?? null, fn ($query, $listingId) => $query->where('livestock_listings.id', $listingId))
            ->selectRaw('order_items.listing_id, SUM(order_items.quantity) as units, SUM(order_items.total_amount) as revenue')
            ->groupBy('order_items.listing_id')
            ->get()
            ->keyBy('listing_id');
        $declining = $productRows->map(function ($product) use ($priorItems) {
            $prior = $priorItems->get($product->id);

            return [
                'id' => (int) $product->id,
                'name' => $product->name,
                'category' => $product->category_name,
                'revenue' => (float) $product->revenue,
                'units' => (int) $product->units,
                'previous_revenue' => (float) ($prior?->revenue ?? 0),
                'previous_units' => (int) ($prior?->units ?? 0),
                'change' => (float) $product->revenue - (float) ($prior?->revenue ?? 0),
                'units_change' => (int) $product->units - (int) ($prior?->units ?? 0),
            ];
        })->filter(fn (array $product): bool => $product['change'] < 0)
            ->sortBy('change')
            ->take(5)
            ->values();

        $statusCounts = (clone $orders)->selectRaw('status, COUNT(*) as count')->groupBy('status')->pluck('count', 'status');
        $paymentCounts = (clone $orders)->selectRaw('payment_status, COUNT(*) as count')->groupBy('payment_status')->pluck('count', 'payment_status');
        $settledPaymentAttempts = (int) ($paymentCounts->get('PAID', 0) + $paymentCounts->get('FAILED', 0));
        $paymentSuccessRate = $settledPaymentAttempts === 0 ? null : round((int) $paymentCounts->get('PAID', 0) / $settledPaymentAttempts * 100, 1);
        $paymentFailureRate = $settledPaymentAttempts === 0 ? null : round((int) $paymentCounts->get('FAILED', 0) / $settledPaymentAttempts * 100, 1);
        $deliveredProofs = Delivery::query()
            ->where('status', 'DELIVERED')
            ->whereBetween('delivery_verified_at', [$from, $to])
            ->when($sellerId !== null, fn ($query) => $query->whereHas('order', fn ($order) => $order->where('seller_id', $sellerId)));
        $buyerCounts = (clone $orders)->selectRaw('buyer_id, COUNT(*) as count')->groupBy('buyer_id')->get();
        $buyerFirstOrders = Order::query()
            ->whereIn('buyer_id', $buyerCounts->pluck('buyer_id'))
            ->when($sellerId !== null, fn ($query) => $query->where('seller_id', $sellerId))
            ->when($data['listing_id'] ?? null, fn ($query, $listingId) => $query->whereHas('items', fn ($items) => $items->where('listing_id', $listingId)))
            ->when($data['category_id'] ?? null, fn ($query, $categoryId) => $query->whereHas('items.listing', fn ($listing) => $listing->where('category_id', $categoryId)))
            ->selectRaw('buyer_id, MIN(created_at) as first_order_at')
            ->groupBy('buyer_id')
            ->get()
            ->keyBy('buyer_id');
        $newCustomers = $buyerFirstOrders->filter(
            fn ($order): bool => CarbonImmutable::parse($order->first_order_at)->between($from, $to),
        )->count();
        $completedOrders = (clone $completed)->get(['id', 'created_at', 'seller_fee', 'subtotal_amount', 'total_amount', 'discount_amount']);
        $completedHistory = OrderStatusHistory::query()
            ->whereIn('order_id', $completedOrders->pluck('id'))
            ->where('to_status', OrderStatus::COMPLETED->value)
            ->orderBy('created_at')
            ->get(['order_id', 'created_at'])
            ->groupBy('order_id');
        $fulfillmentHours = $completedOrders->map(function (Order $order) use ($completedHistory): ?float {
            $completedAt = $completedHistory->get($order->id)?->first()?->created_at;

            return $completedAt ? max(0, $order->created_at->diffInHours($completedAt)) : null;
        })->filter(fn ($hours): bool => $hours !== null);

        $inventoryQuery = LivestockListing::query()
            ->with('category:id,name')
            ->where('status', ListingStatus::ACTIVE);
        $inventoryQuery
            ->when($data['category_id'] ?? null, fn ($query, $categoryId) => $query->where('category_id', $categoryId))
            ->when($data['listing_id'] ?? null, fn ($query, $listingId) => $query->whereKey($listingId));
        if ($sellerId !== null) {
            $inventoryQuery->where('seller_id', $sellerId);
        }
        $inventory = $inventoryQuery->get(['id', 'seller_id', 'category_id', 'name', 'quantity', 'status', 'created_at']);
        $returningBuyers = max(0, $buyerCounts->count() - $newCustomers);
        $repeatPurchasers = $buyerCounts->where('count', '>', 1)->count();
        $sellerMetrics = $user->role === Role::ADMIN
            ? $this->sellerPerformance($from, $to, $data, $sellerId)
            : [];
        $newUsersByDay = User::query()
            ->whereBetween('created_at', [$from, $to])
            ->selectRaw('DATE(created_at) as day, role, COUNT(*) as count')
            ->groupByRaw('DATE(created_at), role')
            ->get()
            ->groupBy('day');
        $newListingsByDay = LivestockListing::query()
            ->whereBetween('created_at', [$from, $to])
            ->selectRaw('DATE(created_at) as day, COUNT(*) as count')
            ->groupByRaw('DATE(created_at)')
            ->pluck('count', 'day');
        $delayedOrders = (clone $orders)
            ->whereIn('status', [
                OrderStatus::PENDING_CONFIRMATION->value,
                OrderStatus::CONFIRMED->value,
                OrderStatus::PREPARING->value,
                OrderStatus::READY_FOR_PICKUP->value,
                OrderStatus::FULFILLING->value,
            ])
            ->where('created_at', '<', now()->subHours(48))
            ->orderBy('created_at')
            ->limit(20)
            ->get(['id', 'order_reference', 'status', 'total_amount', 'created_at'])
            ->map(fn (Order $order): array => [
                'id' => $order->id,
                'reference' => $order->order_reference,
                'status' => $order->status->value,
                'total' => (float) $order->total_amount,
                'created_at' => $order->created_at->toISOString(),
                'age_hours' => (int) $order->created_at->diffInHours(now()),
            ]);

        $series = [];
        $growthSeries = [];
        for ($date = $from->startOfDay(); $date->lte($to); $date = $date->addDay()) {
            $key = $date->toDateString();
            $dayUsers = $newUsersByDay->get($key, collect())->keyBy('role');
            $series[] = [
                'date' => $key,
                'revenue' => round((float) ($dailySales->get($key)?->revenue ?? 0), 2),
                'orders' => (int) ($dailyOrders->get($key)?->orders ?? 0),
                'units' => (int) ($dailySales->get($key)?->units ?? 0),
            ];
            $growthSeries[] = [
                'date' => $key,
                'sellers' => (int) ($dayUsers->get(Role::SELLER->value)?->count ?? 0),
                'buyers' => (int) ($dayUsers->get(Role::BUYER->value)?->count ?? 0),
                'listings' => (int) ($newListingsByDay->get($key) ?? 0),
                'orders' => (int) ($dailyOrders->get($key)?->orders ?? 0),
            ];
        }

        return response()->json([
            'range' => ['from' => $from->toDateString(), 'to' => $to->toDateString()],
            'summary' => [
                'gross_sales' => round((float) (clone $itemQuery)->sum('order_items.total_amount'), 2),
                'orders' => (clone $orders)->count(),
                'completed_orders' => $completedOrders->count(),
                'units_sold' => (int) (clone $itemQuery)->sum('order_items.quantity'),
                'fees' => ($data['listing_id'] ?? $data['category_id'] ?? null) ? null : round((float) $completedOrders->sum('seller_fee'), 2),
                'net_payout' => ($data['listing_id'] ?? $data['category_id'] ?? null) ? null : round((float) $completedOrders->sum(fn (Order $order) => (float) $order->subtotal_amount - (float) $order->seller_fee), 2),
                'average_order_value' => $completedOrders->isEmpty() ? 0 : round((float) (clone $itemQuery)->sum('order_items.total_amount') / $completedOrders->count(), 2),
                'new_customers' => $newCustomers,
                'returning_customers' => $returningBuyers,
                'repeat_purchase_rate' => $buyerCounts->isEmpty() ? null : round($repeatPurchasers / $buyerCounts->count() * 100, 1),
                'average_fulfillment_hours' => $fulfillmentHours->isEmpty() ? null : round($fulfillmentHours->avg(), 1),
                'discounts' => ($data['listing_id'] ?? $data['category_id'] ?? null) ? null : round((float) $completedOrders->sum('discount_amount'), 2),
                'payment_success_rate' => $paymentSuccessRate,
                'payment_failure_rate' => $paymentFailureRate,
                'active_sellers' => User::query()->where('role', Role::SELLER)->whereHas('livestockListings', fn ($query) => $query->where('status', ListingStatus::ACTIVE))->count(),
                'buyers' => $user->role === Role::ADMIN ? User::query()->where('role', Role::BUYER)->count() : null,
                'products' => $inventory->count(),
                'refunds' => null,
                'promotions' => null,
            ],
            'delivery_proof_summary' => [
                'recorded' => (clone $deliveredProofs)->whereNotNull('delivery_proof_path')->count(),
                'missing' => (clone $deliveredProofs)->whereNull('delivery_proof_path')->count(),
            ],
            'series' => $series,
            'growth_series' => $user->role === Role::ADMIN ? $growthSeries : null,
            'order_statuses' => $statusCounts,
            'payment_statuses' => $paymentCounts,
            'products' => $products->take(10)->map(fn ($product): array => [
                'id' => (int) $product->id,
                'name' => $product->name,
                'category' => $product->category_name,
                'revenue' => round((float) $product->revenue, 2),
                'units' => (int) $product->units,
                'listed_at' => CarbonImmutable::parse($product->listed_at)->toISOString(),
            ])->values(),
            'category_sales' => $categorySales->map(fn ($row): array => [
                'category' => $row->category,
                'revenue' => round((float) $row->revenue, 2),
                'units' => (int) $row->units,
            ])->values(),
            'category_supply' => $categorySupply->map(fn ($row): array => [
                'category' => $row->category,
                'units' => (int) $row->units,
            ])->values(),
            'declining_products' => $declining,
            'inventory' => $inventory->map(fn (LivestockListing $listing): array => [
                'id' => $listing->id,
                'name' => $listing->name,
                'category' => $listing->category?->name,
                'quantity' => $listing->quantity,
                'status' => $listing->status->value,
            ])->values(),
            'low_stock' => $inventory->where('quantity', '<=', 3)->values()->map(fn (LivestockListing $listing): array => [
                'id' => $listing->id,
                'name' => $listing->name,
                'category' => $listing->category?->name,
                'quantity' => $listing->quantity,
            ])->values(),
            'seller_performance' => $sellerMetrics,
            'delayed_orders' => $delayedOrders,
            'listing_statuses' => LivestockListing::query()
                ->when($sellerId !== null, fn ($query) => $query->where('seller_id', $sellerId))
                ->when($data['category_id'] ?? null, fn ($query, $categoryId) => $query->where('category_id', $categoryId))
                ->when($data['listing_id'] ?? null, fn ($query, $listingId) => $query->whereKey($listingId))
                ->selectRaw('status, COUNT(*) as count')
                ->groupBy('status')
                ->pluck('count', 'status'),
            'category_listings' => Category::query()
                ->withCount(['listings' => fn ($query) => $query
                    ->when($sellerId !== null, fn ($inner) => $inner->where('seller_id', $sellerId))
                    ->when($data['category_id'] ?? null, fn ($inner, $categoryId) => $inner->where('category_id', $categoryId))
                    ->when($data['listing_id'] ?? null, fn ($inner, $listingId) => $inner->whereKey($listingId))])
                ->get(['id', 'name'])
                ->map(fn (Category $category): array => ['category' => $category->name, 'count' => $category->listings_count]),
            'complaints' => $user->role === Role::ADMIN ? [
                'total' => Complaint::query()->whereBetween('created_at', [$from, $to])->count(),
                'open' => Complaint::query()->whereBetween('created_at', [$from, $to])->whereNull('resolved_at')->count(),
                'resolved' => Complaint::query()->whereBetween('created_at', [$from, $to])->whereNotNull('resolved_at')->count(),
                'average_resolution_hours' => $this->averageComplaintResolution($from, $to),
            ] : null,
            'filters' => [
                'categories' => Category::query()->where('is_active', true)->orderBy('name')->get(['id', 'name']),
                'products' => LivestockListing::query()
                    ->when($sellerId !== null, fn ($query) => $query->where('seller_id', $sellerId))
                    ->when($data['category_id'] ?? null, fn ($query, $categoryId) => $query->where('category_id', $categoryId))
                    ->orderBy('name')->get(['id', 'name']),
                'sellers' => $user->role === Role::ADMIN ? User::query()->where('role', Role::SELLER)->orderBy('name')->get(['id', 'name']) : [],
            ],
            'unavailable' => [
                'inventory_changes' => 'The project does not keep stock movement history.',
                'refunds' => 'Refund records are not stored.',
                'promotions' => 'Promotion codes and redemption records are not stored.',
                'regions' => 'Orders do not have a structured region field.',
                'user_reports' => 'There is no separate user report record type; disputes are represented as complaints.',
                'payouts' => 'Payout transactions are not stored; net payout is an estimate from sales less seller fees.',
                'historical_activity' => 'Historical active account and listing status changes are not recorded; the marketplace activity chart shows new records by day.',
            ],
        ]);
    }

    private function orderQuery(?int $sellerId, CarbonImmutable $from, CarbonImmutable $to, array $filters): Builder
    {
        return Order::query()
            ->whereBetween('created_at', [$from, $to])
            ->when($sellerId !== null, fn ($query) => $query->where('seller_id', $sellerId))
            ->when($filters['status'] ?? null, fn ($query, $status) => $query->where('status', $status))
            ->when($filters['listing_id'] ?? null, fn ($query, $listingId) => $query->whereHas('items', fn ($items) => $items->where('listing_id', $listingId)))
            ->when($filters['category_id'] ?? null, fn ($query, $categoryId) => $query->whereHas('items.listing', fn ($listing) => $listing->where('category_id', $categoryId)));
    }

    private function sellerPerformance(CarbonImmutable $from, CarbonImmutable $to, array $filters, ?int $sellerId): array
    {
        $query = Order::query()
            ->whereBetween('orders.created_at', [$from, $to])
            ->when($sellerId !== null, fn ($query) => $query->where('orders.seller_id', $sellerId))
            ->when($filters['status'] ?? null, fn ($query, $status) => $query->where('orders.status', $status))
            ->join('users', 'users.id', '=', 'orders.seller_id');
        if (! empty($filters['listing_id']) || ! empty($filters['category_id'])) {
            $query->join('order_items', 'order_items.order_id', '=', 'orders.id')
                ->join('livestock_listings', 'livestock_listings.id', '=', 'order_items.listing_id')
                ->when($filters['category_id'] ?? null, fn ($builder, $categoryId) => $builder->where('livestock_listings.category_id', $categoryId))
                ->when($filters['listing_id'] ?? null, fn ($builder, $listingId) => $builder->where('livestock_listings.id', $listingId))
                ->selectRaw('users.id, users.name, COUNT(DISTINCT orders.id) as orders, SUM(CASE WHEN orders.status = ? THEN order_items.total_amount ELSE 0 END) as sales', [OrderStatus::COMPLETED->value]);
        } else {
            $query->selectRaw('users.id, users.name, COUNT(orders.id) as orders, SUM(CASE WHEN orders.status = ? THEN orders.subtotal_amount ELSE 0 END) as sales', [OrderStatus::COMPLETED->value]);
        }

        return $query
            ->groupBy('users.id', 'users.name')
            ->orderByDesc('sales')
            ->limit(10)
            ->get()
            ->map(fn ($row): array => ['id' => $row->id, 'name' => $row->name, 'orders' => (int) $row->orders, 'sales' => round((float) $row->sales, 2)])
            ->all();
    }

    private function averageComplaintResolution(CarbonImmutable $from, CarbonImmutable $to): ?float
    {
        $resolved = Complaint::query()
            ->whereBetween('created_at', [$from, $to])
            ->whereNotNull('resolved_at')
            ->get(['created_at', 'resolved_at']);

        return $resolved->isEmpty() ? null : round($resolved->avg(fn ($complaint) => $complaint->created_at->diffInHours($complaint->resolved_at)), 1);
    }
}
