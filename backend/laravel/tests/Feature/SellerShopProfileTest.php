<?php

namespace Tests\Feature;

use App\Enums\ListingStatus;
use App\Enums\PricingType;
use App\Enums\Role;
use App\Models\AuditLog;
use App\Models\Category;
use App\Models\LivestockListing;
use App\Models\SellerIdentityDocument;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class SellerShopProfileTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        Storage::fake('rider_private');
    }

    public function test_seller_can_save_shop_branding_with_validated_public_image(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $image = UploadedFile::fake()->image('shop.png', 512, 512)->size(500);

        $this->actingAs($seller)->post('/api/seller/shop-profile', [
            'shop_name' => 'Green Valley Farm',
            'shop_image' => $image,
        ])->assertOk()
            ->assertJsonPath('profile.shop_name', 'Green Valley Farm')
            ->assertJsonPath('profile.verification_status', 'NOT_SUBMITTED');

        $profile = $seller->sellerProfile()->firstOrFail();
        $this->assertNotNull($profile->shop_image_path);
        Storage::disk('public')->assertExists($profile->shop_image_path);

        $this->actingAs($seller)->post('/api/seller/shop-profile', [
            'shop_name' => 'Small Image Farm',
            'shop_image' => UploadedFile::fake()->image('too-small.png', 120, 120),
        ])->assertUnprocessable();
    }

    public function test_identity_submission_is_encrypted_private_and_pending_until_admin_approval(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $seller->sellerProfile()->create(['is_verified' => true]);
        $document = UploadedFile::fake()->image('identity.png', 640, 640)->size(700);
        $plainContents = $document->getContent();

        $this->actingAs($seller)->post('/api/seller/verification/submit', [
            'identity_document' => $document,
        ])->assertCreated()
            ->assertJsonPath('profile.verification_status', 'PENDING')
            ->assertJsonMissingPath('profile.encrypted_path')
            ->assertJsonMissingPath('profile.document_path');

        $profile = $seller->sellerProfile()->firstOrFail();
        $this->assertFalse($profile->is_verified);
        $identity = SellerIdentityDocument::query()->where('seller_profile_id', $profile->id)->firstOrFail();
        Storage::disk('rider_private')->assertExists($identity->encrypted_path);
        $this->assertNotSame($plainContents, Storage::disk('rider_private')->get($identity->encrypted_path));
        $this->assertDatabaseHas('notifications', [
            'notifiable_id' => $seller->id,
            'type' => \App\Notifications\SellerVerificationStatusNotification::class,
        ]);

        $this->actingAs($seller)->getJson('/api/auth/user')
            ->assertOk()
            ->assertJsonMissingPath('user.seller_profile.encrypted_path')
            ->assertJsonMissingPath('user.seller_profile.identity_document');

        $this->actingAs($seller)->post('/api/seller/verification/submit', [
            'identity_document' => UploadedFile::fake()->image('blurry.png', 180, 180),
        ])->assertUnprocessable();
    }

    public function test_only_admins_can_review_documents_and_verification_is_audited(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $identity = UploadedFile::fake()->image('identity.png', 640, 640)->size(600);
        $this->actingAs($seller)->post('/api/seller/verification/submit', [
            'identity_document' => $identity,
        ])->assertCreated();

        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $this->actingAs($buyer)->getJson('/api/admin/seller-verifications')->assertForbidden();
        $this->actingAs($buyer)->postJson("/api/admin/seller-verifications/{$seller->id}/decision", [
            'status' => 'VERIFIED',
        ])->assertForbidden();

        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $this->actingAs($admin)->getJson('/api/admin/seller-verifications?status=PENDING')
            ->assertOk()
            ->assertJsonPath('sellers.data.0.id', $seller->id)
            ->assertJsonPath('sellers.data.0.verification_status', 'PENDING');

        $details = $this->actingAs($admin)->getJson("/api/admin/seller-verifications/{$seller->id}")
            ->assertOk()
            ->assertJsonPath('seller.document.mime_type', 'image/webp')
            ->assertJsonMissingPath('seller.document.encrypted_path')
            ->assertJsonMissingPath('seller.document.path');
        $documentUrl = $details->json('seller.document.view_url');
        $this->actingAs($admin)->postJson("/api/admin/seller-verifications/{$seller->id}/decision", [
            'status' => 'VERIFIED',
        ])->assertConflict();
        $this->actingAs($buyer)->get($documentUrl)->assertForbidden();
        $documentResponse = $this->actingAs($admin)->get($documentUrl)->assertOk();
        $this->assertSame('image/webp', $documentResponse->headers->get('Content-Type'));
        $this->assertSame('WEBP', substr($documentResponse->getContent(), 8, 4));
        $reviewResponse = $this->actingAs($admin)->postJson("/api/admin/seller-verifications/{$seller->id}/document/reviewed")
            ->assertOk();
        $this->assertDatabaseHas('audit_logs', [
            'user_id' => $admin->id,
            'entity_type' => 'SELLER_PROFILE',
            'entity_id' => (string) $seller->sellerProfile()->value('id'),
            'action' => 'seller.identity.document_reviewed',
        ]);
        $reviewResponse->assertJsonPath('seller.document.reviewed_by_current_admin', true);

        $this->actingAs($admin)->postJson("/api/admin/seller-verifications/{$seller->id}/decision", [
            'status' => 'REJECTED',
            'rejection_reason' => 'Please re-upload 1234567890 as the image is unclear.',
        ])->assertOk()
            ->assertJsonPath('seller.verification_status', 'REJECTED')
            ->assertJsonPath('seller.verification_rejection_reason', 'Please re-upload [redacted] as the image is unclear.');
        $auditHistory = json_encode(AuditLog::query()->get()->toArray(), JSON_THROW_ON_ERROR);
        $this->assertStringNotContainsString('1234567890', $auditHistory);

        $profile = $seller->sellerProfile()->firstOrFail();
        $this->assertFalse($profile->is_verified);
        $this->assertDatabaseHas('audit_logs', [
            'entity_type' => 'SELLER_PROFILE',
            'entity_id' => (string) $profile->id,
            'action' => 'seller.identity.rejected',
        ]);

        $this->actingAs($seller)->post('/api/seller/verification/submit', [
            'identity_document' => UploadedFile::fake()->image('identity-resubmitted.png', 640, 640)->size(600),
        ])->assertCreated()->assertJsonPath('profile.verification_status', 'PENDING');
        $this->assertDatabaseHas('seller_profiles', [
            'id' => $profile->id,
            'verification_status' => 'PENDING',
            'verification_rejection_reason' => null,
            'is_verified' => false,
        ]);

        $resubmittedDetail = $this->actingAs($admin)->getJson("/api/admin/seller-verifications/{$seller->id}")->assertOk();
        $resubmittedUrl = $resubmittedDetail->json('seller.document.view_url');
        $this->actingAs($admin)->get($resubmittedUrl)->assertOk();
        $this->actingAs($admin)->postJson("/api/admin/seller-verifications/{$seller->id}/document/reviewed")->assertOk();
        $this->actingAs($admin)->postJson("/api/admin/seller-verifications/{$seller->id}/decision", [
            'status' => 'VERIFIED',
        ])->assertOk()->assertJsonPath('seller.verification_status', 'VERIFIED');
        $this->getJson("/api/sellers/{$seller->id}/shop")->assertOk()->assertJsonPath('seller.is_verified', true);

        $category = Category::create(['name' => 'Verification Test Livestock', 'slug' => 'verification-test-livestock']);
        LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Verified seller listing',
            'quantity' => 1,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 100,
            'status' => ListingStatus::ACTIVE,
        ]);
        $this->getJson('/api/listings')->assertOk()->assertJsonPath('data.0.seller.is_verified', true);
    }

    public function test_public_shop_and_listing_cards_use_shop_brand_and_only_admin_approved_badge(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $profile = $seller->sellerProfile()->create([
            'business_name' => 'Old Business Name',
            'shop_name' => 'New Public Shop',
            'is_verified' => true,
            'verification_status' => 'NOT_SUBMITTED',
        ]);
        $category = Category::create(['name' => 'Goats', 'slug' => 'seller-profile-goats']);
        $listing = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Healthy Boer Goat',
            'quantity' => 3,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 120,
            'status' => ListingStatus::ACTIVE,
        ]);

        $this->getJson("/api/sellers/{$seller->id}/shop")
            ->assertOk()
            ->assertJsonPath('seller.shop_name', 'New Public Shop')
            ->assertJsonPath('seller.is_verified', false);
        $this->getJson('/api/listings')
            ->assertOk()
            ->assertJsonPath('data.0.seller.shop_name', 'New Public Shop')
            ->assertJsonPath('data.0.seller.is_verified', false)
            ->assertJsonMissingPath('data.0.seller.seller_profile')
            ->assertJsonMissingPath('data.0.seller.identity_document');

        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $this->actingAs($admin)->postJson("/api/admin/seller-verifications/{$seller->id}/decision", [
            'status' => 'VERIFIED',
        ])->assertConflict();

        $this->assertSame('NOT_SUBMITTED', $profile->fresh()->verification_status);
        $this->assertSame($listing->id, $listing->fresh()->id);
    }
}
