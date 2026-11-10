<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class FarmgateNotificationMail extends Mailable
{
    use Queueable, SerializesModels;

    /**
     * @param  array<string, mixed>  $data
     */
    public function __construct(
        public string $recipientName,
        public array $data,
        public string $notificationUrl,
        public string $actionLabel = 'View notification',
        public ?string $notificationTimestamp = null,
        public string $recipientRole = 'BUYER',
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'FARMGATE update: '.$this->title());
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.farmgate-notification',
            with: [
                'recipientName' => $this->recipientName,
                'title' => $this->title(),
                'notificationMessage' => $this->message(),
                'notificationUrl' => $this->notificationUrl,
                'actionLabel' => $this->actionLabel,
                'notificationTimestamp' => $this->notificationTimestamp,
            ],
        );
    }

    private function title(): string
    {
        $type = (string) ($this->data['type'] ?? 'update');

        return match ($type) {
            'order_status_changed' => 'Order '.($this->data['order_reference'] ?? '').' '.str_replace('_', ' ', strtolower((string) ($this->data['status'] ?? 'updated'))),
            'order_case_updated' => 'Complaint or refund case updated',
            'order_delivery_status_changed', 'delivery_proof_recorded', 'order_rider_assigned', 'rider_assignment_waiting' => 'Delivery update',
            'listing_moderation_updated', 'listing_moderation_needs_review' => 'Listing review result',
            'review_moderation_updated' => 'Review update',
            'rider_application_status' => 'Rider application update',
            'seller_payout_recorded' => 'Seller payout record updated',
            'calendar_event' => 'Farmgate event update',
            'chat_message' => 'A conversation needs your attention',
            default => 'Important account update',
        };
    }

    private function message(): string
    {
        return match ((string) ($this->data['type'] ?? '')) {
            'order_status_changed' => $this->recipientRole === 'BUYER'
                ? 'The status of your order is now '.str_replace('_', ' ', strtolower((string) ($this->data['status'] ?? 'updated'))).'.'
                : 'An order you are involved with is now '.str_replace('_', ' ', strtolower((string) ($this->data['status'] ?? 'updated'))).'. Sign in to review the update.',
            'order_case_updated' => 'There is a new update to an order case. Sign in to review it.',
            'order_delivery_status_changed', 'delivery_proof_recorded', 'order_rider_assigned', 'rider_assignment_waiting' => 'There is a new delivery update. Sign in to review it.',
            'chat_message' => 'There is a new conversation update. Sign in to read it.',
            'listing_moderation_updated' => 'The review status of your listing has changed.',
            'listing_moderation_needs_review' => 'A listing needs your attention. Sign in to review it.',
            'review_moderation_updated' => 'There is a new review update in your account.',
            'rider_application_status' => 'There is a new rider application or vehicle update. Sign in to review it.',
            'seller_payout_recorded' => 'A seller payout record was updated. Sign in to review its status.',
            'calendar_event' => 'There is a new event update in your account.',
            'promotion_changed' => 'There is a new promotion update in your account.',
            default => 'There is a new update in your FARMGATE account.',
        };
    }
}
