<?php

namespace App\Services\Chat;

use App\Enums\Role;
use App\Models\ChatConversation;
use App\Models\ChatMessage;
use App\Models\Interest;
use App\Models\Order;
use App\Models\User;
use App\Notifications\DirectChatMessageNotification;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class DirectChatService
{
    /**
     * Search eligible recipients without returning contact or profile data.
     *
     * @return Collection<int, User>
     */
    public function searchRecipients(User $actor, string $search): Collection
    {
        $escaped = addcslashes($search, '\\%_');

        return User::query()
            ->where('users.id', '!=', $actor->id)
            ->where('name', 'like', '%'.$escaped.'%')
            ->where(function (Builder $query) use ($actor): void {
                if ($actor->role === Role::BUYER) {
                    $query->where('role', '!=', Role::SELLER->value)
                        ->orWhere(function (Builder $seller) use ($actor): void {
                            $seller->where('role', Role::SELLER->value);
                            $this->whereBuyerSellerRelationship($seller, $actor->id, 'users.id');
                        });
                } elseif ($actor->role === Role::SELLER) {
                    $query->where('role', '!=', Role::BUYER->value)
                        ->orWhere(function (Builder $buyer) use ($actor): void {
                            $buyer->where('role', Role::BUYER->value);
                            $this->whereBuyerSellerRelationship($buyer, 'users.id', $actor->id);
                        });
                }
            })
            ->orderBy('name')
            ->limit(15)
            ->get(['id', 'name', 'role', 'account_preferences'])
            ->filter(fn (User $recipient): bool => $recipient->accountPreferenceEnabled('allow_direct_messages'))
            ->values();
    }

    public function start(User $actor, int $recipientId): ChatConversation
    {
        $recipient = User::query()->findOrFail($recipientId);
        abort_if($actor->is($recipient), 422, 'Choose another account to start a direct conversation.');
        abort_unless($this->canMessage($actor, $recipient), 403, 'You can only message this buyer or seller when you have an order or listing interest together.');

        [$firstId, $secondId] = [min($actor->id, $recipient->id), max($actor->id, $recipient->id)];
        $key = $firstId.':'.$secondId;

        // The unique direct_key is the final concurrency guard. firstOrCreate
        // safely resolves concurrent starts to the same participant pair.
        return DB::transaction(fn (): ChatConversation => ChatConversation::query()->firstOrCreate(
            ['direct_key' => $key],
            [
                'kind' => 'direct',
                'user_id' => $firstId,
                'recipient_id' => $secondId,
            ],
        ));
    }

    /**
     * Verify membership and relationship inside the same transaction that persists the message.
     *
     * @return array{conversation: ChatConversation, message: ChatMessage, created: bool}
     */
    public function send(User $actor, int $conversationId, string $content, string $clientMessageId): array
    {
        return DB::transaction(function () use ($actor, $conversationId, $content, $clientMessageId): array {
            $conversation = ChatConversation::query()
                ->where('kind', 'direct')
                ->whereKey($conversationId)
                ->where(function (Builder $query) use ($actor): void {
                    $query->where('user_id', $actor->id)->orWhere('recipient_id', $actor->id);
                })
                ->lockForUpdate()
                ->firstOrFail();

            $otherId = (int) ($conversation->user_id === $actor->id ? $conversation->recipient_id : $conversation->user_id);
            $other = User::query()->findOrFail($otherId);
            abort_unless($this->canMessage($actor, $other), 403, 'You can no longer message this buyer or seller without an order or listing interest together.');

            $duplicate = $conversation->messages()
                ->where('sender_id', $actor->id)
                ->where('client_message_id', $clientMessageId)
                ->first();
            if ($duplicate !== null) {
                abort_unless($duplicate->content === trim($content), 409, 'This message ID was already used for different content.');

                return ['conversation' => $conversation, 'message' => $duplicate, 'created' => false];
            }

            $message = $conversation->messages()->create([
                'sender_id' => $actor->id,
                'client_message_id' => $clientMessageId,
                'role' => 'participant',
                'content' => trim($content),
            ]);
            $conversation->touch();
            if ($other->accountPreferenceEnabled('chat_notifications')) {
                DB::afterCommit(fn () => $other->notify(new DirectChatMessageNotification(
                    $conversation->id,
                    $actor->id,
                    $actor->name,
                )));
            }

            return ['conversation' => $conversation, 'message' => $message, 'created' => true];
        });
    }

    public function canMessage(User $first, User $second): bool
    {
        if (! $second->accountPreferenceEnabled('allow_direct_messages')) {
            return false;
        }

        if (($first->role === Role::BUYER && $second->role === Role::SELLER)
            || ($first->role === Role::SELLER && $second->role === Role::BUYER)) {
            $buyerId = $first->role === Role::BUYER ? $first->id : $second->id;
            $sellerId = $first->role === Role::SELLER ? $first->id : $second->id;

            return Order::query()
                ->where('buyer_id', $buyerId)
                ->where('seller_id', $sellerId)
                ->exists()
                || Interest::query()
                    ->where('buyer_id', $buyerId)
                    ->whereHas('listing', fn (Builder $listing): Builder => $listing->where('seller_id', $sellerId))
                    ->exists();
        }

        return true;
    }

    private function whereBuyerSellerRelationship(Builder $query, int|string $buyerId, int|string $sellerId): void
    {
        $query->where(function (Builder $relationship) use ($buyerId, $sellerId): void {
            $relationship->whereExists(function ($orders) use ($buyerId, $sellerId): void {
                $orders->selectRaw('1')
                    ->from('orders')
                    ->whereNull('orders.deleted_at');
                $this->whereValueOrColumn($orders, 'orders.buyer_id', $buyerId);
                $this->whereValueOrColumn($orders, 'orders.seller_id', $sellerId);
            })->orWhereExists(function ($interests) use ($buyerId, $sellerId): void {
                $interests->selectRaw('1')
                    ->from('interests')
                    ->join('livestock_listings', 'livestock_listings.id', '=', 'interests.livestock_listing_id')
                    ->whereNull('interests.deleted_at')
                    ->whereNull('livestock_listings.deleted_at');
                $this->whereValueOrColumn($interests, 'interests.buyer_id', $buyerId);
                $this->whereValueOrColumn($interests, 'livestock_listings.seller_id', $sellerId);
            });
        });
    }

    private function whereValueOrColumn(\Illuminate\Database\Query\Builder $query, string $column, int|string $value): void
    {
        if (is_string($value) && str_contains($value, '.')) {
            $query->whereColumn($column, $value);

            return;
        }

        $query->where($column, $value);
    }
}
