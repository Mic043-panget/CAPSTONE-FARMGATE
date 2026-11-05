<?php

namespace Tests\Feature;

use App\Enums\ListingStatus;
use App\Enums\OrderStatus;
use App\Enums\PricingType;
use App\Enums\Role;
use App\Models\AuditLog;
use App\Models\Category;
use App\Models\ChatConversation;
use App\Models\Delivery;
use App\Models\LivestockListing;
use App\Models\Order;
use App\Models\User;
use App\Services\Chat\ChatProvider;
use App\Services\Chat\ChatProviderException;
use App\Services\Chat\GeminiChatProvider;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as ClientRequest;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Mockery;
use Tests\TestCase;

class ChatApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_chat_endpoints_require_authentication(): void
    {
        $this->getJson('/api/chat/conversations')->assertUnauthorized();
        $this->postJson('/api/chat/messages', ['message' => 'Hello'])->assertUnauthorized();
    }

    public function test_chat_persists_messages_and_only_returns_the_callers_conversations(): void
    {
        $provider = Mockery::mock(ChatProvider::class);
        $provider->shouldReceive('respond')->once()->andReturn('Welcome to FARMGATE.');
        $this->app->instance(ChatProvider::class, $provider);
        $user = User::factory()->create(['role' => Role::BUYER]);

        $response = $this->actingAs($user)->postJson('/api/chat/messages', [
            'message' => 'How does checkout work?',
        ])->assertCreated()
            ->assertJsonPath('assistant_message.content', 'Welcome to FARMGATE.')
            ->assertJsonPath('user_message.role', 'user');

        $conversationId = $response->json('conversation.id');
        $this->assertDatabaseHas('chat_conversations', ['id' => $conversationId, 'user_id' => $user->id]);
        $this->assertDatabaseCount('chat_messages', 2);

        $otherUser = User::factory()->create(['role' => Role::BUYER]);
        $otherConversation = ChatConversation::query()->create(['user_id' => $otherUser->id, 'title' => 'Private']);

        $this->actingAs($user)->getJson('/api/chat/conversations')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonMissing(['title' => 'Private']);

        $this->actingAs($user)->getJson('/api/chat/conversations/'.$otherConversation->id)->assertNotFound();
        $this->actingAs($user)->postJson('/api/chat/messages', [
            'conversation_id' => $otherConversation->id,
            'message' => 'Read another account',
        ])->assertNotFound();
        $this->assertDatabaseCount('chat_messages', 2);
    }

    public function test_seller_report_context_is_recomputed_and_scoped_to_authenticated_seller(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER, 'name' => 'Farm Seller']);
        $otherSeller = User::factory()->create(['role' => Role::SELLER]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::COMPLETED,
            'total_amount' => 1250.50,
        ]);
        Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $otherSeller->id,
            'status' => OrderStatus::COMPLETED,
            'total_amount' => 9800.00,
        ]);

        $provider = Mockery::mock(ChatProvider::class);
        $provider->shouldReceive('respond')->once()->withArgs(function (string $instruction, array $history): bool {
            return str_contains($instruction, '"record_count":1')
                && str_contains($instruction, '"total_amount":"1250.50"')
                && ! str_contains($instruction, '9800')
                && $history[0]['role'] === 'user';
        })->andReturn('Your authorized completed-sales summary has one order.');
        $this->app->instance(ChatProvider::class, $provider);

        $this->actingAs($seller)->postJson('/api/chat/messages', [
            'message' => 'Summarize my sales',
            'report' => ['type' => 'sales'],
        ])->assertCreated();
    }

    public function test_ai_report_context_uses_selected_transaction_filters(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::COMPLETED,
            'payment_status' => 'PAID',
            'payment_method' => 'GCASH',
            'total_amount' => 450,
        ]);
        Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::COMPLETED,
            'payment_status' => 'UNPAID',
            'payment_method' => 'COD',
            'total_amount' => 900,
        ]);

        $provider = Mockery::mock(ChatProvider::class);
        $provider->shouldReceive('respond')->once()->withArgs(
            fn (string $instruction): bool => str_contains($instruction, '"record_count":1')
                && str_contains($instruction, '"total_amount":"450.00"')
                && str_contains($instruction, '"payment_status":"PAID"')
                && str_contains($instruction, '"amount_min":"400"'),
        )->andReturn('The selected filters match one paid transaction.');
        $this->app->instance(ChatProvider::class, $provider);

        $this->actingAs($admin)->postJson('/api/chat/messages', [
            'message' => 'Analyze the filtered transaction report',
            'report' => [
                'type' => 'transactions',
                'payment_status' => 'PAID',
                'payment_method' => 'GCASH',
                'amount_min' => '400',
                'amount_max' => '500',
            ],
        ])->assertCreated()
            ->assertJsonPath('assistant_message.content', 'The selected filters match one paid transaction.')
            ->assertJsonPath('conversation.report_context.payment_method', 'GCASH');
    }

    public function test_ai_sales_context_respects_selected_product_and_uses_only_its_item_revenue(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $category = Category::create(['name' => 'Cattle', 'slug' => 'cattle']);
        $selectedListing = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Selected calf',
            'quantity' => 2,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 100,
            'status' => ListingStatus::ACTIVE,
        ]);
        $otherListing = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Other calf',
            'quantity' => 2,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 200,
            'status' => ListingStatus::ACTIVE,
        ]);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::COMPLETED,
            'total_amount' => 300,
        ]);
        $order->items()->createMany([
            ['listing_id' => $selectedListing->id, 'quantity' => 1, 'unit_price' => 100, 'total_amount' => 100, 'pricing_type' => PricingType::PER_HEAD],
            ['listing_id' => $otherListing->id, 'quantity' => 1, 'unit_price' => 200, 'total_amount' => 200, 'pricing_type' => PricingType::PER_HEAD],
        ]);

        $provider = Mockery::mock(ChatProvider::class);
        $provider->shouldReceive('respond')->once()->withArgs(
            fn (string $instruction): bool => str_contains($instruction, '"record_count":1')
                && str_contains($instruction, '"total_amount":"100.00"')
                && str_contains($instruction, '"listing_id":'.$selectedListing->id),
        )->andReturn('The selected product has PHP 100 in sales.');
        $this->app->instance(ChatProvider::class, $provider);

        $this->actingAs($seller)->postJson('/api/chat/messages', [
            'message' => 'Analyze selected product sales',
            'report' => ['type' => 'sales', 'listing_id' => $selectedListing->id],
        ])->assertCreated()
            ->assertJsonPath('assistant_message.content', 'The selected product has PHP 100 in sales.');
    }

    public function test_disallowed_report_types_are_denied_before_provider_call(): void
    {
        $provider = Mockery::mock(ChatProvider::class);
        $provider->shouldNotReceive('respond');
        $this->app->instance(ChatProvider::class, $provider);
        $rider = User::factory()->create(['role' => Role::RIDER]);

        $this->actingAs($rider)->postJson('/api/chat/messages', [
            'message' => 'Show users',
            'report' => ['type' => 'users'],
        ])->assertForbidden();

        $this->assertDatabaseCount('chat_conversations', 0);
        $this->assertDatabaseCount('chat_messages', 0);
    }

    public function test_empty_report_context_returns_zero_aggregates_to_the_provider(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $provider = Mockery::mock(ChatProvider::class);
        $provider->shouldReceive('respond')->once()->withArgs(
            fn (string $instruction): bool => str_contains($instruction, '"record_count":0')
                && str_contains($instruction, '"monthly_totals":[]'),
        )->andReturn('There is not enough sales data in this report yet.');
        $this->app->instance(ChatProvider::class, $provider);

        $this->actingAs($seller)->postJson('/api/chat/messages', [
            'message' => 'Summarize this sales report',
            'report' => ['type' => 'sales'],
        ])->assertCreated()
            ->assertJsonPath('assistant_message.content', 'There is not enough sales data in this report yet.');
    }

    public function test_admin_can_request_an_authorized_user_aggregate(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        User::factory()->create(['role' => Role::SELLER]);
        User::factory()->create(['role' => Role::BUYER]);

        $provider = Mockery::mock(ChatProvider::class);
        $provider->shouldReceive('respond')->once()->withArgs(
            fn (string $instruction): bool => str_contains($instruction, '"report":"users"')
                && str_contains($instruction, '"record_count":3'),
        )->andReturn('There are three accounts in this count.');
        $this->app->instance(ChatProvider::class, $provider);

        $this->actingAs($admin)->postJson('/api/chat/messages', [
            'message' => 'How many accounts?',
            'report' => ['type' => 'users'],
        ])->assertCreated();
    }

    public function test_buyer_live_order_context_contains_only_their_own_order_data(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $otherBuyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $ownOrder = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::PENDING_CONFIRMATION,
            'total_amount' => 425.00,
        ]);
        $otherOrder = Order::create([
            'buyer_id' => $otherBuyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::COMPLETED,
            'total_amount' => 9876.00,
        ]);

        $provider = Mockery::mock(ChatProvider::class);
        $provider->shouldReceive('respond')->once()->withArgs(
            fn (string $instruction): bool => str_contains($instruction, '"order_id":'.$ownOrder->id)
                && str_contains($instruction, '"status":"PENDING_CONFIRMATION"')
                && ! str_contains($instruction, '"order_id":'.$otherOrder->id)
                && ! str_contains($instruction, '9876'),
        )->andReturn('Your latest order is awaiting seller confirmation.');
        $this->app->instance(ChatProvider::class, $provider);

        $this->actingAs($buyer)->postJson('/api/chat/messages', [
            'message' => 'What is my latest order status?',
        ])->assertCreated();
    }

    public function test_rider_live_delivery_context_is_scoped_to_the_authenticated_rider(): void
    {
        $rider = User::factory()->create(['role' => Role::RIDER]);
        $otherRider = User::factory()->create(['role' => Role::RIDER]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $ownOrder = Order::create(['buyer_id' => $buyer->id, 'seller_id' => $seller->id, 'status' => OrderStatus::CONFIRMED, 'total_amount' => 100]);
        $otherOrder = Order::create(['buyer_id' => $buyer->id, 'seller_id' => $seller->id, 'status' => OrderStatus::CONFIRMED, 'total_amount' => 100]);
        $ownDelivery = Delivery::create(['order_id' => $ownOrder->id, 'rider_id' => $rider->id, 'status' => 'RIDER_ACCEPTED']);
        $otherDelivery = Delivery::create(['order_id' => $otherOrder->id, 'rider_id' => $otherRider->id, 'status' => 'IN_TRANSIT']);

        $provider = Mockery::mock(ChatProvider::class);
        $provider->shouldReceive('respond')->once()->withArgs(
            fn (string $instruction): bool => str_contains($instruction, '"delivery_id":'.$ownDelivery->id)
                && ! str_contains($instruction, '"delivery_id":'.$otherDelivery->id),
        )->andReturn('Your assigned delivery is ready for pickup.');
        $this->app->instance(ChatProvider::class, $provider);

        $this->actingAs($rider)->postJson('/api/chat/messages', [
            'message' => 'What is my next delivery?',
        ])->assertCreated();
    }

    public function test_report_context_survives_followups_and_conversation_deletion_is_owner_scoped(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER, 'name' => 'Farm Seller']);
        $otherSeller = User::factory()->create(['role' => Role::SELLER]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        Order::create(['buyer_id' => $buyer->id, 'seller_id' => $seller->id, 'status' => OrderStatus::COMPLETED, 'total_amount' => 321.45]);
        Order::create(['buyer_id' => $buyer->id, 'seller_id' => $otherSeller->id, 'status' => OrderStatus::COMPLETED, 'total_amount' => 6543.99]);

        $provider = Mockery::mock(ChatProvider::class);
        $provider->shouldReceive('respond')->twice()->withArgs(
            fn (string $instruction): bool => str_contains($instruction, '"report":"sales"')
                && str_contains($instruction, '"total_amount":"321.45"')
                && ! str_contains($instruction, '6543.99')
                && ! str_contains($instruction, 'Farm')
                && str_contains($instruction, '"status_distribution":[{"status":"COMPLETED","count":1}]')
                && str_contains($instruction, '"monthly_totals":[{"period":"'.now()->format('Y-m').'","record_count":1,"total_amount":"321.45"}]'),
        )->andReturn('Your report shows one completed sale.');
        $provider->shouldReceive('respond')->once()->withArgs(
            fn (string $instruction): bool => ! str_contains($instruction, '"report":"sales"'),
        )->andReturn('I can answer a general question.');
        $this->app->instance(ChatProvider::class, $provider);

        $fromDate = now()->subDay()->toDateString();
        $first = $this->actingAs($seller)->postJson('/api/chat/messages', [
            'message' => 'Analyze my sales',
            'report' => ['type' => 'sales', 'from' => $fromDate, 'search' => 'Farm'],
        ])->assertCreated();
        $conversationId = $first->json('conversation.id');
        $audit = AuditLog::query()->where('action', 'POST api/chat/messages')->latest('id')->firstOrFail();
        $this->assertStringNotContainsString('"report_context"', json_encode($audit->metadata, JSON_THROW_ON_ERROR));

        $this->actingAs($seller)->getJson('/api/chat/conversations/'.$conversationId)
            ->assertOk()
            ->assertJsonPath('conversation.report_context.type', 'sales')
            ->assertJsonPath('conversation.report_context.search', 'Farm')
            ->assertJsonPath('conversation.report_context.from', $fromDate);
        $this->actingAs($seller)->postJson('/api/chat/messages', [
            'conversation_id' => $conversationId,
            'message' => 'Can you explain the trend?',
        ])->assertCreated();
        $this->actingAs($seller)->patchJson('/api/chat/conversations/'.$conversationId.'/report-context')
            ->assertOk();
        $this->actingAs($seller)->getJson('/api/chat/conversations/'.$conversationId)
            ->assertJsonPath('conversation.report_context', null);
        $this->actingAs($seller)->postJson('/api/chat/messages', [
            'conversation_id' => $conversationId,
            'message' => 'Let us switch to a general question.',
        ])->assertCreated();

        $otherConversation = ChatConversation::query()->create(['user_id' => $otherSeller->id, 'title' => 'Private']);
        $this->actingAs($seller)->deleteJson('/api/chat/conversations/'.$otherConversation->id)->assertNotFound();
        $this->actingAs($seller)->deleteJson('/api/chat/conversations/'.$conversationId)->assertOk();
        $this->assertDatabaseMissing('chat_conversations', ['id' => $conversationId]);
        $this->assertDatabaseMissing('chat_messages', ['conversation_id' => $conversationId]);
    }

    public function test_provider_failure_returns_generic_unavailable_and_does_not_store_prompt(): void
    {
        $provider = Mockery::mock(ChatProvider::class);
        $provider->shouldReceive('respond')->once()->andThrow(new ChatProviderException('private provider diagnostic'));
        $this->app->instance(ChatProvider::class, $provider);
        $user = User::factory()->create(['role' => Role::BUYER]);

        $this->actingAs($user)->postJson('/api/chat/messages', [
            'message' => 'keep this private prompt',
        ])->assertStatus(503)
            ->assertJsonPath('message', 'The assistant is temporarily unavailable. Please try again later.')
            ->assertJsonMissing(['message' => 'private provider diagnostic']);

        $this->assertDatabaseCount('chat_conversations', 0);
        $this->assertDatabaseCount('chat_messages', 0);
    }

    public function test_chat_validation_bounds_message_and_history_and_audit_redacts_content(): void
    {
        $provider = Mockery::mock(ChatProvider::class);
        $provider->shouldReceive('respond')->once()->withArgs(fn (string $instruction, array $history): bool => count($history) === 11)
            ->andReturn('A bounded reply.');
        $this->app->instance(ChatProvider::class, $provider);

        $user = User::factory()->create(['role' => Role::BUYER]);
        $conversation = ChatConversation::query()->create(['user_id' => $user->id, 'title' => 'Existing']);
        for ($index = 0; $index < 15; $index++) {
            $conversation->messages()->create([
                'role' => $index % 2 === 0 ? 'user' : 'assistant',
                'content' => 'Earlier message '.$index,
            ]);
        }

        $this->actingAs($user)->postJson('/api/chat/messages', [
            'conversation_id' => $conversation->id,
            'message' => 'This private prompt must not appear in audit values.',
            'reason' => 'This private prompt must not appear in audit values.',
        ])->assertCreated();

        $audit = AuditLog::query()->where('action', 'POST api/chat/messages')->latest('id')->firstOrFail();
        $this->assertNull($audit->reason);
        $this->assertStringNotContainsString(
            'This private prompt must not appear in audit values.',
            json_encode($audit->metadata, JSON_THROW_ON_ERROR),
        );
        $this->assertStringNotContainsString(
            'This private prompt must not appear in audit values.',
            json_encode($audit->before_values, JSON_THROW_ON_ERROR),
        );
        $this->assertStringNotContainsString(
            'This private prompt must not appear in audit values.',
            json_encode($audit->after_values, JSON_THROW_ON_ERROR),
        );
    }

    public function test_messages_over_limit_and_extra_report_keys_are_rejected(): void
    {
        $user = User::factory()->create(['role' => Role::BUYER]);

        $this->actingAs($user)->postJson('/api/chat/messages', [
            'message' => str_repeat('x', 2001),
        ])->assertUnprocessable();

        $this->actingAs($user)->postJson('/api/chat/messages', [
            'message' => 'Summarize',
            'report' => ['type' => 'transactions', 'seller_id' => 999],
        ])->assertUnprocessable();
    }

    public function test_gemini_provider_failure_is_not_exposed_to_client(): void
    {
        config(['services.gemini.api_key' => null]);
        $user = User::factory()->create(['role' => Role::BUYER]);

        $this->actingAs($user)->postJson('/api/chat/messages', [
            'message' => 'Hello',
        ])->assertStatus(503)
            ->assertJsonMissing(['message' => 'Chat provider is not configured.']);

        $this->assertDatabaseCount('chat_messages', 0);
    }

    public function test_gemini_adapter_sends_key_in_header_and_reads_provider_response(): void
    {
        config([
            'services.gemini.api_key' => 'test-only-gemini-key',
            'services.gemini.model' => 'gemini-2.5-flash-lite',
        ]);
        Http::fake([
            'https://generativelanguage.googleapis.com/*' => Http::response([
                'candidates' => [[
                    'content' => ['parts' => [['text' => 'A mocked Gemini response.']]],
                ]],
            ], 200),
        ]);
        $user = User::factory()->create(['role' => Role::BUYER]);

        $this->actingAs($user)->postJson('/api/chat/messages', [
            'message' => 'Hello',
        ])->assertCreated()
            ->assertJsonPath('assistant_message.content', 'A mocked Gemini response.');

        Http::assertSent(fn (ClientRequest $request): bool => $request->hasHeader('x-goog-api-key', 'test-only-gemini-key')
            && ! str_contains($request->url(), 'test-only-gemini-key')
            && $request['contents'][0]['role'] === 'user');
    }

    public function test_gemini_adapter_uses_fallback_model_when_primary_is_busy(): void
    {
        config([
            'services.gemini.api_key' => 'test-only-gemini-key',
            'services.gemini.model' => 'gemini-2.5-flash-lite',
            'services.gemini.fallback_model' => 'gemini-2.5-flash',
        ]);
        Http::fakeSequence()
            ->push(['error' => ['message' => 'Model is busy.']], 503)
            ->push([
                'candidates' => [[
                    'content' => ['parts' => [['text' => 'Fallback model response.']]],
                ]],
            ], 200);
        $user = User::factory()->create(['role' => Role::BUYER]);

        $this->actingAs($user)->postJson('/api/chat/messages', [
            'message' => 'Hello',
        ])->assertCreated()
            ->assertJsonPath('assistant_message.content', 'Fallback model response.');

        Http::assertSentCount(2);
        Http::assertSent(fn (ClientRequest $request): bool => str_contains($request->url(), 'gemini-2.5-flash-lite:generateContent'));
        Http::assertSent(fn (ClientRequest $request): bool => str_contains($request->url(), 'gemini-2.5-flash:generateContent'));
    }

    public function test_gemini_provider_logs_safe_status_details_for_rejected_requests(): void
    {
        config([
            'services.gemini.api_key' => 'test-only-gemini-key',
            'services.gemini.model' => 'gemini-2.5-flash-lite',
            'services.gemini.fallback_model' => '',
        ]);
        Http::fake([
            'https://generativelanguage.googleapis.com/*' => Http::response([
                'error' => ['status' => 'PERMISSION_DENIED', 'message' => 'Sensitive provider response'],
            ], 403),
        ]);
        Log::spy();

        try {
            app(GeminiChatProvider::class)->respond('private prompt', [
                ['role' => 'user', 'content' => 'private prompt'],
            ]);
            $this->fail('Expected the provider to reject the request.');
        } catch (ChatProviderException) {
            Log::shouldHaveReceived('warning')->once()->withArgs(
                fn (string $message, array $context): bool => $message === 'Gemini chat provider rejected or could not complete a request.'
                    && $context['model'] === 'gemini-2.5-flash-lite'
                    && $context['http_status'] === 403
                    && $context['provider_status'] === 'PERMISSION_DENIED'
                    && $context['provider_message'] === 'Sensitive provider response'
                    && ! str_contains(json_encode($context), 'test-only-gemini-key')
                    && ! str_contains(json_encode($context), 'private prompt')
                    && ! str_contains(json_encode($context), 'AIza'),
            );
        }
    }

    public function test_gemini_provider_redacts_api_keys_in_provider_error_messages(): void
    {
        $apiKey = 'AIzaSy'.str_repeat('A', 32);
        config([
            'services.gemini.api_key' => $apiKey,
            'services.gemini.model' => 'gemini-2.5-flash-lite',
            'services.gemini.fallback_model' => '',
        ]);
        Http::fake([
            'https://generativelanguage.googleapis.com/*' => Http::response([
                'error' => ['status' => 'NOT_FOUND', 'message' => "Rejected key {$apiKey}"],
            ], 404),
        ]);
        Log::spy();

        try {
            app(GeminiChatProvider::class)->respond('private prompt', [
                ['role' => 'user', 'content' => 'private prompt'],
            ]);
            $this->fail('Expected the provider to reject the request.');
        } catch (ChatProviderException) {
            Log::shouldHaveReceived('warning')->once()->withArgs(
                fn (string $message, array $context): bool => $message === 'Gemini chat provider rejected or could not complete a request.'
                    && $context['provider_message'] === 'Rejected key [redacted]'
                    && ! str_contains(json_encode($context), $apiKey),
            );
        }
    }
}
