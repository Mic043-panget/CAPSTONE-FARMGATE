<?php

namespace Tests\Feature;

use App\Enums\OrderStatus;
use App\Enums\Role;
use App\Models\Order;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class PayMongoWebhookTest extends TestCase
{
    use RefreshDatabase;

    private const WEBHOOK_SECRET = 'whsec_test_only';

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'services.paymongo.secret_key' => 'sk_test_farmgate',
            'services.paymongo.webhook_secret' => self::WEBHOOK_SECRET,
            'payments.paymongo.configuration_verified' => false,
        ]);
    }

    public function test_signed_paid_test_event_updates_order_and_duplicate_event_is_not_processed_twice(): void
    {
        $order = $this->pendingOrder();
        $payload = $this->paidPayload($order);

        $this->postWebhook($payload)->assertOk()->assertJsonPath('message', 'Webhook received.');
        $this->assertSame('PAID', $order->fresh()->payment_status);
        $this->assertNotNull($order->fresh()->paid_at);
        $this->assertDatabaseHas('paymongo_webhook_events', [
            'event_type' => 'checkout_session.payment.paid',
            'checkout_session_id' => 'cs_test_farmgate',
            'status' => 'PROCESSED',
        ]);
        $this->assertNotNull(
            DB::table('paymongo_webhook_events')->value('processed_at'),
        );

        $this->postWebhook($payload)->assertOk()->assertJsonPath('message', 'Duplicate webhook event ignored.');
        $this->assertDatabaseCount('paymongo_webhook_events', 1);
        $this->assertSame(1, $order->seller->notifications()->where('type', 'App\\Notifications\\OrderStatusChangedNotification')->count());
    }

    public function test_invalid_signature_does_not_change_payment_or_create_event_record(): void
    {
        $order = $this->pendingOrder();
        $this->postWebhook($this->paidPayload($order), 'invalid-signature')->assertUnauthorized();

        $this->assertSame('PENDING', $order->fresh()->payment_status);
        $this->assertDatabaseCount('paymongo_webhook_events', 0);
    }

    public function test_invalid_amount_or_live_mode_event_is_rejected_without_processing(): void
    {
        $order = $this->pendingOrder();
        $this->postWebhook($this->paidPayload($order, 9999))->assertUnprocessable();
        $this->assertSame('PENDING', $order->fresh()->payment_status);
        $this->assertDatabaseCount('paymongo_webhook_events', 0);

        $this->postWebhook($this->paidPayload($order, 10000, true))->assertUnprocessable();
        $this->assertSame('PENDING', $order->fresh()->payment_status);
        $this->assertDatabaseCount('paymongo_webhook_events', 0);

        $invalidCurrency = $this->paidPayload($order);
        $invalidCurrency['data']['attributes']['data']['attributes']['payments'][0]['attributes']['currency'] = 'USD';
        $this->postWebhook($invalidCurrency)->assertUnprocessable();
        $this->assertSame('PENDING', $order->fresh()->payment_status);
        $this->assertDatabaseCount('paymongo_webhook_events', 0);
    }

    public function test_invalid_order_reference_is_rejected_without_processing(): void
    {
        $order = $this->pendingOrder();
        $payload = $this->paidPayload($order, referenceNumber: (string) ($order->id + 1));

        $this->postWebhook($payload)->assertUnprocessable();

        $this->assertSame('PENDING', $order->fresh()->payment_status);
        $this->assertNull($order->fresh()->paid_at);
        $this->assertDatabaseCount('paymongo_webhook_events', 0);
    }

    public function test_unsupported_checkout_event_is_ignored_and_does_not_mark_order_paid(): void
    {
        $order = $this->pendingOrder();
        $payload = $this->paidPayload($order);
        $payload['data']['attributes']['type'] = 'checkout_session.payment.failed';

        $this->postWebhook($payload)->assertOk()->assertJsonPath('message', 'Webhook event ignored.');
        $this->assertSame('PENDING', $order->fresh()->payment_status);
        $this->assertDatabaseCount('paymongo_webhook_events', 0);
    }

    public function test_webhook_requires_test_api_key_and_signing_secret(): void
    {
        config(['services.paymongo.secret_key' => 'sk_live_not_allowed']);
        $this->postWebhook($this->paidPayload($this->pendingOrder()))->assertStatus(503);

        config([
            'services.paymongo.secret_key' => null,
            'services.paymongo.webhook_secret' => null,
        ]);
        $this->postJson('/api/payments/paymongo/webhook', [])->assertStatus(503);
    }

    private function pendingOrder(): Order
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);

        return Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::PENDING_CONFIRMATION,
            'payment_method' => 'GCASH',
            'payment_status' => 'PENDING',
            'paymongo_checkout_session_id' => 'cs_test_farmgate',
            'total_amount' => '100.00',
        ]);
    }

    private function paidPayload(
        Order $order,
        int $amount = 10000,
        bool $liveMode = false,
        ?string $referenceNumber = null,
    ): array {
        return [
            'data' => [
                'id' => 'evt_test_farmgate',
                'type' => 'event',
                'attributes' => [
                    'type' => 'checkout_session.payment.paid',
                    'livemode' => $liveMode,
                    'data' => [
                        'id' => 'cs_test_farmgate',
                        'type' => 'checkout_session',
                        'attributes' => [
                            'reference_number' => $referenceNumber ?? (string) $order->id,
                            'payments' => [[
                                'id' => 'pay_test_farmgate',
                                'attributes' => ['status' => 'paid', 'amount' => $amount, 'currency' => 'PHP'],
                            ],
                            ]],
                    ],
                ],
            ],
        ];
    }

    private function postWebhook(array $payload, ?string $signatureOverride = null)
    {
        $body = json_encode($payload, JSON_THROW_ON_ERROR);
        $timestamp = (string) time();
        $signature = $signatureOverride ?? hash_hmac('sha256', $timestamp.'.'.$body, self::WEBHOOK_SECRET);

        return $this->call('POST', '/api/payments/paymongo/webhook', [], [], [], [
            'HTTP_PAYMONGO_SIGNATURE' => 't='.$timestamp.',te='.$signature,
            'CONTENT_TYPE' => 'application/json',
            'HTTP_ACCEPT' => 'application/json',
        ], $body);
    }
}
