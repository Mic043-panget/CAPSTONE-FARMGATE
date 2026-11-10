<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Models\AuditLog;
use App\Models\Category;
use App\Models\ChatConversation;
use App\Models\Interest;
use App\Models\LivestockListing;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\ProductImage;
use App\Models\User;
use App\Notifications\ChatAttentionNotification;
use App\Notifications\DirectChatMessageNotification;
use App\Services\Chat\ChatProvider;
use App\Services\Chat\ChatProviderException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery;
use Tests\TestCase;

class DirectChatApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_direct_chat_only_previews_exact_order_references_for_orders_accessible_to_both_participants(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $otherBuyer = User::factory()->create(['role' => Role::BUYER]);
        $category = Category::query()->create(['name' => 'Sheep', 'slug' => 'sheep']);
        $firstListing = LivestockListing::query()->create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Dorset ewe',
            'quantity' => 4,
            'pricing_type' => 'PER_HEAD',
            'price_per_head' => 1200,
            'status' => 'ACTIVE',
        ]);
        $secondListing = LivestockListing::query()->create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Suffolk ram',
            'quantity' => 2,
            'pricing_type' => 'PER_HEAD',
            'price_per_head' => 1400,
            'status' => 'ACTIVE',
        ]);
        $firstListing->images()->create([
            'url' => 'https://farmgate.test/dorset.jpg',
            'alt_text' => 'Dorset ewe',
            'sort_order' => 0,
        ]);
        $order = Order::query()->create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => 'CONFIRMED',
            'total_amount' => 2600,
            'shipping_address' => ['street_address' => 'Private address'],
            'payment_reference' => 'FG-PAY-PRIVATE',
        ]);
        OrderItem::query()->create([
            'order_id' => $order->id,
            'listing_id' => $firstListing->id,
            'quantity' => 1,
            'unit_price' => 1200,
            'total_amount' => 1200,
            'pricing_type' => 'PER_HEAD',
        ]);
        OrderItem::query()->create([
            'order_id' => $order->id,
            'listing_id' => $secondListing->id,
            'quantity' => 1,
            'unit_price' => 1400,
            'total_amount' => 1400,
            'pricing_type' => 'PER_HEAD',
        ]);
        $otherOrder = Order::query()->create([
            'buyer_id' => $otherBuyer->id,
            'seller_id' => $seller->id,
            'status' => 'CONFIRMED',
            'total_amount' => 500,
        ]);
        $conversationId = $this->actingAs($buyer)->postJson('/api/chat/direct-conversations', [
            'recipient_id' => $seller->id,
        ])->assertOk()->json('conversation.id');

        $message = "Discussing {$order->order_reference}; not {$order->order_reference}-EXTRA and not {$otherOrder->order_reference}.";
        $this->actingAs($seller)->postJson("/api/chat/conversations/{$conversationId}/messages", [
            'message' => $message,
            'client_message_id' => '8339e28e-b45b-45e8-824d-f1114e4cc0ba',
        ])->assertCreated()
            ->assertJsonPath('message.content', $message)
            ->assertJsonCount(1, 'message.order_previews')
            ->assertJsonPath('message.order_previews.0.order_reference', $order->order_reference)
            ->assertJsonPath('message.order_previews.0.item_count', 2)
            ->assertJsonPath('message.order_previews.0.items.0.name', 'Dorset ewe')
            ->assertJsonPath('message.order_previews.0.items.0.image_url', 'https://farmgate.test/dorset.jpg')
            ->assertJsonPath('message.order_previews.0.items.1.name', 'Suffolk ram')
            ->assertJsonMissingPath('message.order_previews.0.payment_reference')
            ->assertJsonMissingPath('message.order_previews.0.shipping_address');

        $this->actingAs($buyer)->getJson("/api/chat/conversations/{$conversationId}")
            ->assertOk()
            ->assertJsonPath('messages.0.order_previews.0.order_id', $order->id);
        $this->actingAs($otherBuyer)->getJson("/api/chat/conversations/{$conversationId}")->assertNotFound();

        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $supportConversationId = $this->actingAs($buyer)->postJson('/api/chat/direct-conversations', [
            'recipient_id' => $admin->id,
        ])->assertOk()->json('conversation.id');
        $this->actingAs($buyer)->postJson("/api/chat/conversations/{$supportConversationId}/messages", [
            'message' => "Please review order {$order->order_reference}.",
            'client_message_id' => 'ee84e974-cc40-4597-9792-eec660cfc808',
        ])->assertCreated()
            ->assertJsonPath('message.order_previews.0.order_reference', $order->order_reference);
        $this->actingAs($admin)->getJson("/api/chat/conversations/{$supportConversationId}")
            ->assertOk()
            ->assertJsonPath('messages.0.order_previews.0.order_id', $order->id);
    }

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

    public function test_users_can_prevent_direct_messages_and_disable_optional_chat_email_notifications(): void
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

        $this->assertDatabaseHas('notifications', [
            'notifiable_id' => $recipient->id,
            'type' => DirectChatMessageNotification::class,
        ]);
        $this->assertDatabaseHas('notification_deliveries', [
            'notifiable_id' => $recipient->id,
            'channel' => 'email',
            'status' => 'skipped',
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

    public function test_buyer_can_start_a_listing_chat_without_interest_and_each_product_gets_its_own_thread(): void
    {
        app()->instance(ChatProvider::class, Mockery::mock(ChatProvider::class)
            ->shouldReceive('respond')
            ->once()
            ->andReturn('The listing states the current price is PHP 100 per head.')
            ->getMock());
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
            'status' => 'ACTIVE',
        ]);
        $interest = Interest::query()->create([
            'buyer_id' => $buyer->id,
            'livestock_listing_id' => $listing->id,
            'status' => 'INTERESTED',
        ]);
        ProductImage::query()->forceCreate([
            'listing_id' => $listing->id,
            'url' => 'https://farmgate.test/listings/calf.jpg',
            'alt_text' => 'Calf',
            'sort_order' => 0,
        ]);
        $unrelatedListing = LivestockListing::query()->create([
            'seller_id' => $seller->id,
            'category_id' => $listing->category_id,
            'name' => 'Unrelated listing',
            'pricing_type' => 'PER_HEAD',
            'price_per_head' => 125,
            'status' => 'ACTIVE',
        ]);
        $unrelatedConversationId = $this->actingAs($buyer)->postJson('/api/chat/direct-conversations', [
            'recipient_id' => $seller->id,
            'listing_id' => $unrelatedListing->id,
        ])->assertOk()
            ->assertJsonPath('conversation.listing.name', 'Unrelated listing')
            ->json('conversation.id');

        $conversationId = $this->actingAs($buyer)->postJson('/api/chat/direct-conversations', [
            'recipient_id' => $seller->id,
            'listing_id' => $listing->id,
        ])->assertOk()
            ->assertJsonPath('conversation.listing.name', 'Test listing')
            ->assertJsonPath('conversation.listing.image_url', 'https://farmgate.test/listings/calf.jpg')
            ->assertJsonPath('conversation.listing.href', '#listing/'.$listing->id)
            ->json('conversation.id');
        $this->assertNotSame($unrelatedConversationId, $conversationId);

        $this->actingAs($buyer)->postJson("/api/chat/conversations/{$conversationId}/messages", [
            'message' => 'I am interested in this listing.',
            'client_message_id' => 'a8dd3ac3-29c5-44f7-8511-eed96a181fe1',
        ])->assertCreated()
            ->assertJsonPath('ai_status', 'answered')
            ->assertJsonPath('ai_message.role', 'assistant')
            ->assertJsonPath('ai_message.content', 'The listing states the current price is PHP 100 per head.');
        $this->actingAs($buyer)->postJson("/api/chat/conversations/{$conversationId}/messages", [
            'message' => 'I need a refund.',
            'client_message_id' => '0bdf2385-1468-4122-9afe-c35ce35906bb',
        ])->assertCreated()
            ->assertJsonPath('ai_status', 'handed_off')
            ->assertJsonPath('ai_message.content', 'The seller has been notified and will reply when available.')
            ->assertJsonPath('conversation.needs_human_attention', true);
        $this->assertDatabaseHas('notifications', [
            'notifiable_id' => $seller->id,
            'type' => ChatAttentionNotification::class,
        ]);

        $interest->delete();
        $this->actingAs($seller)->postJson("/api/chat/conversations/{$conversationId}/messages", [
            'message' => 'Can you send another message?',
            'client_message_id' => 'bbf648a4-ecaa-4b5c-8923-339bdc0464e1',
        ])->assertCreated();

        $this->assertDatabaseCount('chat_messages', 5);
    }

    public function test_order_chat_ai_answers_from_verified_order_status_and_hands_policy_questions_to_the_seller(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => 'READY_FOR_PICKUP',
            'shipping_address' => ['address' => 'Private buyer address'],
        ]);
        $provider = Mockery::mock(ChatProvider::class);
        $provider->shouldReceive('respond')
            ->once()
            ->withArgs(function (string $instruction, array $history) use ($order): bool {
                $this->assertStringContainsString('Verified order facts (JSON)', $instruction);
                $this->assertStringContainsString('"order_reference":"'.$order->order_reference.'"', $instruction);
                $this->assertStringContainsString('"order_status":"READY_FOR_PICKUP"', $instruction);
                $this->assertStringNotContainsString('shipping_address', $instruction);
                $this->assertSame('Is my order being processed?', $history[0]['content']);

                return true;
            })
            ->andReturn("Farmgate AI: Order {$order->order_reference} is currently marked READY_FOR_PICKUP in Farmgate.");
        app()->instance(ChatProvider::class, $provider);

        $conversationId = $this->actingAs($buyer)->postJson('/api/chat/direct-conversations', [
            'recipient_id' => $seller->id,
        ])->assertOk()->json('conversation.id');

        $this->actingAs($buyer)->postJson("/api/chat/conversations/{$conversationId}/messages", [
            'message' => 'Is my order being processed?',
            'client_message_id' => '571ba516-a304-4fb6-97a3-4f2339387595',
            'order_id' => $order->id,
        ])->assertCreated()
            ->assertJsonPath('ai_status', 'answered')
            ->assertJsonPath('ai_message.role', 'assistant')
            ->assertJsonPath('ai_message.content', "Farmgate AI: Order {$order->order_reference} is currently marked READY_FOR_PICKUP in Farmgate.")
            ->assertJsonPath('ai_message.order_previews.0.order_reference', $order->order_reference);

        $this->actingAs($buyer)->postJson("/api/chat/conversations/{$conversationId}/messages", [
            'message' => 'Can I get a refund?',
            'client_message_id' => 'bb3ce475-4277-4e8c-a63a-104d935fcc3d',
            'order_id' => $order->id,
        ])->assertCreated()
            ->assertJsonPath('ai_status', 'handed_off')
            ->assertJsonPath('ai_message.content', 'The seller has been notified and will reply when available.');

        $this->assertDatabaseHas('notifications', [
            'notifiable_id' => $seller->id,
            'type' => ChatAttentionNotification::class,
        ]);
    }

    public function test_order_chat_cannot_use_another_sellers_order_as_ai_context(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $otherSeller = User::factory()->create(['role' => Role::SELLER]);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $otherSeller->id,
            'status' => 'CONFIRMED',
        ]);
        $this->actingAs($buyer)->postJson('/api/chat/direct-conversations', [
            'recipient_id' => $seller->id,
        ])->assertForbidden();

        Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => 'CONFIRMED',
        ]);
        $conversationId = $this->actingAs($buyer)->postJson('/api/chat/direct-conversations', [
            'recipient_id' => $seller->id,
        ])->assertOk()->json('conversation.id');

        $this->actingAs($buyer)->postJson("/api/chat/conversations/{$conversationId}/messages", [
            'message' => 'What is the status?',
            'client_message_id' => '0df6cdfa-e9ba-4bc3-9df9-4bf659d97565',
            'order_id' => $order->id,
        ])->assertNotFound();

        $this->assertDatabaseMissing('chat_messages', ['client_message_id' => '0df6cdfa-e9ba-4bc3-9df9-4bf659d97565']);
    }

    public function test_product_chat_ai_outage_keeps_buyer_message_and_saves_handoff_for_seller(): void
    {
        app()->instance(ChatProvider::class, Mockery::mock(ChatProvider::class)
            ->shouldReceive('respond')
            ->once()
            ->andThrow(new ChatProviderException('provider offline'))
            ->getMock());

        [$buyer, $seller, $listing] = $this->createActiveProductChatParticipants();
        $conversationId = $this->actingAs($buyer)->postJson('/api/chat/direct-conversations', [
            'recipient_id' => $seller->id,
            'listing_id' => $listing->id,
        ])->assertOk()->json('conversation.id');

        $this->actingAs($buyer)->postJson("/api/chat/conversations/{$conversationId}/messages", [
            'message' => 'How many animals are listed?',
            'client_message_id' => 'ceef11f8-824d-4c03-9acd-7317e5a56af2',
        ])->assertCreated()
            ->assertJsonPath('ai_status', 'unavailable')
            ->assertJsonPath('message.content', 'How many animals are listed?')
            ->assertJsonPath('ai_message.content', 'Farmgate AI is temporarily unavailable. The seller has been notified and will reply when available.')
            ->assertJsonPath('conversation.needs_human_attention', true);

        $this->assertDatabaseHas('chat_messages', ['content' => 'How many animals are listed?', 'sender_id' => $buyer->id]);
        $this->assertDatabaseHas('notifications', ['notifiable_id' => $seller->id, 'type' => ChatAttentionNotification::class]);
        $this->actingAs($seller)->getJson("/api/chat/conversations/{$conversationId}")
            ->assertOk()
            ->assertJsonPath('messages.1.content', 'Farmgate AI is temporarily unavailable. The seller has been notified and will reply when available.');
    }

    public function test_product_chat_hands_unlisted_questions_to_the_seller_and_ai_receives_only_listing_facts(): void
    {
        $provider = Mockery::mock(ChatProvider::class);
        $provider->shouldReceive('respond')
            ->once()
            ->withArgs(function (string $instruction, array $history): bool {
                $this->assertStringContainsString('Verified listing facts (JSON)', $instruction);
                $this->assertStringContainsString('"breed":"Angus"', $instruction);
                $this->assertStringContainsString('untrusted seller-supplied data', $instruction);
                $this->assertSame('What is the exact birth date?', $history[0]['content']);

                return true;
            })
            ->andReturn('[SELLER_NEEDED] The listing does not state the exact birth date.');
        app()->instance(ChatProvider::class, $provider);

        [$buyer, $seller, $listing] = $this->createActiveProductChatParticipants();
        $conversationId = $this->actingAs($buyer)->postJson('/api/chat/direct-conversations', [
            'recipient_id' => $seller->id,
            'listing_id' => $listing->id,
        ])->assertOk()->json('conversation.id');

        $this->actingAs($buyer)->postJson("/api/chat/conversations/{$conversationId}/messages", [
            'message' => 'What is the exact birth date?',
            'client_message_id' => '3f08d073-adef-4ecc-aa0f-15d7e4f20ccd',
        ])->assertCreated()
            ->assertJsonPath('ai_status', 'handed_off')
            ->assertJsonPath('ai_message.content', 'The seller has been notified and will reply when available.')
            ->assertJsonPath('conversation.needs_human_attention', true);

        $this->assertDatabaseHas('notifications', [
            'notifiable_id' => $seller->id,
            'type' => ChatAttentionNotification::class,
        ]);
    }

    public function test_seller_can_take_over_and_resume_product_chat_ai(): void
    {
        app()->instance(ChatProvider::class, Mockery::mock(ChatProvider::class)
            ->shouldReceive('respond')
            ->once()
            ->andReturn('The listing states the breed is Boer.')
            ->getMock());

        [$buyer, $seller, $listing] = $this->createActiveProductChatParticipants();
        $conversationId = $this->actingAs($buyer)->postJson('/api/chat/direct-conversations', [
            'recipient_id' => $seller->id,
            'listing_id' => $listing->id,
        ])->assertOk()->json('conversation.id');

        $this->actingAs($seller)->patchJson("/api/chat/conversations/{$conversationId}/product-ai", ['paused' => true])
            ->assertOk()
            ->assertJsonPath('conversation.ai_paused', true);
        $this->actingAs($buyer)->postJson("/api/chat/conversations/{$conversationId}/messages", [
            'message' => 'Could you confirm the listing age?',
            'client_message_id' => 'c057ad6c-dccc-44f5-93f3-d5c22300b860',
        ])->assertCreated()
            ->assertJsonPath('ai_status', 'not_applicable')
            ->assertJsonPath('ai_message', null);
        $this->actingAs($seller)->postJson("/api/chat/conversations/{$conversationId}/messages", [
            'message' => 'The listing shows the age in the description.',
            'client_message_id' => '3095ef6c-0308-48df-a44f-1fb13b35b213',
        ])->assertCreated()->assertJsonPath('ai_status', 'not_applicable');
        $this->actingAs($seller)->patchJson("/api/chat/conversations/{$conversationId}/product-ai", ['paused' => false])
            ->assertOk()
            ->assertJsonPath('conversation.ai_paused', false);

        $this->actingAs($buyer)->postJson("/api/chat/conversations/{$conversationId}/messages", [
            'message' => 'What breed is listed?',
            'client_message_id' => 'de47ba59-5230-4d60-80a3-ad641202ddc1',
        ])->assertCreated()
            ->assertJsonPath('ai_status', 'answered')
            ->assertJsonPath('ai_message.content', 'The listing states the breed is Boer.');
        $this->actingAs($buyer)->patchJson("/api/chat/conversations/{$conversationId}/product-ai", ['paused' => true])
            ->assertForbidden();
    }

    /**
     * @return array{0: User, 1: User, 2: LivestockListing}
     */
    private function createActiveProductChatParticipants(): array
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $category = Category::query()->create(['name' => 'Cattle', 'slug' => 'cattle']);
        $listing = LivestockListing::query()->create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Angus cattle',
            'breed' => 'Angus',
            'quantity' => 3,
            'pricing_type' => 'PER_HEAD',
            'price_per_head' => 25000,
            'description' => 'Adult cattle raised locally.',
            'status' => 'ACTIVE',
        ]);

        return [$buyer, $seller, $listing];
    }
}
