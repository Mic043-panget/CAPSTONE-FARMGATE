<?php

namespace App\Notifications;

use App\Contracts\FarmgateNotification;
use Illuminate\Notifications\Notification;

class OrderUpdateRequestedNotification extends Notification implements FarmgateNotification
{
    public function __construct(
        public int $orderId,
        public string $buyerName,
        public string $orderReference,
    ) {}

    public function via(object $notifiable): array
    {
        return ['database'];
    }

    public function toArray(object $notifiable): array
    {
        return [
            'type' => 'order_update_requested',
            'order_id' => $this->orderId,
            'order_reference' => $this->orderReference,
            'buyer_name' => $this->buyerName,
        ];
    }
}
