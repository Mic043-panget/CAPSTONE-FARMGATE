<?php

namespace App\Services\Chat;

use App\Enums\Role;
use App\Models\ChatConversation;
use App\Models\User;
use App\Notifications\ChatAttentionNotification;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class ChatAttentionService
{
    /**
     * Mark an uncertain or sensitive chat for a human and notify the responsible
     * seller/admin once. Message content is deliberately not included.
     */
    public function flag(ChatConversation $conversation, User $sender, bool $notifyAgain = false): void
    {
        if ($conversation->attention_notified_at !== null && ! $notifyAgain) {
            return;
        }

        $recipients = $this->recipients($conversation, $sender);
        $conversation->needs_human_attention = true;
        $conversation->attention_notified_at = now();
        $conversation->save();

        DB::afterCommit(function () use ($recipients, $conversation, $sender): void {
            foreach ($recipients as $recipient) {
                $recipient->notify(new ChatAttentionNotification($conversation->id, $sender->id, $sender->name));
            }
        });
    }

    public function requiresHuman(string $text): bool
    {
        return preg_match(
            '/\b(refund|chargeback|complaint|dispute|scam|fraud|injur(?:y|ed)|sick|disease|abuse|threat|harass(?:ment|ed)?|unsafe|emergency|lawyer|legal action|police|not received|wrong order|payment problem|status update|where is my order|uncertain(?:ty)?|not sure|can(?:not|\'t) (?:confirm|verify)|unable to (?:confirm|verify|determine)|not enough (?:information|details)|price negotiation|negotiat(?:e|ion)|make (?:a )?deal|make an offer|lower price|discount|talk to (?:the )?seller|speak to (?:the )?seller|contact (?:the )?seller|seller please|recommend|should i (?:buy|choose|select)|would you (?:buy|choose|select)|is this (?:a good choice|right for me)|hindi sigurado|di sigurado|hindi ko alam|nasaktan|reklamo|panloloko)\b/iu',
            $text,
        ) === 1;
    }

    public function productChatNeedsSeller(string $text): bool
    {
        return $this->requiresHuman($text);
    }

    /**
     * @return Collection<int, User>
     */
    private function recipients(ChatConversation $conversation, User $sender): Collection
    {
        if ($conversation->kind === 'direct') {
            $peerId = (int) ($conversation->user_id === $sender->id ? $conversation->recipient_id : $conversation->user_id);
            $peer = User::query()->find($peerId);
            if ($peer?->role === Role::ADMIN) {
                return collect([$peer]);
            }
            if ($peer?->role === Role::SELLER && $sender->role === Role::BUYER) {
                return collect([$peer]);
            }
        }

        return User::query()->where('role', Role::ADMIN->value)->get();
    }
}
