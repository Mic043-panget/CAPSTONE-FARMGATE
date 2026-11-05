<?php

namespace Tests\Feature;

use App\Enums\DeliveryStatus;
use App\Enums\InterestStatus;
use App\Enums\ListingStatus;
use App\Enums\OrderStatus;
use App\Enums\PricingType;
use App\Enums\Role;
use App\Models\Category;
use App\Models\Delivery;
use App\Models\DeliveryStatusHistory;
use App\Models\Interest;
use App\Models\LivestockListing;
use App\Models\Order;
use App\Models\RiderOffer;
use App\Models\RiderProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DashboardTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_user_listing_can_filter_verified_accounts_with_role_filter(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $verifiedBuyer = User::factory()->create(['role' => Role::BUYER]);
        User::factory()->unverified()->create(['role' => Role::BUYER]);
        User::factory()->create(['role' => Role::SELLER]);

        $verifiedResponse = $this->actingAs($admin)->getJson('/api/admin/users?role=BUYER&verified=1')
            ->assertOk()
            ->assertJsonCount(1, 'users.data');
        $this->assertSame($verifiedBuyer->id, $verifiedResponse->json('users.data.0.id'));
        $this->assertNotNull($verifiedResponse->json('users.data.0.email_verified_at'));

        $this->actingAs($admin)->getJson('/api/admin/users?role=BUYER')
            ->assertOk()
            ->assertJsonCount(2, 'users.data');
    }

    public function test_seller_dashboard_returns_metrics(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $category = Category::create(['name' => 'Cattle', 'slug' => 'cattle']);

        LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Cattle A',
            'quantity' => 2,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 500,
            'status' => ListingStatus::ACTIVE,
        ]);

        $completed = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::COMPLETED,
            'total_amount' => 500,
        ]);
        $pending = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::PENDING_CONFIRMATION,
            'total_amount' => 300,
        ]);

        $this->actingAs($seller)->getJson('/api/dashboard/seller')
            ->assertOk()
            ->assertJsonPath('summary.total_completed_sales', '500.00')
            ->assertJsonPath('summary.pending_orders', 1)
            ->assertJsonPath('summary.active_listings', 1)
            ->assertJsonPath('summary.interested_buyers', 0);
    }

    public function test_buyer_dashboard_returns_account_summary(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $category = Category::create(['name' => 'Swine', 'slug' => 'swine']);
        $listing = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Piglet',
            'quantity' => 3,
            'pricing_type' => PricingType::PER_KILO,
            'price_per_kilo' => 180,
            'status' => ListingStatus::ACTIVE,
        ]);
        Interest::create([
            'buyer_id' => $buyer->id,
            'livestock_listing_id' => $listing->id,
            'status' => InterestStatus::INTERESTED,
        ]);
        Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::CONFIRMED,
            'total_amount' => 360,
        ]);

        $this->actingAs($buyer)->getJson('/api/dashboard/buyer')
            ->assertOk()
            ->assertJsonPath('summary.interested_listings', 1)
            ->assertJsonPath('summary.active_orders', 1)
            ->assertJsonPath('summary.purchase_history.0.total_amount', '360.00');
    }

    public function test_rider_dashboard_returns_work_queue(): void
    {
        $rider = User::factory()->create(['role' => Role::RIDER]);
        RiderProfile::create([
            'user_id' => $rider->id,
            'phone' => '09170000000',
            'vehicle_type' => 'motorbike',
            'availability' => 'AVAILABLE',
            'is_verified' => true,
            'latitude' => 14.120,
            'longitude' => 120.450,
            'last_location_at' => now(),
        ]);
        $delivery = Delivery::create([
            'order_id' => Order::create([
                'buyer_id' => User::factory()->create(['role' => Role::BUYER])->id,
                'seller_id' => User::factory()->create(['role' => Role::SELLER])->id,
                'status' => OrderStatus::READY_FOR_PICKUP,
                'total_amount' => 220,
            ])->id,
            'rider_id' => $rider->id,
            'status' => DeliveryStatus::RIDER_ACCEPTED,
            'pickup_latitude' => 14.122,
            'pickup_longitude' => 120.442,
            'pickup_address' => 'Bongabong Market',
            'qr_token' => 'ride-1',
        ]);
        $offerDelivery = Delivery::create([
            'order_id' => Order::create([
                'buyer_id' => User::factory()->create(['role' => Role::BUYER])->id,
                'seller_id' => User::factory()->create(['role' => Role::SELLER])->id,
                'status' => OrderStatus::READY_FOR_PICKUP,
                'delivery_method' => 'STANDARD_DELIVERY',
                'payment_method' => 'COD',
                'total_amount' => 180,
            ])->id,
            'rider_id' => $rider->id,
            'status' => DeliveryStatus::RIDER_OFFERED,
            'pickup_latitude' => 14.122,
            'pickup_longitude' => 120.442,
        ]);
        RiderOffer::create([
            'delivery_id' => $offerDelivery->id,
            'rider_id' => $rider->id,
            'status' => 'OPEN',
            'distance_km' => 1.2,
            'expires_at' => now()->addMinutes(10),
        ]);

        $this->actingAs($rider)->getJson('/api/dashboard/rider')
            ->assertOk()
            ->assertJsonPath('summary.availability', 'AVAILABLE')
            ->assertJsonPath('summary.pending_offers', 1)
            ->assertJsonPath('summary.active_assignments', 1);
    }

    public function test_rider_dashboard_analytics_are_filtered_and_scoped_to_the_authenticated_rider(): void
    {
        $rider = User::factory()->create(['role' => Role::RIDER]);
        $otherRider = User::factory()->create(['role' => Role::RIDER]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $deliveredOrder = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::COMPLETED,
            'total_amount' => 500,
            'shipping_address' => [
                'recipient_name' => 'Private Buyer',
                'street_address' => 'Private Street 12',
                'barangay' => 'Poblacion',
                'city_municipality' => 'Bongabong',
                'province' => 'Oriental Mindoro',
            ],
        ]);
        $delivered = Delivery::create([
            'order_id' => $deliveredOrder->id,
            'rider_id' => $rider->id,
            'status' => DeliveryStatus::DELIVERED,
            'pickup_verified_at' => now()->subMinutes(45),
            'delivery_verified_at' => now()->subMinutes(15),
            'assigned_at' => now()->subHour(),
            'assigned_at' => now()->subHour(),
        ]);
        DeliveryStatusHistory::create([
            'delivery_id' => $delivered->id,
            'changed_by' => $rider->id,
            'from_status' => DeliveryStatus::IN_TRANSIT->value,
            'to_status' => DeliveryStatus::DELIVERED->value,
            'reason' => 'Verified delivery',
            'created_at' => now()->subMinutes(15),
        ]);

        $cancelledOrder = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::CANCELLED,
            'total_amount' => 200,
        ]);
        Delivery::create([
            'order_id' => $cancelledOrder->id,
            'rider_id' => $rider->id,
            'status' => DeliveryStatus::CANCELLED,
        ]);
        $foreignOrder = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::COMPLETED,
            'total_amount' => 800,
        ]);
        Delivery::create([
            'order_id' => $foreignOrder->id,
            'rider_id' => $otherRider->id,
            'status' => DeliveryStatus::DELIVERED,
        ]);

        $today = now()->toDateString();
        $this->actingAs($rider)->getJson('/api/dashboard/rider?from='.$today.'&to='.$today.'&status=DELIVERED')
            ->assertOk()
            ->assertJsonPath('summary.delivered', 1)
            ->assertJsonPath('summary.cancellations', 0)
            ->assertJsonPath('summary.average_delivery_minutes', 30)
            ->assertJsonPath('summary.filtered_deliveries', 1)
            ->assertJsonPath('status_counts.DELIVERED', 1)
            ->assertJsonPath('deliveries.data.0.id', $delivered->id)
            ->assertJsonPath('deliveries.data.0.dropoff_area', 'Poblacion, Bongabong, Oriental Mindoro')
            ->assertJsonPath('recent_activity.0.to_status', DeliveryStatus::DELIVERED->value)
            ->assertJsonMissing(['recipient_name' => 'Private Buyer'])
            ->assertJsonMissing(['street_address' => 'Private Street 12']);

        $this->actingAs($rider)->getJson('/api/dashboard/rider?from='.$today.'&to='.$today)
            ->assertOk()
            ->assertJsonPath('summary.cancellations', 1)
            ->assertJsonPath('summary.accepted', 1)
            ->assertJsonPath('summary.filtered_deliveries', 2)
            ->assertJsonPath('status_counts.CANCELLED', 1);
    }

    public function test_rider_delivery_report_is_scoped_redacted_and_validates_status_filters(): void
    {
        $rider = User::factory()->create(['role' => Role::RIDER]);
        $otherRider = User::factory()->create(['role' => Role::RIDER]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::COMPLETED,
            'total_amount' => 350,
            'shipping_address' => [
                'recipient_name' => 'Secret Recipient',
                'phone_number' => '09123456789',
                'street_address' => 'Exact House and Street',
                'barangay' => 'Cawayan',
                'city_municipality' => 'Bongabong',
                'province' => 'Oriental Mindoro',
            ],
        ]);
        $pickupVerifiedAt = now()->subMinutes(40);
        $deliveryVerifiedAt = now()->subMinutes(10);
        $ownDelivery = Delivery::create([
            'order_id' => $order->id,
            'rider_id' => $rider->id,
            'status' => DeliveryStatus::DELIVERED,
            'assigned_at' => now()->subHour(),
            'pickup_verified_at' => $pickupVerifiedAt,
            'delivery_verified_at' => $deliveryVerifiedAt,
            'pickup_latitude' => 12.3456,
            'pickup_longitude' => 121.1234,
        ]);
        $foreignOrder = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::COMPLETED,
            'total_amount' => 900,
        ]);
        Delivery::create([
            'order_id' => $foreignOrder->id,
            'rider_id' => $otherRider->id,
            'status' => DeliveryStatus::DELIVERED,
        ]);

        $this->actingAs($rider)->getJson('/api/reports/deliveries?status=DELIVERED&sort=order_reference&direction=asc')
            ->assertOk()
            ->assertJsonCount(1, 'data.data')
            ->assertJsonPath('data.data.0.id', $ownDelivery->id)
            ->assertJsonPath('data.data.0.dropoff_area', 'Cawayan, Bongabong, Oriental Mindoro')
            ->assertJsonPath('data.data.0.pickup_verified_at', $ownDelivery->fresh()->pickup_verified_at->toISOString())
            ->assertJsonMissing(['street_address' => 'Exact House and Street'])
            ->assertJsonMissing(['rider_location_latitude' => 12.3456]);

        $this->actingAs($rider)->getJson('/api/reports/deliveries?status=NOT_A_DELIVERY_STATUS')
            ->assertUnprocessable();
    }

    public function test_admin_dashboard_returns_monitoring_summary(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        User::factory()->create(['role' => Role::RIDER]);
        Category::create(['name' => 'Goat', 'slug' => 'goat']);
        LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => Category::query()->value('id'),
            'name' => 'Goat 1',
            'quantity' => 1,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 1500,
            'status' => ListingStatus::ACTIVE,
        ]);
        Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::COMPLETED,
            'total_amount' => 1500,
        ]);

        $this->actingAs($admin)->getJson('/api/dashboard/admin')
            ->assertOk()
            ->assertJsonPath('summary.total_users', 4)
            ->assertJsonPath('summary.total_orders', 1)
            ->assertJsonPath('summary.active_listings', 1);
    }
}
