<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class OrderStatusChangedMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public string $recipientName,
        public string $orderReference,
        public string $status,
        public ?string $reason,
        public string $orderUrl,
        public string $actionLabel = 'View order',
    ) {}

    public function envelope(): Envelope
    {
        $statusLabel = str_replace('_', ' ', strtolower($this->status));

        return new Envelope(subject: 'Order '.$this->orderReference.' '.$statusLabel);
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.order-status-changed',
            with: [
                'recipientName' => $this->recipientName,
                'orderReference' => $this->orderReference,
                'status' => str_replace('_', ' ', strtolower($this->status)),
                'reason' => $this->reason,
                'orderUrl' => $this->orderUrl,
                'actionLabel' => $this->actionLabel,
            ],
        );
    }
}
