<?php

namespace App\Notifications;

use App\Contracts\FarmgateNotification;
use Illuminate\Notifications\Notification;

class SellerVerificationStatusNotification extends Notification implements FarmgateNotification
{
    public function __construct(
        private readonly string $status,
        private readonly string $changedAt,
    ) {}

    public function via(object $notifiable): array
    {
        return ['database'];
    }

    public function toArray(object $notifiable): array
    {
        $statusLabel = match ($this->status) {
            'PENDING' => 'pending review',
            'VERIFIED' => 'verified',
            'REJECTED' => 'rejected',
            default => 'updated',
        };

        return [
            'type' => 'seller_verification_status',
            'status' => $this->status,
            'changed_at' => $this->changedAt,
            'message' => 'Your seller identity verification is '.$statusLabel.'.',
        ];
    }
}
