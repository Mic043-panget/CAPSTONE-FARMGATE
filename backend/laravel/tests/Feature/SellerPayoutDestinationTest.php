<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Models\AuditLog;
use App\Models\SellerPayoutDestination;
use App\Models\SellerPayoutPolicy;
use App\Models\SellerPayoutPolicyAcknowledgement;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class SellerPayoutDestinationTest extends TestCase
{
    use RefreshDatabase;

    private SellerPayoutPolicy $activePolicy;

    protected function setUp(): void
    {
        parent::setUp();
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $this->activePolicy = SellerPayoutPolicy::query()->create([
            'version' => 'payout-test-v1',
            'effective_date' => today(),
            'policy_text' => str_repeat('Farmgate payout policy test terms. ', 5),
            'status' => 'PUBLISHED',
            'created_by' => $admin->id,
            'approved_by' => $admin->id,
            'published_by' => $admin->id,
            'approved_at' => now(),
            'published_at' => now(),
            'approval_reason' => 'Approved test payout policy terms.',
            'publication_reason' => 'Published for payout workflow tests.',
        ]);
    }

    public function test_seller_destination_is_owner_scoped_encrypted_and_only_returned_masked(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $this->acknowledgePolicy($seller);
        $otherSeller = User::factory()->create(['role' => Role::SELLER]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        SellerPayoutDestination::query()->create([
            'seller_id' => $otherSeller->id,
            'destination_type' => 'BANK',
            'account_holder' => 'Other Seller',
            'bank_name' => 'Other Bank',
            'account_number' => '9999999999999999',
            'status' => 'PENDING_VERIFICATION',
            'consent_version' => 'seller-payout-ops-v1',
            'consent_accepted_at' => now(),
        ]);

        $this->actingAs($buyer)->getJson('/api/seller/payout-destination')->assertForbidden();
        $this->actingAs($seller)
            ->getJson('/api/seller/payout-destination')
            ->assertOk()
            ->assertJsonPath('destination', null)
            ->assertJsonPath('consent.version', 'seller-payout-ops-v1');

        $payload = $this->bankPayload();
        $response = $this->actingAs($seller)
            ->putJson('/api/seller/payout-destination', $payload)
            ->assertOk()
            ->assertJsonPath('destination.status', 'PENDING_VERIFICATION')
            ->assertJsonPath('destination.account_number_masked', '•••• 6789')
            ->assertJsonMissing(['account_number' => $payload['account_number']]);
        $this->assertStringNotContainsString($payload['account_number'], $response->getContent());

        $destination = SellerPayoutDestination::query()->where('seller_id', $seller->id)->firstOrFail();
        $raw = DB::table('seller_payout_destinations')
            ->where('id', $destination->id)
            ->first(['account_holder', 'bank_name', 'account_number']);
        $this->assertNotSame($payload['account_holder'], $raw->account_holder);
        $this->assertNotSame($payload['bank_name'], $raw->bank_name);
        $this->assertNotSame($payload['account_number'], $raw->account_number);
        $this->assertSame($payload['account_number'], $destination->account_number);
        $this->assertSame($payload['account_holder'], $destination->account_holder);
        $this->assertSame($seller->id, $destination->seller_id);
        $this->assertDatabaseHas('seller_payout_destination_histories', [
            'seller_payout_destination_id' => $destination->id,
            'actor_id' => $seller->id,
            'action' => 'SUBMITTED',
            'new_status' => 'PENDING_VERIFICATION',
        ]);
        $this->assertDatabaseHas('seller_payout_destinations', ['seller_id' => $otherSeller->id]);
    }

    public function test_gcash_destination_is_encrypted_and_masked(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $this->acknowledgePolicy($seller);
        $payload = [
            'destination_type' => 'GCASH',
            'account_holder' => 'Sample Seller Name',
            'wallet_number' => '09171234567',
            'current_password' => 'password',
            'consent_accepted' => true,
            'consent_version' => 'seller-payout-ops-v1',
            'payout_policy_id' => $this->activePolicy->id,
        ];

        $response = $this->actingAs($seller)
            ->putJson('/api/seller/payout-destination', $payload)
            ->assertOk()
            ->assertJsonPath('destination.destination_type', 'GCASH')
            ->assertJsonPath('destination.wallet_number_masked', '•••• 4567');

        $this->assertStringNotContainsString($payload['wallet_number'], $response->getContent());
        $destination = SellerPayoutDestination::query()->firstOrFail();
        $storedNumber = DB::table('seller_payout_destinations')->where('id', $destination->id)->value('wallet_number');
        $this->assertNotSame($payload['wallet_number'], $storedNumber);
        $this->assertSame($payload['wallet_number'], $destination->wallet_number);
    }

    public function test_consent_password_and_present_unverified_identity_are_required(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $this->acknowledgePolicy($seller);
        $profile = $seller->sellerProfile()->create(['is_verified' => false]);

        $this->actingAs($seller)
            ->putJson('/api/seller/payout-destination', $this->bankPayload(['consent_accepted' => false]))
            ->assertUnprocessable();
        $this->actingAs($seller)
            ->putJson('/api/seller/payout-destination', $this->bankPayload(['current_password' => 'incorrect']))
            ->assertUnprocessable();
        $this->actingAs($seller)
            ->putJson('/api/seller/payout-destination', $this->bankPayload())
            ->assertStatus(409);

        $profile->forceFill(['is_verified' => true])->save();
        $this->actingAs($seller)
            ->putJson('/api/seller/payout-destination', $this->bankPayload(['consent_version' => 'old-version']))
            ->assertUnprocessable();
        $this->assertSame(0, SellerPayoutDestination::query()->count());
    }

    public function test_seller_update_of_verified_destination_returns_it_to_pending_verification(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $this->acknowledgePolicy($seller);
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $this->actingAs($seller)->putJson('/api/seller/payout-destination', $this->bankPayload())->assertOk();
        $destination = SellerPayoutDestination::query()->firstOrFail();

        $this->actingAs($admin)
            ->postJson('/api/admin/seller-payout-destinations/'.$destination->id.'/verify', [
                'reason' => 'Destination checked against submitted seller records.',
            ])
            ->assertOk()
            ->assertJsonPath('destination.status', 'VERIFIED');

        $updated = $this->bankPayload(['account_number' => '9876543210']);
        $this->actingAs($seller)
            ->putJson('/api/seller/payout-destination', $updated)
            ->assertOk()
            ->assertJsonPath('destination.status', 'PENDING_VERIFICATION');

        $this->assertNull($destination->fresh()->verified_at);
        $this->assertNull($destination->fresh()->verified_by);
        $this->assertDatabaseHas('seller_payout_destination_histories', [
            'seller_payout_destination_id' => $destination->id,
            'action' => 'UPDATED',
            'previous_status' => 'VERIFIED',
            'new_status' => 'PENDING_VERIFICATION',
        ]);
    }

    public function test_admin_authorization_reason_and_verification_audit_are_enforced_and_masked(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $this->acknowledgePolicy($seller);
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $this->actingAs($seller)->putJson('/api/seller/payout-destination', $this->bankPayload())->assertOk();
        $destination = SellerPayoutDestination::query()->firstOrFail();

        $this->actingAs($seller)
            ->getJson('/api/admin/seller-payout-destinations')
            ->assertForbidden();
        $denied = $this->actingAs($seller)
            ->postJson('/api/admin/seller-payout-destinations/'.$destination->id.'/verify', [
                'reason' => 'Unauthorized attempt Sample Seller Name 1234567890126789',
            ])
            ->assertForbidden();
        $this->assertStringNotContainsString('Sample Seller Name', $denied->getContent());
        $this->assertSame(
            'Unauthorized attempt [destination detail redacted] [masked digits]',
            AuditLog::query()
                ->where('user_id', $seller->id)
                ->where('action', 'POST api/admin/seller-payout-destinations/'.$destination->id.'/verify')
                ->where('status_code', 403)
                ->value('reason'),
        );

        $adminList = $this->actingAs($admin)
            ->getJson('/api/admin/seller-payout-destinations')
            ->assertOk()
            ->assertJsonPath('destinations.data.0.account_number_masked', '•••• 6789');
        $this->assertStringNotContainsString($this->bankPayload()['account_number'], $adminList->getContent());
        $this->actingAs($admin)
            ->postJson('/api/admin/seller-payout-destinations/'.$destination->id.'/verify', [])
            ->assertUnprocessable();

        $reason = 'Verified for Sample Seller Name, number 1234567890126789';
        $safeReason = 'Verified for [destination detail redacted], number [masked digits]';
        $verifiedResponse = $this->actingAs($admin)
            ->postJson('/api/admin/seller-payout-destinations/'.$destination->id.'/verify', ['reason' => $reason])
            ->assertOk()
            ->assertJsonPath('destination.status', 'VERIFIED');
        $this->assertStringNotContainsString($this->bankPayload()['account_number'], $verifiedResponse->getContent());

        $destination->refresh();
        $this->assertSame($admin->id, $destination->verified_by);
        $this->assertNotNull($destination->verified_at);
        $this->assertSame('VERIFIED', $destination->status);
        $this->assertDatabaseHas('seller_payout_destination_histories', [
            'seller_payout_destination_id' => $destination->id,
            'actor_id' => $admin->id,
            'action' => 'VERIFIED',
            'previous_status' => 'PENDING_VERIFICATION',
            'new_status' => 'VERIFIED',
            'reason' => $safeReason,
        ]);

        $audit = AuditLog::query()
            ->where('user_id', $admin->id)
            ->where('action', 'POST api/admin/seller-payout-destinations/'.$destination->id.'/verify')
            ->where('status_code', 200)
            ->firstOrFail();
        $auditJson = json_encode([
            'metadata' => $audit->metadata,
            'before' => $audit->before_values,
            'after' => $audit->after_values,
            'changed' => $audit->changed_fields,
        ], JSON_THROW_ON_ERROR);
        $this->assertStringNotContainsString($this->bankPayload()['account_number'], $auditJson);
        $this->assertStringNotContainsString($this->bankPayload()['account_holder'], $auditJson);
        $this->assertSame($safeReason, $audit->reason);
    }

    public function test_admin_can_reject_pending_destination_with_reason(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $this->acknowledgePolicy($seller);
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $this->actingAs($seller)->putJson('/api/seller/payout-destination', $this->bankPayload())->assertOk();
        $destination = SellerPayoutDestination::query()->firstOrFail();

        $this->actingAs($admin)
            ->postJson('/api/admin/seller-payout-destinations/'.$destination->id.'/reject', [
                'reason' => 'Submitted details need correction.',
            ])
            ->assertOk()
            ->assertJsonPath('destination.status', 'REJECTED');
        $this->assertSame('REJECTED', $destination->fresh()->status);
        $this->assertDatabaseHas('seller_payout_destination_histories', [
            'seller_payout_destination_id' => $destination->id,
            'action' => 'REJECTED',
            'new_status' => 'REJECTED',
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function bankPayload(array $overrides = []): array
    {
        return array_replace([
            'destination_type' => 'BANK',
            'account_holder' => 'Sample Seller Name',
            'bank_name' => 'Sample Rural Bank',
            'account_number' => '1234567890126789',
            'current_password' => 'password',
            'consent_accepted' => true,
            'consent_version' => 'seller-payout-ops-v1',
            'payout_policy_id' => $this->activePolicy->id,
        ], $overrides);
    }

    private function acknowledgePolicy(User $seller): void
    {
        SellerPayoutPolicyAcknowledgement::query()->create([
            'seller_id' => $seller->id,
            'seller_payout_policy_id' => $this->activePolicy->id,
            'acknowledged_at' => now(),
        ]);
    }
}
