<?php

namespace Tests\Feature;

use App\Enums\DeliveryStatus;
use App\Enums\OrderStatus;
use App\Enums\Role;
use App\Models\AuditLog;
use App\Models\Delivery;
use App\Models\Order;
use App\Models\RiderProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class DeliveryTrackingTest extends TestCase
{
    use RefreshDatabase;

    public function test_rider_can_update_location_and_tracking_view_returns_map_metadata(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $rider = User::factory()->create(['role' => Role::RIDER]);

        RiderProfile::create([
            'user_id' => $rider->id,
            'phone' => '09170000001',
            'vehicle_type' => 'motorbike',
            'availability' => 'AVAILABLE',
            'is_verified' => true,
            'latitude' => 14.118,
            'longitude' => 120.430,
            'last_location_at' => now(),
        ]);

        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::READY_FOR_PICKUP,
            'total_amount' => 220,
        ]);

        $delivery = Delivery::create([
            'order_id' => $order->id,
            'rider_id' => $rider->id,
            'status' => DeliveryStatus::RIDER_ACCEPTED,
            'pickup_latitude' => 14.120,
            'pickup_longitude' => 120.440,
            'pickup_address' => 'Bongabong Public Market',
            'qr_token' => 'pickup-abc-123',
        ]);

        $capturedAt = now();
        $this->actingAs($rider)->postJson('/api/deliveries/'.$delivery->id.'/location?reported_pin=14.119', [
            'latitude' => 14.119,
            'longitude' => 120.435,
            'observed_at' => $capturedAt->toISOString(),
        ])->assertOk();
        $this->assertNotNull($delivery->fresh()->rider_location_captured_at);
        $storedCapturedAt = $delivery->fresh()->rider_location_captured_at;
        $locationAudit = AuditLog::query()
            ->where('route', 'api/deliveries/{delivery}/location')
            ->latest('id')
            ->firstOrFail();
        $this->assertStringNotContainsString('14.119', json_encode($locationAudit->toArray()));
        $this->assertStringNotContainsString('120.435', json_encode($locationAudit->toArray()));
        $this->assertStringNotContainsString('reported_pin', $locationAudit->request_url);

        $this->actingAs($rider)->postJson('/api/deliveries/'.$delivery->id.'/location', [
            'latitude' => 14.110,
            'longitude' => 120.420,
            'observed_at' => $storedCapturedAt->toISOString(),
        ])->assertStatus(409);
        $this->actingAs($rider)->postJson('/api/deliveries/'.$delivery->id.'/location', [
            'latitude' => 14.110,
            'longitude' => 120.420,
            'observed_at' => $storedCapturedAt->copy()->subSecond()->toISOString(),
        ])->assertStatus(409);

        $this->assertSame(14.119, $delivery->fresh()->rider_location_latitude);
        $this->actingAs($seller)->getJson('/api/deliveries/'.$delivery->id.'/tracking')
            ->assertOk()
            ->assertJsonPath('delivery.status', DeliveryStatus::RIDER_ACCEPTED->value)
            ->assertJsonPath('delivery.rider_location_latitude', 14.119)
            ->assertJsonPath('map.provider', 'leaflet-openstreetmap')
            ->assertJsonPath('route.distance_km', 0.6);
    }

    public function test_buyer_orders_include_delivery_status_for_order_history_filters(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::COMPLETED,
            'total_amount' => 220,
        ]);
        Delivery::create([
            'order_id' => $order->id,
            'status' => DeliveryStatus::DELIVERED,
            'pickup_address' => 'Bongabong Public Market',
        ]);

        $this->actingAs($buyer)->getJson('/api/orders')
            ->assertOk()
            ->assertJsonPath('orders.0.status', OrderStatus::COMPLETED->value)
            ->assertJsonPath('orders.0.delivery.status', DeliveryStatus::DELIVERED->value);
    }

    public function test_rider_can_verify_pickup_and_complete_delivery_with_qr_token(): void
    {
        Storage::fake('delivery_proofs');
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $rider = User::factory()->create(['role' => Role::RIDER]);

        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::READY_FOR_PICKUP,
            'total_amount' => 220,
            'delivery_method' => 'STANDARD_DELIVERY',
            'shipping_address' => [
                'latitude' => 14.121,
                'longitude' => 120.441,
                'recipient_name' => 'Buyer',
            ],
        ]);

        $pickupToken = str_repeat('P', 64);
        $deliveryToken = str_repeat('D', 64);
        $delivery = Delivery::create([
            'order_id' => $order->id,
            'rider_id' => $rider->id,
            'status' => DeliveryStatus::RIDER_ACCEPTED,
            'pickup_latitude' => 14.120,
            'pickup_longitude' => 120.440,
            'pickup_address' => 'Bongabong Public Market',
            'pickup_qr_token_hash' => hash('sha256', $pickupToken),
            'pickup_qr_expires_at' => now()->addMinutes(30),
        ]);

        $this->actingAs($rider)->postJson('/api/deliveries/'.$delivery->id.'/pickup-verify', [
            'qr_token' => $pickupToken,
            'latitude' => 14.120,
            'longitude' => 120.440,
        ])->assertOk()->assertJsonPath('delivery.status', DeliveryStatus::PICKED_UP->value);
        $this->actingAs($rider)->postJson('/api/deliveries/'.$delivery->id.'/pickup-verify', [
            'qr_token' => $pickupToken,
            'latitude' => 14.120,
            'longitude' => 120.440,
        ])->assertStatus(409);

        $order->forceFill(['status' => OrderStatus::FULFILLING])->save();
        $this->actingAs($seller)->patchJson('/api/orders/'.$order->id.'/status', [
            'status' => OrderStatus::COMPLETED->value,
        ])->assertStatus(409);
        $delivery->refresh()->forceFill([
            'delivery_qr_token_hash' => hash('sha256', $deliveryToken),
            'delivery_qr_expires_at' => now()->addMinutes(30),
        ])->save();
        $this->actingAs($rider)->post('/api/deliveries/'.$delivery->id.'/delivery-verify', [
            'qr_token' => $deliveryToken,
            'photo' => UploadedFile::fake()->image('delivery.jpg'),
            'recipient_confirmed' => '1',
            'recipient_name' => 'Buyer',
            'captured_at' => now()->toISOString(),
        ])->assertOk()->assertJsonPath('delivery.status', DeliveryStatus::DELIVERED->value);

        $this->assertNotNull($delivery->refresh()->pickup_verified_at);
        $this->assertNotNull($delivery->delivery_verified_at);
        $this->assertEquals(14.120, $delivery->pickup_verification_latitude);
        $this->assertEquals(120.440, $delivery->pickup_verification_longitude);
        $this->assertNull($delivery->delivery_verification_latitude);
        $this->assertNull($delivery->delivery_verification_longitude);
        $this->assertTrue($delivery->recipient_confirmed);
        $this->assertSame('Buyer', $delivery->delivery_recipient_name);
        $this->assertNotNull($delivery->proof_captured_at);
        $this->assertNotNull($delivery->proof_recorded_at);
        $this->assertNotNull($delivery->delivery_proof_sha256);
        Storage::disk('delivery_proofs')->assertExists($delivery->delivery_proof_path);
        $this->assertNull($delivery->pickup_qr_token_hash);
        $this->assertNull($delivery->delivery_qr_token_hash);
        $this->assertSame(2, $delivery->statusHistory()->count());
        $this->assertSame('PICKUP_QR_VERIFIED', $delivery->statusHistory()->reorder('id')->value('reason'));
        $this->actingAs($seller)->patchJson('/api/orders/'.$order->id.'/status', [
            'status' => OrderStatus::COMPLETED->value,
        ])->assertOk()->assertJsonPath('order.status', OrderStatus::COMPLETED->value);
        $this->assertSame(DeliveryStatus::DELIVERED, $delivery->fresh()->status);
    }

    public function test_qr_verification_rejects_wrong_distance_expired_codes_and_replay(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $rider = User::factory()->create(['role' => Role::RIDER]);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::READY_FOR_PICKUP,
            'total_amount' => 220,
            'delivery_method' => 'STANDARD_DELIVERY',
            'shipping_address' => ['latitude' => 14.121, 'longitude' => 120.441],
        ]);
        $token = str_repeat('X', 64);
        $delivery = Delivery::create([
            'order_id' => $order->id,
            'rider_id' => $rider->id,
            'status' => DeliveryStatus::RIDER_ACCEPTED,
            'pickup_latitude' => 14.120,
            'pickup_longitude' => 120.440,
            'pickup_qr_token_hash' => hash('sha256', $token),
            'pickup_qr_expires_at' => now()->addMinutes(30),
        ]);

        $this->actingAs($rider)->postJson('/api/deliveries/'.$delivery->id.'/pickup-verify', [
            'qr_token' => $token,
            'latitude' => 14.125,
            'longitude' => 120.440,
        ])->assertUnprocessable();
        $this->assertSame(DeliveryStatus::RIDER_ACCEPTED, $delivery->refresh()->status);

        $delivery->forceFill(['pickup_qr_expires_at' => now()->subSecond()])->save();
        $this->actingAs($rider)->postJson('/api/deliveries/'.$delivery->id.'/pickup-verify', [
            'qr_token' => $token,
            'latitude' => 14.120,
            'longitude' => 120.440,
        ])->assertUnprocessable();
        $this->assertSame(DeliveryStatus::RIDER_ACCEPTED, $delivery->refresh()->status);
    }

    public function test_dropoff_verification_fails_closed_when_buyer_pin_is_missing(): void
    {
        Storage::fake('delivery_proofs');
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $rider = User::factory()->create(['role' => Role::RIDER]);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::READY_FOR_PICKUP,
            'total_amount' => 220,
            'delivery_method' => 'STANDARD_DELIVERY',
        ]);
        $pickupToken = str_repeat('A', 64);
        $dropoffToken = str_repeat('B', 64);
        $delivery = Delivery::create([
            'order_id' => $order->id,
            'rider_id' => $rider->id,
            'status' => DeliveryStatus::RIDER_ACCEPTED,
            'pickup_latitude' => 14.120,
            'pickup_longitude' => 120.440,
            'pickup_qr_token_hash' => hash('sha256', $pickupToken),
            'pickup_qr_expires_at' => now()->addMinutes(30),
        ]);

        $this->actingAs($rider)->postJson('/api/deliveries/'.$delivery->id.'/pickup-verify', [
            'qr_token' => $pickupToken,
            'latitude' => 14.120,
            'longitude' => 120.440,
        ])->assertOk();
        $order->forceFill(['status' => OrderStatus::FULFILLING])->save();
        $delivery->refresh()->forceFill([
            'delivery_qr_token_hash' => hash('sha256', $dropoffToken),
            'delivery_qr_expires_at' => now()->addMinutes(30),
        ])->save();

        $this->actingAs($rider)->post('/api/deliveries/'.$delivery->id.'/delivery-verify', [
            'qr_token' => $dropoffToken,
            'latitude' => 14.120,
            'longitude' => 120.440,
            'photo' => UploadedFile::fake()->image('delivery.jpg'),
            'recipient_confirmed' => '1',
            'recipient_name' => 'Buyer',
            'captured_at' => now()->toISOString(),
        ])->assertUnprocessable();
        $this->assertSame(DeliveryStatus::PICKED_UP, $delivery->refresh()->status);
        $this->assertNull($delivery->delivery_verified_at);
    }

    public function test_only_order_participants_can_issue_purpose_specific_delivery_codes(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $otherBuyer = User::factory()->create(['role' => Role::BUYER]);
        $rider = User::factory()->create(['role' => Role::RIDER]);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::READY_FOR_PICKUP,
            'total_amount' => 220,
            'delivery_method' => 'STANDARD_DELIVERY',
        ]);
        Delivery::create([
            'order_id' => $order->id,
            'rider_id' => $rider->id,
            'status' => DeliveryStatus::RIDER_ACCEPTED,
            'pickup_latitude' => 14.120,
            'pickup_longitude' => 120.440,
        ]);

        $response = $this->actingAs($seller)->postJson('/api/orders/'.$order->id.'/delivery-code')
            ->assertOk()->assertJsonPath('purpose', 'pickup');
        $this->assertStringStartsWith('FARMGATE:PICKUP:', $response->json('code'));
        $this->actingAs($seller)->getJson('/api/orders/'.$order->id)
            ->assertOk()
            ->assertJsonMissingPath('order.delivery.pickup_qr_token_hash')
            ->assertJsonMissingPath('order.delivery.qr_token');
        Delivery::query()->where('order_id', $order->id)->update(['status' => DeliveryStatus::PICKED_UP->value]);
        $order->forceFill(['status' => OrderStatus::FULFILLING])->save();
        $buyerCode = $this->actingAs($buyer)->postJson('/api/orders/'.$order->id.'/delivery-code')
            ->assertOk()->assertJsonPath('purpose', 'delivery');
        $this->assertStringStartsWith('FARMGATE:DELIVERY:', $buyerCode->json('code'));
        $this->actingAs($otherBuyer)->postJson('/api/orders/'.$order->id.'/delivery-code')->assertForbidden();
    }

    public function test_rider_delivery_search_and_status_filter_are_scoped_and_paginated(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER, 'name' => 'Local Buyer']);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $rider = User::factory()->create(['role' => Role::RIDER]);
        $otherRider = User::factory()->create(['role' => Role::RIDER]);
        foreach ([
            [$rider, DeliveryStatus::RIDER_ACCEPTED],
            [$rider, DeliveryStatus::PICKED_UP],
            [$otherRider, DeliveryStatus::RIDER_ACCEPTED],
        ] as [$assignedRider, $status]) {
            $order = Order::create([
                'buyer_id' => $buyer->id,
                'seller_id' => $seller->id,
                'status' => OrderStatus::READY_FOR_PICKUP,
                'total_amount' => 220,
            ]);
            Delivery::create(['order_id' => $order->id, 'rider_id' => $assignedRider->id, 'status' => $status]);
        }

        $this->actingAs($rider)->getJson('/api/riders/deliveries?search=Local%20Buyer&status=PICKED_UP&per_page=1')
            ->assertOk()
            ->assertJsonPath('deliveries.total', 1)
            ->assertJsonPath('deliveries.data.0.status', DeliveryStatus::PICKED_UP->value);
    }
}
