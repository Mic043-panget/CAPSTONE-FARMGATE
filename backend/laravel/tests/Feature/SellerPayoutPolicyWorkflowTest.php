<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Models\SellerPayoutDestination;
use App\Models\SellerPayoutPolicy;
use App\Models\SellerPayoutPolicyAcknowledgement;
use App\Models\User;
use App\Services\SellerPayoutPolicyService;
use App\Services\SystemSettingsService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SellerPayoutPolicyWorkflowTest extends TestCase
{
    use RefreshDatabase;

    public function test_policy_requires_authorized_admin_draft_approval_and_publication_then_seller_acknowledgment(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $policySections = $this->completePolicySections();
        $payload = [
            'version' => '2026.1',
            'effective_date' => today()->toDateString(),
            'policy_text' => str_replace("\n", "\r\n", app(SellerPayoutPolicyService::class)->compileCompletePolicy($policySections)),
        ];

        $this->actingAs($seller)
            ->post('/api/admin/seller-payout-policies', $payload)
            ->assertForbidden();
        $this->actingAs($seller)
            ->getJson('/api/seller/payout-policy')
            ->assertOk()
            ->assertJsonPath('policy', null);

        $draftResponse = $this->actingAs($admin)
            ->post('/api/admin/seller-payout-policies', $payload)
            ->assertCreated()
            ->assertJsonPath('policy.status', 'DRAFT')
            ->assertJsonPath('policy.version', '2026.1');
        $policyId = (int) $draftResponse->json('policy.id');
        $policy = SellerPayoutPolicy::query()->findOrFail($policyId);
        $this->assertSame($admin->id, $policy->created_by);
        $this->assertNull($policy->approved_by);
        $this->assertNull($policy->published_by);
        $this->assertNull($policy->supporting_document_path);

        $this->actingAs($seller)
            ->postJson("/api/admin/seller-payout-policies/{$policyId}/approve", [
                'policy_sections' => $policySections,
                'confirmed_actual_terms' => true,
                'reason' => 'Seller cannot approve Farmgate policy.',
            ])
            ->assertForbidden();

        $this->actingAs($admin)
            ->postJson("/api/admin/seller-payout-policies/{$policyId}/approve", [
                'policy_sections' => array_replace($policySections, ['calculation' => 'A different but sufficiently complete payout calculation term that was not saved in this draft.']),
                'confirmed_actual_terms' => true,
                'reason' => 'Approve the verified Farmgate payout policy.',
            ])
            ->assertStatus(409)
            ->assertJsonPath('message', 'The reviewed policy text differs from the saved draft. Edit and save the complete policy sections before approval.');

        $this->actingAs($admin)
            ->postJson("/api/admin/seller-payout-policies/{$policyId}/approve", [
                'policy_sections' => array_replace($policySections, ['timing' => 'TBD']),
                'confirmed_actual_terms' => true,
                'reason' => 'Approve the verified Farmgate payout policy.',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['policy_sections.timing']);

        $this->actingAs($admin)
            ->postJson("/api/admin/seller-payout-policies/{$policyId}/approve", [
                'policy_sections' => $policySections,
                'confirmed_actual_terms' => true,
                'reason' => 'Approve the verified Farmgate payout policy.',
            ])
            ->assertOk()
            ->assertJsonPath('policy.status', 'APPROVED');
        $policy->refresh();
        $this->assertNull($policy->published_by);
        $this->assertSame($admin->id, $policy->approved_by);
        $this->assertNotNull($policy->approved_at);
        $this->assertNull($policy->published_at);
        $this->assertSame('Approve the verified Farmgate payout policy.', $policy->approval_reason);
        $this->assertDatabaseHas('audit_logs', [
            'user_id' => $admin->id,
            'action' => "POST api/admin/seller-payout-policies/{$policyId}/approve",
            'status_code' => 200,
        ]);
        $this->actingAs($admin)
            ->postJson("/api/admin/seller-payout-policies/{$policyId}/publish", [
                'policy_sections' => array_replace($policySections, ['timing' => 'TBD']),
                'confirmed_actual_terms' => true,
                'reason' => 'Publish the verified Farmgate payout policy.',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['policy_sections.timing']);
        $this->actingAs($admin)
            ->postJson("/api/admin/seller-payout-policies/{$policyId}/publish", [
                'policy_sections' => $policySections,
                'confirmed_actual_terms' => true,
                'reason' => 'Publish the verified Farmgate payout policy.',
            ])
            ->assertOk()
            ->assertJsonPath('policy.status', 'PUBLISHED');
        $policy->refresh();
        $this->assertSame($admin->id, $policy->published_by);
        $this->assertNotNull($policy->published_at);
        $this->assertSame('Publish the verified Farmgate payout policy.', $policy->publication_reason);
        $this->assertDatabaseHas('audit_logs', [
            'user_id' => $admin->id,
            'action' => "POST api/admin/seller-payout-policies/{$policyId}/publish",
            'status_code' => 200,
        ]);

        $sellerPolicy = $this->actingAs($seller)
            ->getJson('/api/seller/payout-policy')
            ->assertOk()
            ->assertJsonPath('policy.version', '2026.1')
            ->assertJsonPath('policy.acknowledged', false)
            ->assertJsonPath('policy.policy_text', str_replace("\n", "\r\n", app(SellerPayoutPolicyService::class)->compileCompletePolicy($policySections)));
        $this->assertNull($sellerPolicy->json('policy.supporting_document_url'));

        $destinationPayload = [
            'destination_type' => 'BANK',
            'account_holder' => 'Test Seller',
            'bank_name' => 'Test Bank',
            'account_number' => '123456789012',
            'current_password' => 'password',
            'consent_accepted' => true,
            'consent_version' => 'seller-payout-ops-v1',
            'payout_policy_id' => $policyId,
        ];
        $this->actingAs($seller)
            ->putJson('/api/seller/payout-destination', $destinationPayload)
            ->assertStatus(409);

        $this->actingAs($seller)
            ->postJson("/api/seller/payout-policy/{$policyId}/acknowledge", ['acknowledged' => true])
            ->assertOk()
            ->assertJsonPath('version', '2026.1');
        $acknowledgement = SellerPayoutPolicyAcknowledgement::query()->firstOrFail();
        $this->assertSame($seller->id, $acknowledgement->seller_id);
        $this->assertSame($policyId, $acknowledgement->seller_payout_policy_id);
        $this->assertNotNull($acknowledgement->acknowledged_at);

        $this->actingAs($seller)
            ->putJson('/api/seller/payout-destination', $destinationPayload)
            ->assertOk()
            ->assertJsonPath('destination.status', 'PENDING_VERIFICATION');
        $destination = SellerPayoutDestination::query()->firstOrFail();

        $this->actingAs($seller)
            ->postJson("/api/admin/seller-payout-destinations/{$destination->id}/verify", ['reason' => 'Seller cannot approve payout destination.'])
            ->assertForbidden();
        $this->actingAs($admin)
            ->postJson("/api/admin/seller-payout-destinations/{$destination->id}/verify", ['reason' => 'Verified seller payout ownership against submitted account records.'])
            ->assertOk()
            ->assertJsonPath('destination.status', 'VERIFIED');

        $this->actingAs($admin)
            ->putJson('/api/admin/settings/manual_seller_payouts_enabled', [
                'value' => true,
                'reason' => 'Enable after published policy and verified destination checks.',
            ])
            ->assertOk();
        $this->assertTrue(app(SystemSettingsService::class)->getBoolean('manual_seller_payouts_enabled'));
    }

    public function test_amendment_requires_current_published_base_and_separate_admin_approval_and_publication(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $baseSections = $this->completePolicySections();
        $base = SellerPayoutPolicy::query()->create([
            'version' => '1.0',
            'effective_date' => today(),
            'policy_text' => app(SellerPayoutPolicyService::class)->compileCompletePolicy($baseSections),
            'status' => 'PUBLISHED',
            'created_by' => $admin->id,
            'approved_by' => $admin->id,
            'published_by' => $admin->id,
            'approved_at' => now(),
            'published_at' => now(),
            'approval_reason' => 'Approved test base version.',
            'publication_reason' => 'Published test base version.',
        ]);
        $amendmentSections = array_replace($this->completePolicySections(), [
            'calculation' => 'Current seller fee is 0%. Payout equals saved product subtotal minus the saved per-order seller_fee; do not recalculate historical fees.',
            'timing' => 'Eligible payout processing occurs on weekends with no cutoff. External banks may not settle on weekends; keep the payout pending until the transfer is confirmed.',
            'fees' => 'The current seller fee rate is 0%. The saved seller_fee for each order is authoritative and no new fee is applied to historical orders.',
            'failed_returned' => 'Manual payout recording documents a transfer completed outside Farmgate. Do not mark a transfer paid until its external reference, amount, and date are recorded after confirmation.',
            'dispute_corrections' => 'A payout correction requires an administrator reason and audit history. The application does not calculate separate seller credits, discretionary adjustments, or additional deductions.',
        ]);
        $amendmentPayload = [
            'version' => '1.1',
            'effective_date' => today()->toDateString(),
            'policy_sections' => $amendmentSections,
            'amendment_reason' => 'Align policy calculation with saved order fee snapshots.',
        ];

        $this->postJson("/api/admin/seller-payout-policies/{$base->id}/amendments", $amendmentPayload)
            ->assertUnauthorized();
        $this->actingAs($seller)
            ->postJson("/api/admin/seller-payout-policies/{$base->id}/amendments", $amendmentPayload)
            ->assertForbidden();
        $response = $this->actingAs($admin)
            ->postJson("/api/admin/seller-payout-policies/{$base->id}/amendments", $amendmentPayload)
            ->assertCreated()
            ->assertJsonPath('policy.status', 'DRAFT')
            ->assertJsonPath('policy.version', '1.1')
            ->assertJsonPath('policy.based_on.version', '1.0');
        $amendmentId = (int) $response->json('policy.id');
        $amendment = SellerPayoutPolicy::query()->findOrFail($amendmentId);
        $sourceText = $base->policy_text;
        $this->assertSame($base->id, $amendment->based_on_policy_id);
        $this->assertSame($sourceText, $base->fresh()->policy_text);
        $this->assertDatabaseHas('audit_logs', [
            'user_id' => $admin->id,
            'action' => "POST api/admin/seller-payout-policies/{$base->id}/amendments",
            'status_code' => 201,
            'reason' => $amendmentPayload['amendment_reason'],
        ]);

        $approvalPayload = [
            'policy_sections' => $amendmentSections,
            'confirmed_actual_terms' => true,
            'reason' => 'Confirmed the amendment against supported payout behavior.',
        ];
        $this->actingAs($seller)
            ->postJson("/api/admin/seller-payout-policies/{$amendmentId}/approve", $approvalPayload)
            ->assertForbidden();
        $this->actingAs($admin)
            ->postJson("/api/admin/seller-payout-policies/{$amendmentId}/approve", $approvalPayload)
            ->assertOk()
            ->assertJsonPath('policy.status', 'APPROVED');
        $amendment->refresh();
        $this->assertSame($admin->id, $amendment->approved_by);
        $this->assertNotNull($amendment->approved_at);
        $this->assertSame($sourceText, $base->fresh()->policy_text);
        try {
            $amendment->forceFill(['policy_text' => 'Altered approved content.'])->save();
            $this->fail('Approved policy content must be immutable.');
        } catch (\LogicException $exception) {
            $this->assertSame('An approved or published seller payout policy is immutable.', $exception->getMessage());
        }

        $this->actingAs($seller)
            ->postJson("/api/admin/seller-payout-policies/{$amendmentId}/publish", [
                ...$approvalPayload,
                'reason' => 'Seller cannot publish a payout policy.',
            ])
            ->assertForbidden();
        $this->actingAs($admin)
            ->postJson("/api/admin/seller-payout-policies/{$amendmentId}/publish", [
                ...$approvalPayload,
                'reason' => 'Publish the approved policy amendment version 1.1.',
            ])
            ->assertOk()
            ->assertJsonPath('policy.status', 'PUBLISHED');
        $amendment->refresh();
        $this->assertSame($admin->id, $amendment->published_by);
        $this->assertSame($sourceText, $base->fresh()->policy_text);
        $this->assertDatabaseHas('audit_logs', [
            'user_id' => $admin->id,
            'action' => "POST api/admin/seller-payout-policies/{$amendmentId}/approve",
            'status_code' => 200,
            'reason' => $approvalPayload['reason'],
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'user_id' => $admin->id,
            'action' => "POST api/admin/seller-payout-policies/{$amendmentId}/publish",
            'status_code' => 200,
            'reason' => 'Publish the approved policy amendment version 1.1.',
        ]);

        $this->actingAs($seller)
            ->getJson('/api/seller/payout-policy')
            ->assertOk()
            ->assertJsonPath('policy.version', '1.1')
            ->assertJsonPath('policy.acknowledged', false);
        $this->actingAs($seller)
            ->postJson("/api/seller/payout-policy/{$amendmentId}/acknowledge", ['acknowledged' => true])
            ->assertOk()
            ->assertJsonPath('version', '1.1');
        $this->assertDatabaseHas('seller_payout_policy_acknowledgements', [
            'seller_id' => $seller->id,
            'seller_payout_policy_id' => $amendmentId,
        ]);
    }

    public function test_manual_payout_toggle_reports_unmet_policy_and_destination_prerequisites(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $this->actingAs($admin)
            ->putJson('/api/admin/settings/manual_seller_payouts_enabled', [
                'value' => true,
                'reason' => 'Enable when policy prerequisites are complete.',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['settings.manual_seller_payouts_enabled']);

        $policy = SellerPayoutPolicy::query()->create([
            'version' => 'effective-v1',
            'effective_date' => today(),
            'policy_text' => str_repeat('Actual policy text. ', 8),
            'supporting_document_path' => 'seller-payout-policies/effective.pdf',
            'supporting_document_mime_type' => 'application/pdf',
            'status' => 'PUBLISHED',
            'created_by' => $admin->id,
            'approved_by' => $admin->id,
            'published_by' => $admin->id,
            'approved_at' => now(),
            'published_at' => now(),
            'approval_reason' => 'Approved actual policy.',
            'publication_reason' => 'Published actual policy.',
        ]);
        SellerPayoutDestination::query()->create([
            'seller_id' => $seller->id,
            'destination_type' => 'BANK',
            'account_holder' => 'Test Seller',
            'bank_name' => 'Test Bank',
            'account_number' => '123456789012',
            'status' => 'VERIFIED',
            'consent_version' => 'seller-payout-ops-v1',
            'consent_accepted_at' => now(),
        ]);

        $this->actingAs($admin)
            ->putJson('/api/admin/settings/manual_seller_payouts_enabled', [
                'value' => true,
                'reason' => 'Enable only when seller policy acknowledgment is complete.',
            ])
            ->assertOk();
        $this->assertTrue(app(SystemSettingsService::class)->getBoolean('manual_seller_payouts_enabled'));
        $this->assertSame('effective-v1', $policy->version);
    }

    /**
     * @return array<string, string>
     */
    private function completePolicySections(): array
    {
        return [
            'eligibility' => 'Only eligible COD orders and sellers that satisfy the documented system prerequisites may be paid.',
            'calculation' => 'Calculate the payout from the order merchandise subtotal less the recorded seller fee for that order.',
            'timing' => 'Farmgate completes external payout recording only after an administrator records the completed transfer.',
            'destination_requirements' => 'The seller must acknowledge this policy and submit a supported destination that an administrator verifies.',
            'fees' => 'The seller fee shown on the order is calculated from the configured seller fee rate and captured when the order is placed.',
            'failed_returned' => 'Failed or returned transfers must not be recorded as paid; an administrator must review and document the outcome.',
            'dispute_corrections' => 'Disputes and corrections require administrator review, a reason, and a retained audit record.',
        ];
    }
}
