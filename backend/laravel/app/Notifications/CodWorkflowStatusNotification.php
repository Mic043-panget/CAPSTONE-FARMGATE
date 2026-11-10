<?php

namespace App\Notifications;

use App\Contracts\FarmgateNotification;
use Illuminate\Notifications\Notification;

class CodWorkflowStatusNotification extends Notification implements FarmgateNotification
{
    public function __construct(
        public string $type,
        public int $orderId,
        public string $orderReference,
        public string $status,
        public string $message,
    ) {}

    public function via(object $notifiable): array
    {
        return ['database'];
    }

    public function toArray(object $notifiable): array
    {
        return [
            'type' => $this->type,
            'order_id' => $this->orderId,
            'order_reference' => $this->orderReference,
            'status' => $this->status,
            'message' => $this->message,
        ];
    }
}
