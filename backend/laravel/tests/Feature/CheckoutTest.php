<?php

namespace Tests\Feature;

use App\Enums\ListingStatus;
use App\Enums\OrderStatus;
use App\Enums\PricingType;
use App\Enums\Role;
use App\Models\Category;
use App\Models\LivestockListing;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\SystemSetting;
use App\Models\User;
use App\Services\SystemSettingsService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class CheckoutTest extends TestCase
{
    use RefreshDatabase;

    public function test_buyer_can_add_items_to_cart_and_view_them(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $category = Category::create(['name' => 'Goat', 'slug' => 'goat']);
        $listing = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Boer Goat',
            'quantity' => 4,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 6000,
            'status' => ListingStatus::ACTIVE,
        ]);

        $this->actingAs($buyer)->postJson('/api/cart/items', [
            'listing_id' => $listing->id,
            'quantity' => 2,
        ])->assertOk()->assertJsonPath('cart.items.0.quantity', 2);

        $this->actingAs($buyer)->getJson('/api/cart')
            ->assertOk()
            ->assertJsonCount(1, 'items');
    }

    public function test_buyer_can_update_and_remove_cart_items_without_exceeding_available_stock(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $category = Category::create(['name' => 'Goat', 'slug' => 'goat']);
        $listing = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Boer Goat',
            'quantity' => 3,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 6000,
            'status' => ListingStatus::ACTIVE,
        ]);

        $this->actingAs($buyer)->postJson('/api/cart/items', ['listing_id' => $listing->id, 'quantity' => 2])->assertOk();
        $this->actingAs($buyer)->postJson('/api/cart/items', ['listing_id' => $listing->id, 'quantity' => 2])->assertUnprocessable();

        $itemId = $this->actingAs($buyer)->getJson('/api/cart')->assertOk()->json('items.0.id');
        $this->actingAs($buyer)->patchJson('/api/cart/items/'.$itemId, ['quantity' => 3])->assertOk()->assertJsonPath('items.0.quantity', 3);
        $this->actingAs($buyer)->patchJson('/api/cart/items/'.$itemId, ['quantity' => 4])->assertUnprocessable();
        $this->actingAs($buyer)->deleteJson('/api/cart/items/'.$itemId)->assertOk()->assertJsonCount(0, 'items');
    }

    public function test_checkout_applies_selected_kilograms_and_head_count_to_quote_and_order(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $category = Category::create(['name' => 'Livestock', 'slug' => 'livestock']);
        $pork = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Native Pork',
            'quantity' => 20,
            'pricing_type' => PricingType::PER_KILO,
            'price_per_kilo' => 220,
            'status' => ListingStatus::ACTIVE,
        ]);
        $goat = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Boer Goat',
            'quantity' => 5,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 6000,
            'status' => ListingStatus::ACTIVE,
        ]);

        $this->actingAs($buyer)->postJson('/api/cart/items', ['listing_id' => $pork->id, 'quantity' => 1])->assertOk();
        $this->actingAs($buyer)->postJson('/api/cart/items', ['listing_id' => $goat->id, 'quantity' => 1])->assertOk();
        $cartItems = $this->actingAs($buyer)->getJson('/api/cart')->assertOk()->json('items');
        $selectedQuantities = collect($cartItems)->map(fn (array $item): array => [
            'cart_item_id' => $item['id'],
            'quantity' => $item['listing_id'] === $pork->id ? 5 : 3,
        ])->all();

        $this->actingAs($buyer)->postJson('/api/checkout/quote', [
            'items' => $selectedQuantities,
            'delivery_method' => 'SELF_PICKUP',
        ])->assertOk()->assertJsonPath('subtotal', '19100.00');

        $checkout = $this->actingAs($buyer)->postJson('/api/checkout', [
            'items' => $selectedQuantities,
            'delivery_method' => 'SELF_PICKUP',
        ])->assertOk()
            ->assertJsonPath('order.subtotal_amount', '19100.00');

        $this->assertDatabaseHas('order_items', [
            'order_id' => $checkout->json('order.id'),
            'listing_id' => $pork->id,
            'quantity' => 5,
            'total_amount' => '1100.00',
        ]);
        $this->assertDatabaseHas('order_items', [
            'order_id' => $checkout->json('order.id'),
            'listing_id' => $goat->id,
            'quantity' => 3,
            'total_amount' => '18000.00',
        ]);
        $this->assertDatabaseHas('livestock_listings', ['id' => $pork->id, 'quantity' => 15]);
        $this->assertDatabaseHas('livestock_listings', ['id' => $goat->id, 'quantity' => 2]);
    }

    public function test_buyer_can_checkout_active_listing_and_create_immutable_order_snapshot(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $category = Category::create(['name' => 'Swine', 'slug' => 'swine']);
        $listing = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Bongabong Native Pig',
            'quantity' => 3,
            'pricing_type' => PricingType::PER_KILO,
            'price_per_kilo' => 220,
            'status' => ListingStatus::ACTIVE,
        ]);

        $this->actingAs($buyer)->postJson('/api/cart/items', [
            'listing_id' => $listing->id,
            'quantity' => 2,
        ])->assertOk();

        $checkout = $this->actingAs($buyer)->postJson('/api/checkout')
            ->assertOk()
            ->assertJsonStructure(['order' => ['order_reference']])
            ->assertJsonPath('order.status', 'PENDING_CONFIRMATION')
            ->assertJsonPath('order.total_amount', '440.00')
            ->assertJsonPath('order.payment_method', 'COD')
            ->assertJsonPath('order.payment_status', 'UNPAID')
            ->assertJsonPath('order.items.0.unit_price', '220.00')
            ->assertJsonPath('order.items.0.total_amount', '440.00')
            ->assertJsonPath('order.items.0.pricing_type', 'PER_KILO');

        $this->actingAs($buyer)->getJson('/api/orders/'.$checkout->json('order.id'))
            ->assertOk()
            ->assertJsonPath('order.payment_method', 'COD')
            ->assertJsonPath('order.payment_status', 'UNPAID')
            ->assertJsonPath('order.items.0.unit_price', '220.00')
            ->assertJsonPath('order.items.0.total_amount', '440.00')
            ->assertJsonPath('order.items.0.pricing_type', 'PER_KILO')
            ->assertJsonPath('order.items.0.listing.category.name', 'Swine')
            ->assertJsonPath('order.items.0.listing.category.reference_code', 'SW')
            ->assertJsonPath('order.platform_fee', '0.00')
            ->assertJsonPath('order.seller_fee', '0.00');

        $this->assertDatabaseHas('orders', ['buyer_id' => $buyer->id, 'seller_id' => $seller->id]);
        $this->assertDatabaseHas('order_items', [
            'listing_id' => $listing->id,
            'quantity' => 2,
            'unit_price' => 220.0,
        ]);
    }

    public function test_mixed_category_checkout_reference_uses_seller_and_first_listing_hints(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $swine = Category::create(['name' => 'Swine', 'slug' => 'swine']);
        $goat = Category::create(['name' => 'Goat', 'slug' => 'goat']);
        $firstListing = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $swine->id,
            'name' => 'Native pig',
            'quantity' => 2,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 1000,
            'status' => ListingStatus::ACTIVE,
        ]);
        $secondListing = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $goat->id,
            'name' => 'Boer goat',
            'quantity' => 2,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 1200,
            'status' => ListingStatus::ACTIVE,
        ]);

        $this->actingAs($buyer)->postJson('/api/cart/items', ['listing_id' => $firstListing->id, 'quantity' => 1])->assertOk();
        $this->actingAs($buyer)->postJson('/api/cart/items', ['listing_id' => $secondListing->id, 'quantity' => 1])->assertOk();

        $checkout = $this->actingAs($buyer)->postJson('/api/checkout')->assertOk();
        $reference = $checkout->json('order.order_reference');

        $this->assertMatchesRegularExpression(
            '/^FG-MX-S'.str_pad((string) $seller->id, 5, '0', STR_PAD_LEFT).'-P'.str_pad((string) $firstListing->id, 5, '0', STR_PAD_LEFT).'-[23456789A-HJ-NP-Z]{16}$/',
            $reference,
        );
        $this->assertDatabaseCount('order_items', 2);
        $this->getJson('/api/orders/verify/'.$reference)
            ->assertOk()
            ->assertJsonPath('order.order_reference', $reference);
    }

    public function test_self_pickup_checkout_saves_the_buyers_pinned_location_on_the_order(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $category = Category::create(['name' => 'Cattle', 'slug' => 'cattle']);
        $listing = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Native Cattle',
            'quantity' => 2,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 500,
            'status' => ListingStatus::ACTIVE,
        ]);

        $response = $this->actingAs($buyer)->postJson('/api/checkout', [
            'listing_id' => $listing->id,
            'quantity' => 1,
            'delivery_method' => 'SELF_PICKUP',
            'buyer_location' => [
                'latitude' => 12.7412,
                'longitude' => 121.3821,
                'city_municipality' => 'Bongabong',
                'barangay' => 'Poblacion',
            ],
        ])->assertOk()
            ->assertJsonPath('order.delivery_method', 'SELF_PICKUP')
            ->assertJsonPath('order.shipping_address.latitude', 12.7412)
            ->assertJsonPath('order.shipping_address.longitude', 121.3821);

        $this->actingAs($buyer)->getJson('/api/orders/'.$response->json('order.id'))
            ->assertOk()
            ->assertJsonPath('order.shipping_address.latitude', 12.7412)
            ->assertJsonPath('order.shipping_address.longitude', 121.3821);
    }

    public function test_per_kilo_quote_multiplies_the_buyers_selected_kilograms_by_the_kilo_price(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $category = Category::create(['name' => 'Poultry', 'slug' => 'poultry']);
        $listing = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Native Chicken',
            'quantity' => 20,
            'pricing_type' => PricingType::PER_KILO,
            'price_per_kilo' => 220,
            'status' => ListingStatus::ACTIVE,
        ]);

        $this->actingAs($buyer)->postJson('/api/checkout/quote', [
            'listing_id' => $listing->id,
            'quantity' => 5,
            'delivery_method' => 'SELF_PICKUP',
        ])->assertOk()->assertJsonPath('subtotal', '1100.00');
    }

    public function test_checkout_saves_selected_delivery_address_and_payment_choices_to_order(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $seller->sellerProfile()->create(['latitude' => 12.7771, 'longitude' => 121.3654, 'pickup_location_confirmed' => true]);
        Http::fake(['https://router.project-osrm.org/*' => Http::response(['code' => 'Ok', 'routes' => [['distance' => 5000]]])]);
        $address = $buyer->buyerAddresses()->create([
            'label' => 'Home',
            'recipient_name' => 'Maria Santos',
            'phone_number' => '+639171234567',
            'province' => 'Oriental Mindoro',
            'city_municipality' => 'Bongabong',
            'barangay' => 'Poblacion',
            'postal_code' => '5211',
            'street_address' => '123 Rizal Street',
            'latitude' => 12.7321,
            'longitude' => 121.3654,
            'is_default' => true,
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

        $this->actingAs($buyer)->postJson('/api/cart/items', ['listing_id' => $listing->id, 'quantity' => 1])->assertOk();
        $quote = $this->actingAs($buyer)->postJson('/api/checkout/quote', [
            'delivery_method' => 'STANDARD_DELIVERY',
            'latitude' => $address->latitude,
            'longitude' => $address->longitude,
            'shipping_address' => [
                'street_address' => $address->street_address,
                'address_line2' => $address->address_line2,
                'barangay' => $address->barangay,
                'city_municipality' => $address->city_municipality,
                'province' => $address->province,
                'postal_code' => $address->postal_code,
            ],
        ])->assertOk();
        $checkout = $this->actingAs($buyer)->postJson('/api/checkout', [
            'delivery_method' => 'STANDARD_DELIVERY',
            'payment_method' => 'COD',
            'buyer_address_id' => $address->id,
            'delivery_quote_token' => $quote->json('delivery_quote_token'),
        ]);
        $checkout->assertOk()
            ->assertJsonPath('order.delivery_method', 'STANDARD_DELIVERY')
            ->assertJsonPath('order.payment_method', 'COD')
            ->assertJsonPath('order.shipping_address.recipient_name', 'Maria Santos')
            ->assertJsonPath('order.delivery_distance_km', '5.00')
            ->assertJsonPath('order.delivery_distance_method', 'OSRM_ROAD_ROUTE')
            ->assertJsonPath('order.seller_location_snapshot.latitude', 12.7771);

        $this->assertDatabaseHas('deliveries', [
            'order_id' => $checkout->json('order.id'),
            'status' => 'WAITING_FOR_RIDER',
            'pickup_latitude' => 12.7771,
        ]);

        $seller->sellerProfile()->update(['latitude' => 13.0, 'longitude' => 122.0]);
        $this->actingAs($buyer)->getJson('/api/orders/'.$checkout->json('order.id'))
            ->assertOk()
            ->assertJsonPath('order.seller_location_snapshot.latitude', 12.7771)
            ->assertJsonPath('order.seller_location_snapshot.longitude', 121.3654);
    }

    public function test_delivery_quote_recalculates_when_buyer_address_changes(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $seller->sellerProfile()->create([
            'latitude' => 12.7771,
            'longitude' => 121.3654,
            'address' => 'Poblacion, Bongabong, Oriental Mindoro',
            'pickup_location_confirmed' => true,
        ]);
        $category = Category::create(['name' => 'Duck', 'slug' => 'duck']);
        $listing = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Pekin Ducks',
            'quantity' => 2,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 320,
            'status' => ListingStatus::ACTIVE,
        ]);
        $this->actingAs($buyer)->postJson('/api/cart/items', ['listing_id' => $listing->id, 'quantity' => 1])->assertOk();
        Http::fake([
            'https://router.project-osrm.org/*' => Http::sequence()
                ->push(['code' => 'Ok', 'routes' => [['distance' => 3000]]])
                ->push(['code' => 'Ok', 'routes' => [['distance' => 12000]]]),
        ]);

        $shortRoute = $this->actingAs($buyer)->postJson('/api/checkout/quote', [
            'delivery_method' => 'STANDARD_DELIVERY',
            'latitude' => 12.7321,
            'longitude' => 121.3654,
            'shipping_address' => [
                'barangay' => 'Poblacion',
                'city_municipality' => 'Bongabong',
                'province' => 'Oriental Mindoro',
                'street_address' => 'Old address',
            ],
        ])->assertOk();
        $changedAddress = $this->actingAs($buyer)->postJson('/api/checkout/quote', [
            'delivery_method' => 'STANDARD_DELIVERY',
            'latitude' => 12.8,
            'longitude' => 121.4,
            'shipping_address' => [
                'barangay' => 'Labasan',
                'city_municipality' => 'Bongabong',
                'province' => 'Oriental Mindoro',
                'street_address' => 'New address',
            ],
        ])->assertOk();

        $this->assertEquals(3.0, $shortRoute->json('delivery_distances_km.'.$seller->id));
        $this->assertEquals(12.0, $changedAddress->json('delivery_distances_km.'.$seller->id));
        $this->assertNotSame($shortRoute->json('shipping'), $changedAddress->json('shipping'));
    }

    public function test_checkout_rejects_a_delivery_quote_if_the_seller_location_changes(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $seller->sellerProfile()->create([
            'latitude' => 12.7771,
            'longitude' => 121.3654,
            'address' => 'Poblacion, Bongabong, Oriental Mindoro',
            'pickup_location_confirmed' => true,
        ]);
        $category = Category::create(['name' => 'Duck', 'slug' => 'duck']);
        $listing = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Pekin Ducks',
            'quantity' => 2,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 320,
            'status' => ListingStatus::ACTIVE,
        ]);
        $this->actingAs($buyer)->postJson('/api/cart/items', ['listing_id' => $listing->id, 'quantity' => 1])->assertOk();
        Http::fake([
            'https://router.project-osrm.org/*' => Http::sequence()
                ->push(['code' => 'Ok', 'routes' => [['distance' => 5000]]])
                ->push(['code' => 'Ok', 'routes' => [['distance' => 10000]]]),
        ]);

        $address = [
            'recipient_name' => 'Buyer',
            'phone_number' => '09171234567',
            'province' => 'Oriental Mindoro',
            'city_municipality' => 'Bongabong',
            'barangay' => 'Poblacion',
            'postal_code' => '5211',
            'street_address' => 'Test Street',
            'address_line2' => '',
            'latitude' => 12.7321,
            'longitude' => 121.3654,
        ];
        $quote = $this->actingAs($buyer)->postJson('/api/checkout/quote', [
            'delivery_method' => 'STANDARD_DELIVERY',
            'latitude' => $address['latitude'],
            'longitude' => $address['longitude'],
            'shipping_address' => $address,
        ])->assertOk();

        $seller->sellerProfile()->update(['latitude' => 12.8]);
        $this->actingAs($buyer)->postJson('/api/checkout', [
            'delivery_method' => 'STANDARD_DELIVERY',
            'shipping_address' => $address,
            'delivery_quote_token' => $quote->json('delivery_quote_token'),
        ])->assertStatus(409)
            ->assertJsonPath('message', 'The delivery location or fee changed while you were checking out. Review the refreshed delivery quote before placing your order.');

        $this->assertDatabaseMissing('orders', ['buyer_id' => $buyer->id]);
        $this->assertDatabaseHas('livestock_listings', ['id' => $listing->id, 'quantity' => 2]);
    }

    public function test_delivery_quote_calculates_distance_and_fee_from_buyer_and_seller_pins(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $seller->sellerProfile()->create([
            'latitude' => 12.7771,
            'longitude' => 121.3654,
            'address' => 'Poblacion, Bongabong, Oriental Mindoro',
            'pickup_location_confirmed' => true,
        ]);
        Http::fake(['https://router.project-osrm.org/*' => Http::response(['code' => 'Ok', 'routes' => [['distance' => 5000]]])]);
        $category = Category::create(['name' => 'Duck', 'slug' => 'duck']);
        $listing = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Pekin Ducks',
            'quantity' => 2,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 320,
            'status' => ListingStatus::ACTIVE,
        ]);

        $this->actingAs($buyer)->postJson('/api/cart/items', ['listing_id' => $listing->id, 'quantity' => 1])->assertOk();
        $quote = $this->actingAs($buyer)->postJson('/api/checkout/quote', [
            'delivery_method' => 'STANDARD_DELIVERY',
            'latitude' => 12.7321,
            'longitude' => 121.3654,
            'shipping_address' => [
                'barangay' => 'Poblacion',
                'city_municipality' => 'Bongabong',
                'province' => 'Oriental Mindoro',
            ],
        ])->assertOk()
            ->assertJsonPath('subtotal', '320.00')
            ->assertJsonPath('shipping', '100.00')
            ->assertJsonPath('delivery_distance_methods.'.$seller->id, 'OSRM_ROAD_ROUTE');
        $this->assertEquals(5.0, (float) $quote->json('delivery_distances_km.'.$seller->id));
        Http::assertSent(fn ($request): bool => str_contains($request->url(), '/121.3654000,12.7771000;121.3654000,12.7321000'));
    }

    public function test_seller_can_save_pickup_coordinates_for_delivery_quotes(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);

        $this->actingAs($seller)->putJson('/api/seller/profile/location', [
            'latitude' => 12.7321,
            'longitude' => 121.3654,
            'pickup_barangay' => 'Poblacion',
            'pickup_city_municipality' => 'Bongabong',
            'pickup_province' => 'Oriental Mindoro',
        ])->assertOk()
            ->assertJsonPath('profile.latitude', 12.7321)
            ->assertJsonPath('profile.longitude', 121.3654)
            ->assertJsonPath('profile.pickup_barangay', 'Poblacion')
            ->assertJsonPath('profile.pickup_city_municipality', 'Bongabong')
            ->assertJsonPath('profile.pickup_province', 'Oriental Mindoro')
            ->assertJsonPath('profile.pickup_location_confirmed', true);
    }

    public function test_paymongo_checkout_pays_all_seller_orders_after_signed_webhook(): void
    {
        config(['services.paymongo.secret_key' => 'sk_test_checkout']);
        config(['services.paymongo.webhook_secret' => 'whsec_test']);
        Http::fake([
            'https://api.paymongo.com/v2/checkout_sessions' => Http::response([
                'data' => [
                    'id' => 'cs_farmgate_test',
                    'attributes' => ['checkout_url' => 'https://checkout.paymongo.test/session'],
                ],
            ]),
        ]);

        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $category = Category::create(['name' => 'Duck', 'slug' => 'duck']);
        $sellerIds = [];
        $listingIds = [];
        foreach (['First seller', 'Second seller'] as $index => $sellerName) {
            $seller = User::factory()->create(['role' => Role::SELLER, 'name' => $sellerName]);
            $sellerIds[] = $seller->id;
            $listing = LivestockListing::create([
                'seller_id' => $seller->id,
                'category_id' => $category->id,
                'name' => 'Pekin Ducks '.$index,
                'quantity' => 2,
                'pricing_type' => PricingType::PER_HEAD,
                'price_per_head' => 320,
                'status' => ListingStatus::ACTIVE,
            ]);
            $listingIds[] = $listing->id;
            $this->actingAs($buyer)->postJson('/api/cart/items', ['listing_id' => $listing->id, 'quantity' => 1])->assertOk();
        }

        $response = $this->actingAs($buyer)->postJson('/api/checkout', ['payment_method' => 'GCASH'])
            ->assertOk()
            ->assertJsonPath('checkout_url', 'https://checkout.paymongo.test/session');
        $this->assertCount(2, $response->json('orders'));
        $references = collect($response->json('orders'))->pluck('order_reference');
        $this->assertCount(2, $references->unique());
        foreach ($response->json('orders') as $order) {
            $sellerIndex = array_search($order['seller_id'], $sellerIds, true);
            $this->assertNotFalse($sellerIndex);
            $this->assertMatchesRegularExpression(
                '/^FG-DU-S'.str_pad((string) $order['seller_id'], 5, '0', STR_PAD_LEFT).'-P'.str_pad((string) $listingIds[$sellerIndex], 5, '0', STR_PAD_LEFT).'-[23456789A-HJ-NP-Z]{16}$/',
                $order['order_reference'],
            );
        }
        $this->assertDatabaseCount('orders', 2);
        $this->assertDatabaseHas('orders', ['payment_status' => 'PENDING', 'paymongo_checkout_session_id' => 'cs_farmgate_test']);
        Http::assertSent(fn ($request): bool => $request->url() === 'https://api.paymongo.com/v2/checkout_sessions'
            && $request['data']['attributes']['payment_method_types'] === ['gcash']);
        $checkoutRequest = Http::recorded()->first(fn ($recorded): bool => $recorded[0]->url() === 'https://api.paymongo.com/v2/checkout_sessions')[0];
        $paymentDescriptions = collect($checkoutRequest['data']['attributes']['line_items'])
            ->pluck('description')
            ->implode(' ');
        $this->assertSame(
            'FARMGATE order '.$response->json('orders.0.order_reference'),
            $checkoutRequest['data']['attributes']['description'],
        );
        foreach ($references as $reference) {
            $this->assertStringContainsString('Order '.$reference, $paymentDescriptions);
        }

        $unpaidOrderId = $response->json('orders.0.id');
        $this->actingAs(User::findOrFail($sellerIds[0]))->patchJson('/api/orders/'.$unpaidOrderId.'/status', [
            'status' => OrderStatus::CONFIRMED->value,
        ])->assertStatus(409);

        $payload = [
            'data' => [
                'id' => 'evt_farmgate_test',
                'type' => 'event',
                'attributes' => [
                    'type' => 'checkout_session.payment.paid',
                    'livemode' => false,
                    'data' => [
                        'id' => 'cs_farmgate_test',
                        'type' => 'checkout_session',
                        'attributes' => [
                            'reference_number' => (string) $unpaidOrderId,
                            'payments' => [[
                                'id' => 'pay_farmgate_test',
                                'attributes' => [
                                    'status' => 'paid',
                                    'amount' => 64000,
                                    'currency' => 'PHP',
                                ],
                            ],
                            ]],
                    ],
                ],
            ],
        ];
        $body = json_encode($payload, JSON_THROW_ON_ERROR);
        $timestamp = (string) time();
        $signature = hash_hmac('sha256', $timestamp.'.'.$body, 'whsec_test');
        $this->call('POST', '/api/payments/paymongo/webhook', [], [], [], [
            'HTTP_PAYMONGO_SIGNATURE' => 't='.$timestamp.',te='.$signature,
            'CONTENT_TYPE' => 'application/json',
            'HTTP_ACCEPT' => 'application/json',
        ], $body)->assertOk();
        $this->call('POST', '/api/payments/paymongo/webhook', [], [], [], [
            'HTTP_PAYMONGO_SIGNATURE' => 't='.$timestamp.',te='.$signature,
            'CONTENT_TYPE' => 'application/json',
            'HTTP_ACCEPT' => 'application/json',
        ], $body)->assertOk()->assertJsonPath('message', 'Duplicate webhook event ignored.');

        $this->assertSame(2, Order::query()->where('payment_status', 'PAID')->count());
        $this->assertNotNull(Order::query()->where('paymongo_checkout_session_id', 'cs_farmgate_test')->first()?->paid_at);
        $this->assertDatabaseCount('paymongo_webhook_events', 1);
    }

    public function test_paymongo_checkout_requires_a_test_key_and_handles_invalid_credentials_safely(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $category = Category::create(['name' => 'Goat', 'slug' => 'goat']);
        $listing = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Boer Goat',
            'quantity' => 2,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 100,
            'status' => ListingStatus::ACTIVE,
        ]);
        $this->actingAs($buyer)->postJson('/api/cart/items', ['listing_id' => $listing->id, 'quantity' => 1])->assertOk();

        config(['services.paymongo.secret_key' => null]);
        $this->actingAs($buyer)->postJson('/api/checkout', ['payment_method' => 'GCASH'])
            ->assertStatus(503)
            ->assertJsonPath('message', 'PayMongo test-mode credentials are required. Use cash on delivery or contact support.');

        config(['services.paymongo.secret_key' => 'sk_live_must_not_be_used']);
        $this->actingAs($buyer)->postJson('/api/checkout', ['payment_method' => 'GCASH'])
            ->assertStatus(503);
        $this->assertDatabaseCount('orders', 0);

        config(['services.paymongo.secret_key' => 'sk_test_invalid_credentials']);
        config(['services.frontend_url' => 'http://127.0.0.1:5173']);
        Http::fake([
            'https://api.paymongo.com/v2/checkout_sessions' => Http::response(['errors' => [['code' => 'authentication_error']]], 401),
        ]);
        $response = $this->actingAs($buyer)->postJson('/api/checkout', ['payment_method' => 'GCASH'])
            ->assertStatus(502);
        $this->assertStringNotContainsString('sk_test_invalid_credentials', $response->getContent());
        $this->assertDatabaseHas('orders', ['payment_status' => 'FAILED', 'status' => OrderStatus::CANCELLED->value]);
        $this->assertDatabaseHas('livestock_listings', ['id' => $listing->id, 'quantity' => 2]);
        Http::assertSent(fn ($request): bool => $request->hasHeader(
            'Authorization',
            'Basic '.base64_encode('sk_test_invalid_credentials:'),
        ));
    }

    public function test_buy_now_checks_out_only_the_selected_listing_and_reserves_its_stock(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $category = Category::create(['name' => 'Goat', 'slug' => 'goat']);
        $cartListing = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Cart goat',
            'quantity' => 4,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 100,
            'status' => ListingStatus::ACTIVE,
        ]);
        $buyNowListing = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Buy now goat',
            'quantity' => 3,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 200,
            'status' => ListingStatus::ACTIVE,
        ]);

        $this->actingAs($buyer)->postJson('/api/cart/items', [
            'listing_id' => $cartListing->id,
            'quantity' => 1,
        ])->assertOk();

        $response = $this->actingAs($buyer)->postJson('/api/checkout', [
            'listing_id' => $buyNowListing->id,
            'quantity' => 2,
        ])->assertOk()
            ->assertJsonPath('order.items.0.listing_id', $buyNowListing->id)
            ->assertJsonPath('order.items.0.quantity', 2);

        $this->assertDatabaseHas('livestock_listings', ['id' => $buyNowListing->id, 'quantity' => 1]);
        $this->actingAs($buyer)->getJson('/api/cart')->assertOk()->assertJsonPath('items.0.listing_id', $cartListing->id);
        $this->actingAs($buyer)->patchJson('/api/orders/'.$response->json('order.id').'/status', [
            'status' => OrderStatus::CANCELLED->value,
        ])->assertOk();
        $this->assertDatabaseHas('livestock_listings', ['id' => $buyNowListing->id, 'quantity' => 3]);
    }

    public function test_buyer_and_seller_can_view_only_their_orders_and_seller_can_transition_with_history(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $otherBuyer = User::factory()->create(['role' => Role::BUYER]);
        $otherSeller = User::factory()->create(['role' => Role::SELLER]);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::PENDING_CONFIRMATION,
            'total_amount' => 440,
        ]);
        Order::create([
            'buyer_id' => $otherBuyer->id,
            'seller_id' => $otherSeller->id,
            'status' => OrderStatus::PENDING_CONFIRMATION,
            'total_amount' => 120,
        ]);
        OrderItem::create([
            'order_id' => $order->id,
            'listing_id' => LivestockListing::create([
                'seller_id' => $seller->id,
                'category_id' => Category::create(['name' => 'Cattle', 'slug' => 'cattle'])->id,
                'name' => 'Native Cattle',
                'quantity' => 1,
                'pricing_type' => PricingType::PER_HEAD,
                'price_per_head' => 440,
                'status' => ListingStatus::ACTIVE,
            ])->id,
            'quantity' => 1,
            'unit_price' => 440,
            'total_amount' => 440,
            'pricing_type' => PricingType::PER_HEAD,
        ]);

        $this->actingAs($buyer)->getJson('/api/orders')->assertOk()->assertJsonCount(1, 'orders');
        $this->actingAs($seller)->getJson('/api/orders')
            ->assertOk()
            ->assertJsonCount(1, 'orders')
            ->assertJsonPath('orders.0.buyer.id', $buyer->id)
            ->assertJsonPath('orders.0.buyer.name', $buyer->name)
            ->assertJsonMissingPath('orders.0.buyer.email');
        $this->actingAs($seller)->getJson('/api/orders/'.$order->id)
            ->assertOk()
            ->assertJsonPath('order.buyer.name', $buyer->name)
            ->assertJsonMissingPath('order.buyer.email');
        $this->actingAs($otherBuyer)->getJson('/api/orders/'.$order->id)->assertForbidden();

        $this->actingAs($seller)->patchJson('/api/orders/'.$order->id.'/status', [
            'status' => OrderStatus::CONFIRMED->value,
        ])->assertOk()->assertJsonPath('order.status', OrderStatus::CONFIRMED->value);

        $this->assertDatabaseHas('order_status_history', [
            'order_id' => $order->id,
            'from_status' => OrderStatus::PENDING_CONFIRMATION->value,
            'to_status' => OrderStatus::CONFIRMED->value,
            'changed_by' => $seller->id,
        ]);
        $this->assertDatabaseHas('notifications', [
            'notifiable_id' => $buyer->id,
            'type' => 'App\\Notifications\\OrderStatusChangedNotification',
        ]);

        $this->actingAs($seller)->patchJson('/api/orders/'.$order->id.'/status', [
            'status' => OrderStatus::CONFIRMED->value,
        ])->assertUnprocessable();
        $this->assertSame(1, $buyer->notifications()->where('data->status', OrderStatus::CONFIRMED->value)->count());

        $this->actingAs($seller)->patchJson('/api/orders/'.$order->id.'/status', [
            'status' => OrderStatus::COMPLETED->value,
        ])->assertUnprocessable();
    }

    public function test_seller_rejection_requires_a_reason_and_notifies_the_buyer_once(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::PENDING_CONFIRMATION,
            'total_amount' => 440,
        ]);

        $this->actingAs($seller)->patchJson('/api/orders/'.$order->id.'/status', [
            'status' => OrderStatus::REJECTED->value,
        ])->assertUnprocessable();
        $this->assertSame(OrderStatus::PENDING_CONFIRMATION, $order->fresh()->status);

        $this->actingAs($seller)->patchJson('/api/orders/'.$order->id.'/status', [
            'status' => OrderStatus::REJECTED->value,
            'reason' => 'The requested quantity is no longer available.',
        ])->assertOk()->assertJsonPath('order.status', OrderStatus::REJECTED->value);

        $this->assertDatabaseHas('order_status_history', [
            'order_id' => $order->id,
            'from_status' => OrderStatus::PENDING_CONFIRMATION->value,
            'to_status' => OrderStatus::REJECTED->value,
            'changed_by' => $seller->id,
            'reason' => 'The requested quantity is no longer available.',
        ]);
        $this->assertSame(1, $buyer->notifications()->where('data->type', 'order_status_changed')->count());
        $this->assertDatabaseHas('notifications', [
            'notifiable_id' => $buyer->id,
            'data->type' => 'order_status_changed',
            'data->reason' => 'The requested quantity is no longer available.',
        ]);
        $this->actingAs($seller)->patchJson('/api/orders/'.$order->id.'/status', [
            'status' => OrderStatus::REJECTED->value,
            'reason' => 'Duplicate decision.',
        ])->assertUnprocessable();
        $this->assertSame(1, $buyer->notifications()->where('data->type', 'order_status_changed')->count());
    }

    public function test_buyer_can_cancel_pending_orders_after_the_configured_window_expires(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::PENDING_CONFIRMATION,
            'total_amount' => 440,
        ]);
        Order::query()->whereKey($order->id)->update(['created_at' => now()->subHours(2)]);

        $this->actingAs($buyer)->getJson('/api/orders')
            ->assertOk()
            ->assertJsonPath('orders.0.buyer_can_cancel', true)
            ->assertJsonMissingPath('orders.0.buyer_cancellation_blocked_reason');

        $this->actingAs($buyer)->patchJson('/api/orders/'.$order->id.'/status', [
            'status' => OrderStatus::CANCELLED->value,
        ])->assertOk()
            ->assertJsonPath('order.status', OrderStatus::CANCELLED->value);
    }

    public function test_buyer_order_list_preserves_unknown_saved_status_without_enabling_actions(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::PENDING_CONFIRMATION,
            'total_amount' => 440,
        ]);
        DB::table('orders')->where('id', $order->id)->update(['status' => 'AWAITING_PAYMENT']);

        $this->actingAs($buyer)->getJson('/api/orders')
            ->assertOk()
            ->assertJsonPath('orders.0.status', 'AWAITING_PAYMENT')
            ->assertJsonPath('orders.0.buyer_can_cancel', false)
            ->assertJsonPath('orders.0.seller.name', $seller->name);
    }

    public function test_buyer_can_cancel_orders_until_they_are_on_the_way(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);

        foreach ([
            OrderStatus::CONFIRMED,
            OrderStatus::PREPARING,
            OrderStatus::READY_FOR_PICKUP,
        ] as $status) {
            $order = Order::create([
                'buyer_id' => $buyer->id,
                'seller_id' => $seller->id,
                'status' => $status,
                'total_amount' => 440,
            ]);

            $this->actingAs($buyer)->patchJson('/api/orders/'.$order->id.'/status', [
                'status' => OrderStatus::CANCELLED->value,
            ])->assertOk()->assertJsonPath('order.status', OrderStatus::CANCELLED->value);
        }

        $onTheWayOrder = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::FULFILLING,
            'total_amount' => 440,
        ]);

        $ordersResponse = $this->actingAs($buyer)->getJson('/api/orders')->assertOk();
        $onTheWayOrderData = collect($ordersResponse->json('orders'))->firstWhere('id', $onTheWayOrder->id);
        $this->assertFalse($onTheWayOrderData['buyer_can_cancel']);
        $this->assertSame('This order is on the way and can no longer be cancelled.', $onTheWayOrderData['buyer_cancellation_blocked_reason']);

        $this->actingAs($buyer)->patchJson('/api/orders/'.$onTheWayOrder->id.'/status', [
            'status' => OrderStatus::CANCELLED->value,
        ])->assertUnprocessable();
    }

    public function test_order_details_include_pinned_seller_and_buyer_locations_for_order_participants(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $seller->sellerProfile()->create([
            'latitude' => 12.7312,
            'longitude' => 121.3664,
            'address' => 'Seller pickup point',
        ]);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::CONFIRMED,
            'shipping_address' => [
                'recipient_name' => 'Buyer',
                'street_address' => 'Market Road',
                'latitude' => 12.74,
                'longitude' => 121.38,
            ],
            'total_amount' => 440,
        ]);

        $this->actingAs($buyer)->getJson('/api/orders/'.$order->id)
            ->assertOk()
            ->assertJsonPath('order.seller.name', $seller->name)
            ->assertJsonPath('order.seller.seller_profile.latitude', 12.7312)
            ->assertJsonPath('order.seller.seller_profile.longitude', 121.3664)
            ->assertJsonPath('order.shipping_address.latitude', 12.74)
            ->assertJsonPath('order.shipping_address.longitude', 121.38);
    }

    public function test_seller_profile_does_not_create_an_unconfirmed_default_pickup_pin(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);

        $this->actingAs($seller)->getJson('/api/seller/profile')
            ->assertOk()
            ->assertJsonPath('profile.latitude', null)
            ->assertJsonPath('profile.longitude', null)
            ->assertJsonPath('profile.pickup_location_confirmed', false);

        $this->assertDatabaseHas('seller_profiles', [
            'user_id' => $seller->id,
            'latitude' => null,
            'longitude' => null,
        ]);
    }

    public function test_buyer_can_request_an_order_update_and_duplicate_requests_are_limited(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $otherBuyer = User::factory()->create(['role' => Role::BUYER]);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::CONFIRMED,
            'total_amount' => 440,
        ]);

        $this->actingAs($buyer)->postJson('/api/orders/'.$order->id.'/request-update')
            ->assertOk()
            ->assertJsonPath('message', 'The seller has been asked to send you an order update.');

        $this->assertDatabaseHas('notifications', [
            'notifiable_id' => $seller->id,
            'type' => 'App\\Notifications\\OrderUpdateRequestedNotification',
        ]);
        $this->assertDatabaseHas('notifications', [
            'notifiable_id' => $seller->id,
            'data->type' => 'order_update_requested',
            'data->order_id' => $order->id,
        ]);

        $this->actingAs($buyer)->postJson('/api/orders/'.$order->id.'/request-update')->assertStatus(429);
        $this->actingAs($otherBuyer)->postJson('/api/orders/'.$order->id.'/request-update')->assertForbidden();
    }

    public function test_checkout_rejects_distance_above_configured_delivery_limit(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $seller->sellerProfile()->create(['latitude' => 13.0, 'longitude' => 121.3654, 'pickup_location_confirmed' => true]);
        Http::fake(['https://router.project-osrm.org/*' => Http::response(['code' => 'Ok', 'routes' => [['distance' => 11000]]])]);
        $category = Category::create(['name' => 'Goat', 'slug' => 'goat']);
        $listing = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Boer Goat',
            'quantity' => 2,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 100,
            'status' => ListingStatus::ACTIVE,
        ]);

        app(SystemSettingsService::class)->update([
            'delivery_distance_limit_km' => 10,
            'maximum_items_per_order' => 50,
            'minimum_order_amount' => 0,
            'maximum_order_amount' => 0,
        ], $admin->id, 'Distance limit test');

        $this->actingAs($buyer)->postJson('/api/cart/items', ['listing_id' => $listing->id, 'quantity' => 1])->assertOk();
        $address = $buyer->buyerAddresses()->create([
            'label' => 'Home',
            'recipient_name' => 'Buyer',
            'phone_number' => '09171234567',
            'province' => 'Oriental Mindoro',
            'city_municipality' => 'Bongabong',
            'barangay' => 'Poblacion',
            'postal_code' => '5211',
            'street_address' => 'Test Street',
            'latitude' => 12.7321,
            'longitude' => 121.3654,
        ]);
        $this->actingAs($buyer)->postJson('/api/checkout', [
            'delivery_method' => 'STANDARD_DELIVERY',
            'buyer_address_id' => $address->id,
        ])->assertStatus(422);
        $this->assertDatabaseMissing('orders', ['buyer_id' => $buyer->id]);
    }

    public function test_buyer_cancellation_is_not_limited_by_the_global_toggle_before_fulfillment(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::PENDING_CONFIRMATION,
            'total_amount' => 440,
            'created_at' => now()->subMinutes(10),
        ]);
        SystemSetting::create([
            'key' => 'allow_buyer_cancellation',
            'value' => '0',
            'type' => 'boolean',
            'category' => 'orders',
            'label' => 'Allow buyer cancellation',
            'is_active' => true,
            'is_public' => false,
            'created_by' => $admin->id,
        ]);
        OrderItem::create([
            'order_id' => $order->id,
            'listing_id' => LivestockListing::create([
                'seller_id' => $seller->id,
                'category_id' => Category::create(['name' => 'Cattle', 'slug' => 'cattle'])->id,
                'name' => 'Native Cattle',
                'quantity' => 1,
                'pricing_type' => PricingType::PER_HEAD,
                'price_per_head' => 440,
                'status' => ListingStatus::ACTIVE,
            ])->id,
            'quantity' => 1,
            'unit_price' => 440,
            'total_amount' => 440,
            'pricing_type' => PricingType::PER_HEAD,
        ]);

        $this->actingAs($buyer)->patchJson('/api/orders/'.$order->id.'/status', [
            'status' => OrderStatus::CANCELLED->value,
        ])->assertOk()
            ->assertJsonPath('order.status', OrderStatus::CANCELLED->value);
        $this->actingAs($buyer)->getJson('/api/notifications')->assertOk()
            ->assertJsonPath('notifications.0.data.type', 'order_status_changed')
            ->assertJsonPath('notifications.0.data.order_id', $order->id)
            ->assertJsonPath('notifications.0.data.status', OrderStatus::CANCELLED->value);
    }

    public function test_checkout_snapshots_delivery_and_platform_rates_for_historical_orders(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $seller->sellerProfile()->create(['latitude' => 12.7771, 'longitude' => 121.3654, 'pickup_location_confirmed' => true]);
        Http::fake(['https://router.project-osrm.org/*' => Http::response(['code' => 'Ok', 'routes' => [['distance' => 5000]]])]);
        $category = Category::create(['name' => 'Goat', 'slug' => 'goat']);
        $listing = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Boer Goat',
            'quantity' => 2,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 100,
            'status' => ListingStatus::ACTIVE,
        ]);

        app(SystemSettingsService::class)->update([
            'platform_service_fee_rate' => 10,
            'delivery_base_fee' => 50,
            'delivery_rate_per_km' => 10,
            'delivery_min_fee' => 0,
            'delivery_max_fee' => 0,
        ], $admin->id, 'Historical fee snapshot test');

        $this->actingAs($buyer)->postJson('/api/cart/items', ['listing_id' => $listing->id, 'quantity' => 1])->assertOk();
        $address = $buyer->buyerAddresses()->create([
            'label' => 'Home',
            'recipient_name' => 'Buyer',
            'phone_number' => '09171234567',
            'province' => 'Oriental Mindoro',
            'city_municipality' => 'Bongabong',
            'barangay' => 'Poblacion',
            'postal_code' => '5211',
            'street_address' => 'Test Street',
            'latitude' => 12.7321,
            'longitude' => 121.3654,
        ]);
        $quote = $this->actingAs($buyer)->postJson('/api/checkout/quote', [
            'delivery_method' => 'STANDARD_DELIVERY',
            'latitude' => $address->latitude,
            'longitude' => $address->longitude,
            'shipping_address' => [
                'street_address' => $address->street_address,
                'address_line2' => $address->address_line2,
                'barangay' => $address->barangay,
                'city_municipality' => $address->city_municipality,
                'province' => $address->province,
                'postal_code' => $address->postal_code,
            ],
        ])->assertOk()
            ->assertJsonPath('shipping', '100.00');
        $response = $this->actingAs($buyer)->postJson('/api/checkout', [
            'delivery_method' => 'STANDARD_DELIVERY',
            'buyer_address_id' => $address->id,
            'delivery_quote_token' => $quote->json('delivery_quote_token'),
        ])->assertOk();
        $response->assertJsonPath('order.delivery_fee', '100.00');
        $orderId = $response->json('order.id');
        $this->assertDatabaseHas('orders', [
            'id' => $orderId,
            'delivery_fee' => 100.00,
            'platform_fee' => 10.00,
            'delivery_rate_per_km_snapshot' => 10.00,
            'delivery_distance_km' => 5,
            'delivery_distance_method' => 'OSRM_ROAD_ROUTE',
        ]);

        app(SystemSettingsService::class)->update(['delivery_rate_per_km' => 20], $admin->id, 'Rate changed');
        $this->assertDatabaseHas('orders', ['id' => $orderId, 'delivery_fee' => 100.00, 'delivery_rate_per_km_snapshot' => 10.00]);
    }

    public function test_barangay_route_fallback_quotes_and_saves_the_same_distance_method_and_fee(): void
    {
        Cache::flush();
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $seller->sellerProfile()->create([
            'pickup_barangay' => 'Poblacion',
            'pickup_city_municipality' => 'Bongabong',
            'pickup_province' => 'Oriental Mindoro',
        ]);
        Http::fake(function ($request) {
            $url = urldecode($request->url());
            if (str_contains($url, 'nominatim.openstreetmap.org')) {
                $barangay = str_contains($url, 'Poblacion') ? 'Poblacion' : 'Tuno';

                return Http::response([[
                    'lat' => $barangay === 'Poblacion' ? '12.7771' : '12.7321',
                    'lon' => $barangay === 'Poblacion' ? '121.3654' : '121.3821',
                    'address' => [
                        'suburb' => $barangay,
                        'city' => 'Bongabong',
                        'state' => 'Oriental Mindoro',
                        'country' => 'Philippines',
                    ],
                ]]);
            }

            return Http::response(['code' => 'Ok', 'routes' => [['distance' => 6000]]]);
        });
        app(SystemSettingsService::class)->update([
            'delivery_base_fee' => 50,
            'delivery_included_km' => 0,
            'delivery_rate_per_km' => 10,
            'delivery_min_fee' => 50,
            'delivery_max_fee' => 0,
            'delivery_tiers_enabled' => false,
        ], $admin->id, 'Barangay road route fee test');

        $category = Category::create(['name' => 'Goat', 'slug' => 'goat']);
        $listing = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Bongabong Goat',
            'quantity' => 2,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 100,
            'status' => ListingStatus::ACTIVE,
        ]);
        $this->actingAs($buyer)->postJson('/api/cart/items', ['listing_id' => $listing->id, 'quantity' => 1])->assertOk();
        $address = $buyer->buyerAddresses()->create([
            'label' => 'Home',
            'recipient_name' => 'Buyer',
            'phone_number' => '09171234567',
            'province' => 'Oriental Mindoro',
            'city_municipality' => 'Bongabong',
            'barangay' => 'Tuno',
            'postal_code' => '5211',
            'street_address' => 'Test Street',
            'latitude' => 12.7321,
            'longitude' => 121.3821,
        ]);

        $quote = $this->actingAs($buyer)->postJson('/api/checkout/quote', [
            'delivery_method' => 'STANDARD_DELIVERY',
            'latitude' => $address->latitude,
            'longitude' => $address->longitude,
            'shipping_address' => [
                'street_address' => $address->street_address,
                'address_line2' => $address->address_line2,
                'barangay' => $address->barangay,
                'city_municipality' => $address->city_municipality,
                'province' => $address->province,
                'postal_code' => $address->postal_code,
            ],
        ])->assertOk()
            ->assertJsonPath('shipping', '110.00')
            ->assertJsonPath('delivery_distances_km.'.$seller->id, 6)
            ->assertJsonPath('delivery_distance_methods.'.$seller->id, 'OSRM_BARANGAY_ESTIMATE');

        $checkout = $this->actingAs($buyer)->postJson('/api/checkout', [
            'delivery_method' => 'STANDARD_DELIVERY',
            'buyer_address_id' => $address->id,
            'delivery_quote_token' => $quote->json('delivery_quote_token'),
        ])->assertOk()
            ->assertJsonPath('order.delivery_distance_km', '6.00')
            ->assertJsonPath('order.delivery_distance_method', 'OSRM_BARANGAY_ESTIMATE')
            ->assertJsonPath('order.delivery_fee', '110.00');

        $this->actingAs($buyer)->getJson('/api/orders/'.$checkout->json('order.id'))
            ->assertOk()
            ->assertJsonPath('order.delivery_distance_km', '6.00')
            ->assertJsonPath('order.delivery_distance_method', 'OSRM_BARANGAY_ESTIMATE')
            ->assertJsonPath('order.delivery_fee', '110.00');
        $this->assertDatabaseHas('deliveries', [
            'order_id' => $checkout->json('order.id'),
            'pickup_latitude' => 12.7771,
            'pickup_longitude' => 121.3654,
        ]);
    }
}
