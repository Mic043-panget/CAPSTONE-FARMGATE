<?php

namespace Tests\Feature;

use App\Enums\DeliveryStatus;
use App\Enums\OrderStatus;
use App\Enums\PricingType;
use App\Enums\Role;
use App\Models\Category;
use App\Models\Delivery;
use App\Models\LivestockListing;
use App\Models\Order;
use App\Models\RiderOffer;
use App\Models\RiderProfile;
use App\Models\User;
use App\Services\RiderAssignmentService;
use App\Services\SystemSettingsService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

class RiderAssignmentTest extends TestCase
{
    use RefreshDatabase;

    public function test_unverified_rider_is_not_assigned_when_verification_is_required(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $rider = User::factory()->create(['role' => Role::RIDER]);
        RiderProfile::create([
            'user_id' => $rider->id,
            'phone' => '09170000001',
            'vehicle_type' => 'motorbike',
            'availability' => 'AVAILABLE',
            'is_verified' => false,
            'latitude' => 14.123,
            'longitude' => 120.456,
            'last_location_at' => now(),
        ]);

        app(SystemSettingsService::class)->update(['rider_verification_required' => true], $admin->id, 'Rider verification required');

        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::READY_FOR_PICKUP,
            'delivery_method' => 'STANDARD_DELIVERY',
            'payment_method' => 'COD',
            'total_amount' => 440,
        ]);

        $this->actingAs($seller)->postJson('/api/deliveries/assign', ['order_id' => $order->id])
            ->assertOk()
            ->assertJsonPath('delivery.status', DeliveryStatus::WAITING_FOR_RIDER->value);
    }

    public function test_rider_can_update_availability_and_location_and_receive_offer(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $rider = User::factory()->create(['role' => Role::RIDER]);
        RiderProfile::create([
            'user_id' => $rider->id,
            'phone' => '09171234567',
            'vehicle_type' => 'motorbike',
            'availability' => 'AVAILABLE',
            'is_verified' => true,
            'latitude' => 14.123,
            'longitude' => 120.456,
            'last_location_at' => now(),
        ]);

        $category = Category::create(['name' => 'Swine', 'slug' => 'swine']);
        $listing = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Native Pig',
            'quantity' => 2,
            'pricing_type' => PricingType::PER_KILO,
            'price_per_kilo' => 220,
        ]);

        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::READY_FOR_PICKUP,
            'delivery_method' => 'STANDARD_DELIVERY',
            'payment_method' => 'COD',
            'total_amount' => 440,
        ]);
        Delivery::create([
            'order_id' => $order->id,
            'status' => DeliveryStatus::WAITING_FOR_RIDER,
            'pickup_latitude' => 14.100,
            'pickup_longitude' => 120.400,
            'pickup_address' => 'Bongabong',
        ]);

        $this->actingAs($rider)->postJson('/api/riders/location', [
            'latitude' => 14.120,
            'longitude' => 120.450,
        ])->assertOk();
        $this->assertTrue(app(SystemSettingsService::class)->getBoolean('automatic_rider_assignment_enabled'));
        $this->assertCount(1, app(RiderAssignmentService::class)->findEligibleRiders(0, 0));

        $assignment = $this->actingAs($seller)->postJson('/api/deliveries/assign', [
            'order_id' => $order->id,
        ])->assertOk()->assertJsonPath('delivery.status', DeliveryStatus::RIDER_OFFERED->value);

        $this->assertDatabaseHas('rider_offers', ['rider_id' => $rider->id]);
        $this->actingAs($rider)->getJson('/api/riders/offers')->assertOk();
    }

    public function test_rider_offer_starts_when_order_is_ready_for_pickup_and_retries_are_idempotent(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $otherSeller = User::factory()->create(['role' => Role::SELLER]);
        $rider = User::factory()->create(['role' => Role::RIDER]);
        RiderProfile::create([
            'user_id' => $rider->id,
            'phone' => '09170000111',
            'vehicle_type' => 'motorbike',
            'availability' => 'AVAILABLE',
            'is_verified' => true,
            'latitude' => 14.100,
            'longitude' => 120.400,
            'last_location_at' => now(),
        ]);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::PENDING_CONFIRMATION,
            'delivery_method' => 'STANDARD_DELIVERY',
            'payment_method' => 'COD',
            'total_amount' => 200,
        ]);
        $delivery = Delivery::create([
            'order_id' => $order->id,
            'status' => DeliveryStatus::WAITING_FOR_RIDER,
            'pickup_latitude' => 14.100,
            'pickup_longitude' => 120.400,
            'pickup_address' => 'Bongabong',
        ]);
        $assignment = app(RiderAssignmentService::class);

        $assignment->dispatchForOrder($order->id);
        $this->assertDatabaseCount('rider_offers', 0);

        $this->actingAs($seller)->patchJson('/api/orders/'.$order->id.'/status', [
            'status' => OrderStatus::CONFIRMED->value,
        ])->assertOk()
            ->assertJsonPath('order.status', OrderStatus::CONFIRMED->value);
        $this->assertDatabaseCount('rider_offers', 0);

        $this->actingAs($seller)->patchJson('/api/orders/'.$order->id.'/status', [
            'status' => OrderStatus::PREPARING->value,
        ])->assertOk();
        $this->actingAs($seller)->patchJson('/api/orders/'.$order->id.'/status', [
            'status' => OrderStatus::READY_FOR_PICKUP->value,
        ])->assertOk()
            ->assertJsonPath('delivery.status', DeliveryStatus::RIDER_OFFERED->value);
        $this->assertDatabaseCount('rider_offers', 1);
        $this->assertDatabaseHas('notifications', [
            'notifiable_id' => $rider->id,
            'data->type' => 'rider_offer_available',
            'data->order_id' => $order->id,
        ]);
        $this->assertDatabaseHas('notifications', [
            'notifiable_id' => $buyer->id,
            'data->type' => 'order_status_changed',
            'data->status' => OrderStatus::CONFIRMED->value,
        ]);

        $this->actingAs($seller)->postJson('/api/deliveries/assign', ['order_id' => $order->id])->assertOk();
        $this->assertDatabaseCount('rider_offers', 1);
        $this->assertSame(1, $rider->notifications()->where('data->type', 'rider_offer_available')->count());
        $this->actingAs($seller)->getJson('/api/orders')
            ->assertOk()
            ->assertJsonMissingPath('orders.0.delivery.rider.email');
        $this->actingAs($otherSeller)->postJson('/api/deliveries/assign', ['order_id' => $order->id])->assertForbidden();
        $this->assertSame(DeliveryStatus::RIDER_OFFERED, $delivery->fresh()->status);
    }

    public function test_cancelling_order_cancels_offered_and_accepted_delivery_and_notifies_affected_riders(): void
    {
        config([
            'mail.default' => 'smtp',
            'mail.mailers.smtp.scheme' => 'smtp',
            'mail.mailers.smtp.host' => 'smtp.farmgate.test',
            'mail.mailers.smtp.port' => 587,
            'mail.mailers.smtp.username' => 'notifications@farmgate.test',
            'mail.mailers.smtp.password' => 'test-only-password',
            'mail.from.address' => 'notifications@farmgate.test',
        ]);
        Mail::fake();

        foreach ([DeliveryStatus::RIDER_OFFERED, DeliveryStatus::RIDER_ACCEPTED] as $deliveryStatus) {
            $buyer = User::factory()->create(['role' => Role::BUYER]);
            $seller = User::factory()->create(['role' => Role::SELLER]);
            $rider = User::factory()->create(['role' => Role::RIDER]);
            $rider->forceFill(['account_preferences' => ['order_notifications' => false]])->save();
            RiderProfile::create([
                'user_id' => $rider->id,
                'phone' => '09170000123',
                'vehicle_type' => 'motorbike',
                'availability' => 'AVAILABLE',
                'is_verified' => true,
                'latitude' => 12.77,
                'longitude' => 121.36,
                'last_location_at' => now(),
            ]);
            $order = Order::create([
                'buyer_id' => $buyer->id,
                'seller_id' => $seller->id,
                'status' => OrderStatus::READY_FOR_PICKUP,
                'delivery_method' => 'STANDARD_DELIVERY',
                'payment_method' => 'COD',
                'total_amount' => 100,
            ]);
            $delivery = Delivery::create([
                'order_id' => $order->id,
                'rider_id' => $deliveryStatus === DeliveryStatus::RIDER_ACCEPTED ? $rider->id : null,
                'status' => $deliveryStatus,
                'pickup_address' => 'Bongabong',
                'rider_location_latitude' => 12.77,
                'rider_location_longitude' => 121.36,
                'rider_location_updated_at' => now(),
                'rider_location_captured_at' => now(),
                'order_qr_token_encrypted' => 'encrypted-token',
                'order_qr_token_hash' => hash('sha256', 'token'),
                'order_qr_rider_id' => $rider->id,
                'qr_token' => 'legacy-token',
                'pickup_qr_token_hash' => hash('sha256', 'pickup'),
                'pickup_qr_expires_at' => now()->addHour(),
                'delivery_qr_token_hash' => hash('sha256', 'delivery'),
                'delivery_qr_expires_at' => now()->addHour(),
            ]);
            if ($deliveryStatus === DeliveryStatus::RIDER_OFFERED) {
                RiderOffer::create([
                    'delivery_id' => $delivery->id,
                    'rider_id' => $rider->id,
                    'status' => 'OPEN',
                    'distance_km' => 1,
                    'expires_at' => now()->addMinutes(10),
                ]);
            }

            $this->actingAs($buyer)->patchJson('/api/orders/'.$order->id.'/status', [
                'status' => OrderStatus::CANCELLED->value,
                'reason' => 'Buyer cancelled the order.',
            ])->assertOk()->assertJsonPath('order.status', OrderStatus::CANCELLED->value);

            $cancelledDelivery = $delivery->fresh();
            $this->assertSame(DeliveryStatus::CANCELLED, $cancelledDelivery->status);
            $this->assertNull($cancelledDelivery->rider_id);
            $this->assertTrue(app(RiderAssignmentService::class)->findEligibleRiders(12.77, 121.36)->contains('user_id', $rider->id));
            $this->assertNull($cancelledDelivery->rider_location_latitude);
            $this->assertNull($cancelledDelivery->rider_location_updated_at);
            $this->assertNull($cancelledDelivery->order_qr_token_hash);
            $this->assertNull($cancelledDelivery->qr_token);
            $this->assertNull($cancelledDelivery->pickup_qr_token_hash);
            $this->assertNull($cancelledDelivery->delivery_qr_token_hash);
            $this->assertDatabaseHas('delivery_status_histories', [
                'delivery_id' => $delivery->id,
                'from_status' => $deliveryStatus->value,
                'to_status' => DeliveryStatus::CANCELLED->value,
                'changed_by' => $buyer->id,
            ]);
            $this->assertDatabaseHas('notifications', [
                'notifiable_id' => $rider->id,
                'data->type' => 'order_status_changed',
                'data->order_id' => $order->id,
                'data->status' => OrderStatus::CANCELLED->value,
            ]);
            $this->actingAs($buyer)->getJson('/api/orders/'.$order->id)
                ->assertOk()
                ->assertJsonPath('order.status_history.0.to_status', OrderStatus::CANCELLED->value)
                ->assertJsonPath('order.delivery.status_history.0.to_status', DeliveryStatus::CANCELLED->value);
            $this->assertDatabaseHas('order_status_email_deliveries', [
                'order_id' => $order->id,
                'recipient_id' => $rider->id,
                'order_status' => OrderStatus::CANCELLED->value,
                'delivery_status' => 'SENT',
            ]);
            $this->assertDatabaseMissing('rider_offers', [
                'delivery_id' => $delivery->id,
                'status' => 'OPEN',
            ]);
            $this->actingAs($buyer)->patchJson('/api/orders/'.$order->id.'/status', [
                'status' => OrderStatus::CANCELLED->value,
                'reason' => 'Buyer cancelled the order.',
            ])->assertUnprocessable();
            $this->assertSame(
                1,
                $buyer->notifications()->where('data->order_id', $order->id)->where('data->status', OrderStatus::CANCELLED->value)->count(),
            );
            $this->assertSame(3, $order->emailDeliveries()->count());
            $this->actingAs($rider)->postJson('/api/deliveries/'.$delivery->id.'/location', [
                'latitude' => 12.77,
                'longitude' => 121.36,
                'observed_at' => now()->toISOString(),
            ])->assertForbidden();
        }
    }

    public function test_order_cannot_be_cancelled_after_pickup_or_while_in_transit(): void
    {
        foreach ([DeliveryStatus::PICKED_UP, DeliveryStatus::IN_TRANSIT] as $deliveryStatus) {
            $buyer = User::factory()->create(['role' => Role::BUYER]);
            $seller = User::factory()->create(['role' => Role::SELLER]);
            $rider = User::factory()->create(['role' => Role::RIDER]);
            $order = Order::create([
                'buyer_id' => $buyer->id,
                'seller_id' => $seller->id,
                'status' => OrderStatus::FULFILLING,
                'delivery_method' => 'STANDARD_DELIVERY',
                'payment_method' => 'COD',
                'total_amount' => 100,
            ]);
            $delivery = Delivery::create([
                'order_id' => $order->id,
                'rider_id' => $rider->id,
                'status' => $deliveryStatus,
                'pickup_address' => 'Bongabong',
                'order_qr_token_hash' => hash('sha256', 'token'),
            ]);

            $this->actingAs($buyer)->patchJson('/api/orders/'.$order->id.'/status', [
                'status' => OrderStatus::CANCELLED->value,
            ])->assertStatus(409)
                ->assertJsonFragment(['message' => 'This order has been picked up. Use the delivery exception or return workflow instead of cancelling it.']);

            $this->assertSame(OrderStatus::FULFILLING, $order->fresh()->status);
            $this->assertSame($deliveryStatus, $delivery->fresh()->status);
            $this->assertNotNull($delivery->fresh()->rider_id);
            $this->assertSame(hash('sha256', 'token'), $delivery->fresh()->order_qr_token_hash);
            $this->assertDatabaseMissing('notifications', [
                'notifiable_id' => $rider->id,
                'data->order_id' => $order->id,
                'data->status' => OrderStatus::CANCELLED->value,
            ]);
        }
    }

    public function test_unsupported_paymongo_checkout_failure_event_does_not_change_pending_order(): void
    {
        Config::set('services.paymongo.webhook_secret', 'test-webhook-secret');
        Config::set('services.paymongo.secret_key', 'sk_test_example');
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $rider = User::factory()->create(['role' => Role::RIDER]);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::PENDING_CONFIRMATION,
            'delivery_method' => 'STANDARD_DELIVERY',
            'payment_method' => 'GCASH',
            'payment_status' => 'PENDING',
            'paymongo_checkout_session_id' => 'cs_failed_order',
            'total_amount' => 100,
        ]);
        $delivery = Delivery::create([
            'order_id' => $order->id,
            'status' => DeliveryStatus::RIDER_OFFERED,
            'pickup_address' => 'Bongabong',
        ]);
        $offer = RiderOffer::create([
            'delivery_id' => $delivery->id,
            'rider_id' => $rider->id,
            'status' => 'OPEN',
            'distance_km' => 1,
            'expires_at' => now()->addMinutes(10),
        ]);
        $payload = json_encode([
            'data' => [
                'id' => 'evt_failed_test',
                'type' => 'event',
                'attributes' => [
                    'type' => 'checkout_session.payment.failed',
                    'livemode' => false,
                    'data' => [
                        'id' => 'cs_failed_order',
                        'type' => 'checkout_session',
                    ],
                ],
            ],
        ], JSON_THROW_ON_ERROR);
        $timestamp = (string) time();
        $signature = hash_hmac('sha256', $timestamp.'.'.$payload, 'test-webhook-secret');
        $sendWebhook = fn () => $this->call(
            'POST',
            '/api/payments/paymongo/webhook',
            [],
            [],
            [],
            [
                'HTTP_PAYMONGO_SIGNATURE' => 't='.$timestamp.',te='.$signature,
                'CONTENT_TYPE' => 'application/json',
            ],
            $payload,
        );

        $sendWebhook()->assertOk()->assertJsonPath('message', 'Webhook event ignored.');
        $this->assertSame(OrderStatus::PENDING_CONFIRMATION, $order->fresh()->status);
        $this->assertSame('PENDING', $order->fresh()->payment_status);
        $this->assertSame(DeliveryStatus::RIDER_OFFERED, $delivery->fresh()->status);
        $this->assertSame('OPEN', $offer->fresh()->status);

        $sendWebhook()->assertOk()->assertJsonPath('message', 'Webhook event ignored.');
        $this->assertSame(0, $order->statusHistory()->count());
        $this->assertSame(0, $order->emailDeliveries()->count());
        $this->assertSame(0, $buyer->notifications()->where('data->order_id', $order->id)->count());
    }

    public function test_no_eligible_rider_leaves_ready_order_waiting_and_assignment_retry_is_idempotent(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::PENDING_CONFIRMATION,
            'delivery_method' => 'STANDARD_DELIVERY',
            'payment_method' => 'COD',
            'total_amount' => 200,
        ]);
        $delivery = Delivery::create([
            'order_id' => $order->id,
            'status' => DeliveryStatus::WAITING_FOR_RIDER,
            'pickup_latitude' => 14.100,
            'pickup_longitude' => 120.400,
            'pickup_address' => 'Bongabong',
        ]);

        $this->actingAs($seller)->patchJson('/api/orders/'.$order->id.'/status', [
            'status' => OrderStatus::CONFIRMED->value,
        ])->assertOk();
        $this->actingAs($seller)->patchJson('/api/orders/'.$order->id.'/status', [
            'status' => OrderStatus::PREPARING->value,
        ])->assertOk();
        $this->actingAs($seller)->patchJson('/api/orders/'.$order->id.'/status', [
            'status' => OrderStatus::READY_FOR_PICKUP->value,
        ])->assertOk()->assertJsonPath('delivery.status', DeliveryStatus::WAITING_FOR_RIDER->value);

        $this->assertDatabaseHas('notifications', [
            'notifiable_id' => $seller->id,
            'data->type' => 'rider_assignment_waiting',
            'data->order_id' => $order->id,
        ]);
        $this->actingAs($seller)->postJson('/api/deliveries/assign', ['order_id' => $order->id])
            ->assertOk()->assertJsonPath('delivery.status', DeliveryStatus::WAITING_FOR_RIDER->value);
        $this->assertSame(1, $seller->notifications()->where('data->type', 'rider_assignment_waiting')->count());
        $this->assertDatabaseCount('rider_offers', 0);
        $this->assertSame(OrderStatus::READY_FOR_PICKUP, $order->fresh()->status);
        $this->assertSame(DeliveryStatus::WAITING_FOR_RIDER, $delivery->fresh()->status);
    }

    public function test_standard_order_cannot_be_completed_before_verified_delivery_or_revoke_its_offer(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $rider = User::factory()->create(['role' => Role::RIDER]);
        RiderProfile::create([
            'user_id' => $rider->id,
            'phone' => '09170000222',
            'vehicle_type' => 'motorbike',
            'availability' => 'AVAILABLE',
            'is_verified' => true,
            'latitude' => 14.100,
            'longitude' => 120.400,
            'last_location_at' => now(),
        ]);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::PENDING_CONFIRMATION,
            'delivery_method' => 'STANDARD_DELIVERY',
            'payment_method' => 'COD',
            'total_amount' => 200,
        ]);
        $delivery = Delivery::create([
            'order_id' => $order->id,
            'status' => DeliveryStatus::WAITING_FOR_RIDER,
            'pickup_latitude' => 14.100,
            'pickup_longitude' => 120.400,
            'pickup_address' => 'Bongabong',
        ]);

        $this->actingAs($seller)->patchJson('/api/orders/'.$order->id.'/status', [
            'status' => OrderStatus::CONFIRMED->value,
        ])->assertOk();
        $this->actingAs($seller)->patchJson('/api/orders/'.$order->id.'/status', [
            'status' => OrderStatus::PREPARING->value,
        ])->assertOk();
        $this->actingAs($seller)->patchJson('/api/orders/'.$order->id.'/status', [
            'status' => OrderStatus::READY_FOR_PICKUP->value,
        ])->assertOk();
        $offer = RiderOffer::query()->where('delivery_id', $delivery->id)->firstOrFail();

        foreach ([
            OrderStatus::FULFILLING,
        ] as $status) {
            $this->actingAs($seller)->patchJson('/api/orders/'.$order->id.'/status', [
                'status' => $status->value,
            ])->assertOk()->assertJsonPath('order.status', $status->value);
        }

        $this->actingAs($seller)->patchJson('/api/orders/'.$order->id.'/status', [
            'status' => OrderStatus::COMPLETED->value,
        ])->assertStatus(409)
            ->assertJsonPath('message', 'Standard delivery must be QR-verified before the order can be completed.');
        $this->assertSame(OrderStatus::FULFILLING, $order->fresh()->status);
        $this->assertSame(DeliveryStatus::RIDER_OFFERED, $delivery->fresh()->status);
        $this->assertDatabaseHas('rider_offers', ['id' => $offer->id, 'status' => 'OPEN']);
        $this->actingAs($rider)->getJson('/api/riders/offers')->assertOk()->assertJsonCount(1, 'offers');
        $this->actingAs($rider)->postJson('/api/riders/offers/'.$offer->id.'/accept')->assertOk();
        $this->assertDatabaseMissing('notifications', [
            'notifiable_id' => $rider->id,
            'data->type' => 'order_rider_assigned',
            'data->order_id' => $order->id,
        ]);
    }

    public function test_rider_can_accept_offer_and_delivery_moves_to_pickup_pending(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $rider = User::factory()->create(['role' => Role::RIDER]);
        RiderProfile::create([
            'user_id' => $rider->id,
            'phone' => '09181112222',
            'vehicle_type' => 'tricycle',
            'availability' => 'AVAILABLE',
            'is_verified' => true,
            'latitude' => 14.100,
            'longitude' => 120.400,
            'last_location_at' => now(),
        ]);

        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::READY_FOR_PICKUP,
            'delivery_method' => 'STANDARD_DELIVERY',
            'payment_method' => 'COD',
            'total_amount' => 200,
        ]);

        $delivery = Delivery::create([
            'order_id' => $order->id,
            'status' => DeliveryStatus::SEARCHING_FOR_RIDER,
            'pickup_latitude' => 14.100,
            'pickup_longitude' => 120.400,
            'pickup_address' => 'Bongabong Market',
        ]);

        $offer = RiderOffer::create([
            'delivery_id' => $delivery->id,
            'rider_id' => $rider->id,
            'status' => 'OPEN',
            'distance_km' => 1.5,
            'expires_at' => now()->addMinutes(10),
        ]);

        $response = $this->actingAs($rider)->postJson('/api/riders/offers/'.$offer->id.'/accept');
        $this->assertSame(200, $response->getStatusCode(), $response->getContent());
        $response->assertJsonPath('message', 'Delivery assignment confirmed.')
            ->assertJsonPath('delivery.status', DeliveryStatus::RIDER_ACCEPTED->value)
            ->assertJsonMissingPath('delivery.order');

        $this->assertDatabaseHas('deliveries', ['id' => $delivery->id, 'status' => DeliveryStatus::RIDER_ACCEPTED->value]);
        $this->assertDatabaseHas('notifications', [
            'notifiable_id' => $buyer->id,
            'data->type' => 'order_rider_assigned',
            'data->order_id' => $order->id,
        ]);
        $this->assertDatabaseHas('notifications', [
            'notifiable_id' => $seller->id,
            'data->type' => 'order_rider_assigned',
            'data->order_id' => $order->id,
        ]);
        $this->assertDatabaseHas('notifications', [
            'notifiable_id' => $buyer->id,
            'data->type' => 'order_rider_assigned',
            'data->order_id' => $order->id,
        ]);
        $this->assertDatabaseHas('notifications', [
            'notifiable_id' => $seller->id,
            'data->type' => 'order_rider_assigned',
            'data->order_id' => $order->id,
        ]);
        $this->assertDatabaseHas('notifications', [
            'notifiable_id' => $rider->id,
            'data->type' => 'rider_assignment_confirmed',
            'data->order_id' => $order->id,
        ]);
    }

    public function test_rider_can_decline_offer_once_and_next_eligible_rider_can_accept(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $riders = collect([14.100, 14.101])->map(function (float $latitude): User {
            $rider = User::factory()->create(['role' => Role::RIDER]);
            RiderProfile::create([
                'user_id' => $rider->id,
                'phone' => '0917000000'.substr((string) $rider->id, -1),
                'vehicle_type' => 'motorbike',
                'availability' => 'AVAILABLE',
                'is_verified' => true,
                'latitude' => $latitude,
                'longitude' => 120.400,
                'last_location_at' => now(),
            ]);

            return $rider;
        });
        $outsider = User::factory()->create(['role' => Role::RIDER]);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::READY_FOR_PICKUP,
            'delivery_method' => 'STANDARD_DELIVERY',
            'payment_method' => 'COD',
            'total_amount' => 200,
        ]);
        $delivery = Delivery::create([
            'order_id' => $order->id,
            'status' => DeliveryStatus::WAITING_FOR_RIDER,
            'pickup_latitude' => 14.100,
            'pickup_longitude' => 120.400,
            'pickup_address' => 'Bongabong',
        ]);

        $this->actingAs($seller)->postJson('/api/deliveries/assign', ['order_id' => $order->id])
            ->assertOk()->assertJsonPath('delivery.status', DeliveryStatus::SEARCHING_FOR_RIDER->value);
        $this->assertDatabaseCount('rider_offers', 2);
        $initialOffer = RiderOffer::query()->where('delivery_id', $delivery->id)->firstOrFail();
        $this->assertSame($riders[0]->id, $initialOffer->rider_id);
        $nextOffer = RiderOffer::query()
            ->where('delivery_id', $delivery->id)
            ->where('rider_id', $riders[1]->id)
            ->firstOrFail();
        $this->assertSame('OPEN', $nextOffer->status);
        $this->assertNotNull($nextOffer->expires_at);
        $this->assertNull($delivery->fresh()->rider_id);

        $this->actingAs($outsider)->postJson('/api/riders/offers/'.$initialOffer->id.'/decline')
            ->assertForbidden();
        $this->assertSame('OPEN', $initialOffer->fresh()->status);

        $this->actingAs($riders[0])->postJson('/api/riders/offers/'.$initialOffer->id.'/decline')
            ->assertOk()
            ->assertJsonPath('message', 'Delivery offer declined.')
            ->assertJsonPath('delivery.status', DeliveryStatus::SEARCHING_FOR_RIDER->value);
        $this->assertDatabaseHas('rider_offers', ['id' => $initialOffer->id, 'status' => 'DECLINED']);
        $this->assertSame('OPEN', $nextOffer->status);

        $this->actingAs($riders[0])->postJson('/api/riders/offers/'.$initialOffer->id.'/decline')
            ->assertOk()
            ->assertJsonPath('delivery.status', DeliveryStatus::SEARCHING_FOR_RIDER->value);
        $this->assertDatabaseCount('rider_offers', 2);

        $this->actingAs($riders[1])->postJson('/api/riders/offers/'.$nextOffer->id.'/accept')
            ->assertOk()
            ->assertJsonPath('delivery.status', DeliveryStatus::RIDER_ACCEPTED->value);
        $this->assertSame($riders[1]->id, $delivery->fresh()->rider_id);
    }

    public function test_expired_delivery_offer_returns_a_clear_conflict_and_is_not_assigned(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $rider = User::factory()->create(['role' => Role::RIDER]);
        RiderProfile::create([
            'user_id' => $rider->id,
            'phone' => '09180001111',
            'vehicle_type' => 'motorbike',
            'availability' => 'AVAILABLE',
            'is_verified' => true,
        ]);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::READY_FOR_PICKUP,
            'delivery_method' => 'STANDARD_DELIVERY',
            'payment_method' => 'COD',
            'total_amount' => 180,
        ]);
        $delivery = Delivery::create([
            'order_id' => $order->id,
            'rider_id' => $rider->id,
            'status' => DeliveryStatus::RIDER_OFFERED,
            'pickup_latitude' => 12.7,
            'pickup_longitude' => 121.3,
        ]);
        $offer = RiderOffer::create([
            'delivery_id' => $delivery->id,
            'rider_id' => $rider->id,
            'status' => 'OPEN',
            'distance_km' => 1,
            'expires_at' => now()->subMinute(),
        ]);

        $this->actingAs($rider)->postJson('/api/riders/offers/'.$offer->id.'/accept')
            ->assertStatus(409)
            ->assertJsonPath('message', 'This delivery offer has expired.');
        $this->assertSame(DeliveryStatus::RIDER_OFFERED, $delivery->fresh()->status);
        $this->assertNull($delivery->fresh()->assigned_at);
    }

    public function test_rider_offer_map_data_excludes_private_buyer_details_and_uses_approximate_map_pins(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $rider = User::factory()->create(['role' => Role::RIDER]);
        RiderProfile::create([
            'user_id' => $rider->id,
            'phone' => '09183334444',
            'vehicle_type' => 'motorbike',
            'availability' => 'AVAILABLE',
            'is_verified' => true,
            'latitude' => 12.345,
            'longitude' => 121.678,
            'last_location_at' => now(),
        ]);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::READY_FOR_PICKUP,
            'delivery_method' => 'STANDARD_DELIVERY',
            'payment_method' => 'COD',
            'delivery_distance_km' => 6.46,
            'delivery_distance_method' => 'OSRM_ROAD_ROUTE',
            'delivery_fee' => 125,
            'total_amount' => 250,
            'shipping_address' => [
                'recipient_name' => 'Private Buyer Name',
                'phone_number' => '09123456789',
                'street_address' => 'Private Exact Street 123',
                'barangay' => 'Cawayan',
                'city_municipality' => 'Bongabong',
                'province' => 'Oriental Mindoro',
                'latitude' => 12.38127,
                'longitude' => 121.71482,
            ],
        ]);
        $delivery = Delivery::create([
            'order_id' => $order->id,
            'status' => DeliveryStatus::RIDER_OFFERED,
            'rider_id' => $rider->id,
            'pickup_latitude' => 12.34789,
            'pickup_longitude' => 121.67654,
            'pickup_address' => 'Private seller exact address',
        ]);
        $offer = RiderOffer::create([
            'delivery_id' => $delivery->id,
            'rider_id' => $rider->id,
            'status' => 'OPEN',
            'distance_km' => 1.5,
            'expires_at' => now()->addMinutes(10),
        ]);

        $response = $this->actingAs($rider)->getJson('/api/riders/offers')
            ->assertOk()
            ->assertJsonPath('rider_location.latitude', 12.345)
            ->assertJsonPath('offers.0.id', $offer->id)
            ->assertJsonPath('offers.0.delivery.pickup_latitude_approximate', 12.35)
            ->assertJsonPath('offers.0.delivery.order.dropoff_latitude_approximate', 12.38)
            ->assertJsonPath('offers.0.delivery.order.dropoff_area', 'Cawayan, Bongabong, Oriental Mindoro')
            ->assertJsonPath('offers.0.checkout_distance_km', 6.5)
            ->assertJsonPath('offers.0.checkout_distance_method', 'OSRM_ROAD_ROUTE')
            ->assertJsonPath('offers.0.checkout_delivery_fee', '125.00')
            ->assertJsonMissing(['recipient_name' => 'Private Buyer Name'])
            ->assertJsonMissing(['phone_number' => '09123456789'])
            ->assertJsonMissing(['street_address' => 'Private Exact Street 123'])
            ->assertJsonMissing(['pickup_address' => 'Private seller exact address'])
            ->assertJsonMissing(['buyer' => ['name' => $buyer->name]]);

        $this->assertStringNotContainsString('Private Buyer Name', $response->getContent());
        $this->assertStringNotContainsString('Private Exact Street 123', $response->getContent());
        $this->actingAs($rider)->getJson('/api/riders/deliveries')
            ->assertOk()
            ->assertJsonCount(0, 'deliveries.data');
    }

    public function test_standard_delivery_broadcasts_to_all_eligible_riders_within_radius_and_notifies_them(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $riders = collect([14.100, 14.101, 14.102])->map(function (float $latitude): User {
            $rider = User::factory()->create(['role' => Role::RIDER]);
            RiderProfile::create([
                'user_id' => $rider->id,
                'phone' => '0917000000'.substr((string) $rider->id, -1),
                'vehicle_type' => 'motorbike',
                'availability' => 'AVAILABLE',
                'is_verified' => true,
                'latitude' => $latitude,
                'longitude' => 120.400,
                'last_location_at' => now(),
            ]);

            return $rider;
        });
        $outsideRider = User::factory()->create(['role' => Role::RIDER]);
        RiderProfile::create([
            'user_id' => $outsideRider->id,
            'phone' => '09170000099',
            'vehicle_type' => 'motorbike',
            'availability' => 'AVAILABLE',
            'is_verified' => true,
            'latitude' => 14.600,
            'longitude' => 120.400,
            'last_location_at' => now(),
        ]);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::READY_FOR_PICKUP,
            'delivery_method' => 'STANDARD_DELIVERY',
            'payment_method' => 'COD',
            'total_amount' => 200,
        ]);
        $delivery = Delivery::create([
            'order_id' => $order->id,
            'status' => DeliveryStatus::WAITING_FOR_RIDER,
            'pickup_latitude' => 14.100,
            'pickup_longitude' => 120.400,
            'pickup_address' => 'Bongabong',
        ]);

        app(RiderAssignmentService::class)->dispatchForOrder($order->id);
        $offers = RiderOffer::query()->where('delivery_id', $delivery->id)->orderBy('rider_id')->get();

        $this->assertCount(3, $offers);
        $this->assertEqualsCanonicalizing($riders->pluck('id')->all(), $offers->pluck('rider_id')->all());
        $offers->each(fn (RiderOffer $offer) => $this->assertSame(now()->addMinutes(10)->timestamp, $offer->expires_at->timestamp));
        $this->assertSame(DeliveryStatus::SEARCHING_FOR_RIDER, $delivery->refresh()->status);
        $this->assertNull($delivery->rider_id);
        $this->assertDatabaseMissing('rider_offers', [
            'delivery_id' => $delivery->id,
            'rider_id' => $outsideRider->id,
        ]);
        foreach ($riders as $rider) {
            $this->assertDatabaseHas('notifications', [
                'notifiable_id' => $rider->id,
                'data->type' => 'rider_offer_available',
                'data->order_id' => $order->id,
            ]);
        }
    }

    public function test_expired_broadcast_offers_are_closed_without_assigning_a_rider(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $rider = User::factory()->create(['role' => Role::RIDER]);
        RiderProfile::create([
            'user_id' => $rider->id,
            'phone' => '09170000098',
            'vehicle_type' => 'motorbike',
            'availability' => 'AVAILABLE',
            'is_verified' => true,
            'latitude' => 14.100,
            'longitude' => 120.400,
            'last_location_at' => now(),
        ]);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::READY_FOR_PICKUP,
            'delivery_method' => 'STANDARD_DELIVERY',
            'payment_method' => 'COD',
            'total_amount' => 200,
        ]);
        $delivery = Delivery::create([
            'order_id' => $order->id,
            'status' => DeliveryStatus::WAITING_FOR_RIDER,
            'pickup_latitude' => 14.100,
            'pickup_longitude' => 120.400,
            'pickup_address' => 'Bongabong',
        ]);
        app(RiderAssignmentService::class)->dispatchForOrder($order->id);
        $offer = RiderOffer::query()->where('delivery_id', $delivery->id)->firstOrFail();
        $this->travel(10)->minutes();
        app(RiderAssignmentService::class)->processPendingDeliveries();
        $this->assertSame(DeliveryStatus::WAITING_FOR_RIDER, $delivery->refresh()->status);
        $this->assertDatabaseHas('rider_offers', ['id' => $offer->id, 'status' => 'EXPIRED']);
        $this->assertNull($delivery->rider_id);

        $this->actingAs($rider)->postJson('/api/riders/location', [
            'latitude' => 14.101,
            'longitude' => 120.401,
        ])->assertOk();
        $this->actingAs($rider)->getJson('/api/riders/offers')
            ->assertOk()
            ->assertJsonCount(1, 'offers');
        $this->assertDatabaseHas('rider_offers', [
            'delivery_id' => $delivery->id,
            'rider_id' => $rider->id,
            'status' => 'OPEN',
        ]);
        $this->assertSame(DeliveryStatus::RIDER_OFFERED, $delivery->fresh()->status);
    }

    public function test_simultaneous_claims_cannot_duplicate_delivery_or_assign_rider_to_two_active_deliveries(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $riders = collect([14.100, 14.101, 14.102])->map(function (float $latitude): User {
            $rider = User::factory()->create(['role' => Role::RIDER]);
            RiderProfile::create([
                'user_id' => $rider->id,
                'phone' => '0917000000'.substr((string) $rider->id, -1),
                'vehicle_type' => 'motorbike',
                'availability' => 'AVAILABLE',
                'is_verified' => true,
                'latitude' => $latitude,
                'longitude' => 120.400,
                'last_location_at' => now(),
            ]);

            return $rider;
        });
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::READY_FOR_PICKUP,
            'delivery_method' => 'STANDARD_DELIVERY',
            'payment_method' => 'COD',
            'total_amount' => 200,
        ]);
        $delivery = Delivery::create([
            'order_id' => $order->id,
            'status' => DeliveryStatus::WAITING_FOR_RIDER,
            'pickup_latitude' => 14.100,
            'pickup_longitude' => 120.400,
            'pickup_address' => 'Bongabong',
        ]);
        $assignment = app(RiderAssignmentService::class);
        $assignment->dispatchForOrder($order->id);
        $offers = RiderOffer::query()->where('delivery_id', $delivery->id)->where('status', 'OPEN')->orderBy('rider_id')->get();
        $winnerOffer = $offers->firstWhere('rider_id', $riders[1]->id);
        $otherOffer = $offers->firstWhere('rider_id', $riders[2]->id);
        $secondOrder = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::READY_FOR_PICKUP,
            'delivery_method' => 'STANDARD_DELIVERY',
            'payment_method' => 'COD',
            'total_amount' => 250,
        ]);
        $secondDelivery = Delivery::create([
            'order_id' => $secondOrder->id,
            'status' => DeliveryStatus::RIDER_OFFERED,
            'rider_id' => $riders[1]->id,
            'pickup_latitude' => 14.100,
            'pickup_longitude' => 120.400,
            'pickup_address' => 'Bongabong',
        ]);
        $secondOffer = RiderOffer::create([
            'delivery_id' => $secondDelivery->id,
            'rider_id' => $riders[1]->id,
            'status' => 'OPEN',
            'distance_km' => 1.5,
            'expires_at' => null,
        ]);

        $this->actingAs($riders[1])->postJson('/api/riders/offers/'.$winnerOffer->id.'/accept')->assertOk();
        $this->assertDatabaseHas('deliveries', [
            'id' => $delivery->id,
            'rider_id' => $riders[1]->id,
            'status' => DeliveryStatus::RIDER_ACCEPTED->value,
        ]);
        $this->assertDatabaseHas('rider_offers', ['id' => $otherOffer->id, 'status' => 'REVOKED']);

        $this->actingAs($riders[2])->postJson('/api/riders/offers/'.$otherOffer->id.'/accept')
            ->assertStatus(409)
            ->assertJsonPath('message', 'Another rider has already accepted this delivery.');
        $this->assertDatabaseHas('deliveries', ['id' => $delivery->id, 'rider_id' => $riders[1]->id]);
        $this->assertSame(1, RiderOffer::query()->where('delivery_id', $delivery->id)->where('status', 'ACCEPTED')->count());

        $this->actingAs($riders[1])->postJson('/api/riders/offers/'.$secondOffer->id.'/accept')->assertStatus(409);
        $this->assertDatabaseHas('deliveries', ['id' => $secondDelivery->id, 'rider_id' => $riders[1]->id, 'status' => DeliveryStatus::RIDER_OFFERED->value]);
    }
}
