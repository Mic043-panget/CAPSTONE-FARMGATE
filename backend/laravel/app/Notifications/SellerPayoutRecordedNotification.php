<?php

namespace App\Notifications;

use App\Contracts\FarmgateNotification;
use Illuminate\Notifications\Notification;

class SellerPayoutRecordedNotification extends Notification implements FarmgateNotification
{
    public function __construct(
        public int $orderId,
        public string $orderReference,
        public int $amountCents,
    ) {}

    public function via(object $notifiable): array
    {
        return ['database'];
    }

    public function toArray(object $notifiable): array
    {
        return [
            'type' => 'seller_payout_recorded',
            'order_id' => $this->orderId,
            'order_reference' => $this->orderReference,
            'amount_cents' => $this->amountCents,
            'message' => 'Farmgate recorded an externally completed seller payout for order '.$this->orderReference.'. This record does not mean Farmgate sent the transfer.',
        ];
    }
}
