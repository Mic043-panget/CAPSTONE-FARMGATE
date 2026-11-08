<?php

namespace App\Services;

use App\Enums\DeliveryStatus;
use App\Enums\OrderStatus;
use App\Enums\Role;
use App\Jobs\SendOrderStatusEmail;
use App\Models\Delivery;
use App\Models\LivestockListing;
use App\Models\Order;
use App\Models\OrderStatusEmailDelivery;
use App\Models\RiderOffer;
use App\Models\User;
use App\Notifications\OrderStatusChangedNotification;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;
use Throwable;

class OrderWorkflowService
{
    public function __construct(private readonly SystemSettingsService $settings) {}

    private const BUYER_CANCELLABLE_STATUSES = [
        OrderStatus::PENDING_CONFIRMATION,
        OrderStatus::CONFIRMED,
        OrderStatus::PREPARING,
        OrderStatus::READY_FOR_PICKUP,
    ];

    private const TRANSITIONS = [
        OrderStatus::PENDING_CONFIRMATION->value => [
            Role::SELLER->value => [OrderStatus::CONFIRMED, OrderStatus::REJECTED],
            Role::BUYER->value => [OrderStatus::CANCELLED],
        ],
        OrderStatus::CONFIRMED->value => [
            Role::SELLER->value => [OrderStatus::PREPARING, OrderStatus::CANCELLED],
            Role::BUYER->value => [OrderStatus::CANCELLED],
        ],
        OrderStatus::PREPARING->value => [
            Role::SELLER->value => [OrderStatus::READY_FOR_PICKUP],
            Role::BUYER->value => [OrderStatus::CANCELLED],
        ],
        OrderStatus::READY_FOR_PICKUP->value => [
            Role::SELLER->value => [OrderStatus::FULFILLING],
            Role::BUYER->value => [OrderStatus::CANCELLED],
        ],
        OrderStatus::FULFILLING->value => [
            Role::SELLER->value => [OrderStatus::COMPLETED],
        ],
    ];

    public function transition(Order $order, User $actor, OrderStatus $nextStatus, ?string $reason = null): Order
    {
        $role = $actor->role;
        $ownsOrder = ($role === Role::BUYER && $order->buyer_id === $actor->id)
            || ($role === Role::SELLER && $order->seller_id === $actor->id);

        if (! $ownsOrder) {
            abort(403, 'You are not authorized to update this order.');
        }

        if ($nextStatus === OrderStatus::CANCELLED) {
            if ($role === Role::SELLER) {
                abort_unless($this->settings->getBoolean('allow_seller_cancellation'), 403, 'Seller cancellation is disabled.');

                $windowMinutes = $this->settings->getInt('order_cancellation_minutes');
                if ($windowMinutes > 0) {
                    $expiresAt = $order->created_at?->copy()->addMinutes($windowMinutes) ?? now()->addMinutes($windowMinutes);
                    abort_if(now()->greaterThan($expiresAt), 422, 'Order cancellation window has expired.');
                }
            }
        }

        $allowed = self::TRANSITIONS[$order->status->value][$role->value] ?? [];
        if (! in_array($nextStatus, $allowed, true)) {
            if (in_array($nextStatus, [OrderStatus::CANCELLED, OrderStatus::REJECTED], true)
                && Delivery::query()
                    ->where('order_id', $order->id)
                    ->whereIn('status', [DeliveryStatus::PICKED_UP->value, DeliveryStatus::IN_TRANSIT->value])
                    ->exists()) {
                abort(409, 'This order has been picked up. Use the delivery exception or return workflow instead of cancelling it.');
            }
            throw ValidationException::withMessages([
                'status' => ['This order status transition is not allowed.'],
            ]);
        }

        return DB::transaction(function () use ($order, $actor, $nextStatus, $reason): Order {
            $lockedOrder = Order::query()->lockForUpdate()->findOrFail($order->id);
            if ($lockedOrder->status !== $order->status) {
                throw ValidationException::withMessages([
                    'status' => ['The order changed before this update could be applied.'],
                ]);
            }
            if ($nextStatus === OrderStatus::COMPLETED && $lockedOrder->delivery_method === 'STANDARD_DELIVERY') {
                $delivery = Delivery::query()->where('order_id', $lockedOrder->id)->lockForUpdate()->first();
                abort_unless(
                    $delivery?->status === DeliveryStatus::DELIVERED,
                    409,
                    'Standard delivery must be QR-verified before the order can be completed.',
                );
            }
            $delivery = null;
            $affectedRiderIds = collect();
            if (in_array($nextStatus, [OrderStatus::CANCELLED, OrderStatus::REJECTED], true)) {
                $delivery = Delivery::query()->where('order_id', $lockedOrder->id)->lockForUpdate()->first();
                abort_if(
                    $delivery && in_array($delivery->status, [DeliveryStatus::PICKED_UP, DeliveryStatus::IN_TRANSIT], true),
                    409,
                    'This order has been picked up. Use the delivery exception or return workflow instead of cancelling it.',
                );
                if ($delivery) {
                    $affectedRiderIds = RiderOffer::query()
                        ->where('delivery_id', $delivery->id)
                        ->where('status', 'OPEN')
                        ->pluck('rider_id');
                    if ($delivery->rider_id !== null) {
                        $affectedRiderIds->push($delivery->rider_id);
                    }
                    $affectedRiderIds = $affectedRiderIds->unique()->values();
                }
            }
            abort_if(
                $actor->role === Role::SELLER
                    && $lockedOrder->payment_method !== 'COD'
                    && $lockedOrder->payment_status !== 'PAID',
                409,
                'This online payment has not been confirmed by PayMongo yet.',
            );

            $fromStatus = $lockedOrder->status;
            $lockedOrder->status = $nextStatus;
            $lockedOrder->save();
            if (in_array($nextStatus, [OrderStatus::CANCELLED, OrderStatus::REJECTED], true)) {
                if ($delivery) {
                    $this->cancelDelivery($delivery, $actor, $reason ?? 'Order '.$nextStatus->value.'.');
                }
            }
            if ($nextStatus === OrderStatus::COMPLETED) {
                $delivery = Delivery::query()->where('order_id', $lockedOrder->id)->lockForUpdate()->first();
                if ($delivery && in_array($delivery->status, [
                    DeliveryStatus::WAITING_FOR_RIDER,
                    DeliveryStatus::RIDER_OFFERED,
                    DeliveryStatus::SEARCHING_FOR_RIDER,
                    DeliveryStatus::FAILED,
                ], true)) {
                    RiderOffer::query()->where('delivery_id', $delivery->id)->where('status', 'OPEN')->update(['status' => 'REVOKED']);
                    $previousStatus = $delivery->status;
                    $delivery->forceFill([
                        'status' => DeliveryStatus::CANCELLED,
                        'rider_id' => null,
                        'assigned_at' => null,
                        'rider_location_latitude' => null,
                        'rider_location_longitude' => null,
                        'rider_location_updated_at' => null,
                        'rider_location_captured_at' => null,
                        'pickup_qr_token_hash' => null,
                        'pickup_qr_expires_at' => null,
                        'delivery_qr_token_hash' => null,
                        'delivery_qr_expires_at' => null,
                        'qr_token' => null,
                        'order_qr_token_encrypted' => null,
                        'order_qr_token_hash' => null,
                        'order_qr_rider_id' => null,
                    ])->save();
                    $delivery->statusHistory()->create([
                        'changed_by' => $actor->id,
                        'from_status' => $previousStatus->value,
                        'to_status' => DeliveryStatus::CANCELLED->value,
                        'reason' => 'Order completed before rider assignment.',
                        'created_at' => now(),
                    ]);
                }
            }
            if ($lockedOrder->stock_reserved_at && in_array($nextStatus, [OrderStatus::CANCELLED, OrderStatus::REJECTED], true)) {
                foreach ($lockedOrder->items as $item) {
                    $listing = LivestockListing::withTrashed()->lockForUpdate()->find($item->listing_id);
                    $listing?->increment('quantity', $item->quantity);
                }
                $lockedOrder->forceFill(['stock_reserved_at' => null])->save();
            }
            $lockedOrder->statusHistory()->create([
                'from_status' => $fromStatus,
                'to_status' => $nextStatus,
                'changed_by' => $actor->id,
                'reason' => $reason,
            ]);

            $criticalStatus = in_array($nextStatus, [OrderStatus::CANCELLED, OrderStatus::REJECTED], true);
            if ($this->settings->getBoolean('in_app_notifications_enabled')
                && ($criticalStatus || $this->settings->getBoolean('order_notifications_enabled'))) {
                $recipients = collect([$lockedOrder->buyer, $lockedOrder->seller]);
                if ($criticalStatus) {
                    $recipients = $recipients->merge(User::query()->whereIn('id', $affectedRiderIds)->get());
                }
                foreach ($recipients->filter()->unique('id') as $recipient) {
                    if ($criticalStatus || $recipient->accountPreferenceEnabled('order_notifications')) {
                        $recipient->notify(new OrderStatusChangedNotification($lockedOrder->id, $nextStatus, $lockedOrder->order_reference, $reason));
                    }
                }
            }

            if ($criticalStatus && $this->settings->getBoolean('email_notifications_enabled')) {
                $recipients = collect([$lockedOrder->buyer, $lockedOrder->seller])
                    ->merge(User::query()->whereIn('id', $affectedRiderIds)->get())
                    ->filter()
                    ->unique('id');
                foreach ($recipients as $recipient) {
                    if (! filled($recipient->email)) {
                        continue;
                    }
                    $email = OrderStatusEmailDelivery::query()->create([
                        'order_id' => $lockedOrder->id,
                        'recipient_id' => $recipient->id,
                        'order_status' => $nextStatus->value,
                        'reason' => $reason,
                    ]);
                    DB::afterCommit(function () use ($email): void {
                        try {
                            SendOrderStatusEmail::dispatch($email->id);
                        } catch (Throwable $exception) {
                            $email->forceFill([
                                'delivery_status' => 'FAILED',
                                'error_code' => $exception::class,
                            ])->save();
                            Log::error('An order status email could not be queued.', [
                                'email_delivery_id' => $email->id,
                                'exception' => $exception::class,
                            ]);
                        }
                    });
                }
            }

            return $lockedOrder->load('items', 'statusHistory');
        });
    }

    private function cancelDelivery(Delivery $delivery, User $actor, string $reason): void
    {
        if ($delivery->status !== DeliveryStatus::CANCELLED) {
            $previousStatus = $delivery->status;
            $delivery->forceFill([
                'status' => DeliveryStatus::CANCELLED,
                'rider_id' => null,
                'assigned_at' => null,
                'rider_location_latitude' => null,
                'rider_location_longitude' => null,
                'rider_location_updated_at' => null,
                'rider_location_captured_at' => null,
                'pickup_qr_token_hash' => null,
                'pickup_qr_expires_at' => null,
                'delivery_qr_token_hash' => null,
                'delivery_qr_expires_at' => null,
                'qr_token' => null,
                'order_qr_token_encrypted' => null,
                'order_qr_token_hash' => null,
                'order_qr_rider_id' => null,
            ])->save();
            $delivery->statusHistory()->create([
                'changed_by' => $actor->id,
                'from_status' => $previousStatus->value,
                'to_status' => DeliveryStatus::CANCELLED->value,
                'reason' => $reason,
                'created_at' => now(),
            ]);
        }

        RiderOffer::query()
            ->where('delivery_id', $delivery->id)
            ->where('status', 'OPEN')
            ->update(['status' => 'REVOKED']);
    }

    public static function buyerCanCancel(OrderStatus $status): bool
    {
        return in_array($status, self::BUYER_CANCELLABLE_STATUSES, true);
    }
}
