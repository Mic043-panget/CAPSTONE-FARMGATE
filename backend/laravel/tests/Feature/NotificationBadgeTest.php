<?php

namespace Tests\Feature;

use App\Enums\OrderStatus;
use App\Enums\Role;
use App\Models\ChatConversation;
use App\Models\User;
use App\Notifications\DirectChatMessageNotification;
use App\Notifications\OrderStatusChangedNotification;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class NotificationBadgeTest extends TestCase
{
    use RefreshDatabase;

    public function test_unread_count_and_mark_as_read_are_scoped_to_the_signed_in_user(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $otherUser = User::factory()->create(['role' => Role::SELLER]);

        $buyer->notify($this->notification(1));
        $this->actingAs($buyer)->getJson('/api/notifications')
            ->assertOk()
            ->assertJsonPath('unread_count', 1);

        $buyer->notify($this->notification(2));
        $buyer->notify($this->notification(3));
        $this->getJson('/api/notifications')
            ->assertOk()
            ->assertJsonPath('unread_count', 3);

        for ($index = 4; $index <= 101; $index++) {
            $buyer->notify($this->notification($index));
        }
        $otherUser->notify($this->notification(102));
        $conversation = ChatConversation::query()->create([
            'user_id' => $buyer->id,
            'kind' => 'direct',
            'recipient_id' => $otherUser->id,
            'direct_key' => "direct-{$buyer->id}-{$otherUser->id}",
        ]);
        $buyer->notify(new DirectChatMessageNotification($conversation->id, $otherUser->id, $otherUser->name));

        $this->getJson('/api/notifications')
            ->assertOk()
            ->assertJsonPath('unread_count', 101)
            ->assertJsonPath('unread_chat_count', 1)
            ->assertJsonCount(100, 'notifications');

        $this->postJson('/api/notifications/read')
            ->assertOk()
            ->assertJsonPath('unread_count', 0)
            ->assertJsonPath('unread_chat_count', 1);

        $this->assertSame(1, $buyer->unreadNotifications()->count());
        $this->getJson("/api/chat/conversations/{$conversation->id}")->assertOk();
        $this->getJson('/api/notifications')->assertOk()->assertJsonPath('unread_chat_count', 0);
        $this->assertSame(1, $otherUser->unreadNotifications()->count());
    }

    private function notification(int $orderId): OrderStatusChangedNotification
    {
        return new OrderStatusChangedNotification($orderId, OrderStatus::CONFIRMED, "FG-{$orderId}");
    }
}
