<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Models\CodReceivingMethod;
use App\Models\RiderProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class CodReceivingMethodWorkflowTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('delivery_proofs');
        config([
            'services.paymongo.secret_key' => null,
            'services.paymongo.webhook_secret' => null,
            'payments.paymongo.configuration_verified' => false,
        ]);
    }

    public function test_receiving_method_stays_inactive_and_masked_until_a_different_admin_verifies_it(): void
    {
        $configuringAdmin = User::factory()->create(['role' => Role::ADMIN]);
        $verifyingAdmin = User::factory()->create(['role' => Role::ADMIN]);
        $rider = User::factory()->create(['role' => Role::RIDER]);
        RiderProfile::create(['user_id' => $rider->id, 'availability' => 'OFFLINE', 'is_verified' => true]);
        $accountNumber = '1234567890123456';

        $created = $this->actingAs($configuringAdmin)
            ->postJson('/api/admin/cod/receiving-methods', [
                'method_type' => 'BANK_TRANSFER',
                'label' => 'Farmgate remittance account',
                'instructions' => 'Transfer the full batch amount to this Farmgate account.',
                'account_holder' => 'Farmgate Operations Inc',
                'bank_name' => 'Sample Bank',
                'account_number' => $accountNumber,
            ])
            ->assertCreated()
            ->assertJsonPath('method.status', 'PENDING_VERIFICATION')
            ->assertJsonPath('method.account_number_masked', '•••• 3456');
        $this->assertStringNotContainsString($accountNumber, $created->getContent());
        $method = CodReceivingMethod::query()->firstOrFail();
        $storedNumber = DB::table('cod_receiving_methods')->where('id', $method->id)->value('account_number');
        $this->assertNotSame($accountNumber, $storedNumber);
        $this->assertSame($accountNumber, $method->account_number);

        $this->actingAs($rider)
            ->getJson('/api/riders/cod/receiving-methods')
            ->assertOk()
            ->assertJsonCount(0, 'methods');
        $this->actingAs($configuringAdmin)
            ->postJson('/api/admin/cod/receiving-methods/'.$method->id.'/verify', [
                'reason' => 'Confirmed the receiving details belong to Farmgate.',
                'receiving_only_confirmed' => true,
            ])
            ->assertStatus(409);

        $this->actingAs($verifyingAdmin)
            ->postJson('/api/admin/cod/receiving-methods/'.$method->id.'/verify', [
                'reason' => 'Confirmed the receiving details belong to Farmgate.',
                'receiving_only_confirmed' => true,
            ])
            ->assertOk()
            ->assertJsonPath('method.status', 'ACTIVE');
        $this->actingAs($rider)
            ->getJson('/api/riders/cod/receiving-methods')
            ->assertOk()
            ->assertJsonPath('methods.0.account_number', $accountNumber)
            ->assertJsonPath('methods.0.account_number_masked', '•••• 3456');
        $this->actingAs(User::factory()->create(['role' => Role::BUYER]))
            ->getJson('/api/riders/cod/receiving-methods')
            ->assertForbidden();
    }

    public function test_online_banking_qr_is_a_receive_only_method_without_paymongo_configuration(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $verifyingAdmin = User::factory()->create(['role' => Role::ADMIN]);
        $rider = User::factory()->create(['role' => Role::RIDER]);
        RiderProfile::create(['user_id' => $rider->id, 'availability' => 'OFFLINE', 'is_verified' => true]);
        $fields = [
            'method_type' => 'BANK_QR',
            'label' => 'Farmgate online banking QR',
            'instructions' => 'Send the remittance only to Farmgate.',
            'account_holder' => 'Farmgate Operations Inc',
            'bank_name' => 'Sample Bank',
            'account_number' => 'merchant-12345',
        ];

        $this->actingAs($admin)
            ->postJson('/api/admin/cod/receiving-methods', $fields)
            ->assertUnprocessable();
        $this->assertSame(0, CodReceivingMethod::query()->count());

        $this->actingAs($admin)
            ->post('/api/admin/cod/receiving-methods', [...$fields, 'qr' => UploadedFile::fake()->image('farmgate-qr.png')])
            ->assertCreated()
            ->assertJsonPath('method.status', 'PENDING_VERIFICATION');
        $method = CodReceivingMethod::query()->firstOrFail();
        $this->actingAs($verifyingAdmin)
            ->postJson('/api/admin/cod/receiving-methods/'.$method->id.'/verify', [
                'reason' => 'Verified this QR points only to the Farmgate receiving account.',
                'receiving_only_confirmed' => false,
            ])
            ->assertUnprocessable();
        $this->assertSame('PENDING_VERIFICATION', $method->fresh()->status);
        $this->actingAs($verifyingAdmin)
            ->postJson('/api/admin/cod/receiving-methods/'.$method->id.'/verify', [
                'reason' => 'Verified this QR points only to the Farmgate receiving account.',
                'receiving_only_confirmed' => true,
            ])
            ->assertOk()
            ->assertJsonPath('method.status', 'ACTIVE');
        $qrUrl = $this->actingAs($rider)->getJson('/api/riders/cod/receiving-methods')
            ->assertOk()
            ->assertJsonPath('methods.0.method_type', 'BANK_QR')
            ->json('methods.0.qr_url');
        $this->get($qrUrl)->assertOk()->assertHeader('Cache-Control', 'no-store, private');
        $summary = $this->actingAs($admin)->getJson('/api/admin/cod/summary')->assertOk()
            ->assertJsonPath('receiving_methods.active_qr', 1)
            ->assertJsonPath('payment_providers.paymongo.seller_payouts_enabled', false);
        $this->assertStringNotContainsString('sk_test_server-only-example', $summary->getContent());
        $this->assertStringNotContainsString('whsk_server-only-example', $summary->getContent());
    }

    public function test_paymongo_receiving_qr_can_be_configured_and_requires_provider_readiness(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $verifyingAdmin = User::factory()->create(['role' => Role::ADMIN]);
        $rider = User::factory()->create(['role' => Role::RIDER]);
        RiderProfile::create(['user_id' => $rider->id, 'availability' => 'OFFLINE', 'is_verified' => true]);
        $fields = [
            'method_type' => 'PAYMONGO_QR',
            'label' => 'Farmgate PayMongo receiving QR',
            'instructions' => 'Use this QR to receive the COD remittance.',
            'account_holder' => 'Farmgate Operations Inc',
            'bank_name' => 'PayMongo',
            'account_number' => 'merchant-12345',
        ];

        $this->actingAs($admin)
            ->post('/api/admin/cod/receiving-methods', [...$fields, 'qr' => UploadedFile::fake()->image('farmgate-paymongo-qr.png')])
            ->assertCreated()
            ->assertJsonPath('method.status', 'PENDING_VERIFICATION');
        $method = CodReceivingMethod::query()->firstOrFail();

        $this->actingAs($verifyingAdmin)
            ->postJson('/api/admin/cod/receiving-methods/'.$method->id.'/verify', [
                'reason' => 'Verified this QR receives funds for Farmgate.',
                'receiving_only_confirmed' => true,
            ])
            ->assertStatus(503);
        $this->actingAs($rider)->getJson('/api/riders/cod/receiving-methods')->assertOk()->assertJsonCount(0, 'methods');

        config([
            'services.paymongo.secret_key' => 'sk_test_server-only-example',
            'services.paymongo.webhook_secret' => 'whsk_server-only-example',
            'payments.paymongo.configuration_verified' => true,
        ]);
        $this->actingAs($verifyingAdmin)
            ->postJson('/api/admin/cod/receiving-methods/'.$method->id.'/verify', [
                'reason' => 'Verified this QR receives funds for Farmgate.',
                'receiving_only_confirmed' => true,
            ])
            ->assertOk()
            ->assertJsonPath('method.status', 'ACTIVE');

        $this->actingAs($rider)->getJson('/api/riders/cod/receiving-methods')
            ->assertOk()
            ->assertJsonPath('methods.0.method_type', 'PAYMONGO_QR');
    }

    public function test_receiving_method_edits_and_reactivation_require_a_new_admin_verification(): void
    {
        $configuringAdmin = User::factory()->create(['role' => Role::ADMIN]);
        $secondAdmin = User::factory()->create(['role' => Role::ADMIN]);
        $thirdAdmin = User::factory()->create(['role' => Role::ADMIN]);
        $method = CodReceivingMethod::query()->create([
            'method_type' => 'BANK_TRANSFER',
            'label' => 'Farmgate bank',
            'instructions' => 'Transfer the full batch amount.',
            'account_holder' => 'Farmgate Operations Inc',
            'bank_name' => 'Sample Bank',
            'account_number' => '1234567890',
            'status' => 'ACTIVE',
            'configured_by' => $configuringAdmin->id,
            'verified_by' => $secondAdmin->id,
            'verified_at' => now(),
        ]);

        $this->actingAs(User::factory()->create(['role' => Role::BUYER]))
            ->putJson('/api/admin/cod/receiving-methods/'.$method->id, [
                'label' => 'Updated Farmgate bank',
                'instructions' => 'Use the updated receiving instructions.',
                'bank_name' => 'Updated Bank',
                'reason' => 'Bank details were confirmed with the provider.',
            ])->assertForbidden();

        $this->actingAs($configuringAdmin)
            ->putJson('/api/admin/cod/receiving-methods/'.$method->id, [
                'label' => 'Updated Farmgate bank',
                'instructions' => 'Use the updated receiving instructions.',
                'bank_name' => 'Updated Bank',
                'account_number' => '9876543210',
                'reason' => 'Bank details were confirmed with the provider.',
            ])->assertOk()
            ->assertJsonPath('method.status', 'PENDING_VERIFICATION')
            ->assertJsonPath('method.account_number_masked', '•••• 3210');

        $this->actingAs($configuringAdmin)
            ->postJson('/api/admin/cod/receiving-methods/'.$method->id.'/verify', [
                'reason' => 'Confirmed updated details belong to Farmgate.',
                'receiving_only_confirmed' => true,
            ])->assertStatus(409);
        $this->actingAs($secondAdmin)
            ->postJson('/api/admin/cod/receiving-methods/'.$method->id.'/verify', [
                'reason' => 'Confirmed updated details belong to Farmgate.',
                'receiving_only_confirmed' => true,
            ])->assertOk()->assertJsonPath('method.status', 'ACTIVE');

        $this->actingAs($secondAdmin)
            ->postJson('/api/admin/cod/receiving-methods/'.$method->id.'/deactivate', [
                'reason' => 'Temporarily stop accepting bank remittance.',
            ])->assertOk()->assertJsonPath('method.status', 'DISABLED');
        $this->actingAs($configuringAdmin)
            ->postJson('/api/admin/cod/receiving-methods/'.$method->id.'/enable', [
                'reason' => 'The receiving account is available again.',
            ])->assertOk()->assertJsonPath('method.status', 'PENDING_VERIFICATION');
        $this->actingAs($configuringAdmin)
            ->postJson('/api/admin/cod/receiving-methods/'.$method->id.'/verify', [
                'reason' => 'Confirmed this account remains Farmgate controlled.',
                'receiving_only_confirmed' => true,
            ])->assertStatus(409);
        $this->actingAs($thirdAdmin)
            ->postJson('/api/admin/cod/receiving-methods/'.$method->id.'/verify', [
                'reason' => 'Confirmed this account remains Farmgate controlled.',
                'receiving_only_confirmed' => true,
            ])->assertOk()->assertJsonPath('method.status', 'ACTIVE');

        $this->assertDatabaseHas('cod_receiving_method_histories', [
            'cod_receiving_method_id' => $method->id,
            'action' => 'CONFIGURATION_UPDATED',
        ]);
        $this->assertDatabaseHas('cod_receiving_method_histories', [
            'cod_receiving_method_id' => $method->id,
            'action' => 'REACTIVATION_REQUESTED',
        ]);
    }
}
