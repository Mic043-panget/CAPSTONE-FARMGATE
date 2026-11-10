<?php

namespace App\Notifications;

use App\Contracts\FarmgateNotification;
use App\Enums\OrderStatus;
use Illuminate\Notifications\Notification;

class OrderStatusChangedNotification extends Notification implements FarmgateNotification
{
    public function __construct(
        public int $orderId,
        public OrderStatus $status,
        public string $orderReference,
        public ?string $reason = null,
    ) {}

    public function via(object $notifiable): array
    {
        return ['database'];
    }

    public function toArray(object $notifiable): array
    {
        return [
            'type' => 'order_status_changed',
            'order_id' => $this->orderId,
            'order_reference' => $this->orderReference,
            'status' => $this->status->value,
            'reason' => $this->reason,
        ];
    }
}
