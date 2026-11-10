<?php

namespace App\Http\Controllers\Api;

use App\Enums\OrderStatus;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\User;
use App\Notifications\OrderUpdateRequestedNotification;
use App\Services\OrderWorkflowService;
use App\Services\RiderAssignmentService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use Throwable;

class OrderController extends Controller
{
    public function verify(string $reference): JsonResponse
    {
        $reference = strtoupper($reference);
        $order = Order::query()->where('order_reference', $reference)->first();

        if ($order === null) {
            $orderId = DB::table('order_reference_aliases')
                ->where('legacy_reference', $reference)
                ->value('order_id');
            $order = Order::query()->findOrFail($orderId);
        }

        return response()->json([
            'order' => [
                'order_reference' => $order->order_reference,
                'status' => $order->status->value,
                'created_at' => $order->created_at?->toISOString(),
            ],
        ]);
    }

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless(in_array($user->role, [Role::BUYER, Role::SELLER], true), 403);

        $query = Order::query()->with(['items.listing', 'statusHistory', 'delivery.rider:id,name']);
        $query->where($user->role === Role::BUYER ? 'buyer_id' : 'seller_id', $user->id);
        if ($user->role === Role::BUYER) {
            $query->with(['seller:id,name', 'codCollection.remittance']);
        } else {
            $query->with('buyer:id,name');
        }
        $orders = $query->latest()->get();

        if ($user->role === Role::BUYER) {
            $orders = $orders->map(function (Order $order): array {
                $order->setAttribute('cod_payment', $this->codPaymentSummary($order));
                $order->unsetRelation('codCollection');
                $rawStatus = (string) $order->getRawOriginal('status');
                $status = OrderStatus::tryFrom($rawStatus);
                $order->setAttribute('buyer_can_cancel', $status !== null && OrderWorkflowService::buyerCanCancel($status));
                if ($rawStatus === OrderStatus::FULFILLING->value) {
                    $order->setAttribute('buyer_cancellation_blocked_reason', 'This order is on the way and can no longer be cancelled.');
                }

                $deliveryStatus = $order->delivery?->getRawOriginal('status');
                $order->makeHidden('status');
                if ($order->delivery) {
                    $order->delivery->makeHidden('status');
                }
                $payload = $order->toArray();
                $payload['status'] = $rawStatus;
                if (isset($payload['delivery']) && $deliveryStatus !== null) {
                    $payload['delivery']['status'] = $deliveryStatus;
                }

                return $payload;
            });
        }

        return response()->json(['orders' => $orders]);
    }

    public function show(Request $request, Order $order): JsonResponse
    {
        $this->authorizeOrder($request, $order);

        $relations = [
            'items.listing.category',
            'seller:id,name',
            'seller.sellerProfile:user_id,business_name,phone,latitude,longitude,address',
            'statusHistory.actor:id,name',
            'activities',
            'delivery.rider:id,name',
            'delivery.statusHistory.actor:id,name',
        ];
        if ($request->user()->role === Role::SELLER) {
            $relations[] = 'buyer:id,name';
        } else {
            $relations[] = 'codCollection.remittance';
        }

        $order->load($relations);
        if ($request->user()->role === Role::BUYER) {
            $order->setAttribute('cod_payment', $this->codPaymentSummary($order));
            $order->unsetRelation('codCollection');
        }

        return response()->json(['order' => $order]);
    }

    public function requestUpdate(Request $request, Order $order): JsonResponse
    {
        abort_unless($request->user()->role === Role::BUYER, 403);
        $this->authorizeOrder($request, $order);

        $seller = User::query()->findOrFail($order->seller_id);
        $key = 'order-update-request:'.$request->user()->id.':'.$order->id;
        $sent = RateLimiter::attempt($key, 1, function () use ($seller, $order, $request): bool {
            $seller->notify(new OrderUpdateRequestedNotification($order->id, $request->user()->name, $order->order_reference));

            return true;
        }, 900);

        abort_if($sent === false, 429, 'You recently requested an update for this order. Please wait before requesting again.');

        return response()->json(['message' => 'The seller has been asked to send you an order update.']);
    }

    public function updateStatus(Request $request, Order $order, OrderWorkflowService $workflow, RiderAssignmentService $assignment): JsonResponse
    {
        $this->authorizeOrder($request, $order);
        $data = $request->validate([
            'status' => ['required', 'string'],
            'reason' => ['nullable', 'string', 'max:500'],
        ]);
        $status = OrderStatus::tryFrom($data['status']);
        abort_if($status === null, 422, 'The selected status is invalid.');
        abort_if(
            $request->user()->role === Role::SELLER
                && $status === OrderStatus::REJECTED
                && blank($data['reason'] ?? null),
            422,
            'A reason is required when rejecting an order.',
        );

        $updated = $workflow->transition($order, $request->user(), $status, $data['reason'] ?? null);
        $delivery = null;
        $assignmentWarning = null;
        if ($request->user()->role === Role::SELLER
            && $status === OrderStatus::READY_FOR_PICKUP
            && $updated->delivery_method === 'STANDARD_DELIVERY') {
            try {
                $delivery = $assignment->assignForOrder($updated);
            } catch (Throwable $exception) {
                Log::error('Automatic rider assignment failed after seller acceptance.', [
                    'order_id' => $updated->id,
                    'seller_id' => $request->user()->id,
                    'exception' => $exception,
                ]);
                $delivery = $updated->delivery()->with('rider:id,name', 'offers.rider:id,name')->first();
                $assignmentWarning = 'The order was accepted, but rider assignment could not be completed. Retry assignment from the order details.';
                try {
                    $assignment->notifyAssignmentFailure($updated, $assignmentWarning);
                } catch (Throwable $notificationException) {
                    Log::error('Seller could not be notified about a rider assignment failure.', [
                        'order_id' => $updated->id,
                        'seller_id' => $request->user()->id,
                        'exception' => $notificationException,
                    ]);
                }
            }
        }

        return response()->json([
            'message' => 'Order status updated.',
            'order' => $updated,
            'delivery' => $delivery?->load('rider:id,name', 'offers.rider:id,name'),
            'rider_assignment_warning' => $assignmentWarning,
        ]);
    }

    private function authorizeOrder(Request $request, Order $order): void
    {
        $user = $request->user();
        abort_unless(
            ($user->role === Role::BUYER && $order->buyer_id === $user->id)
                || ($user->role === Role::SELLER && $order->seller_id === $user->id),
            403,
        );
    }

    /**
     * @return array{amount_due: string, status: string, collection_status: string|null, remittance_status: string|null}|null
     */
    private function codPaymentSummary(Order $order): ?array
    {
        if ($order->payment_method !== 'COD') {
            return null;
        }

        $collection = $order->codCollection;
        $remittance = $collection?->remittance;

        return [
            'amount_due' => (string) $order->total_amount,
            'status' => $order->payment_status === 'PAID'
                ? 'PAID'
                : ($collection ? 'AWAITING_CONFIRMATION' : 'UNPAID'),
            'collection_status' => $collection?->status,
            'remittance_status' => $remittance?->status,
        ];
    }
}
