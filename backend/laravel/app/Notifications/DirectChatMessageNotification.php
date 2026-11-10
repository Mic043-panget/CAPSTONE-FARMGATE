<?php

namespace App\Notifications;

use App\Contracts\FarmgateNotification;
use Illuminate\Notifications\Notification;

class DirectChatMessageNotification extends Notification implements FarmgateNotification
{
    public function __construct(
        public int $conversationId,
        public int $senderId,
        public string $senderName,
        public ?int $messageId = null,
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
            ...($this->messageId === null ? [] : ['message_id' => $this->messageId]),
        ];
    }
}
