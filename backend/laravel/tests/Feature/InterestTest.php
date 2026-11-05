<?php

namespace Tests\Feature;

use App\Enums\InterestStatus;
use App\Enums\ListingStatus;
use App\Enums\PricingType;
use App\Enums\Role;
use App\Models\Category;
use App\Models\Interest;
use App\Models\LivestockListing;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class InterestTest extends TestCase
{
    use RefreshDatabase;

    public function test_buyer_can_toggle_interest_on_an_active_listing(): void
    {
        [$buyer, $listing] = $this->buyerAndListing();

        $this->actingAs($buyer)->postJson("/api/listings/{$listing->id}/interest")
            ->assertOk()->assertJsonPath('interested', true);
        $this->assertDatabaseHas('interests', ['buyer_id' => $buyer->id, 'livestock_listing_id' => $listing->id]);

        $this->actingAs($buyer)->postJson("/api/listings/{$listing->id}/interest")
            ->assertOk()->assertJsonPath('interested', false);
        $this->assertSoftDeleted('interests', ['buyer_id' => $buyer->id, 'livestock_listing_id' => $listing->id]);
    }

    public function test_seller_cannot_toggle_interest_and_only_owns_interests_are_visible(): void
    {
        [$buyer, $listing] = $this->buyerAndListing();
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $otherSeller = User::factory()->create(['role' => Role::SELLER]);
        $listing->seller_id = $seller->id;
        $listing->save();
        $otherListing = new LivestockListing([
            'category_id' => $listing->category_id,
            'name' => 'Other active livestock',
            'quantity' => 1,
            'status' => ListingStatus::ACTIVE,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 100,
        ]);
        $otherListing->seller_id = $otherSeller->id;
        $otherListing->save();
        $this->createInterest($buyer, $listing);
        $this->createInterest($buyer, $otherListing);

        $this->actingAs($seller)->postJson("/api/listings/{$listing->id}/interest")->assertForbidden();
        $this->actingAs($seller)->getJson('/api/seller/interests')
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('pending_total', 1);

        $interest = Interest::query()->where('livestock_listing_id', $listing->id)->firstOrFail();
        $this->actingAs($seller)->patchJson("/api/seller/interests/{$interest->id}", ['status' => InterestStatus::CONTACTED->value])
            ->assertOk();
        $this->getJson('/api/seller/interests')->assertOk()->assertJsonPath('pending_total', 0);
    }

    public function test_only_buyers_can_view_their_interests(): void
    {
        [$buyer, $listing] = $this->buyerAndListing();
        $this->createInterest($buyer, $listing);

        $this->actingAs($buyer)->getJson('/api/buyer/interests')->assertOk()->assertJsonCount(1, 'interests');
        $this->actingAs(User::factory()->create(['role' => Role::SELLER]))->getJson('/api/buyer/interests')->assertForbidden();
    }

    private function buyerAndListing(): array
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $category = Category::create(['name' => fake()->unique()->word(), 'slug' => fake()->unique()->slug()]);
        $listing = new LivestockListing([
            'category_id' => $category->id,
            'name' => 'Active livestock',
            'quantity' => 1,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 500,
            'status' => ListingStatus::ACTIVE,
        ]);
        $listing->seller_id = $seller->id;
        $listing->save();

        return [$buyer, $listing];
    }

    private function createInterest(User $buyer, LivestockListing $listing): Interest
    {
        $interest = new Interest(['status' => InterestStatus::INTERESTED]);
        $interest->buyer_id = $buyer->id;
        $interest->livestock_listing_id = $listing->id;
        $interest->save();

        return $interest;
    }
}
