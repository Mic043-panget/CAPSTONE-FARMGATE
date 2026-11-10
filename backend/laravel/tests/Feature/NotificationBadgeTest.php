<?php

namespace Tests\Feature;

use App\Enums\OrderStatus;
use App\Enums\Role;
use App\Models\ChatConversation;
use App\Models\AuditLog;
use App\Models\User;
use App\Notifications\DirectChatMessageNotification;
use App\Notifications\OrderStatusChangedNotification;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
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
            ->assertJsonPath('unread_count', 101)
            ->assertJsonPath('marked_count', 0)
            ->assertJsonPath('marked_ids', [])
            ->assertJsonPath('bulk_read_count', 0)
            ->assertJsonPath('critical_unread_count', 101)
            ->assertJsonPath('unread_chat_count', 1);

        $this->assertSame(102, $buyer->unreadNotifications()->count());
        $this->getJson("/api/chat/conversations/{$conversation->id}")->assertOk();
        $this->getJson('/api/notifications')->assertOk()->assertJsonPath('unread_chat_count', 0);
        $this->assertSame(1, $otherUser->unreadNotifications()->count());
    }

    public function test_bulk_read_marks_informational_notifications_but_preserves_critical_alerts(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $buyer->notify($this->notification(31));
        $criticalNotification = $buyer->notifications()->firstOrFail();
        $informational = $buyer->notifications()->create([
            'id' => (string) Str::uuid(),
            'type' => 'App\\Notifications\\PromotionChangedNotification',
            'data' => ['type' => 'promotion_changed', 'message' => 'Promotion dates changed.'],
            'read_at' => null,
        ]);
        $attention = $buyer->notifications()->create([
            'id' => (string) Str::uuid(),
            'type' => 'App\\Notifications\\ChatAttentionNotification',
            'data' => ['type' => 'chat_attention', 'attention_required' => true],
            'read_at' => null,
        ]);
        $alreadyRead = $buyer->notifications()->create([
            'id' => (string) Str::uuid(),
            'type' => 'App\\Notifications\\PromotionChangedNotification',
            'data' => ['type' => 'promotion_changed', 'message' => 'An older read promotion notice.'],
            'read_at' => now(),
        ]);

        $this->actingAs($buyer)->getJson('/api/notifications')
            ->assertOk()
            ->assertJsonPath('unread_count', 3)
            ->assertJsonPath('bulk_read_count', 1)
            ->assertJsonPath('critical_unread_count', 2);

        $this->postJson('/api/notifications/read')
            ->assertOk()
            ->assertJsonPath('marked_count', 1)
            ->assertJsonPath('marked_ids.0', $informational->id)
            ->assertJsonPath('unread_count', 2)
            ->assertJsonPath('bulk_read_count', 0)
            ->assertJsonPath('critical_unread_count', 2);

        $this->assertNotNull($informational->fresh()->read_at);
        $this->assertNotNull($alreadyRead->fresh()->read_at);
        $this->assertNull($attention->fresh()->read_at);
        $this->assertNull($criticalNotification->fresh()->read_at);

        $this->postJson("/api/notifications/{$criticalNotification->id}/read")
            ->assertOk()
            ->assertJsonPath('unread_count', 1)
            ->assertJsonPath('critical_unread_count', 1)
            ->assertJsonPath('bulk_read_count', 0);
        $this->assertNotNull($criticalNotification->fresh()->read_at);
    }

    public function test_individual_notification_read_is_scoped_to_its_owner(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $otherUser = User::factory()->create(['role' => Role::SELLER]);
        $buyer->notify($this->notification(12));
        $otherUser->notify($this->notification(13));
        $owned = $buyer->notifications()->firstOrFail();
        $foreign = $otherUser->notifications()->firstOrFail();

        $this->actingAs($buyer)->postJson("/api/notifications/{$foreign->id}/read")->assertNotFound();
        $this->postJson("/api/notifications/{$owned->id}/read", [
            'target_available' => false,
            'target_type' => 'order',
            'target_id' => '214',
        ])
            ->assertOk()
            ->assertJsonPath('notification.id', $owned->id)
            ->assertJsonPath('unread_count', 0)
            ->assertJsonPath('critical_unread_count', 0);

        $this->assertNotNull($owned->fresh()->read_at);
        $this->assertNull($foreign->fresh()->read_at);
        $this->assertDatabaseHas('audit_logs', [
            'user_id' => $buyer->id,
            'action' => 'notification.target.unavailable',
            'entity_type' => 'order',
            'entity_id' => '214',
        ]);
    }

    private function notification(int $orderId): OrderStatusChangedNotification
    {
        return new OrderStatusChangedNotification($orderId, OrderStatus::CONFIRMED, "FG-{$orderId}");
    }
}
