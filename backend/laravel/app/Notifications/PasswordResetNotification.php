<?php

namespace App\Notifications;

use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

class PasswordResetNotification extends Notification
{
    public function __construct(public readonly string $url) {}

    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject('Reset your FARMGATE password')
            ->view('emails.farmgate-notification', [
                'recipientName' => $notifiable->name,
                'title' => 'Reset your FARMGATE password',
                'notificationMessage' => 'We received a request to reset your password. This single-use link expires in 60 minutes. If you did not request it, you can safely ignore this email.',
                'notificationUrl' => $this->url,
                'actionLabel' => 'Reset password',
                'notificationTimestamp' => null,
            ]);
    }
}
