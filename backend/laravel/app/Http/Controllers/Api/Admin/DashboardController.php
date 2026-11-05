<?php

namespace App\Http\Controllers\Api\Admin;

use App\Enums\DeliveryStatus;
use App\Enums\ListingStatus;
use App\Enums\OrderStatus;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\Delivery;
use App\Models\LivestockListing;
use App\Models\Order;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DashboardController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);

        return response()->json(['summary' => [
            'total_users' => User::query()->count(),
            'total_orders' => Order::query()->count(),
            'active_listings' => LivestockListing::query()->where('status', ListingStatus::ACTIVE->value)->count(),
            'pending_listings' => LivestockListing::query()->where('status', ListingStatus::PENDING_REVIEW->value)->count(),
            'active_deliveries' => Delivery::query()->whereIn('status', [
                DeliveryStatus::SEARCHING_FOR_RIDER->value,
                DeliveryStatus::RIDER_OFFERED->value,
                DeliveryStatus::RIDER_ACCEPTED->value,
                DeliveryStatus::PICKUP_PENDING->value,
                DeliveryStatus::PICKED_UP->value,
                DeliveryStatus::IN_TRANSIT->value,
            ])->count(),
            'waiting_deliveries' => Delivery::query()->where('status', DeliveryStatus::WAITING_FOR_RIDER->value)->count(),
            'delivered_with_proof' => Delivery::query()->where('status', DeliveryStatus::DELIVERED->value)->whereNotNull('delivery_proof_path')->count(),
            'delivered_without_proof' => Delivery::query()->where('status', DeliveryStatus::DELIVERED->value)->whereNull('delivery_proof_path')->count(),
            'total_sales' => (string) number_format((float) Order::query()->where('status', OrderStatus::COMPLETED->value)->sum('total_amount'), 2, '.', ''),
        ]]);
    }
}
