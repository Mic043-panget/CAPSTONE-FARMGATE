<?php

namespace App\Notifications;

use App\Contracts\FarmgateNotification;
use Illuminate\Notifications\Notification;

class SellerReviewReportNotification extends Notification implements FarmgateNotification
{
    public function __construct(
        public string $reviewReference,
        public string $status,
        public ?string $reviewStatus = null,
    ) {}

    public function via(object $notifiable): array
    {
        return ['database'];
    }

    public function toArray(object $notifiable): array
    {
        $message = $this->status === 'received'
            ? 'Your report for review '.$this->reviewReference.' was received and sent to Farmgate moderators.'
            : 'A moderator reviewed your report for '.$this->reviewReference.'. The review is '.strtolower((string) $this->reviewStatus).'.';

        return [
            'type' => 'seller_review_report_status',
            'review_reference' => $this->reviewReference,
            'status' => $this->status,
            'review_status' => $this->reviewStatus,
            'message' => $message,
        ];
    }
}
