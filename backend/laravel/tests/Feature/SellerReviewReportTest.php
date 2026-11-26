<?php

namespace Tests\Feature;

use App\Enums\ListingStatus;
use App\Enums\OrderStatus;
use App\Enums\PricingType;
use App\Enums\Role;
use App\Models\AuditLog;
use App\Models\Category;
use App\Models\LivestockListing;
use App\Models\Order;
use App\Models\Review;
use App\Models\ReviewReport;
use App\Models\ReviewReportMedia;
use App\Models\User;
use App\Notifications\SellerReviewReportNotification;
use App\Services\AuditContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\RefreshDatabaseState;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class SellerReviewReportTest extends TestCase
{
    use RefreshDatabase;

    protected function connectionsToTransact(): array
    {
        return [];
    }

    protected function afterRefreshingDatabase(): void
    {
        $this->beforeApplicationDestroyed(function (): void {
            $this->artisan('migrate:fresh', $this->migrateFreshUsing());
            RefreshDatabaseState::$migrated = false;
        });
    }

    public function test_seller_reviews_still_load_before_the_seller_report_migration_is_applied(): void
    {
        [$seller, , , $review] = $this->createReviewFixture();
        Schema::table('review_reports', function ($table): void {
            $table->dropColumn(['reporter_role', 'explanation']);
        });

        $this->actingAs($seller)->getJson('/api/seller/reviews')
            ->assertOk()
            ->assertJsonPath('reviews.data.0.review_reference', $review->review_reference)
            ->assertJsonPath('reviews.data.0.seller_report_status', null);
    }

    public function test_seller_report_is_private_audited_and_resolved_by_admin(): void
    {
        Storage::fake('case_media');
        [$seller, $buyer, $admin, $review, $order] = $this->createReviewFixture();
        app(AuditContext::class)->clear();
        $this->actingAs($seller)->postJson("/api/seller/reviews/{$review->id}/reports", [
            'reason' => 'NOT_A_REASON',
            'explanation' => str_repeat('x', 501),
        ])->assertUnprocessable()
            ->assertJsonValidationErrors(['reason', 'explanation']);
        $this->assertSame(0, ReviewReport::query()->count());
        app(AuditContext::class)->clear();
        $evidence = UploadedFile::fake()->image('policy-evidence.jpg', 64, 64);

        $this->actingAs($seller)->post("/api/seller/reviews/{$review->id}/reports", [
            'reason' => 'FAKE_OR_UNRELATED',
            'explanation' => 'This comment does not describe the livestock transaction.',
            'evidence' => [$evidence],
        ])->assertCreated()
            ->assertJsonPath('report.status', 'OPEN');

        $report = ReviewReport::query()->where('review_id', $review->id)->firstOrFail();
        $media = ReviewReportMedia::query()->where('review_report_id', $report->id)->firstOrFail();
        $this->assertSame('SELLER', $report->reporter_role);
        $this->assertSame('FAKE_OR_UNRELATED', $report->reason);
        $this->assertSame('PUBLISHED', Review::query()->findOrFail($review->id)->status->value);
        $this->assertSame(2, Review::query()->findOrFail($review->id)->rating);
        Storage::disk('case_media')->assertExists($media->path);
        $this->assertDatabaseHas('audit_logs', ['entity_type' => 'ReviewReport', 'entity_id' => $report->id]);

        $this->actingAs($seller)->getJson('/api/seller/reviews')
            ->assertOk()
            ->assertJsonPath('reviews.data.0.seller_report_status', 'OPEN')
            ->assertJsonMissingPath('reviews.data.0.reports')
            ->assertJsonMissing(['explanation' => 'This comment does not describe the livestock transaction.']);

        $adminQueue = $this->actingAs($admin)->getJson('/api/admin/reviews/reports');
        $adminQueue->assertOk()
            ->assertJsonPath('reviews.data.0.reports.0.reporter_role', 'SELLER')
            ->assertJsonPath('reviews.data.0.reports.0.reason', 'FAKE_OR_UNRELATED')
            ->assertJsonPath('reviews.data.0.reports.0.explanation', 'This comment does not describe the livestock transaction.');
        $mediaUrl = $adminQueue->json('reviews.data.0.reports.0.media_files.0.url');
        $this->assertNotEmpty($mediaUrl);

        $this->actingAs($buyer)->get($mediaUrl)->assertForbidden();
        $this->actingAs($seller)->get($mediaUrl)->assertForbidden();
        $this->actingAs($admin)->get($mediaUrl)->assertOk();

        $otherSeller = User::factory()->create(['role' => Role::SELLER]);
        $this->actingAs($otherSeller)->postJson("/api/seller/reviews/{$review->id}/reports", [
            'reason' => 'SPAM',
        ])->assertNotFound();
        $this->actingAs($buyer)->postJson("/api/seller/reviews/{$review->id}/reports", [
            'reason' => 'SPAM',
        ])->assertForbidden();

        $this->actingAs($seller)->postJson("/api/seller/reviews/{$review->id}/reports", [
            'reason' => 'SPAM',
        ])->assertStatus(409)->assertJsonPath('report.status', 'OPEN');
        $this->assertSame(1, ReviewReport::query()->where('review_id', $review->id)->count());

        $this->actingAs($otherSeller)->patchJson("/api/admin/reviews/{$review->id}/moderation", [
            'status' => 'HIDDEN',
            'reason' => 'Admin reviewed the seller report.',
        ])->assertForbidden();
        $this->actingAs($admin)->patchJson("/api/admin/reviews/{$review->id}/moderation", [
            'status' => 'HIDDEN',
            'reason' => 'Admin reviewed the seller report.',
        ])->assertOk()->assertJsonPath('review.status', 'HIDDEN');

        $this->assertDatabaseHas('review_reports', ['id' => $report->id, 'status' => 'REVIEWED']);
        $reviewAudit = AuditLog::query()->where('entity_type', 'Review')->where('entity_id', $review->id)->latest()->firstOrFail();
        $this->assertTrue(collect($reviewAudit->metadata['database_changes'])->contains(
            fn (array $change): bool => $change['entity_type'] === 'ReviewReport'
                && collect($change['changed_fields'])->contains(fn (array $field): bool => $field['field'] === 'status'),
        ));
        $this->assertDatabaseHas('order_activities', ['order_id' => $order->id, 'activity_key' => 'REVIEW_MODERATED']);
        $this->assertDatabaseHas('notifications', [
            'notifiable_id' => $seller->id,
            'type' => SellerReviewReportNotification::class,
        ]);
        $sellerNotifications = DB::table('notifications')
            ->where('notifiable_id', $seller->id)
            ->where('type', SellerReviewReportNotification::class)
            ->get()
            ->map(fn ($notification) => json_decode($notification->data, true)['status'])
            ->all();
        $this->assertEqualsCanonicalizing(['received', 'resolved'], $sellerNotifications);

        $sellerReviews = $this->actingAs($seller)->getJson('/api/seller/reviews')->assertOk();
        $this->assertSame('REVIEWED', $sellerReviews->json('reviews.data.0.seller_report_status'));
        $this->assertTrue(
            $sellerReviews->json('reviews.data.0.status') === 'HIDDEN',
            'The reporting seller should be able to see the report outcome for the review they reported.',
        );
        $this->assertSame(1, AuditLog::query()->where('entity_type', 'ReviewReport')->where('entity_id', $report->id)->count());

        $adminQueueAfterDecision = $this->actingAs($admin)->getJson('/api/admin/reviews/reports')->assertOk();
        $this->assertNotEmpty($adminQueueAfterDecision->json('reviews.data.0.moderation_history'));
    }

    /**
     * @return array{User, User, User, Review, Order}
     */
    private function createReviewFixture(): array
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $category = Category::create(['name' => 'Review Report Goats', 'slug' => 'review-report-goats']);
        $listing = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Review Report Boer Goat',
            'quantity' => 3,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 5000,
            'status' => ListingStatus::ACTIVE,
        ]);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::COMPLETED,
            'total_amount' => 5000,
        ]);
        $review = Review::create([
            'order_id' => $order->id,
            'listing_id' => $listing->id,
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'rating' => 2,
            'comment' => 'An unrelated comment.',
            'status' => 'PUBLISHED',
        ]);

        return [$seller, $buyer, $admin, $review, $order];
    }
}
