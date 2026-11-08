<?php

namespace App\Notifications;

use Illuminate\Notifications\Notification;

class OrderCaseUpdatedNotification extends Notification
{
    public function __construct(
        public int $caseId,
        public int $orderId,
        public string $orderReference,
        public string $caseType,
        public string $message,
    ) {}

    public function via(object $notifiable): array
    {
        return ['database'];
    }

    public function toArray(object $notifiable): array
    {
        return [
            'type' => 'order_case_updated',
            'case_id' => $this->caseId,
            'case_type' => $this->caseType,
            'order_id' => $this->orderId,
            'order_reference' => $this->orderReference,
            'message' => $this->message,
        ];
    }
}
