<?php

namespace App\Http\Controllers\Api\Seller;

use App\Enums\ListingStatus;
use App\Enums\OrderStatus;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\Interest;
use App\Models\LivestockListing;
use App\Models\Order;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DashboardController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        abort_unless($request->user()?->role === Role::SELLER, 403);

        $sellerId = $request->user()->id;
        $orders = Order::query()->where('seller_id', $sellerId);
        $completedOrders = $orders->clone()->where('status', OrderStatus::COMPLETED->value);
        $pendingOrders = $orders->clone()->whereIn('status', [
            OrderStatus::PENDING_CONFIRMATION->value,
            OrderStatus::CONFIRMED->value,
            OrderStatus::PREPARING->value,
            OrderStatus::READY_FOR_PICKUP->value,
            OrderStatus::FULFILLING->value,
        ]);

        return response()->json(['summary' => [
            'total_completed_sales' => (string) number_format((float) $completedOrders->sum('total_amount'), 2, '.', ''),
            'sales_today' => (string) number_format((float) $completedOrders->whereDate('created_at', today())->sum('total_amount'), 2, '.', ''),
            'sales_this_month' => (string) number_format((float) $completedOrders->whereMonth('created_at', now()->month)->sum('total_amount'), 2, '.', ''),
            'completed_orders' => $completedOrders->count(),
            'pending_orders' => $pendingOrders->count(),
            'active_listings' => LivestockListing::query()->where('seller_id', $sellerId)->where('status', ListingStatus::ACTIVE->value)->count(),
            'sold_listings' => $completedOrders->count(),
            'interested_buyers' => Interest::query()->whereHas('listing', fn ($query) => $query->where('seller_id', $sellerId))->count(),
            'recent_orders' => $orders->with('delivery')->latest()->take(5)->get(),
            'best_selling_products' => $orders->with('items.listing')->get()->flatMap(fn ($order) => $order->items)->take(5)->values(),
        ]]);
    }
}
