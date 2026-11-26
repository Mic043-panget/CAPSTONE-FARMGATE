<?php

namespace Tests\Feature;

use App\Enums\ListingStatus;
use App\Enums\PricingType;
use App\Enums\Role;
use App\Models\Category;
use App\Models\LivestockListing;
use App\Models\User;
use App\Services\Chat\ChatProvider;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery;
use Tests\TestCase;

class AiListingSearchTest extends TestCase
{
    use RefreshDatabase;

    public function test_guest_ai_search_returns_validated_filters_for_the_public_listings_endpoint(): void
    {
        $cow = Category::create(['name' => 'Cow', 'slug' => 'cow']);
        Category::create(['name' => 'Goat', 'slug' => 'goat']);
        Category::create(['name' => 'Inactive', 'slug' => 'inactive', 'is_active' => false]);

        $provider = Mockery::mock(ChatProvider::class);
        $provider->shouldReceive('respond')
            ->once()
            ->withArgs(fn (string $instruction, array $history): bool => str_contains($instruction, '"Cow"')
                && ! str_contains($instruction, '"Inactive"')
                && $history === [['role' => 'user', 'content' => 'female Sahiwal under 25000']])
            ->andReturn(json_encode([
                'keywords' => 'Sahiwal',
                'category' => 'Cow',
                'sex' => 'female',
                'min_age_months' => 6,
                'max_age_months' => null,
                'min_price' => null,
                'max_price' => 25000,
                'pricing_type' => 'PER_HEAD',
                'sort' => 'price_asc',
            ], JSON_THROW_ON_ERROR));
        app()->instance(ChatProvider::class, $provider);

        $this->postJson('/api/listings/ai-search', ['query' => 'female Sahiwal under 25000'])
            ->assertOk()
            ->assertJsonPath('filters.keywords', 'Sahiwal')
            ->assertJsonPath('filters.category_id', $cow->id)
            ->assertJsonPath('filters.sex', 'female')
            ->assertJsonPath('filters.min_age_months', 6)
            ->assertJsonPath('filters.max_price', 25000)
            ->assertJsonPath('filters.pricing_type', 'PER_HEAD')
            ->assertJsonPath('filters.sort', 'price_asc');
    }

    public function test_tagalog_search_terms_are_translated_for_english_listing_descriptions(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $goat = Category::create(['name' => 'Goat', 'slug' => 'goat']);
        $base = [
            'seller_id' => $seller->id,
            'category_id' => $goat->id,
            'quantity' => 1,
            'pricing_type' => PricingType::PER_HEAD,
            'status' => ListingStatus::ACTIVE,
        ];

        $healthy = new LivestockListing($base + [
            'name' => 'Boer livestock',
            'description' => 'Healthy, well cared for animal.',
            'sex' => 'Female',
            'price_per_head' => 12000,
        ]);
        $healthy->seller_id = $seller->id;
        $healthy->save();
        $unrelated = new LivestockListing($base + [
            'name' => 'Young livestock',
            'description' => 'Young animal available.',
            'sex' => 'Male',
            'price_per_head' => 9000,
        ]);
        $unrelated->seller_id = $seller->id;
        $unrelated->save();

        $provider = Mockery::mock(ChatProvider::class);
        $provider->shouldReceive('respond')
            ->once()
            ->withArgs(fn (string $instruction, array $history): bool => str_contains($instruction, 'Filipino/Tagalog')
                && str_contains($instruction, 'English search terms')
                && str_contains($instruction, 'close listing-description equivalents')
                && $history === [['role' => 'user', 'content' => 'malusog']])
            ->andReturn(json_encode([
                'keywords' => 'malusog healthy disease-free well cared for',
                'category' => null,
                'sex' => null,
                'min_age_months' => null,
                'max_age_months' => null,
                'min_price' => null,
                'max_price' => null,
                'pricing_type' => null,
                'sort' => 'newest',
            ], JSON_THROW_ON_ERROR));
        app()->instance(ChatProvider::class, $provider);

        $filters = $this->postJson('/api/listings/ai-search', ['query' => 'malusog'])
            ->assertOk()
            ->assertJsonPath('filters.keywords', 'malusog healthy disease-free well cared for')
            ->json('filters');

        $this->getJson('/api/listings?q='.urlencode('malusog '.$filters['keywords']))
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $healthy->id);
    }

    public function test_ai_search_normalizes_keyword_lists_from_the_provider(): void
    {
        $goat = Category::create(['name' => 'Goat', 'slug' => 'goat']);
        $provider = Mockery::mock(ChatProvider::class);
        $provider->shouldReceive('respond')->once()->andReturn(json_encode([
            'keywords' => ['malusog', 'healthy', 'well cared for'],
            'category' => 'Goat',
            'sex' => null,
            'min_age_months' => null,
            'max_age_months' => null,
            'min_price' => null,
            'max_price' => null,
            'pricing_type' => null,
            'sort' => 'newest',
        ], JSON_THROW_ON_ERROR));
        app()->instance(ChatProvider::class, $provider);

        $this->postJson('/api/listings/ai-search', ['query' => 'malusog na kambing'])
            ->assertOk()
            ->assertJsonPath('filters.keywords', 'malusog healthy well cared for')
            ->assertJsonPath('filters.category_id', $goat->id);
    }

    public function test_invalid_ai_search_response_is_reported_as_unavailable(): void
    {
        $provider = Mockery::mock(ChatProvider::class);
        $provider->shouldReceive('respond')->once()->andReturn('not json');
        app()->instance(ChatProvider::class, $provider);

        $this->postJson('/api/listings/ai-search', ['query' => 'healthy goat'])
            ->assertStatus(503)
            ->assertJsonPath('message', "AI search is temporarily unavailable. We're showing regular listing matches from your search words instead.");
    }

    public function test_ai_search_filters_only_matching_active_public_listings(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $goat = Category::create(['name' => 'Goat', 'slug' => 'goat']);
        $base = [
            'seller_id' => $seller->id,
            'category_id' => $goat->id,
            'quantity' => 1,
            'pricing_type' => PricingType::PER_HEAD,
            'status' => ListingStatus::ACTIVE,
        ];

        $matching = new LivestockListing($base + [
            'name' => 'Young Boer Goat',
            'sex' => 'Female',
            'age_months' => 8,
            'price_per_head' => 12000,
        ]);
        $matching->seller_id = $seller->id;
        $matching->save();
        $wrongSex = new LivestockListing($base + [
            'name' => 'Male Boer Goat',
            'sex' => 'Male',
            'age_months' => 8,
            'price_per_head' => 12000,
        ]);
        $wrongSex->seller_id = $seller->id;
        $wrongSex->save();
        $wrongAge = new LivestockListing($base + [
            'name' => 'Older Female Goat',
            'sex' => 'Female',
            'age_months' => 24,
            'price_per_head' => 12000,
        ]);
        $wrongAge->seller_id = $seller->id;
        $wrongAge->save();
        $hidden = new LivestockListing(array_replace($base, [
            'name' => 'Hidden Female Goat',
            'sex' => 'Female',
            'age_months' => 8,
            'price_per_head' => 12000,
            'status' => ListingStatus::PENDING_REVIEW,
        ]));
        $hidden->seller_id = $seller->id;
        $hidden->save();

        $this->getJson('/api/listings?category_id='.$goat->id.'&sex=female&min_age_months=6&max_age_months=12&max_price=25000&pricing_type=PER_HEAD&sort=price_asc')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name', 'Young Boer Goat');
    }

    public function test_ai_search_validates_query_length(): void
    {
        $this->postJson('/api/listings/ai-search', ['query' => 'go'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('query');
    }
}
