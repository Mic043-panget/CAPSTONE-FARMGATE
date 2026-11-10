<?php

namespace Tests\Feature;

use App\Enums\ListingStatus;
use App\Enums\OrderStatus;
use App\Enums\PricingType;
use App\Enums\ReviewStatus;
use App\Enums\Role;
use App\Models\Category;
use App\Models\LivestockListing;
use App\Models\Order;
use App\Models\Review;
use App\Models\SellerPromotion;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PublicSellerShopTest extends TestCase
{
    use RefreshDatabase;

    public function test_public_shop_returns_only_public_seller_information_and_available_listings(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER, 'name' => 'Public Seller']);
        $seller->sellerProfile()->create([
            'business_name' => 'Bongabong Livestock',
            'phone' => '09171234567',
            'address' => 'Private residential street address',
            'is_verified' => true,
        ]);
        $category = Category::create(['name' => 'Goats', 'slug' => 'shop-goats']);
        $listing = $this->listing($seller, $category, 'Boer Goat', ListingStatus::ACTIVE, 5, 120);
        $this->listing($seller, $category, 'Sold Goat', ListingStatus::ACTIVE, 0, 100);
        $this->listing($seller, $category, 'Unavailable Goat', ListingStatus::DISABLED, 4, 90);
        $promotion = SellerPromotion::create([
            'seller_id' => $seller->id,
            'name' => 'Healthy herd offer',
            'description' => 'Ten percent off this listing.',
            'discount_type' => 'PERCENTAGE',
            'discount_value' => 10,
            'applies_to_all' => false,
            'status' => 'ACTIVE',
            'starts_at' => now()->subHour(),
            'ends_at' => now()->addDay(),
        ]);
        $promotion->listings()->attach($listing->id);
        $buyer = User::factory()->create(['role' => Role::BUYER, 'name' => 'Review Buyer']);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::COMPLETED,
            'total_amount' => 120,
        ]);
        Review::create([
            'order_id' => $order->id,
            'listing_id' => $listing->id,
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'rating' => 5,
            'comment' => 'Healthy livestock.',
            'status' => ReviewStatus::PUBLISHED,
        ]);
        $pendingBuyer = User::factory()->create(['role' => Role::BUYER]);
        $pendingOrder = Order::create([
            'buyer_id' => $pendingBuyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::COMPLETED,
            'total_amount' => 120,
        ]);
        Review::create([
            'order_id' => $pendingOrder->id,
            'listing_id' => $listing->id,
            'buyer_id' => $pendingBuyer->id,
            'seller_id' => $seller->id,
            'rating' => 1,
            'comment' => 'Hidden until moderation.',
            'status' => ReviewStatus::HIDDEN,
        ]);

        $response = $this->getJson("/api/sellers/{$seller->id}/shop")
            ->assertOk()
            ->assertJsonPath('seller.business_name', 'Bongabong Livestock')
            ->assertJsonPath('seller.is_verified', true)
            ->assertJsonPath('listings.total', 1)
            ->assertJsonPath('listings.data.0.id', $listing->id)
            ->assertJsonPath('listings.data.0.current_price', '108.00')
            ->assertJsonPath('categories.0.name', 'Goats')
            ->assertJsonPath('promotions.0.name', 'Healthy herd offer')
            ->assertJsonPath('promotions.0.status', 'ACTIVE')
            ->assertJsonPath('rating_average', 5)
            ->assertJsonPath('review_count', 1)
            ->assertJsonPath('reviews.data.0.comment', 'Healthy livestock.')
            ->assertJsonMissing(['phone' => '09171234567'])
            ->assertJsonMissing(['address' => 'Private residential street address'])
            ->assertJsonMissing(['comment' => 'Hidden until moderation.']);

        $this->assertArrayNotHasKey('email', $response->json('seller'));
        $this->assertArrayNotHasKey('address', $response->json('seller'));
        $this->assertArrayNotHasKey('phone', $response->json('seller'));
    }

    public function test_public_shop_filters_sorts_and_paginates_seller_listings(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $goats = Category::create(['name' => 'Goats', 'slug' => 'shop-filter-goats']);
        $cattle = Category::create(['name' => 'Cattle', 'slug' => 'shop-filter-cattle']);
        $this->listing($seller, $goats, 'Boer Goat', ListingStatus::ACTIVE, 5, 80);
        $this->listing($seller, $goats, 'Angus Goat', ListingStatus::ACTIVE, 5, 160);
        $this->listing($seller, $cattle, 'Angus Cattle', ListingStatus::ACTIVE, 5, 240);
        for ($index = 0; $index < 10; $index++) {
            $this->listing($seller, $goats, "Other Goat {$index}", ListingStatus::ACTIVE, 5, 100 + $index);
        }

        $this->getJson("/api/sellers/{$seller->id}/shop?category_id={$goats->id}&sort=price_asc")
            ->assertOk()
            ->assertJsonPath('listings.total', 12)
            ->assertJsonPath('listings.data.0.original_price', '80.00')
            ->assertJsonPath('listings.data.11.original_price', '160.00')
            ->assertJsonPath('listings.last_page', 1);
        $this->getJson("/api/sellers/{$seller->id}/shop?search=Cattle")
            ->assertOk()
            ->assertJsonPath('listings.total', 1)
            ->assertJsonPath('listings.data.0.name', 'Angus Cattle');
        $this->getJson("/api/sellers/{$seller->id}/shop?page=2")
            ->assertOk()
            ->assertJsonPath('listings.current_page', 2)
            ->assertJsonPath('listings.data.0.name', 'Boer Goat');
        $this->getJson('/api/sellers/999999/shop')->assertNotFound();
    }

    private function listing(User $seller, Category $category, string $name, ListingStatus $status, int $quantity, int $price): LivestockListing
    {
        return LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => $name,
            'quantity' => $quantity,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => $price,
            'status' => $status,
        ]);
    }
}
