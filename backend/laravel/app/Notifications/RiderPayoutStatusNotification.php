<?php

namespace App\Notifications;

use App\Contracts\FarmgateNotification;
use Illuminate\Notifications\Notification;

class RiderPayoutStatusNotification extends Notification implements FarmgateNotification
{
    public function __construct(
        public string $reference,
        public string $status,
        public int $amountCents,
        public string $message,
    ) {}

    public function toArray(object $notifiable): array
    {
        return [
            'type' => 'rider_payout_'.$this->status,
            'payout_reference' => $this->reference,
            'status' => $this->status,
            'amount_cents' => $this->amountCents,
            'message' => $this->message,
        ];
    }
}
