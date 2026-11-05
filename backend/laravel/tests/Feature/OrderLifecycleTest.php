<?php

namespace Tests\Feature;

use App\Enums\DeliveryStatus;
use App\Enums\ListingStatus;
use App\Enums\OrderStatus;
use App\Enums\PricingType;
use App\Enums\Role;
use App\Models\AuditLog;
use App\Models\Category;
use App\Models\Delivery;
use App\Models\LivestockListing;
use App\Models\Order;
use App\Models\RiderOffer;
use App\Models\RiderProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class OrderLifecycleTest extends TestCase
{
    use RefreshDatabase;

    public function test_checkout_to_qr_verified_delivery_is_role_scoped_and_keeps_states_separate(): void
    {
        Storage::fake('delivery_proofs');
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $rider = User::factory()->create(['role' => Role::RIDER]);
        $otherBuyer = User::factory()->create(['role' => Role::BUYER]);

        $seller->sellerProfile()->create([
            'latitude' => 12.7771,
            'longitude' => 121.3654,
            'address' => 'Seller pickup point',
        ]);
        RiderProfile::create([
            'user_id' => $rider->id,
            'phone' => '09170000999',
            'vehicle_type' => 'motorbike',
            'availability' => 'AVAILABLE',
            'is_verified' => true,
            'latitude' => 12.7772,
            'longitude' => 121.3655,
            'last_location_at' => now(),
        ]);
        $category = Category::create(['name' => 'Goat', 'slug' => 'goat']);
        $listing = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Bongabong Goat',
            'quantity' => 2,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 200,
            'status' => ListingStatus::ACTIVE,
        ]);

        $checkout = $this->actingAs($buyer)->postJson('/api/checkout', [
            'listing_id' => $listing->id,
            'quantity' => 1,
            'delivery_method' => 'STANDARD_DELIVERY',
            'payment_method' => 'COD',
            'shipping_address' => [
                'recipient_name' => 'Buyer Name',
                'phone_number' => '09123456789',
                'province' => 'Oriental Mindoro',
                'city_municipality' => 'Bongabong',
                'barangay' => 'Cawayan',
                'postal_code' => '5211',
                'street_address' => 'Private Buyer Street',
                'latitude' => 12.778,
                'longitude' => 121.366,
            ],
        ])->assertOk()
            ->assertJsonPath('order.status', OrderStatus::PENDING_CONFIRMATION->value)
            ->assertJsonPath('order.items.0.unit_price', '200.00')
            ->assertJsonPath('order.items.0.total_amount', '200.00');
        $order = Order::query()->findOrFail($checkout->json('order.id'));
        $delivery = Delivery::query()->where('order_id', $order->id)->firstOrFail();
        $this->assertSame(DeliveryStatus::WAITING_FOR_RIDER, $delivery->status);
        $this->assertDatabaseCount('rider_offers', 0);
        $checkoutAudit = AuditLog::query()->where('route', 'api/checkout')->latest('id')->firstOrFail();
        $this->assertStringNotContainsString('Private Buyer Street', json_encode($checkoutAudit->toArray()));
        $this->assertStringNotContainsString('09123456789', json_encode($checkoutAudit->toArray()));

        $this->actingAs($seller)->patchJson('/api/orders/'.$order->id.'/status', [
            'status' => OrderStatus::CONFIRMED->value,
        ])->assertOk();
        $this->actingAs($seller)->patchJson('/api/orders/'.$order->id.'/status', [
            'status' => OrderStatus::PREPARING->value,
        ])->assertOk();
        $this->actingAs($seller)->patchJson('/api/orders/'.$order->id.'/status', [
            'status' => OrderStatus::READY_FOR_PICKUP->value,
        ])->assertOk()
            ->assertJsonPath('delivery.status', DeliveryStatus::RIDER_OFFERED->value);

        $offer = RiderOffer::query()->where('delivery_id', $delivery->id)->firstOrFail();
        $this->actingAs($rider)->postJson('/api/riders/offers/'.$offer->id.'/accept')
            ->assertOk()
            ->assertJsonPath('delivery.status', DeliveryStatus::RIDER_ACCEPTED->value);
        $this->assertSame($rider->id, $delivery->fresh()->rider_id);

        $pickupCode = $this->actingAs($seller)->postJson('/api/orders/'.$order->id.'/delivery-code')
            ->assertOk()
            ->json('code');
        $this->assertMatchesRegularExpression('/^FARMGATE:PICKUP:[A-Za-z0-9]{64}$/', $pickupCode);
        preg_match('/^FARMGATE:PICKUP:([A-Za-z0-9]{64})$/', $pickupCode, $pickupMatch);
        $this->actingAs($rider)->postJson('/api/deliveries/'.$delivery->id.'/pickup-verify', [
            'qr_token' => $pickupMatch[1],
            'latitude' => 12.7771,
            'longitude' => 121.3654,
        ])->assertOk()
            ->assertJsonPath('delivery.status', DeliveryStatus::PICKED_UP->value);

        $this->actingAs($seller)->patchJson('/api/orders/'.$order->id.'/status', [
            'status' => OrderStatus::FULFILLING->value,
        ])->assertOk()
            ->assertJsonPath('order.status', OrderStatus::FULFILLING->value);
        $this->assertSame(DeliveryStatus::PICKED_UP, $delivery->fresh()->status);
        $deliveryCode = $this->actingAs($buyer)->postJson('/api/orders/'.$order->id.'/delivery-code')
            ->assertOk()
            ->json('code');
        $this->assertMatchesRegularExpression('/^FARMGATE:DELIVERY:[A-Za-z0-9]{64}$/', $deliveryCode);
        preg_match('/^FARMGATE:DELIVERY:([A-Za-z0-9]{64})$/', $deliveryCode, $deliveryMatch);
        $this->actingAs($rider)->post('/api/deliveries/'.$delivery->id.'/delivery-verify', [
            'qr_token' => $deliveryMatch[1],
            'photo' => UploadedFile::fake()->image('delivery.jpg'),
            'recipient_confirmed' => '1',
            'recipient_name' => 'Buyer',
            'captured_at' => now()->toISOString(),
        ])->assertOk()
            ->assertJsonPath('delivery.status', DeliveryStatus::DELIVERED->value);

        $this->assertSame(OrderStatus::FULFILLING, $order->fresh()->status);
        $this->actingAs($seller)->patchJson('/api/orders/'.$order->id.'/status', [
            'status' => OrderStatus::COMPLETED->value,
        ])->assertOk()->assertJsonPath('order.status', OrderStatus::COMPLETED->value);
        $this->assertSame(DeliveryStatus::DELIVERED, $delivery->fresh()->status);

        $this->actingAs($buyer)->getJson('/api/orders/'.$order->id)->assertOk();
        $this->actingAs($otherBuyer)->getJson('/api/orders/'.$order->id)->assertForbidden();
        $this->actingAs($rider)->getJson('/api/orders')->assertForbidden();

        $this->actingAs($rider)->getJson('/api/dashboard/rider')
            ->assertOk()
            ->assertJsonPath('summary.delivered', 1);
        $this->actingAs($seller)->getJson('/api/dashboard/seller')
            ->assertOk()
            ->assertJsonPath('summary.completed_orders', 1);
        $this->actingAs($buyer)->getJson('/api/dashboard/buyer')
            ->assertOk()
            ->assertJsonPath('summary.active_orders', 0);
        $this->actingAs($rider)->getJson('/api/reports/deliveries')
            ->assertOk()
            ->assertJsonPath('data.data.0.status', DeliveryStatus::DELIVERED->value)
            ->assertJsonMissing(['street_address' => 'Private Buyer Street']);
        $this->actingAs($otherBuyer)->getJson('/api/reports/deliveries')
            ->assertOk()
            ->assertJsonPath('summary.total', 0);
    }
}
