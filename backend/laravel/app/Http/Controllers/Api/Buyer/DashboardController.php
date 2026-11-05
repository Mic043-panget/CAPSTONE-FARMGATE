<?php

namespace App\Http\Controllers\Api\Buyer;

use App\Enums\OrderStatus;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\Interest;
use App\Models\Order;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DashboardController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        abort_unless($request->user()?->role === Role::BUYER, 403);

        $orders = Order::query()->where('buyer_id', $request->user()->id);
        $activeStatuses = [
            OrderStatus::PENDING_CONFIRMATION->value,
            OrderStatus::CONFIRMED->value,
            OrderStatus::PREPARING->value,
            OrderStatus::READY_FOR_PICKUP->value,
            OrderStatus::FULFILLING->value,
        ];

        return response()->json(['summary' => [
            'active_orders' => $orders->clone()->whereIn('status', $activeStatuses)->count(),
            'interested_listings' => Interest::query()->where('buyer_id', $request->user()->id)->count(),
            'purchase_history' => $orders->with('delivery')->latest()->take(5)->get(),
            'notifications' => $request->user()->notifications()->latest()->take(5)->get(),
        ]]);
    }
}
