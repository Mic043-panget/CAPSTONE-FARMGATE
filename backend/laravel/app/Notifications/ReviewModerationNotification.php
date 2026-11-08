<?php

namespace App\Notifications;

use Illuminate\Notifications\Notification;

class ReviewModerationNotification extends Notification
{
    public function __construct(public int $reviewId, public int $orderId, public string $status) {}

    public function via(object $notifiable): array
    {
        return ['database'];
    }

    public function toArray(object $notifiable): array
    {
        $message = match ($this->status) {
            'reported' => 'Review #'.$this->reviewId.' was reported for admin moderation.',
            'hidden' => 'Your review was hidden after admin moderation.',
            'published' => 'Your review was restored after admin moderation.',
            default => 'Your review moderation status was updated.',
        };

        return [
            'type' => 'review_moderation_updated',
            'review_id' => $this->reviewId,
            'order_id' => $this->orderId,
            'status' => $this->status,
            'message' => $message,
        ];
    }
}
