<?php

namespace Tests\Unit;

use App\Models\Category;
use App\Models\LivestockListing;
use App\Models\User;
use App\Services\GeminiListingModerationProvider;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as ClientRequest;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use RuntimeException;
use Tests\TestCase;

class GeminiListingModerationProviderTest extends TestCase
{
    use RefreshDatabase;

    public function test_sends_only_moderation_fields_and_parses_structured_json(): void
    {
        config([
            'services.gemini.api_key' => 'unit-test-key-not-a-real-secret',
            'services.gemini.model' => 'test-model',
        ]);
        $listing = $this->listing();
        $content = json_encode([
            'recommendation' => 'APPROVE',
            'confidence' => 0.97,
            'category_supported' => true,
            'reasons' => ['Relevant listing.'],
            'flags' => [],
        ]);
        Http::fake(['*' => Http::response([
            'candidates' => [['content' => ['parts' => [['text' => $content]]]]],
        ])]);

        $result = app(GeminiListingModerationProvider::class)->review($listing);

        $this->assertSame('APPROVE', $result['recommendation']);
        Http::assertSent(function (ClientRequest $request): bool {
            $body = json_encode($request->data());

            return str_contains($request->url(), 'models/test-model:generateContent')
                && $request->header('x-goog-api-key') === ['unit-test-key-not-a-real-secret']
                && str_contains((string) $body, 'Bongabong pig')
                && ! str_contains((string) $body, 'private pickup address')
                && ! str_contains((string) $body, 'seller@example.test');
        });
    }

    public function test_invalid_json_response_fails_without_a_model_decision(): void
    {
        config(['services.gemini.api_key' => 'unit-test-key-not-a-real-secret']);
        Http::fake(['*' => Http::response([
            'candidates' => [['content' => ['parts' => [['text' => 'not json']]]]],
        ])]);

        $this->expectException(RuntimeException::class);
        app(GeminiListingModerationProvider::class)->review($this->listing());
    }

    public function test_provider_quota_error_fails_closed(): void
    {
        config(['services.gemini.api_key' => 'unit-test-key-not-a-real-secret']);
        Http::fake(['*' => Http::response(['error' => ['status' => 'RESOURCE_EXHAUSTED']], 429)]);

        $this->expectException(RuntimeException::class);
        app(GeminiListingModerationProvider::class)->review($this->listing());
    }

    public function test_uploaded_listing_photo_is_sent_as_inline_image_data(): void
    {
        config([
            'services.gemini.api_key' => 'unit-test-key-not-a-real-secret',
            'services.gemini.model' => 'test-model',
        ]);
        Storage::fake('public');
        $listing = $this->listing();
        $path = UploadedFile::fake()->image('pig.jpg')->storePublicly('listing-images', 'public');
        $listing->images()->create(['url' => Storage::disk('public')->url($path)]);
        $structuredResult = json_encode([
            'recommendation' => 'APPROVE',
            'confidence' => 0.97,
            'category_supported' => true,
            'reasons' => ['The image and listing are consistent.'],
            'flags' => [],
        ]);
        Http::fake([
            '*' => Http::response([
                'candidates' => [
                    [
                        'content' => [
                            'parts' => [['text' => $structuredResult]],
                        ],
                    ],
                ],
            ]),
        ]);

        app(GeminiListingModerationProvider::class)->review($listing);

        Http::assertSent(function (ClientRequest $request): bool {
            $parts = $request->data()['contents'][0]['parts'];
            $imagePart = $parts[1] ?? [];

            return isset($imagePart['inlineData']['mimeType'], $imagePart['inlineData']['data'])
                && $imagePart['inlineData']['mimeType'] === 'image/jpeg'
                && $imagePart['inlineData']['data'] !== '';
        });
    }

    private function listing(): LivestockListing
    {
        $category = Category::create(['name' => 'Swine', 'slug' => 'swine']);

        return LivestockListing::create([
            'seller_id' => User::factory()->create()->id,
            'category_id' => $category->id,
            'name' => 'Bongabong pig',
            'quantity' => 1,
            'pickup_location' => 'private pickup address',
            'pricing_type' => 'PER_HEAD',
            'price_per_head' => 1000,
            'status' => 'PENDING_REVIEW',
        ]);
    }
}
