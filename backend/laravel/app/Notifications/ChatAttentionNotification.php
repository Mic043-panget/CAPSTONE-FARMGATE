<?php

namespace App\Notifications;

use App\Contracts\FarmgateNotification;
use Illuminate\Notifications\Notification;

class ChatAttentionNotification extends Notification implements FarmgateNotification
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
            // Keep the existing chat notification route/action working.
            'type' => 'chat_message',
            'conversation_id' => $this->conversationId,
            'sender_id' => $this->senderId,
            'sender_name' => $this->senderName,
            'attention_required' => true,
            'message' => 'A chat needs human attention.',
        ];
    }
}
