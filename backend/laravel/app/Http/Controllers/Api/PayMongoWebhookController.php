<?php

namespace App\Http\Controllers\Api;

use App\Enums\OrderStatus;
use App\Http\Controllers\Controller;
use App\Models\LivestockListing;
use App\Models\Order;
use App\Models\OrderStatusHistory;
use App\Notifications\OrderStatusChangedNotification;
use App\Services\RiderAssignmentService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PayMongoWebhookController extends Controller
{
    public function handle(Request $request): JsonResponse
    {
        $secret = config('services.paymongo.webhook_secret');
        abort_if(! filled($secret), 503, 'PayMongo webhook signing is not configured.');

        $parts = [];
        foreach (explode(',', (string) $request->header('Paymongo-Signature')) as $component) {
            [$key, $value] = array_pad(explode('=', trim($component), 2), 2, null);
            if ($key && $value) {
                $parts[$key] = $value;
            }
        }

        $timestamp = $parts['t'] ?? '';
        $signatureKey = str_starts_with((string) config('services.paymongo.secret_key'), 'sk_live_') ? 'li' : 'te';
        $signature = $parts[$signatureKey] ?? '';
        abort_unless(ctype_digit($timestamp) && abs(time() - (int) $timestamp) <= 300, 401, 'Invalid PayMongo webhook timestamp.');

        $expected = hash_hmac('sha256', $timestamp.'.'.$request->getContent(), $secret);
        abort_unless(hash_equals($expected, $signature), 401, 'Invalid PayMongo webhook signature.');

        $type = $request->input('data.type');
        $sessionId = $request->input('data.data.id');
        if (! is_string($type) || ! is_string($sessionId)) {
            return response()->json(['message' => 'Webhook event ignored.']);
        }

        if ($type === 'checkout_session.payment.paid') {
            $orderIds = Order::query()->where('paymongo_checkout_session_id', $sessionId)->pluck('id');
            if ($orderIds->isNotEmpty()) {
                DB::transaction(function () use ($orderIds): void {
                    foreach (Order::query()->whereIn('id', $orderIds)->lockForUpdate()->get() as $order) {
                        if ($order->payment_status !== 'PENDING') {
                            continue;
                        }

                        $order->forceFill(['payment_status' => 'PAID', 'paid_at' => now()])->save();
                        DB::afterCommit(function () use ($order): void {
                            app(RiderAssignmentService::class)->dispatchForOrder($order->id);
                            $seller = $order->seller;
                            if ($seller?->accountPreferenceEnabled('order_notifications')) {
                                $seller->notify(new OrderStatusChangedNotification($order->id, OrderStatus::PENDING_CONFIRMATION, $order->order_reference));
                            }
                        });
                    }
                });
            }
        } elseif (in_array($type, ['checkout_session.payment.failed', 'checkout_session.expired'], true)) {
            $orders = Order::query()->where('paymongo_checkout_session_id', $sessionId)->get();
            foreach ($orders as $order) {
                $this->cancelUnpaidOrder($order);
            }
        }

        return response()->json(['message' => 'Webhook received.']);
    }

    private function cancelUnpaidOrder(Order $order): void
    {
        DB::transaction(function () use ($order): void {
            $lockedOrder = Order::query()->with('items')->lockForUpdate()->find($order->id);
            if (! $lockedOrder || $lockedOrder->payment_status !== 'PENDING' || $lockedOrder->status !== OrderStatus::PENDING_CONFIRMATION) {
                return;
            }

            foreach ($lockedOrder->items as $item) {
                LivestockListing::withTrashed()->whereKey($item->listing_id)->increment('quantity', $item->quantity);
            }

            $lockedOrder->forceFill([
                'payment_status' => 'FAILED',
                'status' => OrderStatus::CANCELLED,
                'stock_reserved_at' => null,
            ])->save();
            OrderStatusHistory::create([
                'order_id' => $lockedOrder->id,
                'from_status' => OrderStatus::PENDING_CONFIRMATION,
                'to_status' => OrderStatus::CANCELLED,
                'changed_by' => $lockedOrder->buyer_id,
                'reason' => 'PayMongo payment failed or checkout expired.',
            ]);
        });
    }
}
