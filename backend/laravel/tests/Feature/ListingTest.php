<?php

namespace Tests\Feature;

use App\Enums\ListingStatus;
use App\Enums\OrderStatus;
use App\Enums\PricingType;
use App\Enums\Role;
use App\Models\Category;
use App\Models\Interest;
use App\Models\LivestockListing;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Review;
use App\Models\User;
use App\Services\SystemSettingsService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ListingTest extends TestCase
{
    use RefreshDatabase;

    public function test_seller_can_create_and_submit_a_per_kilo_listing(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $seller->sellerProfile()->create(['business_name' => 'Verified Seller', 'is_verified' => true]);
        $category = Category::create(['name' => 'Swine', 'slug' => 'swine']);

        $this->actingAs($seller)->postJson('/api/seller/listings', [
            'category_id' => $category->id,
            'name' => 'Bongabong Native Pig',
            'quantity' => 1,
            'estimated_weight_kg' => 42.5,
            'pricing_type' => PricingType::PER_KILO->value,
            'price_per_kilo' => 220,
            'images' => ['https://example.com/pig.jpg'],
        ])->assertCreated()->assertJsonPath('listing.status', ListingStatus::DRAFT->value);

        $listing = LivestockListing::firstOrFail();
        $this->actingAs($seller)->postJson("/api/seller/listings/{$listing->id}/submit")
            ->assertOk()->assertJsonPath('listing.status', ListingStatus::PENDING_REVIEW->value);
    }

    public function test_buyer_cannot_create_a_listing(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $category = Category::create(['name' => 'Goat', 'slug' => 'goat']);

        $this->actingAs($buyer)->postJson('/api/seller/listings', [
            'category_id' => $category->id,
            'name' => 'Restricted listing',
            'quantity' => 1,
            'pricing_type' => PricingType::PER_HEAD->value,
            'price_per_head' => 1000,
        ])->assertForbidden();
    }

    public function test_unverified_seller_is_blocked_when_verification_is_required(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $category = Category::create(['name' => 'Goat', 'slug' => 'goat']);
        app(SystemSettingsService::class)->update(['seller_verification_required' => true], $admin->id, 'Seller verification required');

        $this->actingAs($seller)->postJson('/api/seller/listings', [
            'category_id' => $category->id,
            'name' => 'Unverified listing',
            'quantity' => 1,
            'pricing_type' => PricingType::PER_HEAD->value,
            'price_per_head' => 1000,
        ])->assertStatus(403)
            ->assertJson(['message' => 'Seller verification is required before creating listings.']);
    }

    public function test_public_marketplace_returns_only_active_listings(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $category = Category::create(['name' => 'Cattle', 'slug' => 'cattle']);
        $base = [
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'quantity' => 1,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 50000,
        ];
        $visible = new LivestockListing($base + ['name' => 'Visible', 'status' => ListingStatus::ACTIVE]);
        $visible->seller_id = $seller->id;
        $visible->save();
        $hidden = new LivestockListing($base + ['name' => 'Hidden', 'status' => ListingStatus::PENDING_REVIEW]);
        $hidden->seller_id = $seller->id;
        $hidden->save();

        $this->getJson('/api/listings')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.name', 'Visible');
    }

    public function test_admin_can_approve_a_submitted_listing(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $seller->sellerProfile()->create(['business_name' => 'Verified Seller', 'is_verified' => true]);
        $category = Category::create(['name' => 'Duck', 'slug' => 'duck']);
        $listing = new LivestockListing([
            'category_id' => $category->id,
            'name' => 'Farm Duck',
            'quantity' => 4,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 350,
            'status' => ListingStatus::PENDING_REVIEW,
        ]);
        $listing->seller_id = $seller->id;
        $listing->save();

        $this->actingAs($admin)->postJson("/api/admin/listings/{$listing->id}/review", ['status' => ListingStatus::ACTIVE->value])
            ->assertOk()->assertJsonPath('listing.status', ListingStatus::ACTIVE->value);
    }

    public function test_marketplace_supports_search_filters_and_price_sorting(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $seller->sellerProfile()->create(['business_name' => 'Verified Seller', 'is_verified' => true]);
        $category = Category::create(['name' => 'Swine', 'slug' => 'swine']);
        $otherCategory = Category::create(['name' => 'Cattle', 'slug' => 'cattle']);

        $first = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Bongabong Native Pig',
            'breed' => 'Native',
            'sex' => 'MALE',
            'quantity' => 1,
            'pricing_type' => PricingType::PER_KILO,
            'price_per_kilo' => 300,
            'status' => ListingStatus::ACTIVE,
        ]);

        LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $otherCategory->id,
            'name' => 'Highland Cattle',
            'breed' => 'Angus',
            'sex' => 'FEMALE',
            'quantity' => 1,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 25000,
            'status' => ListingStatus::ACTIVE,
        ]);

        $this->getJson('/api/listings?q=Pig&category_id='.$category->id.'&pricing_type='.PricingType::PER_KILO->value.'&min_price=100&max_price=500&sort=price_asc')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name', 'Bongabong Native Pig');

        $this->getJson('/api/listings?sort=newest')
            ->assertOk()
            ->assertJsonPath('data.0.name', 'Highland Cattle');
    }

    public function test_marketplace_can_sort_active_listings_by_buyer_interest(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $category = Category::create(['name' => 'Goat', 'slug' => 'goat']);
        $popular = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Popular goat',
            'quantity' => 1,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 1000,
            'status' => ListingStatus::ACTIVE,
        ]);
        LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'New goat',
            'quantity' => 1,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 1000,
            'status' => ListingStatus::ACTIVE,
        ]);

        foreach (range(1, 3) as $index) {
            Interest::create([
                'buyer_id' => User::factory()->create(['role' => Role::BUYER])->id,
                'livestock_listing_id' => $popular->id,
            ]);
        }

        $this->getJson('/api/listings?sort=popular')
            ->assertOk()
            ->assertJsonPath('data.0.name', 'Popular goat')
            ->assertJsonPath('data.0.interests_count', 3);
    }

    public function test_listing_show_returns_related_marketplace_items(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $seller->sellerProfile()->create(['business_name' => 'Verified Seller', 'is_verified' => true]);
        $category = Category::create(['name' => 'Goat', 'slug' => 'goat']);

        $listing = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Boer Goat',
            'quantity' => 2,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 5000,
            'status' => ListingStatus::ACTIVE,
        ]);

        LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Alpine Goat',
            'quantity' => 3,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 4500,
            'status' => ListingStatus::ACTIVE,
        ]);

        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::COMPLETED,
            'total_amount' => 5000,
        ]);
        OrderItem::create([
            'order_id' => $order->id,
            'listing_id' => $listing->id,
            'quantity' => 1,
            'unit_price' => 5000,
            'total_amount' => 5000,
            'pricing_type' => PricingType::PER_HEAD,
        ]);
        Review::create([
            'order_id' => $order->id,
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'rating' => 5,
            'comment' => 'Healthy and well cared for.',
            'status' => 'PUBLISHED',
        ]);

        $this->getJson('/api/listings/'.$listing->id)
            ->assertOk()
            ->assertJsonPath('listing.name', 'Boer Goat')
            ->assertJsonPath('rating_average', 5)
            ->assertJsonPath('review_count', 1)
            ->assertJsonPath('reviews.0.comment', 'Healthy and well cared for.')
            ->assertJsonCount(1, 'related');
    }

    public function test_listing_expiration_days_hide_old_active_listings(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $seller->sellerProfile()->create(['business_name' => 'Verified Seller', 'is_verified' => true]);
        $category = Category::create(['name' => 'Pig', 'slug' => 'pig']);

        app(SystemSettingsService::class)->update([
            'listing_expiration_days' => 30,
        ], $admin->id, 'Listing expiration');

        $expired = new LivestockListing([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Expired Pig',
            'quantity' => 1,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 1200,
            'status' => ListingStatus::ACTIVE,
        ]);
        $expired->forceFill(['created_at' => now()->subDays(31), 'updated_at' => now()->subDays(31)])->save();

        $fresh = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Fresh Pig',
            'quantity' => 2,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 1400,
            'status' => ListingStatus::ACTIVE,
        ]);

        $this->getJson('/api/listings')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.name', 'Fresh Pig');
        $this->getJson('/api/listings/'.$expired->id)->assertNotFound();
        $this->getJson('/api/listings/'.$fresh->id)->assertOk();
    }

    public function test_seller_listing_approval_and_max_active_limit_are_enforced(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $seller->sellerProfile()->create(['business_name' => 'Verified Seller', 'is_verified' => true]);
        $category = Category::create(['name' => 'Chicken', 'slug' => 'chicken']);

        app(SystemSettingsService::class)->update([
            'seller_listing_approval_required' => true,
            'maximum_active_listings' => 2,
        ], $admin->id, 'Listing policies');

        LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'First chicken',
            'quantity' => 2,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 150,
            'status' => ListingStatus::ACTIVE,
        ]);

        $draft = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Second chicken',
            'quantity' => 3,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 175,
            'status' => ListingStatus::DRAFT,
        ]);
        $this->actingAs($seller)->postJson("/api/seller/listings/{$draft->id}/submit")
            ->assertOk()
            ->assertJsonPath('listing.status', ListingStatus::PENDING_REVIEW->value);

        app(SystemSettingsService::class)->update([
            'maximum_active_listings' => 1,
        ], $admin->id, 'Lower listing cap');

        $blocked = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Third chicken',
            'quantity' => 4,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 200,
            'status' => ListingStatus::DRAFT,
        ]);

        $this->actingAs($seller)->postJson("/api/seller/listings/{$blocked->id}/submit")
            ->assertStatus(422)
            ->assertJson(['message' => 'Maximum active listings reached.']);
    }

    public function test_seller_listing_search_and_sort_keep_filters_in_paginated_results(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $category = Category::create(['name' => 'Swine', 'slug' => 'swine']);
        $otherCategory = Category::create(['name' => 'Cattle', 'slug' => 'cattle']);

        foreach (range(1, 16) as $index) {
            LivestockListing::create([
                'seller_id' => $seller->id,
                'category_id' => $category->id,
                'name' => sprintf('Native pig %02d', $index),
                'quantity' => $index,
                'pricing_type' => PricingType::PER_HEAD,
                'price_per_head' => 1000 + $index,
                'status' => ListingStatus::DRAFT,
            ]);
        }
        LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $otherCategory->id,
            'name' => 'Farm cattle',
            'quantity' => 2,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 500,
            'status' => ListingStatus::DRAFT,
        ]);
        LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Rejected listing',
            'quantity' => 1,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 3000,
            'status' => ListingStatus::REJECTED,
        ]);

        $response = $this->actingAs($seller)->getJson('/api/seller/listings?q=Swine&sort=name&direction=asc&page=2')
            ->assertOk()
            ->assertJsonPath('listings.current_page', 2)
            ->assertJsonPath('listings.last_page', 2)
            ->assertJsonPath('listings.data.0.name', 'Native pig 16');
        $this->assertStringContainsString('q=Swine', $response->json('listings.prev_page_url'));
        $this->assertStringContainsString('sort=name', $response->json('listings.prev_page_url'));
        $this->assertStringContainsString('direction=asc', $response->json('listings.prev_page_url'));

        $this->getJson('/api/seller/listings?q=Native&sort=price&direction=asc')
            ->assertOk()
            ->assertJsonPath('listings.data.0.name', 'Native pig 01');
        $this->getJson('/api/seller/listings?sort=category&direction=asc')
            ->assertOk()
            ->assertJsonPath('listings.data.0.name', 'Farm cattle');
        $this->getJson('/api/seller/listings?sort=quantity&direction=desc')
            ->assertOk()
            ->assertJsonPath('listings.data.0.name', 'Native pig 16');
        $this->getJson('/api/seller/listings?sort=status&direction=desc')
            ->assertOk()
            ->assertJsonPath('listings.data.0.name', 'Rejected listing');

        $this->getJson('/api/seller/listings?sort=created_at;DROP%20TABLE%20users')
            ->assertUnprocessable();
    }

    public function test_seller_can_edit_and_delete_only_owned_draft_or_rejected_listings(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $otherSeller = User::factory()->create(['role' => Role::SELLER]);
        $category = Category::create(['name' => 'Goat', 'slug' => 'goat']);
        $draft = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Old listing name',
            'quantity' => 2,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 1800,
            'status' => ListingStatus::DRAFT,
        ]);
        $active = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Published goat',
            'quantity' => 1,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 2000,
            'status' => ListingStatus::ACTIVE,
        ]);

        $this->actingAs($seller)->putJson("/api/seller/listings/{$draft->id}", [
            'category_id' => $category->id,
            'name' => 'Updated goat',
            'quantity' => 3,
            'pricing_type' => PricingType::PER_HEAD->value,
            'price_per_head' => 2100,
        ])->assertOk()->assertJsonPath('listing.name', 'Updated goat');

        $this->actingAs($otherSeller)->deleteJson("/api/seller/listings/{$draft->id}")
            ->assertForbidden();
        $this->actingAs($seller)->deleteJson("/api/seller/listings/{$active->id}")
            ->assertStatus(409);
        $this->deleteJson("/api/seller/listings/{$draft->id}")
            ->assertOk()
            ->assertJson(['message' => 'Listing deleted.']);

        $this->assertSoftDeleted('livestock_listings', ['id' => $draft->id]);
        $this->assertDatabaseHas('livestock_listings', ['id' => $active->id, 'status' => ListingStatus::ACTIVE->value]);
    }

    public function test_listing_submit_without_review_and_delete_cannot_cross_status_transition(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $category = Category::create(['name' => 'Sheep', 'slug' => 'sheep']);
        app(SystemSettingsService::class)->update([
            'seller_listing_approval_required' => false,
        ], $admin->id, 'Disable listing review');
        $listing = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Local sheep',
            'quantity' => 2,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 4000,
            'status' => ListingStatus::DRAFT,
        ]);

        $this->actingAs($seller)->postJson("/api/seller/listings/{$listing->id}/submit")
            ->assertOk()
            ->assertJsonPath('listing.status', ListingStatus::ACTIVE->value);
        $this->deleteJson("/api/seller/listings/{$listing->id}")
            ->assertStatus(409);
    }

    public function test_seller_can_cancel_active_and_pending_listings_back_to_draft(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $otherSeller = User::factory()->create(['role' => Role::SELLER]);
        $category = Category::create(['name' => 'Cattle', 'slug' => 'cattle']);
        $active = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Active cattle',
            'quantity' => 1,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 50000,
            'status' => ListingStatus::ACTIVE,
        ]);
        $pending = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Pending cattle',
            'quantity' => 1,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 50000,
            'status' => ListingStatus::PENDING_REVIEW,
        ]);

        $this->actingAs($otherSeller)->postJson("/api/seller/listings/{$pending->id}/cancel")
            ->assertForbidden();

        $this->actingAs($seller)->postJson("/api/seller/listings/{$pending->id}/cancel")
            ->assertOk()
            ->assertJsonPath('message', 'Listing cancelled and returned to drafts.')
            ->assertJsonPath('listing.status', ListingStatus::DRAFT->value);
        $this->postJson("/api/seller/listings/{$active->id}/cancel")
            ->assertOk()
            ->assertJsonPath('listing.status', ListingStatus::DRAFT->value);

        $this->assertDatabaseHas('livestock_listings', ['id' => $active->id, 'status' => ListingStatus::DRAFT->value]);
        $this->assertDatabaseHas('livestock_listings', ['id' => $pending->id, 'status' => ListingStatus::DRAFT->value]);
    }

    public function test_seller_cannot_cancel_draft_rejected_or_sold_listing(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $category = Category::create(['name' => 'Goat', 'slug' => 'goat']);

        foreach ([ListingStatus::DRAFT, ListingStatus::REJECTED, ListingStatus::SOLD] as $status) {
            $listing = LivestockListing::create([
                'seller_id' => $seller->id,
                'category_id' => $category->id,
                'name' => "Listing {$status->value}",
                'quantity' => 1,
                'pricing_type' => PricingType::PER_HEAD,
                'price_per_head' => 1000,
                'status' => $status,
            ]);

            $this->actingAs($seller)->postJson("/api/seller/listings/{$listing->id}/cancel")
                ->assertStatus(409);
            $this->assertDatabaseHas('livestock_listings', ['id' => $listing->id, 'status' => $status->value]);
        }
    }
}
