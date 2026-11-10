<?php

namespace App\Notifications;

use App\Contracts\FarmgateNotification;
use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Notification;

class RiderApplicationStatusNotification extends Notification implements FarmgateNotification
{
    use Queueable;

    public function __construct(
        private readonly int $applicationId,
        private readonly string $publicReference,
        private readonly string $status,
        private readonly ?string $reason,
        private readonly bool $vehicleChange = false,
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
            ...($this->vehicleChange ? ['vehicle_change_id' => $this->applicationId] : ['application_id' => $this->applicationId]),
            ...($this->vehicleChange ? ['vehicle_reference' => $this->publicReference] : ['application_reference' => $this->publicReference]),
            'status' => $this->status,
            'message' => ($this->vehicleChange ? 'Vehicle update ' : 'Rider application ').$this->publicReference.' is '.$statusLabel.'.',
            'reason' => $this->reason,
        ];
    }
}
