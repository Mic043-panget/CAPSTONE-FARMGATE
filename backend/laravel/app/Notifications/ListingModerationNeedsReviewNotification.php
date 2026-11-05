<?php

namespace App\Notifications;

use Illuminate\Notifications\Notification;

class ListingModerationNeedsReviewNotification extends Notification
{
    /**
     * @param  array<int, string>  $reasons
     * @param  array<int, string>  $flags
     */
    public function __construct(
        public int $listingId,
        public string $listingName,
        public string $moderationStatus,
        public array $reasons,
        public array $flags,
    ) {}

    public function via(object $notifiable): array
    {
        return ['database'];
    }

    public function toArray(object $notifiable): array
    {
        return [
            'type' => 'listing_moderation_updated',
            'listing_id' => $this->listingId,
            'listing_name' => $this->listingName,
            'moderation_status' => $this->moderationStatus,
            'reasons' => $this->reasons,
            'flags' => $this->flags,
        ];
    }
}
