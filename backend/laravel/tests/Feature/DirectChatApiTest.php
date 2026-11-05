<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Models\AuditLog;
use App\Models\Category;
use App\Models\ChatConversation;
use App\Models\Interest;
use App\Models\LivestockListing;
use App\Models\Order;
use App\Models\User;
use App\Notifications\DirectChatMessageNotification;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DirectChatApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_direct_chat_search_requires_authentication_and_returns_only_eligible_minimal_recipients(): void
    {
        $this->getJson('/api/chat/recipients?search=Fa')->assertUnauthorized();

        $buyer = User::factory()->create(['role' => Role::BUYER, 'name' => 'Buyer One']);
        $connectedSeller = User::factory()->create([
            'role' => Role::SELLER,
            'name' => 'Farm Connected',
            'email' => 'private-connected@example.test',
        ]);
        $unconnectedSeller = User::factory()->create(['role' => Role::SELLER, 'name' => 'Farm Outside']);
        $admin = User::factory()->create(['role' => Role::ADMIN, 'name' => 'Farm Operations']);
        Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $connectedSeller->id,
            'status' => 'PENDING_CONFIRMATION',
            'total_amount' => 250,
        ]);

        $this->actingAs($buyer)->getJson('/api/chat/recipients?search=Farm')
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonFragment(['id' => $connectedSeller->id, 'name' => 'Farm Connected', 'role' => 'SELLER'])
            ->assertJsonFragment(['id' => $admin->id, 'name' => 'Farm Operations', 'role' => 'ADMIN'])
            ->assertJsonMissing(['id' => $unconnectedSeller->id])
            ->assertJsonMissing(['email' => 'private-connected@example.test']);

        $this->actingAs($buyer)->getJson('/api/chat/recipients?search=%25%25')->assertUnprocessable();
        $this->actingAs($buyer)->postJson('/api/chat/direct-conversations', ['recipient_id' => $unconnectedSeller->id])
            ->assertForbidden();
    }

    public function test_users_can_prevent_direct_messages_and_disable_chat_notifications(): void
    {
        $sender = User::factory()->create(['role' => Role::ADMIN]);
        $recipient = User::factory()->create(['role' => Role::SELLER]);
        $recipient->forceFill(['account_preferences' => ['allow_direct_messages' => false]])->save();

        $this->actingAs($sender)->getJson('/api/chat/recipients?search='.$recipient->name)
            ->assertOk()
            ->assertJsonMissing(['id' => $recipient->id]);
        $this->actingAs($sender)->postJson('/api/chat/direct-conversations', [
            'recipient_id' => $recipient->id,
        ])->assertForbidden();

        $recipient->forceFill(['account_preferences' => [
            'allow_direct_messages' => true,
            'chat_notifications' => false,
        ]])->save();
        $conversationId = $this->actingAs($sender)->postJson('/api/chat/direct-conversations', [
            'recipient_id' => $recipient->id,
        ])->assertOk()->json('conversation.id');
        $this->actingAs($sender)->postJson("/api/chat/conversations/{$conversationId}/messages", [
            'message' => 'Notifications are disabled.',
            'client_message_id' => '7d3a10e4-0eec-4fa2-ae15-6d6fa7aabfaa',
        ])->assertCreated();

        $this->assertDatabaseMissing('notifications', [
            'notifiable_id' => $recipient->id,
            'type' => DirectChatMessageNotification::class,
        ]);
    }

    public function test_direct_pairs_are_idempotent_and_messages_are_shared_only_with_participants(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN, 'name' => 'Operations']);
        $seller = User::factory()->create(['role' => Role::SELLER, 'name' => 'Farm Seller']);
        $outsider = User::factory()->create(['role' => Role::RIDER]);
        $aiConversation = ChatConversation::query()->create([
            'user_id' => $admin->id,
            'title' => 'Saved AI thread',
        ]);

        $firstStart = $this->actingAs($admin)->postJson('/api/chat/direct-conversations', [
            'recipient_id' => $seller->id,
        ])->assertOk()->json('conversation.id');
        $secondStart = $this->actingAs($seller)->postJson('/api/chat/direct-conversations', [
            'recipient_id' => $admin->id,
        ])->assertOk()->json('conversation.id');
        $this->assertSame($firstStart, $secondStart);

        $this->actingAs($admin)->postJson("/api/chat/conversations/{$firstStart}/messages", [
            'message' => 'Pickup details are ready.',
            'client_message_id' => 'f53b2049-321d-4fb1-a878-6b2451e6420a',
            'sender_id' => $outsider->id,
            'role' => 'assistant',
        ])->assertCreated()
            ->assertJsonPath('message.sender_id', $admin->id)
            ->assertJsonPath('message.role', 'participant')
            ->assertJsonPath('message.is_mine', true);
        $this->assertDatabaseHas('notifications', [
            'notifiable_id' => $seller->id,
            'type' => DirectChatMessageNotification::class,
        ]);
        $audit = AuditLog::query()
            ->where('action', "POST api/chat/conversations/{$firstStart}/messages")
            ->latest('id')
            ->firstOrFail();
        $this->assertStringNotContainsString(
            'Pickup details are ready.',
            json_encode($audit->metadata, JSON_THROW_ON_ERROR),
        );
        $this->actingAs($admin)->postJson("/api/chat/conversations/{$firstStart}/messages", [
            'message' => 'Pickup details are ready.',
            'client_message_id' => 'f53b2049-321d-4fb1-a878-6b2451e6420a',
        ])->assertOk();
        $this->actingAs($admin)->postJson("/api/chat/conversations/{$firstStart}/messages", [
            'message' => 'Different text with a reused message ID.',
            'client_message_id' => 'f53b2049-321d-4fb1-a878-6b2451e6420a',
        ])->assertStatus(409);
        $this->assertDatabaseCount('chat_messages', 1);

        $this->actingAs($seller)->getJson("/api/chat/conversations/{$firstStart}")
            ->assertOk()
            ->assertJsonPath('conversation.kind', 'direct')
            ->assertJsonPath('conversation.peer.id', $admin->id)
            ->assertJsonPath('messages.0.content', 'Pickup details are ready.')
            ->assertJsonPath('messages.0.is_mine', false);

        $this->actingAs($admin)->getJson('/api/chat/conversations')
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonFragment(['id' => $aiConversation->id, 'kind' => 'ai'])
            ->assertJsonFragment(['id' => $firstStart, 'kind' => 'direct']);

        $this->actingAs($outsider)->getJson("/api/chat/conversations/{$firstStart}")->assertNotFound();
        $this->actingAs($outsider)->postJson("/api/chat/conversations/{$firstStart}/messages", [
            'message' => 'I am not a participant.',
            'client_message_id' => '7bde8e5b-4233-43c4-97f0-16377aa77218',
        ])->assertNotFound();
        $this->actingAs($admin)->postJson('/api/chat/messages', [
            'conversation_id' => $firstStart,
            'message' => 'A direct thread is not an AI thread.',
        ])->assertNotFound();
    }

    public function test_buyer_seller_interest_allows_chat_but_must_still_exist_for_every_send(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $category = Category::query()->create([
            'name' => 'Livestock test',
            'slug' => 'livestock-test',
        ]);
        $listing = LivestockListing::query()->create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Test listing',
            'pricing_type' => 'PER_HEAD',
            'price_per_head' => 100,
        ]);
        $interest = Interest::query()->create([
            'buyer_id' => $buyer->id,
            'livestock_listing_id' => $listing->id,
            'status' => 'INTERESTED',
        ]);

        $conversationId = $this->actingAs($buyer)->postJson('/api/chat/direct-conversations', [
            'recipient_id' => $seller->id,
        ])->assertOk()->json('conversation.id');

        $this->actingAs($buyer)->postJson("/api/chat/conversations/{$conversationId}/messages", [
            'message' => 'I am interested in this listing.',
            'client_message_id' => 'a8dd3ac3-29c5-44f7-8511-eed96a181fe1',
        ])->assertCreated();

        $interest->delete();
        $this->actingAs($seller)->postJson("/api/chat/conversations/{$conversationId}/messages", [
            'message' => 'Can you send another message?',
            'client_message_id' => 'bbf648a4-ecaa-4b5c-8923-339bdc0464e1',
        ])->assertForbidden();

        $this->assertDatabaseCount('chat_messages', 1);
    }
}
