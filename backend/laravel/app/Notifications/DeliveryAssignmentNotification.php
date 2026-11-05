<?php

namespace App\Notifications;

use Illuminate\Notifications\Notification;

class DeliveryAssignmentNotification extends Notification
{
    public function __construct(
        public string $event,
        public int $orderId,
        public string $orderReference,
        public int $deliveryId,
        public string $message,
        public ?int $offerId = null,
    ) {}

    public function via(object $notifiable): array
    {
        return ['database'];
    }

    public function toArray(object $notifiable): array
    {
        return [
            'type' => $this->event,
            'order_id' => $this->orderId,
            'order_reference' => $this->orderReference,
            'delivery_id' => $this->deliveryId,
            'offer_id' => $this->offerId,
            'message' => $this->message,
            'has_delivery_proof' => $this->event === 'delivery_proof_recorded',
        ];
    }
}
