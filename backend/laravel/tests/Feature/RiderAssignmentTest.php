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
            ->assertOk()->assertJsonPath('delivery.status', DeliveryStatus::RIDER_OFFERED->value);
        $initialOffer = RiderOffer::query()->where('delivery_id', $delivery->id)->firstOrFail();
        $this->assertSame($riders[0]->id, $initialOffer->rider_id);

        $this->actingAs($outsider)->postJson('/api/riders/offers/'.$initialOffer->id.'/decline')
            ->assertForbidden();
        $this->assertSame('OPEN', $initialOffer->fresh()->status);

        $this->actingAs($riders[0])->postJson('/api/riders/offers/'.$initialOffer->id.'/decline')
            ->assertOk()
            ->assertJsonPath('message', 'Delivery offer declined.')
            ->assertJsonPath('delivery.status', DeliveryStatus::SEARCHING_FOR_RIDER->value);
        $this->assertDatabaseHas('rider_offers', ['id' => $initialOffer->id, 'status' => 'DECLINED']);
        $nextOffer = RiderOffer::query()
            ->where('delivery_id', $delivery->id)
            ->where('rider_id', $riders[1]->id)
            ->firstOrFail();
        $this->assertSame('OPEN', $nextOffer->status);
        $this->assertNull($nextOffer->expires_at);

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

    public function test_standard_delivery_starts_with_one_eight_hour_offer_then_broadcasts_to_other_available_riders(): void
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

        app(RiderAssignmentService::class)->dispatchForOrder($order->id);
        $initialOffer = RiderOffer::query()->where('delivery_id', $delivery->id)->firstOrFail();

        $this->assertSame($riders[0]->id, $initialOffer->rider_id);
        $this->assertSame(now()->addHours(8)->timestamp, $initialOffer->expires_at->timestamp);
        $this->assertSame(DeliveryStatus::RIDER_OFFERED, $delivery->refresh()->status);

        $this->travel(8)->hours();
        RiderProfile::query()->whereIn('user_id', $riders->pluck('id'))->update(['last_location_at' => now()]);
        app(RiderAssignmentService::class)->processPendingDeliveries();

        $this->assertSame(DeliveryStatus::SEARCHING_FOR_RIDER, $delivery->refresh()->status);
        $this->assertDatabaseHas('rider_offers', ['id' => $initialOffer->id, 'status' => 'EXPIRED']);
        $broadcastOffers = RiderOffer::query()->where('delivery_id', $delivery->id)->where('status', 'OPEN')->get();
        $this->assertCount(2, $broadcastOffers);
        $this->assertEqualsCanonicalizing($riders->slice(1)->pluck('id')->all(), $broadcastOffers->pluck('rider_id')->all());
        $this->assertNull($broadcastOffers->first()->expires_at);
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
        $this->travel(8)->hours();
        RiderProfile::query()->whereIn('user_id', $riders->pluck('id'))->update(['last_location_at' => now()]);
        $assignment->processPendingDeliveries();
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
