<?php

namespace App\Notifications;

use Illuminate\Notifications\Notification;

class DirectChatMessageNotification extends Notification
{
    public function __construct(
        public int $conversationId,
        public int $senderId,
        public string $senderName,
    ) {}

    public function via(object $notifiable): array
    {
        return ['database'];
    }

    public function toArray(object $notifiable): array
    {
        return [
            'type' => 'chat_message',
            'conversation_id' => $this->conversationId,
            'sender_id' => $this->senderId,
            'sender_name' => $this->senderName,
        ];
    }
}
