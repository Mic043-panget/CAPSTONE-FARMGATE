<?php

namespace App\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Notification;

class RiderApplicationStatusNotification extends Notification
{
    use Queueable;

    public function __construct(
        private readonly int $applicationId,
        private readonly string $status,
        private readonly ?string $reason,
    ) {}

    public function via(object $notifiable): array
    {
        return ['database'];
    }

    public function toArray(object $notifiable): array
    {
        $statusLabel = str_replace('_', ' ', strtolower($this->status));

        return [
            'type' => 'rider_application_status',
            'application_id' => $this->applicationId,
            'status' => $this->status,
            'message' => 'Your rider application is '.$statusLabel.'.',
            'reason' => $this->reason,
        ];
    }
}
