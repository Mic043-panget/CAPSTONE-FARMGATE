<?php

namespace App\Notifications;

use App\Contracts\FarmgateNotification;
use Illuminate\Notifications\Notification;

class PromotionChangedNotification extends Notification implements FarmgateNotification
{
    public function __construct(
        public int $promotionId,
        public string $title,
        public string $action,
        public string $status,
        public string $changedAt,
    ) {}

    public function via(object $notifiable): array
    {
        return ['database'];
    }

    public function toArray(object $notifiable): array
    {
        return [
            'type' => 'promotion_changed',
            'promotion_id' => $this->promotionId,
            'title' => $this->title,
            'action' => $this->action,
            'status' => $this->status,
            'changed_at' => $this->changedAt,
            'message' => match ($this->action) {
                'activated' => 'A seller promotion is now available.',
                'paused' => 'A seller promotion was paused.',
                'ended' => 'A seller promotion has ended.',
                default => 'A seller promotion was updated.',
            },
        ];
    }
}
