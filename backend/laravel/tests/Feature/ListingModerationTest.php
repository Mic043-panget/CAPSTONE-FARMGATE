<?php

namespace Tests\Feature;

use App\Enums\ListingStatus;
use App\Enums\PricingType;
use App\Enums\Role;
use App\Jobs\ModerateListing;
use App\Models\Category;
use App\Models\ListingModerationAttempt;
use App\Models\LivestockListing;
use App\Models\User;
use App\Services\ListingModerationProvider;
use App\Services\ListingModerationService;
use App\Services\SystemSettingsService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Mockery;
use RuntimeException;
use Tests\TestCase;

class ListingModerationTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_listing_details_include_seller_photos_and_moderation_history(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $listing = $this->pendingListing();
        $listing->images()->create(['url' => 'https://farmgate.test/listing.jpg', 'alt_text' => 'Livestock photo']);
        $listing->moderationAttempts()->create([
            'seller_id' => $listing->seller_id,
            'attempt_number' => 1,
            'status' => 'MANUAL_REVIEW',
            'reasons' => ['Manual review requested.'],
        ]);

        $this->actingAs($admin)->getJson('/api/admin/listings/'.$listing->id)
            ->assertOk()
            ->assertJsonPath('listing.seller.email', $listing->seller->email)
            ->assertJsonPath('listing.images.0.alt_text', 'Livestock photo')
            ->assertJsonPath('listing.moderation_attempts.0.reasons.0', 'Manual review requested.');

        $this->actingAs(User::factory()->create(['role' => Role::BUYER]))
            ->getJson('/api/admin/listings/'.$listing->id)
            ->assertForbidden();
    }

    public function test_seller_can_find_their_listing_by_id_from_a_notification(): void
    {
        $listing = $this->pendingListing();

        $this->actingAs($listing->seller)->getJson('/api/seller/listings?q='.$listing->id)
            ->assertOk()
            ->assertJsonPath('listings.data.0.id', $listing->id);

        $otherSeller = User::factory()->create(['role' => Role::SELLER]);
        $this->actingAs($otherSeller)->getJson('/api/seller/listings?q='.$listing->id)
            ->assertOk()
            ->assertJsonCount(0, 'listings.data');
    }

    public function test_high_confidence_valid_result_auto_approves_and_is_idempotent(): void
    {
        config(['services.gemini.moderation_confidence_threshold' => 0.9]);
        $listing = $this->pendingListing();
        $provider = Mockery::mock(ListingModerationProvider::class);
        $provider->shouldReceive('review')->once()->andReturn($this->approvedResult());
        $this->app->instance(ListingModerationProvider::class, $provider);

        app(ListingModerationService::class)->moderate($listing->id);
        app(ListingModerationService::class)->moderate($listing->id);

        $this->assertSame(ListingStatus::ACTIVE, $listing->fresh()->status);
        $this->assertSame('AUTO_APPROVED', $listing->moderationAttempts()->firstOrFail()->status);
        $this->assertSame(1, $listing->moderationAttempts()->count());
        $this->assertDatabaseHas('notifications', [
            'notifiable_id' => $listing->seller_id,
            'data->type' => 'listing_moderation_updated',
            'data->moderation_status' => 'AUTO_APPROVED',
        ]);
        $this->actingAs($listing->seller)->getJson('/api/notifications')
            ->assertOk()
            ->assertJsonPath('notifications.0.data.moderation_status', 'AUTO_APPROVED');
    }

    public function test_uncertain_or_low_confidence_result_remains_pending_for_admin(): void
    {
        $listing = $this->pendingListing();
        $provider = Mockery::mock(ListingModerationProvider::class);
        $provider->shouldReceive('review')->once()->andReturn($this->approvedResult(0.65));
        $this->app->instance(ListingModerationProvider::class, $provider);

        app(ListingModerationService::class)->moderate($listing->id);

        $this->assertSame(ListingStatus::PENDING_REVIEW, $listing->fresh()->status);
        $this->assertSame('MANUAL_REVIEW', $listing->moderationAttempts()->firstOrFail()->status);
        $notification = $listing->seller->notifications()->firstOrFail();
        $this->assertSame('listing_moderation_updated', $notification->data['type']);
        $this->assertSame('MANUAL_REVIEW', $notification->data['moderation_status']);
        $this->assertContains('Confidence is below the configured automatic decision threshold.', $notification->data['reasons']);
        $this->actingAs($listing->seller)->getJson('/api/notifications')
            ->assertOk()
            ->assertJsonPath('notifications.0.data.type', 'listing_moderation_updated')
            ->assertJsonPath('notifications.0.data.reasons.0', 'Confidence is below the configured automatic decision threshold.');
    }

    public function test_invalid_confidence_threshold_fails_closed(): void
    {
        config(['services.gemini.moderation_confidence_threshold' => 'invalid']);
        $listing = $this->pendingListing();
        $provider = Mockery::mock(ListingModerationProvider::class);
        $provider->shouldReceive('review')->once()->andReturn($this->approvedResult(1.0));
        $this->app->instance(ListingModerationProvider::class, $provider);

        app(ListingModerationService::class)->moderate($listing->id);

        $this->assertSame(ListingStatus::PENDING_REVIEW, $listing->fresh()->status);
        $this->assertSame('MANUAL_REVIEW', $listing->moderationAttempts()->firstOrFail()->status);
        $this->assertContains(
            'Confidence threshold configuration is invalid; automatic decisions are disabled.',
            $listing->seller->notifications()->firstOrFail()->data['reasons'],
        );
    }

    public function test_malformed_result_fails_closed_and_admin_can_retry_failed_moderation(): void
    {
        $listing = $this->pendingListing();
        $provider = Mockery::mock(ListingModerationProvider::class);
        $calls = 0;
        $provider->shouldReceive('review')->times(3)->andReturnUsing(function () use (&$calls): array {
            $calls++;
            if ($calls === 1) {
                return ['recommendation' => 'APPROVE', 'confidence' => 'certain'];
            }

            throw new RuntimeException('Provider unavailable');
        });
        $this->app->instance(ListingModerationProvider::class, $provider);

        try {
            app(ListingModerationService::class)->moderate($listing->id);
            $this->fail('Invalid result should be rejected.');
        } catch (RuntimeException) {
            // A malformed model result is stored as a failed attempt and never changes listing state.
        }
        try {
            app(ListingModerationService::class)->moderate($listing->id);
        } catch (RuntimeException) {
            // One queue retry is allowed; the second failed attempt is the limit.
        }
        try {
            app(ListingModerationService::class)->moderate($listing->id);
        } catch (RuntimeException) {
            // The failed attempt is persisted; later retries remain fail-closed.
        }

        $this->assertSame(ListingStatus::PENDING_REVIEW, $listing->fresh()->status);
        $this->assertSame(3, $listing->moderationAttempts()->count());
        $this->assertSame('FAILED', $listing->moderationAttempts()->latest('id')->firstOrFail()->status);
    }

    public function test_ai_cannot_overwrite_an_admin_decision_made_during_provider_call(): void
    {
        $listing = $this->pendingListing();
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $provider = Mockery::mock(ListingModerationProvider::class);
        $provider->shouldReceive('review')->once()->andReturnUsing(function () use ($admin, $listing): array {
            $this->actingAs($admin)->postJson("/api/admin/listings/{$listing->id}/review", ['status' => ListingStatus::REJECTED->value])->assertOk();

            return $this->approvedResult();
        });
        $this->app->instance(ListingModerationProvider::class, $provider);

        app(ListingModerationService::class)->moderate($listing->id);

        $this->assertSame(ListingStatus::REJECTED, $listing->fresh()->status);
        $this->assertSame('SUPERSEDED', $listing->moderationAttempts()->firstOrFail()->status);
    }

    public function test_inactive_category_is_deterministically_kept_for_manual_review(): void
    {
        $listing = $this->pendingListing('Other livestock');
        $listing->category()->update(['is_active' => false]);
        $provider = Mockery::mock(ListingModerationProvider::class);
        $provider->shouldNotReceive('review');
        $this->app->instance(ListingModerationProvider::class, $provider);

        app(ListingModerationService::class)->moderate($listing->id);

        $this->assertSame(ListingStatus::PENDING_REVIEW, $listing->fresh()->status);
        $this->assertSame('MANUAL_REVIEW', $listing->moderationAttempts()->firstOrFail()->status);
        $this->assertContains(
            'The listing category is inactive or unavailable.',
            $listing->seller->notifications()->firstOrFail()->data['reasons'],
        );
    }

    public function test_unavailable_remote_image_fails_closed_without_fetching_the_url(): void
    {
        config([
            'services.gemini.api_key' => 'unit-test-key-not-a-real-secret',
            'services.gemini.model' => 'test-model',
        ]);
        Http::fake();
        $listing = $this->pendingListing();
        $listing->images()->create(['url' => 'https://images.example.test/livestock.jpg']);

        try {
            app(ListingModerationService::class)->moderate($listing->id);
            $this->fail('A remote image that cannot be safely analyzed should fail closed.');
        } catch (RuntimeException) {
            // The listing stays pending, and remote media is never fetched by the backend.
        }

        Http::assertNothingSent();
        $this->assertSame(ListingStatus::PENDING_REVIEW, $listing->fresh()->status);
        $this->assertSame('FAILED', $listing->moderationAttempts()->firstOrFail()->status);
    }

    public function test_low_confidence_rejection_remains_pending_for_admin_review(): void
    {
        $listing = $this->pendingListing();
        $provider = Mockery::mock(ListingModerationProvider::class);
        $provider->shouldReceive('review')->once()->andReturn([
            'recommendation' => 'REJECT',
            'confidence' => 0.65,
            'category_supported' => true,
            'reasons' => ['The listing may not match the selected category.'],
            'flags' => ['potentially misleading'],
        ]);
        $this->app->instance(ListingModerationProvider::class, $provider);
        app(ListingModerationService::class)->moderate($listing->id);

        $this->assertSame(ListingStatus::PENDING_REVIEW, $listing->fresh()->status);
        $this->assertSame('FLAGGED', $listing->moderationAttempts()->firstOrFail()->status);
        $notification = $listing->seller->notifications()->firstOrFail();
        $this->assertContains('The listing may not match the selected category.', $notification->data['reasons']);
        $this->assertContains('Confidence is below the configured automatic decision threshold.', $notification->data['reasons']);
        $this->assertContains('potentially misleading', $notification->data['flags']);

        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $this->actingAs($admin)->getJson('/api/admin/listings?moderation_status=FLAGGED')
            ->assertOk()
            ->assertJsonPath('listings.data.0.id', $listing->id);
    }

    public function test_high_confidence_rejection_rejects_listing_and_notifies_seller_with_reason(): void
    {
        config(['services.gemini.moderation_confidence_threshold' => 0.9]);
        $listing = $this->pendingListing();
        $provider = Mockery::mock(ListingModerationProvider::class);
        $provider->shouldReceive('review')->once()->andReturn([
            'recommendation' => 'REJECT',
            'confidence' => 0.99,
            'category_supported' => true,
            'reasons' => ['The listing appears to advertise a non-livestock product.'],
            'flags' => ['non-livestock content'],
        ]);
        $this->app->instance(ListingModerationProvider::class, $provider);

        app(ListingModerationService::class)->moderate($listing->id);

        $this->assertSame(ListingStatus::REJECTED, $listing->fresh()->status);
        $attempt = $listing->moderationAttempts()->firstOrFail();
        $this->assertSame('AUTO_REJECTED', $attempt->status);
        $this->assertSame(ListingStatus::REJECTED->value, $attempt->final_listing_status);
        $this->assertTrue($attempt->applied_automatically);
        $this->assertStringContainsString('automatically rejected', $attempt->response_summary);

        $notification = $listing->seller->notifications()->firstOrFail();
        $this->assertSame('listing_moderation_updated', $notification->data['type']);
        $this->assertSame('AUTO_REJECTED', $notification->data['moderation_status']);
        $this->assertContains('The listing appears to advertise a non-livestock product.', $notification->data['reasons']);
        $this->assertContains('non-livestock content', $notification->data['flags']);
        $this->actingAs($listing->seller)->getJson('/api/notifications')
            ->assertOk()
            ->assertJsonPath('notifications.0.data.moderation_status', 'AUTO_REJECTED')
            ->assertJsonPath('notifications.0.data.reasons.0', 'The listing appears to advertise a non-livestock product.');

        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $this->actingAs($admin)->getJson('/api/admin/listings?moderation_status=AUTO_REJECTED')
            ->assertOk()
            ->assertJsonPath('listings.data.0.id', $listing->id)
            ->assertJsonPath('listings.data.0.status', ListingStatus::REJECTED->value);
    }

    public function test_auto_approved_listings_are_visible_in_the_ai_filter(): void
    {
        $listing = $this->pendingListing();
        $provider = Mockery::mock(ListingModerationProvider::class);
        $provider->shouldReceive('review')->once()->andReturn($this->approvedResult());
        $this->app->instance(ListingModerationProvider::class, $provider);
        app(ListingModerationService::class)->moderate($listing->id);

        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $this->actingAs($admin)->getJson('/api/admin/listings?moderation_status=AUTO_APPROVED')
            ->assertOk()
            ->assertJsonPath('listings.data.0.id', $listing->id)
            ->assertJsonPath('listings.data.0.latest_moderation_attempt.applied_automatically', true)
            ->assertJsonPath('listings.data.0.latest_moderation_attempt.final_listing_status', 'ACTIVE');
    }

    public function test_admin_override_reason_and_final_status_are_saved(): void
    {
        $listing = $this->pendingListing();
        $admin = User::factory()->create(['role' => Role::ADMIN]);

        $this->actingAs($admin)->postJson("/api/admin/listings/{$listing->id}/review", [
            'status' => ListingStatus::REJECTED->value,
            'reason' => 'Insufficient listing details.',
        ])->assertOk();

        $this->assertDatabaseHas('listing_moderation_attempts', [
            'listing_id' => $listing->id,
            'seller_id' => $listing->seller_id,
            'status' => 'ADMIN_OVERRIDE',
            'final_listing_status' => ListingStatus::REJECTED->value,
            'admin_override_by' => $admin->id,
            'admin_override_reason' => 'Insufficient listing details.',
        ]);
        $this->assertDatabaseHas('notifications', [
            'notifiable_id' => $listing->seller_id,
            'data->type' => 'listing_moderation_updated',
            'data->moderation_status' => 'ADMIN_REJECTED',
        ]);
        $this->assertSame(
            ['Insufficient listing details.'],
            $listing->seller->notifications()->firstOrFail()->data['reasons'],
        );
    }

    public function test_admin_approval_respects_the_configured_active_listing_limit(): void
    {
        $listing = $this->pendingListing();
        $seller = $listing->seller;
        $active = $this->pendingListing('Goat', ListingStatus::ACTIVE, $seller);
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        app(SystemSettingsService::class)->update([
            'maximum_active_listings' => 1,
        ], $admin->id, 'Listing limit test');

        $this->actingAs($admin)->postJson("/api/admin/listings/{$listing->id}/review", [
            'status' => ListingStatus::ACTIVE->value,
        ])->assertStatus(422)
            ->assertJsonPath('message', 'Maximum active listings reached.');

        $this->assertSame(ListingStatus::PENDING_REVIEW, $listing->fresh()->status);
        $this->assertSame(ListingStatus::ACTIVE, $active->fresh()->status);
        $this->assertDatabaseMissing('notifications', [
            'notifiable_id' => $seller->id,
            'data->moderation_status' => 'ADMIN_APPROVED',
        ]);
    }

    public function test_submit_dispatches_async_moderation_and_non_seller_cannot_submit(): void
    {
        Queue::fake();
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $listing = $this->pendingListing('Swine', ListingStatus::DRAFT, $seller);
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        app(SystemSettingsService::class)->update([
            'seller_listing_approval_required' => true,
        ], $admin->id, 'Moderation test');

        $this->actingAs($seller)->postJson("/api/seller/listings/{$listing->id}/submit")
            ->assertOk()
            ->assertJsonPath('listing.status', ListingStatus::PENDING_REVIEW->value);
        Queue::assertPushed(ModerateListing::class, fn (ModerateListing $job): bool => $job->listingId === $listing->id);

        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $this->actingAs($buyer)->postJson("/api/seller/listings/{$listing->id}/submit")->assertForbidden();
    }

    public function test_admin_moderation_filter_requires_admin_role_and_returns_attempt_history(): void
    {
        $listing = $this->pendingListing();
        ListingModerationAttempt::create([
            'listing_id' => $listing->id,
            'attempt_number' => 1,
            'status' => 'MANUAL_REVIEW',
            'recommendation' => 'REVIEW',
            'confidence' => 0.5,
            'model' => 'test-model',
        ]);

        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $this->actingAs($buyer)->getJson('/api/admin/listings?moderation_status=MANUAL_REVIEW')->assertForbidden();
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $this->actingAs($admin)->getJson('/api/admin/listings?moderation_status=MANUAL_REVIEW')
            ->assertOk()
            ->assertJsonPath('listings.data.0.latest_moderation_attempt.status', 'MANUAL_REVIEW');
    }

    public function test_admin_can_retry_failed_moderation_without_exposing_provider_calls(): void
    {
        Queue::fake();
        $listing = $this->pendingListing();
        ListingModerationAttempt::create([
            'listing_id' => $listing->id,
            'seller_id' => $listing->seller_id,
            'attempt_number' => 1,
            'status' => 'FAILED',
            'completed_at' => now(),
        ]);
        $admin = User::factory()->create(['role' => Role::ADMIN]);

        $this->actingAs($admin)->postJson("/api/admin/listings/{$listing->id}/moderation-retry")
            ->assertOk()
            ->assertJsonPath('message', 'AI moderation retry queued.');
        Queue::assertPushed(ModerateListing::class, fn (ModerateListing $job): bool => $job->listingId === $listing->id);
        Http::assertNothingSent();

        $this->actingAs($admin)->postJson("/api/admin/listings/{$listing->id}/moderation-retry")->assertTooManyRequests();
    }

    public function test_seller_can_upload_up_to_five_valid_photos_and_more_are_rejected(): void
    {
        Storage::fake('public');
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $seller->sellerProfile()->create(['business_name' => 'Photo Seller', 'is_verified' => true]);
        $category = Category::create(['name' => 'Swine', 'slug' => 'swine']);
        $payload = [
            'category_id' => $category->id,
            'name' => 'Farm pig',
            'quantity' => 1,
            'pricing_type' => PricingType::PER_HEAD->value,
            'price_per_head' => 900,
            'image_files' => array_map(fn (int $index) => UploadedFile::fake()->image("pig-{$index}.jpg"), range(1, 5)),
        ];

        $response = $this->actingAs($seller)->post('/api/seller/listings', $payload, ['Accept' => 'application/json']);
        $response->assertCreated()->assertJsonCount(5, 'listing.images');
        $this->assertSame(5, LivestockListing::firstOrFail()->images()->count());
        $this->assertCount(5, Storage::disk('public')->allFiles('listing-images'));

        $payload['image_files'][] = UploadedFile::fake()->image('pig-6.jpg');
        $this->actingAs($seller)->post('/api/seller/listings', $payload, ['Accept' => 'application/json'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('image_files');

        $payload['image_files'] = [UploadedFile::fake()->create('not-a-photo.svg', 10, 'image/svg+xml')];
        $this->actingAs($seller)->post('/api/seller/listings', $payload, ['Accept' => 'application/json'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('image_files.0');
    }

    private function pendingListing(string $categoryName = 'Swine', ListingStatus $status = ListingStatus::PENDING_REVIEW, ?User $seller = null): LivestockListing
    {
        $seller ??= User::factory()->create(['role' => Role::SELLER]);
        $category = Category::firstOrCreate(['slug' => str($categoryName)->slug()], ['name' => $categoryName]);

        return LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Bongabong pig',
            'quantity' => 2,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 900,
            'status' => $status,
        ]);
    }

    private function approvedResult(float $confidence = 0.98): array
    {
        return [
            'recommendation' => 'APPROVE',
            'confidence' => $confidence,
            'category_supported' => true,
            'reasons' => ['Listing is relevant to its category.'],
            'flags' => [],
        ];
    }
}
