<?php

namespace App\Notifications;

use App\Contracts\FarmgateNotification;
use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Notification;

class CalendarEventNotification extends Notification implements FarmgateNotification
{
    use Queueable;

    public function __construct(
        private readonly int $eventId,
        private readonly string $title,
        private readonly string $status,
        private readonly string $action,
        private readonly string $startsAt,
    ) {}

    public function via(object $notifiable): array
    {
        return ['database'];
    }

    public function toArray(object $notifiable): array
    {
        return [
            'type' => 'calendar_event',
            'event_id' => $this->eventId,
            'title' => $this->title,
            'status' => $this->status,
            'action' => $this->action,
            'starts_at' => $this->startsAt,
            'message' => match ($this->action) {
                'approved' => 'A Farmgate event was approved.',
                'rejected' => 'A Farmgate event was not approved.',
                'cancelled' => 'A Farmgate event was cancelled.',
                'updated' => 'A Farmgate event schedule was updated.',
                'upcoming' => 'A Farmgate event is coming up soon.',
                default => 'A Farmgate event is available in the calendar.',
            },
        ];
    }
}
