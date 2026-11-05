<?php

namespace Tests\Feature;

use App\Enums\ListingStatus;
use App\Enums\PricingType;
use App\Enums\Role;
use App\Models\Category;
use App\Models\LivestockListing;
use App\Models\SellerPromotion;
use App\Models\User;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class SellerPromotionTest extends TestCase
{
    use RefreshDatabase;

    public function test_seller_can_create_activate_and_apply_a_promotion_to_listing_and_checkout_prices(): void
    {
        [$seller, $listing] = $this->sellerAndListing();

        $payload = $this->promotionPayload($listing, 'Market day offer', 'PERCENTAGE', 15.25);
        $payload['description'] = 'Save on selected livestock this market day.';
        $created = $this->actingAs($seller)->postJson('/api/seller/promotions', $payload)
            ->assertCreated()
            ->assertJsonPath('promotion.status', 'DRAFT')
            ->assertJsonPath('promotion.description', 'Save on selected livestock this market day.');
        $promotionId = $created->json('promotion.id');

        $this->actingAs($seller)->postJson("/api/seller/promotions/{$promotionId}/activate")
            ->assertOk()
            ->assertJsonPath('promotion.status', 'ACTIVE');

        $this->getJson('/api/listings')->assertOk()
            ->assertJsonPath('data.0.original_price', '100.00')
            ->assertJsonPath('data.0.current_price', '84.75')
            ->assertJsonPath('data.0.promotion.name', 'Market day offer');
        $this->getJson('/api/listings?promotions=1')->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.current_price', '84.75');
        $this->getJson("/api/listings/{$listing->id}")->assertOk()
            ->assertJsonPath('listing.current_price', '84.75');

        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $this->actingAs($buyer)->postJson('/api/cart/items', ['listing_id' => $listing->id, 'quantity' => 2])
            ->assertOk()
            ->assertJsonPath('cart.items.0.unit_price', 84.75)
            ->assertJsonPath('cart.items.0.listing.original_price', '100.00')
            ->assertJsonPath('cart.items.0.listing.promotion.name', 'Market day offer');
        $cartItemId = $this->actingAs($buyer)->getJson('/api/cart')->json('items.0.id');
        $this->actingAs($buyer)->postJson('/api/checkout/quote', [
            'items' => [['cart_item_id' => $cartItemId, 'quantity' => 2]],
            'delivery_method' => 'SELF_PICKUP',
        ])->assertOk()->assertJsonPath('subtotal', '169.50');

        $checkout = $this->actingAs($buyer)->postJson('/api/checkout', [
            'items' => [['cart_item_id' => $cartItemId, 'quantity' => 2]],
            'delivery_method' => 'SELF_PICKUP',
        ])->assertOk()->assertJsonPath('order.subtotal_amount', '169.50');

        $this->assertDatabaseHas('order_items', [
            'order_id' => $checkout->json('order.id'),
            'listing_id' => $listing->id,
            'unit_price' => '84.75',
            'total_amount' => '169.50',
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'user_id' => $seller->id,
            'action' => 'seller.promotion.activated',
            'entity_id' => (string) $promotionId,
        ]);
    }

    public function test_active_promotion_windows_cannot_overlap_for_the_same_listing_and_other_sellers_are_scoped_out(): void
    {
        [$seller, $listing] = $this->sellerAndListing();
        $first = $this->actingAs($seller)->postJson('/api/seller/promotions', $this->promotionPayload($listing))->assertCreated()->json('promotion.id');
        $this->actingAs($seller)->postJson("/api/seller/promotions/{$first}/activate")->assertOk();

        $second = $this->actingAs($seller)->postJson('/api/seller/promotions', $this->promotionPayload($listing, 'Second offer'))->assertCreated()->json('promotion.id');
        $conflict = $this->actingAs($seller)->postJson("/api/seller/promotions/{$second}/activate")
            ->assertUnprocessable()
            ->assertJsonValidationErrors('starts_at');
        $this->assertStringContainsString('Market day offer', $conflict->json('errors.starts_at.0'));
        $this->assertDatabaseHas('seller_promotions', ['id' => $second, 'status' => 'DRAFT']);

        $otherSeller = User::factory()->create(['role' => Role::SELLER]);
        $this->actingAs($otherSeller)->postJson("/api/seller/promotions/{$first}/pause")->assertNotFound();
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $this->actingAs($buyer)->getJson('/api/seller/promotions')->assertForbidden();
    }

    public function test_promotion_lifecycle_and_discount_validation_are_enforced(): void
    {
        [$seller, $listing] = $this->sellerAndListing();

        $this->actingAs($seller)->postJson('/api/seller/promotions', $this->promotionPayload($listing, 'Invalid discount', 'PERCENTAGE', 101))
            ->assertUnprocessable()
            ->assertJsonValidationErrors('discount_value');
        $this->actingAs($seller)->postJson('/api/seller/promotions', $this->promotionPayload($listing, 'Too large fixed discount', 'FIXED', 101))
            ->assertUnprocessable()
            ->assertJsonValidationErrors('discount_value');

        $promotionId = $this->actingAs($seller)->postJson('/api/seller/promotions', $this->promotionPayload($listing))->assertCreated()->json('promotion.id');
        $this->actingAs($seller)->putJson("/api/seller/promotions/{$promotionId}", $this->promotionPayload($listing, 'Edited offer'))
            ->assertOk()->assertJsonPath('promotion.name', 'Edited offer');
        $this->actingAs($seller)->postJson("/api/seller/promotions/{$promotionId}/activate")->assertOk();
        $this->actingAs($seller)->putJson("/api/seller/promotions/{$promotionId}", $this->promotionPayload($listing, 'Updated active offer', 'PERCENTAGE', 12))
            ->assertOk()->assertJsonPath('promotion.name', 'Updated active offer')
            ->assertJsonPath('promotion.status', 'ACTIVE');
        $this->actingAs($seller)->postJson("/api/seller/promotions/{$promotionId}/pause")->assertOk()->assertJsonPath('promotion.status', 'PAUSED');
        $this->actingAs($seller)->postJson("/api/seller/promotions/{$promotionId}/activate")->assertOk()->assertJsonPath('promotion.status', 'ACTIVE');
        $this->actingAs($seller)->postJson("/api/seller/promotions/{$promotionId}/end")->assertOk()->assertJsonPath('promotion.status', 'ENDED');
        $this->actingAs($seller)->postJson("/api/seller/promotions/{$promotionId}/activate")->assertStatus(409);

        $draftId = $this->actingAs($seller)->postJson('/api/seller/promotions', $this->promotionPayload($listing, 'Draft to delete'))->assertCreated()->json('promotion.id');
        $this->actingAs($seller)->deleteJson("/api/seller/promotions/{$draftId}")->assertOk();
        $this->assertDatabaseMissing('seller_promotions', ['id' => $draftId]);
    }

    public function test_seller_can_save_replace_and_remove_promotion_images(): void
    {
        Storage::fake('public');
        /** @var FilesystemAdapter $publicDisk */
        $publicDisk = Storage::disk('public');
        [$seller, $listing] = $this->sellerAndListing();

        $created = $this->actingAs($seller)->post('/api/seller/promotions', [
            ...$this->promotionPayload($listing),
            'image' => UploadedFile::fake()->image('promotion.jpg'),
        ], ['Accept' => 'application/json'])->assertCreated();
        $promotionId = $created->json('promotion.id');
        $firstPath = SellerPromotion::query()->findOrFail($promotionId)->image_path;
        $this->assertNotNull($firstPath);
        $publicDisk->assertExists($firstPath);
        $this->assertNotEmpty($created->json('promotion.image_url'));

        $this->actingAs($seller)->postJson("/api/seller/promotions/{$promotionId}/activate")->assertOk();
        $this->getJson("/api/listings/{$listing->id}")->assertOk()
            ->assertJsonPath('listing.promotion.name', 'Market day offer')
            ->assertJsonPath('listing.promotion.image_url', $created->json('promotion.image_url'));

        $updated = $this->actingAs($seller)->post("/api/seller/promotions/{$promotionId}", [
            ...$this->promotionPayload($listing, 'Revised offer'),
            '_method' => 'PUT',
            'image' => UploadedFile::fake()->image('replacement.png'),
        ], ['Accept' => 'application/json'])->assertOk();
        $secondPath = SellerPromotion::query()->findOrFail($promotionId)->image_path;
        $this->assertNotSame($firstPath, $secondPath);
        $publicDisk->assertMissing($firstPath);
        $publicDisk->assertExists($secondPath);
        $this->assertNotEmpty($updated->json('promotion.image_url'));

        $this->actingAs($seller)->post("/api/seller/promotions/{$promotionId}", [
            ...$this->promotionPayload($listing, 'Revised offer'),
            '_method' => 'PUT',
            'remove_image' => '1',
        ], ['Accept' => 'application/json'])->assertOk()
            ->assertJsonPath('promotion.image_url', null);
        $this->assertNull(SellerPromotion::query()->findOrFail($promotionId)->image_path);
        $publicDisk->assertMissing($secondPath);
    }

    public function test_promotion_image_upload_rejects_unsupported_and_oversized_files(): void
    {
        [$seller, $listing] = $this->sellerAndListing();
        Storage::fake('public');
        $headers = ['Accept' => 'application/json'];

        $this->actingAs($seller)->post('/api/seller/promotions', [
            ...$this->promotionPayload($listing),
            'image' => UploadedFile::fake()->create('promotion.svg', 20, 'image/svg+xml'),
        ], $headers)->assertUnprocessable()->assertJsonValidationErrors('image');

        $this->actingAs($seller)->post('/api/seller/promotions', [
            ...$this->promotionPayload($listing),
            'image' => UploadedFile::fake()->image('large.jpg')->size(5121),
        ], $headers)->assertUnprocessable()->assertJsonValidationErrors('image');

        $this->assertDatabaseCount('seller_promotions', 0);
    }

    public function test_all_eligible_scope_applies_to_active_listings_of_only_its_seller(): void
    {
        [$seller, $firstListing] = $this->sellerAndListing();
        $secondListing = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $firstListing->category_id,
            'name' => 'Second listing '.$seller->id,
            'quantity' => 4,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 200,
            'status' => ListingStatus::ACTIVE,
        ]);
        [$otherSeller, $otherListing] = $this->sellerAndListing();
        $payload = $this->promotionPayload($firstListing, 'All listing offer', 'FIXED', 10);
        $payload['applies_to_all'] = true;
        unset($payload['listing_ids']);

        $promotionId = $this->actingAs($seller)->postJson('/api/seller/promotions', $payload)->assertCreated()->json('promotion.id');
        $this->actingAs($seller)->postJson("/api/seller/promotions/{$promotionId}/activate")->assertOk();

        $this->getJson('/api/listings?promotions=1')->assertOk()
            ->assertJsonCount(2, 'data');
        $this->getJson('/api/listings/'.$secondListing->id)->assertOk()->assertJsonPath('listing.current_price', '190.00');
        $this->getJson('/api/listings/'.$otherListing->id)->assertOk()->assertJsonPath('listing.current_price', '100.00');
        $this->assertDatabaseHas('seller_promotions', ['seller_id' => $seller->id, 'applies_to_all' => true]);
        $this->assertNotSame($seller->id, $otherSeller->id);
    }

    public function test_scheduler_ends_expired_active_promotions_and_audits_the_transition(): void
    {
        [$seller, $listing] = $this->sellerAndListing();
        $promotionId = $this->actingAs($seller)->postJson('/api/seller/promotions', $this->promotionPayload($listing))->assertCreated()->json('promotion.id');
        $this->actingAs($seller)->postJson("/api/seller/promotions/{$promotionId}/activate")->assertOk();
        SellerPromotion::query()->whereKey($promotionId)->update(['ends_at' => now()->subMinute()]);

        $this->artisan('promotions:expire')->assertSuccessful()->expectsOutput('1 seller promotion(s) expired.');

        $this->assertDatabaseHas('seller_promotions', ['id' => $promotionId, 'status' => 'ENDED']);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'seller.promotion.expired',
            'entity_id' => (string) $promotionId,
            'user_id' => null,
            'database_action' => 'UPDATE',
        ]);
    }

    private function sellerAndListing(): array
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $category = Category::create(['name' => 'Promotion livestock '.$seller->id, 'slug' => 'promotion-livestock-'.$seller->id]);
        $listing = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Promo listing '.$seller->id,
            'quantity' => 10,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 100,
            'status' => ListingStatus::ACTIVE,
        ]);

        return [$seller, $listing];
    }

    private function promotionPayload(LivestockListing $listing, string $name = 'Market day offer', string $type = 'PERCENTAGE', int|float $discount = 15): array
    {
        return [
            'name' => $name,
            'description' => null,
            'discount_type' => $type,
            'discount_value' => $discount,
            'applies_to_all' => false,
            'listing_ids' => [$listing->id],
            'starts_at' => now()->subMinute()->toISOString(),
            'ends_at' => now()->addDay()->toISOString(),
        ];
    }
}
