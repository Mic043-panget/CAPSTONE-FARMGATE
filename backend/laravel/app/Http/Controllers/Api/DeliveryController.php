<?php

namespace App\Http\Controllers\Api;

use App\Enums\OrderStatus;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Services\RiderAssignmentService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DeliveryController extends Controller
{
    public function assign(Request $request, RiderAssignmentService $service): JsonResponse
    {
        abort_unless($request->user()?->role === Role::SELLER, 403);

        $data = $request->validate([
            'order_id' => ['required', 'integer', 'exists:orders,id'],
        ]);

        $order = Order::query()->findOrFail($data['order_id']);
        abort_unless($order->seller_id === $request->user()->id, 403);
        abort_unless(in_array($order->status, [
            OrderStatus::READY_FOR_PICKUP,
            OrderStatus::FULFILLING,
        ], true), 422, 'This order is not accepted and in progress.');
        abort_if($order->delivery_method !== 'STANDARD_DELIVERY', 422, 'Rider assignment is only available for standard-delivery orders.');

        $delivery = $service->assignForOrder($order);

        return response()->json([
            'message' => $delivery->status->value === 'WAITING_FOR_RIDER' ? 'The order is awaiting rider assignment.' : 'Rider assignment updated.',
            'delivery' => $delivery->load('rider:id,name', 'offers.rider:id,name'),
        ]);
    }
}
