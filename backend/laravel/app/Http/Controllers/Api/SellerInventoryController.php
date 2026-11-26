<?php

namespace App\Http\Controllers\Api;

use App\Enums\OrderStatus;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\Complaint;
use App\Models\LivestockListing;
use App\Models\Order;
use App\Models\OrderItem;
use App\Support\SellerInventoryListingKey;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class SellerInventoryController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $seller = $request->user();
        abort_unless($seller?->role === Role::SELLER, 403);

        $filters = $request->validate([
            'search' => ['nullable', 'string', 'max:120'],
            'listing_key' => ['nullable', 'string', 'max:500'],
            'category' => ['nullable', 'string', 'exists:categories,slug'],
            'order_status' => ['nullable', Rule::in(array_map(static fn (OrderStatus $status): string => $status->value, OrderStatus::cases()))],
            'payment_status' => ['nullable', Rule::in(['PENDING', 'PAID', 'UNPAID', 'FAILED'])],
            'from' => ['nullable', 'date_format:Y-m-d', 'before_or_equal:to'],
            'to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:from'],
            'sort' => ['nullable', Rule::in(['name', 'category', 'quantity_sold', 'sales_total', 'updated_at'])],
            'direction' => ['nullable', Rule::in(['asc', 'desc'])],
            'history_sort' => ['nullable', Rule::in(['date', 'amount', 'quantity', 'listing', 'buyer', 'order_status'])],
            'history_direction' => ['nullable', Rule::in(['asc', 'desc'])],
            'inventory_page' => ['nullable', 'integer', 'min:1'],
            'history_page' => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'min:5', 'max:50'],
        ]);
        $listingId = $this->listingIdFromKey($filters['listing_key'] ?? null, $seller->id);
        $search = trim((string) ($filters['search'] ?? ''));
        $perPage = (int) ($filters['per_page'] ?? 10);

        $completedItems = DB::table('order_items')
            ->join('orders', 'orders.id', '=', 'order_items.order_id')
            ->where('orders.seller_id', $seller->id)
            ->where('orders.status', OrderStatus::COMPLETED->value)
            ->whereNull('orders.deleted_at')
            ->whereNull('order_items.deleted_at')
            ->selectRaw('order_items.listing_id, SUM(order_items.quantity) AS quantity_sold, SUM(order_items.total_amount) AS sales_total')
            ->groupBy('order_items.listing_id');

        $inventoryQuery = LivestockListing::query()
            ->where('livestock_listings.seller_id', $seller->id)
            ->leftJoinSub($completedItems, 'completed_sales', function ($join): void {
                $join->on('completed_sales.listing_id', '=', 'livestock_listings.id');
            })
            ->with(['category:id,name,slug', 'images' => fn ($query) => $query->orderBy('sort_order')->orderBy('id')])
            ->select([
                'livestock_listings.id',
                'livestock_listings.category_id',
                'livestock_listings.name',
                'livestock_listings.breed',
                'livestock_listings.sex',
                'livestock_listings.age_months',
                'livestock_listings.estimated_weight_kg',
                'livestock_listings.description',
                'livestock_listings.pickup_location',
                'livestock_listings.health_information',
                'livestock_listings.vaccination_information',
                'livestock_listings.pricing_type',
                'livestock_listings.price_per_kilo',
                'livestock_listings.price_per_head',
                'livestock_listings.status',
                'livestock_listings.quantity',
                'livestock_listings.updated_at',
            ])
            ->selectRaw('COALESCE(completed_sales.quantity_sold, 0) AS quantity_sold')
            ->selectRaw('COALESCE(completed_sales.sales_total, 0) AS sales_total');
        if ($search !== '') {
            $inventoryQuery->where(function (Builder $query) use ($search): void {
                $query->where('livestock_listings.name', 'like', "%{$search}%")
                    ->orWhereHas('category', fn (Builder $category) => $category->where('name', 'like', "%{$search}%"));
            });
        }
        if (isset($filters['category'])) {
            $inventoryQuery->whereHas('category', fn (Builder $category) => $category->where('slug', $filters['category']));
        }
        if ($listingId !== null) {
            $inventoryQuery->where('livestock_listings.id', $listingId);
        }
        $direction = $filters['direction'] ?? 'desc';
        match ($filters['sort'] ?? 'updated_at') {
            'name' => $inventoryQuery->orderBy('livestock_listings.name', $direction),
            'category' => $inventoryQuery->orderBy(
                DB::table('categories')->select('name')->whereColumn('categories.id', 'livestock_listings.category_id'),
                $direction,
            ),
            'quantity_sold' => $inventoryQuery->orderByRaw('COALESCE(completed_sales.quantity_sold, 0) '.strtoupper($direction)),
            'sales_total' => $inventoryQuery->orderByRaw('COALESCE(completed_sales.sales_total, 0) '.strtoupper($direction)),
            'updated_at' => $inventoryQuery->orderBy('livestock_listings.updated_at', $direction),
        };
        $inventoryQuery->orderBy('livestock_listings.id');

        $inventory = $inventoryQuery->paginate($perPage, ['*'], 'inventory_page', (int) ($filters['inventory_page'] ?? 1));
        $refundAdjustments = $this->paidRefundAdjustments(
            $seller->id,
            $inventory->getCollection()->pluck('id')->map(static fn ($id): int => (int) $id)->all(),
        );
        $listings = $inventory->getCollection()->map(function (LivestockListing $listing) use ($seller, $refundAdjustments): array {
            $grossQuantity = (int) $listing->getAttribute('quantity_sold');
            $grossSales = (float) $listing->getAttribute('sales_total');
            $refund = $refundAdjustments[(int) $listing->id] ?? ['quantity' => 0, 'amount' => 0.0];

            return [
                'listing_key' => $this->listingKey($seller->id, (int) $listing->id),
                'name' => $listing->name,
                'category' => $listing->category?->name ?? 'Uncategorized',
                'category_slug' => $listing->category?->slug,
                'image_url' => $listing->images->first()?->url,
                'images' => $listing->images->map(static fn ($image): array => [
                    'url' => $image->url,
                    'alt_text' => $image->alt_text,
                ])->values(),
                'breed' => $listing->breed,
                'sex' => $listing->sex,
                'age_months' => $listing->age_months,
                'estimated_weight_kg' => $listing->estimated_weight_kg,
                'description' => $listing->description,
                'pickup_location' => $listing->pickup_location,
                'health_information' => $listing->health_information,
                'vaccination_information' => $listing->vaccination_information,
                'pricing_type' => $listing->pricing_type?->value,
                'price_per_kilo' => $listing->price_per_kilo,
                'price_per_head' => $listing->price_per_head,
                'status' => $listing->status?->value,
                'available_quantity' => (int) $listing->quantity,
                'quantity_sold' => max(0, $grossQuantity - min($grossQuantity, (int) $refund['quantity'])),
                'sales_total' => number_format(max(0, $grossSales - min($grossSales, (float) $refund['amount'])), 2, '.', ''),
                'updated_at' => $listing->updated_at?->toISOString(),
            ];
        });
        $inventory->setCollection($listings);

        $listingOptions = $seller->livestockListings()
            ->with('category:id,name')
            ->orderBy('name')
            ->get(['id', 'category_id', 'name'])
            ->map(fn (LivestockListing $listing): array => [
                'listing_key' => $this->listingKey($seller->id, (int) $listing->id),
                'name' => $listing->name,
                'category' => $listing->category?->name ?? 'Uncategorized',
            ]);

        $historyQuery = OrderItem::query()
            ->with([
                'listing' => fn ($listing) => $listing->withTrashed()->with([
                    'category:id,name,slug',
                    'images' => fn ($query) => $query->orderBy('sort_order')->orderBy('id'),
                ]),
                'order.buyer:id,name',
            ])
            ->whereHas('order', fn (Builder $order) => $order->where('seller_id', $seller->id))
            ->whereHas('listing', fn (Builder $listing) => $listing->withTrashed()->where('seller_id', $seller->id));
        if ($listingId !== null) {
            $historyQuery->where('listing_id', $listingId);
        }
        if (isset($filters['category'])) {
            $historyQuery->whereHas('listing', fn (Builder $listing) => $listing
                ->withTrashed()
                ->whereHas('category', fn (Builder $category) => $category->where('slug', $filters['category'])));
        }
        if (isset($filters['order_status'])) {
            $historyQuery->whereHas('order', fn (Builder $order) => $order->where('status', $filters['order_status']));
        }
        if (isset($filters['payment_status'])) {
            $historyQuery->whereHas('order', fn (Builder $order) => $order->where('payment_status', $filters['payment_status']));
        }
        if (isset($filters['from'])) {
            $historyQuery->whereHas('order', fn (Builder $order) => $order->whereDate('created_at', '>=', $filters['from']));
        }
        if (isset($filters['to'])) {
            $historyQuery->whereHas('order', fn (Builder $order) => $order->whereDate('created_at', '<=', $filters['to']));
        }
        if ($search !== '') {
            $historyQuery->where(function (Builder $query) use ($search): void {
                $query->whereHas('listing', fn (Builder $listing) => $listing->where('name', 'like', "%{$search}%"))
                    ->orWhereHas('order', function (Builder $order) use ($search): void {
                        $order->where('order_reference', 'like', "%{$search}%")
                            ->orWhereHas('buyer', fn (Builder $buyer) => $buyer->where('name', 'like', "%{$search}%"));
                    });
            });
        }
        $historyQuery->join('orders as inventory_orders', 'inventory_orders.id', '=', 'order_items.order_id')
            ->whereNull('inventory_orders.deleted_at')
            ->select('order_items.*');
        $historyDirection = $filters['history_direction'] ?? 'desc';
        match ($filters['history_sort'] ?? 'date') {
            'date' => $historyQuery->orderBy('inventory_orders.created_at', $historyDirection),
            'amount' => $historyQuery->orderBy('order_items.total_amount', $historyDirection),
            'quantity' => $historyQuery->orderBy('order_items.quantity', $historyDirection),
            'listing' => $historyQuery->orderBy(
                DB::table('livestock_listings')->select('name')->whereColumn('livestock_listings.id', 'order_items.listing_id'),
                $historyDirection,
            ),
            'buyer' => $historyQuery->orderBy(
                DB::table('users')->select('name')->whereColumn('users.id', 'inventory_orders.buyer_id'),
                $historyDirection,
            ),
            'order_status' => $historyQuery->orderBy('inventory_orders.status', $historyDirection),
        };
        $historyQuery->orderBy('order_items.id');
        $history = $historyQuery->paginate($perPage, ['*'], 'history_page', (int) ($filters['history_page'] ?? 1));
        $history->setCollection($history->getCollection()->map(static function (OrderItem $item): array {
            $order = $item->order;
            $listing = $item->listing;

            return [
                'order_reference' => $order->order_reference,
                'listing_name' => $listing?->name ?? 'Removed listing',
                'category' => $listing?->category?->name ?? 'Uncategorized',
                'image_url' => $listing?->images?->first()?->url,
                'date' => $order->created_at?->toISOString(),
                'quantity' => (int) $item->quantity,
                'buyer_name' => $order->buyer?->name ?? 'Buyer',
                'order_status' => $order->status->value,
                'payment_status' => $order->payment_status,
                'amount' => (string) $item->total_amount,
            ];
        }));

        return response()->json([
            'inventory' => $inventory,
            'history' => $history,
            'listing_options' => $listingOptions,
        ])->header('Cache-Control', 'private, no-store');
    }

    public function orderDetails(Request $request, string $orderReference): JsonResponse
    {
        $seller = $request->user();
        abort_unless($seller?->role === Role::SELLER, 403);
        $order = Order::query()
            ->where('seller_id', $seller->id)
            ->where('order_reference', strtoupper($orderReference))
            ->with([
                'buyer:id,name',
                    'items.listing' => fn ($listing) => $listing->withTrashed()->with('category:id,name'),
                'statusHistory.actor:id,name',
            ])
            ->firstOrFail();

        return response()->json([
            'order' => [
                'order_reference' => $order->order_reference,
                'status' => $order->status->value,
                'payment_status' => $order->payment_status,
                'payment_method' => $order->payment_method,
                'delivery_method' => $order->delivery_method,
                'created_at' => $order->created_at?->toISOString(),
                'buyer_name' => $order->buyer?->name ?? 'Buyer',
                'subtotal_amount' => (string) $order->subtotal_amount,
                'total_amount' => (string) $order->total_amount,
                'items' => $order->items->map(static fn (OrderItem $item): array => [
                    'listing_name' => $item->listing?->name ?? 'Removed listing',
                    'category' => $item->listing?->category?->name ?? 'Uncategorized',
                    'quantity' => (int) $item->quantity,
                    'unit_price' => (string) $item->unit_price,
                    'total_amount' => (string) $item->total_amount,
                    'pricing_type' => $item->pricing_type?->value,
                ])->values(),
                'status_history' => $order->statusHistory->map(static fn ($history): array => [
                    'from_status' => $history->from_status?->value,
                    'to_status' => $history->to_status->value,
                    'reason' => $history->reason,
                    'date' => $history->created_at?->toISOString(),
                    'actor_name' => $history->actor?->name ?? 'Farmgate',
                ])->values(),
            ],
        ])->header('Cache-Control', 'private, no-store');
    }

    /**
     * @param  list<int>  $listingIds
     * @return array<int, array{quantity: int, amount: float}>
     */
    private function paidRefundAdjustments(int $sellerId, array $listingIds): array
    {
        if ($listingIds === []) {
            return [];
        }

        $complaints = Complaint::query()
            ->where('refund_status', 'PAID')
            ->whereHas('order', fn (Builder $order) => $order->where('seller_id', $sellerId)->where('status', OrderStatus::COMPLETED->value))
            ->whereHas('order.items', fn (Builder $items) => $items->whereIn('listing_id', $listingIds))
            ->get(['requested_items', 'approved_refund_amount']);
        $adjustments = [];
        foreach ($complaints as $complaint) {
            $allRequestedItems = collect($complaint->requested_items ?? []);
            $requestedTotal = (float) $allRequestedItems->sum(static fn (array $item): float => (float) ($item['requested_amount'] ?? 0));
            $approvedAmount = (float) $complaint->approved_refund_amount;
            foreach ($allRequestedItems as $item) {
                $listingId = (int) $item['listing_id'];
                if (! in_array($listingId, $listingIds, true)) {
                    continue;
                }
                $weight = $requestedTotal > 0
                    ? (float) ($item['requested_amount'] ?? 0) / $requestedTotal
                    : 0.0;
                $adjustments[$listingId] ??= ['quantity' => 0, 'amount' => 0.0];
                $adjustments[$listingId]['quantity'] += (int) ($item['quantity'] ?? 0);
                $adjustments[$listingId]['amount'] += $approvedAmount * $weight;
            }
        }

        return $adjustments;
    }

    private function listingIdFromKey(?string $key, int $sellerId): ?int
    {
        if ($key === null || $key === '') {
            return null;
        }

        $listingId = LivestockListing::query()
            ->where('seller_id', $sellerId)
            ->pluck('id')
            ->first(fn ($id): bool => hash_equals($this->listingKey($sellerId, (int) $id), $key));
        abort_if($listingId === null, 404, 'The selected inventory listing was not found.');

        return (int) $listingId;
    }

    private function listingKey(int $sellerId, int $listingId): string
    {
        return SellerInventoryListingKey::make($sellerId, $listingId);
    }
}
