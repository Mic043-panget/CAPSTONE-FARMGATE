<?php

namespace Tests\Feature;

use App\Enums\DeliveryStatus;
use App\Enums\OrderStatus;
use App\Enums\Role;
use App\Models\AuditLog;
use App\Models\CodCollection;
use App\Models\CodReceivingMethod;
use App\Models\CodRemittance;
use App\Models\Delivery;
use App\Models\Order;
use App\Models\RiderProfile;
use App\Models\SellerPayout;
use App\Models\SellerPayoutDestination;
use App\Models\SellerPayoutPolicy;
use App\Models\SellerPayoutPolicyAcknowledgement;
use App\Models\User;
use App\Notifications\CodWorkflowStatusNotification;
use App\Services\SystemSettingsService;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class CodRemittanceWorkflowTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('delivery_proofs');
    }

    public function test_only_assigned_approved_rider_can_record_exact_order_cod_collection_after_verified_delivery(): void
    {
        $actors = $this->codOrder();
        $unassigned = User::factory()->create(['role' => Role::RIDER]);
        RiderProfile::create(['user_id' => $unassigned->id, 'availability' => 'OFFLINE', 'is_verified' => true]);
        $actors['delivery']->forceFill(['status' => DeliveryStatus::IN_TRANSIT])->save();
        $this->collectCashAsRider($actors)
            ->assertStatus(409);
        $this->assertSame('UNPAID', $actors['order']->fresh()->payment_status);
        $actors['delivery']->forceFill(['status' => DeliveryStatus::DELIVERED])->save();

        $this->collectCashAsRider($actors, $unassigned)
            ->assertForbidden();
        $this->assertSame('UNPAID', $actors['order']->fresh()->payment_status);

        $this->collectCashAsRider($actors)
            ->assertCreated()
            ->assertJsonPath('collection.expected_amount_cents', 10000);
        $this->collectCashAsRider($actors)
            ->assertStatus(409);

        $this->assertSame('UNPAID', $actors['order']->fresh()->payment_status);
        $this->assertNull($actors['order']->fresh()->paid_at);
        $this->assertSame(DeliveryStatus::DELIVERED, $actors['delivery']->fresh()->status);
        $this->assertSame(OrderStatus::FULFILLING, $actors['order']->fresh()->status);
        $this->assertDatabaseHas('cod_collections', ['order_id' => $actors['order']->id, 'status' => 'COLLECTED']);
        $this->actingAs($actors['buyer'])
            ->getJson('/api/orders/'.$actors['order']->id)
            ->assertOk()
            ->assertJsonPath('order.cod_payment.status', 'AWAITING_CONFIRMATION')
            ->assertJsonPath('order.cod_payment.collection_status', 'COLLECTED')
            ->assertJsonMissingPath('order.codCollection')
            ->assertJsonMissingPath('order.cod_collection.remittance.transaction_reference');
        $this->actingAs($actors['buyer'])
            ->getJson('/api/orders')
            ->assertOk()
            ->assertJsonPath('orders.0.cod_payment.status', 'AWAITING_CONFIRMATION');
        $collection = CodCollection::query()->firstOrFail();
        $this->actingAs($unassigned)->get('/api/cod/collections/'.$collection->id.'/proof')->assertForbidden();
        $this->actingAs($actors['rider'])->get('/api/cod/collections/'.$collection->id.'/proof')->assertOk();

        $this->actingAs($actors['rider'])
            ->postJson('/api/riders/cod/remittances', [
                'method_type' => 'CASH_HANDOVER',
                'receiver_name' => 'Farmgate receiving staff',
            ])
            ->assertCreated();
        $this->actingAs($actors['buyer'])
            ->getJson('/api/orders/'.$actors['order']->id)
            ->assertOk()
            ->assertJsonPath('order.cod_payment.status', 'AWAITING_CONFIRMATION')
            ->assertJsonPath('order.cod_payment.remittance_status', 'SUBMITTED')
            ->assertJsonMissingPath('order.cod_collection.remittance.receiver_name');
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $remittance = CodRemittance::query()->firstOrFail();
        $this->actingAs($admin)
            ->postJson('/api/admin/cod/remittances/'.$remittance->id.'/reconcile', [
                'received_amount_cents' => 10000,
                'verification_confirmed' => true,
                'reason' => 'Verified cash handover against the recorded batch.',
            ])
            ->assertOk();
        $this->assertSame('PAID', $actors['order']->fresh()->payment_status);
        $this->assertNotNull($actors['order']->fresh()->paid_at);
        $this->assertSame('PENDING_SETUP', SellerPayout::query()->firstOrFail()->status);
        $this->actingAs($actors['buyer'])
            ->getJson('/api/orders/'.$actors['order']->id)
            ->assertOk()
            ->assertJsonPath('order.cod_payment.status', 'PAID');

        $this->actingAs($actors['rider'])
            ->post('/api/deliveries/'.$actors['delivery']->id.'/cod-collection', [
                'amount_cents' => 10000,
                'proof' => UploadedFile::fake()->image('handover.png'),
            ])
            ->assertStatus(409);
    }

    public function test_reconciled_remittance_creates_pending_payout_and_manual_confirmation_requires_receipt_and_verified_destination(): void
    {
        $actors = $this->codOrder();
        $actors['order']->forceFill([
            'subtotal_amount' => '90.00',
            'seller_fee' => '10.00',
            'discount_amount' => '20.00',
            'delivery_fee' => '10.00',
            'total_amount' => '100.00',
        ])->save();
        $this->collectCashAsRider($actors)
            ->assertCreated();

        $this->actingAs($actors['rider'])
            ->getJson('/api/riders/cod/collections')
            ->assertOk()
            ->assertJsonPath('total_amount_cents', 10000);

        $this->actingAs($actors['rider'])
            ->postJson('/api/riders/cod/remittances', [
                'method_type' => 'CASH_HANDOVER',
                'receiver_name' => 'Farmgate receiving staff',
            ])
            ->assertCreated()
            ->assertJsonPath('remittance.expected_amount_cents', 10000)
            ->assertJsonPath('remittance.status', 'SUBMITTED');

        $remittance = CodRemittance::query()->firstOrFail();
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $this->actingAs($admin)
            ->getJson('/api/admin/cod/remittances')
            ->assertOk()
            ->assertJsonPath('remittances.data.0.collections.0.order.order_reference', $actors['order']->order_reference)
            ->assertJsonPath('remittances.data.0.collections.0.collected_amount_cents', 10000);
        $this->actingAs($admin)
            ->getJson('/api/admin/cod/remittances?search='.$actors['order']->order_reference.'&status=SUBMITTED&method=CASH_HANDOVER&sort=amount_desc')
            ->assertOk()
            ->assertJsonPath('remittances.total', 1);
        $this->actingAs($admin)
            ->getJson('/api/admin/cod/summary')
            ->assertOk()
            ->assertJsonPath('remittances_awaiting_review.count', 1)
            ->assertJsonPath('remittances_awaiting_review.amount_cents', 10000)
            ->assertJsonPath('seller_payouts_pending.count', 0)
            ->assertJsonPath('paymongo_payouts_enabled', false);
        $proofUrl = $this->getJson('/api/admin/cod/remittances')->json('remittances.data.0.collections.0.proof_url');
        $this->get($proofUrl)->assertOk()->assertHeader('Content-Type', 'image/png');
        $this->actingAs($admin)
            ->postJson('/api/admin/cod/remittances/'.$remittance->id.'/reconcile', [
                'received_amount_cents' => 9500,
                'verification_confirmed' => true,
                'reason' => 'Cash short by 500 cents at handover.',
            ])
            ->assertOk()
            ->assertJsonPath('remittance.status', 'DISPUTED');

        $this->assertSame('REMITTED', CodCollection::query()->firstOrFail()->status);

        $this->actingAs($admin)
            ->postJson('/api/admin/cod/remittances/'.$remittance->id.'/reconcile', [
                'received_amount_cents' => 10000,
                'verification_confirmed' => true,
                'reason' => 'Discrepancy resolved; full amount received.',
            ])
            ->assertOk()
            ->assertJsonPath('remittance.status', 'RECONCILED');
        $this->assertSame('RECONCILED', CodCollection::query()->firstOrFail()->status);
        $this->assertSame('PAID', $actors['order']->fresh()->payment_status);
        $this->assertSame(OrderStatus::COMPLETED, $actors['order']->fresh()->status);

        $this->actingAs($actors['seller'])->getJson('/api/dashboard/seller')
            ->assertOk()
            ->assertJsonPath('summary.total_completed_sales', '100.00')
            ->assertJsonPath('summary.completed_orders', 1)
            ->assertJsonPath('summary.recent_orders.0.status', OrderStatus::COMPLETED->value);
        $this->getJson('/api/reports/sales')
            ->assertOk()
            ->assertJsonPath('summary.total', 1)
            ->assertJsonPath('data.data.0.status', OrderStatus::COMPLETED->value);

        $this->assertDatabaseHas('seller_payouts', [
            'order_id' => $actors['order']->id,
            'seller_id' => $actors['seller']->id,
            'amount_cents' => 8000,
            'status' => 'PENDING_SETUP',
        ]);
        $payout = SellerPayout::query()->firstOrFail();
        $policy = $this->createActivePayoutPolicy($admin);
        $this->acknowledgePayoutPolicy($actors['seller'], $policy);
        $this->assertDatabaseHas('notifications', [
            'notifiable_id' => $actors['seller']->id,
            'type' => CodWorkflowStatusNotification::class,
        ]);
        $this->assertSame(3, $remittance->histories()->count());
        $this->assertDatabaseHas('cod_remittance_histories', ['cod_remittance_id' => $remittance->id, 'action' => 'DISCREPANCY_RECORDED']);
        $this->assertDatabaseHas('cod_remittance_histories', ['cod_remittance_id' => $remittance->id, 'action' => 'RECONCILED']);

        $this->actingAs($actors['seller'])->putJson('/api/seller/payout-destination', [
            'destination_type' => 'BANK',
            'account_holder' => 'Farmgate Seller',
            'bank_name' => 'Sample Bank',
            'account_number' => '123456789012',
            'current_password' => 'password',
            'consent_accepted' => true,
            'consent_version' => 'seller-payout-ops-v1',
            'payout_policy_id' => $policy->id,
        ])->assertOk();
        $destination = SellerPayoutDestination::query()->firstOrFail();
        $this->actingAs($admin)
            ->postJson('/api/admin/seller-payout-destinations/'.$destination->id.'/verify', [
                'reason' => 'Seller destination ownership verified using approved records.',
            ])
            ->assertOk()
            ->assertJsonPath('destination.status', 'VERIFIED');
        $this->assertSame('PENDING', $payout->fresh()->status);
        $this->actingAs($actors['seller'])->putJson('/api/seller/payout-destination', [
            'destination_type' => 'BANK',
            'account_holder' => 'Farmgate Seller',
            'bank_name' => 'Sample Bank',
            'account_number' => '999999999999',
            'current_password' => 'password',
            'consent_accepted' => true,
            'consent_version' => 'seller-payout-ops-v1',
            'payout_policy_id' => $policy->id,
        ])->assertStatus(409);
        $this->actingAs($admin)
            ->post('/api/admin/seller-payouts/'.$payout->id.'/manual-confirm', [
                'external_reference' => 'offline-transfer-confirmation-01',
                'amount_cents' => 8000,
                'paid_at' => today()->toDateString(),
                'reason' => 'Attempt before manual payouts are enabled.',
                'externally_completed_confirmed' => true,
                'receipt' => UploadedFile::fake()->image('disabled-payout.png'),
            ])
            ->assertStatus(503);
        $this->assertSame('PENDING', $payout->fresh()->status);

        app(SystemSettingsService::class)->update(
            ['manual_seller_payouts_enabled' => true],
            $admin->id,
            'Approved COD payout policy reference FIN-01; payout destination verification completed outside Farmgate.',
        );
        $this->actingAs($admin)
            ->postJson('/api/admin/seller-payouts/'.$payout->id.'/status', [
                'status' => 'FAILED',
                'reason' => 'External transfer attempt was reported as failed.',
            ])
            ->assertOk()
            ->assertJsonPath('payout.status', 'FAILED');
        $this->actingAs($admin)
            ->postJson('/api/admin/seller-payouts/'.$payout->id.'/status', [
                'status' => 'PENDING',
                'reason' => 'Issue was reviewed; payout can be attempted again.',
            ])
            ->assertOk()
            ->assertJsonPath('payout.status', 'PENDING');
        $this->actingAs($admin)
            ->postJson('/api/admin/seller-payouts/'.$payout->id.'/manual-confirm', [
                'external_reference' => 'offline-transfer-confirmation-01',
                'amount_cents' => 8000,
                'paid_at' => today()->toDateString(),
                'reason' => 'Creator cannot independently confirm the transfer.',
                'externally_completed_confirmed' => true,
            ])
            ->assertStatus(409);
        $confirmingAdmin = User::factory()->create(['role' => Role::ADMIN]);
        $this->actingAs($confirmingAdmin)
            ->post('/api/admin/seller-payouts/'.$payout->id.'/manual-confirm', [
                'external_reference' => 'offline-transfer-confirmation-01',
                'amount_cents' => 8000,
                'paid_at' => today()->toDateString(),
                'reason' => 'A confirmation attestation is required before recording.',
            ])
            ->assertUnprocessable();
        $this->assertSame('PENDING', $payout->fresh()->status);
        $this->actingAs($confirmingAdmin)
            ->post('/api/admin/seller-payouts/'.$payout->id.'/manual-confirm', [
                'external_reference' => 'offline-transfer-confirmation-01',
                'amount_cents' => 8000,
                'paid_at' => today()->toDateString(),
                'reason' => 'Recorded after independently reviewing the external transfer evidence.',
                'externally_completed_confirmed' => true,
            ])
            ->assertCreated()
            ->assertJsonPath('payout.status', 'PAID');
        $this->assertSame('MANUAL_EVIDENCE_RECORDED', $payout->fresh()->provider_status);
        $this->assertNull($payout->fresh()->receipt_path);
        $this->actingAs($admin)
            ->getJson('/api/admin/seller-payouts?group=recorded&search='.$actors['order']->order_reference.'&status=PAID')
            ->assertOk()
            ->assertJsonPath('payouts.total', 1);
        $this->actingAs($admin)
            ->getJson('/api/admin/cod/summary')
            ->assertOk()
            ->assertJsonPath('confirmed_cod_received.count', 1)
            ->assertJsonPath('confirmed_cod_received.amount_cents', 10000)
            ->assertJsonPath('recorded_payouts.count', 1)
            ->assertJsonPath('recorded_payouts.amount_cents', 8000);
        $this->assertDatabaseHas('seller_payouts', ['id' => $payout->id, 'status' => 'PAID', 'amount_cents' => 8000]);
        $this->assertTrue(AuditLog::query()
            ->where('user_id', $confirmingAdmin->id)
            ->where('action', 'POST api/admin/seller-payouts/'.$payout->id.'/manual-confirm')
            ->where('status_code', 201)
            ->exists());
        $this->actingAs($admin)
            ->post('/api/admin/seller-payouts/'.$payout->id.'/manual-confirm', [
                'external_reference' => 'offline-transfer-confirmation-02',
                'amount_cents' => 8000,
                'paid_at' => today()->toDateString(),
                'reason' => 'Duplicate transfer confirmation should be blocked.',
                'externally_completed_confirmed' => true,
                'receipt' => UploadedFile::fake()->image('duplicate-receipt.png'),
            ])
            ->assertStatus(409);

        $this->actingAs($actors['seller'])
            ->getJson('/api/seller/payouts')
            ->assertOk()
            ->assertJsonPath('payouts.data.0.amount_cents', 8000)
            ->assertJsonPath('payouts.data.0.order.order_reference', $actors['order']->order_reference)
            ->assertJsonPath('payouts.data.0.destination_masked.identifier', '•••• 9012')
            ->assertJsonMissingPath('payouts.data.0.destination.account_number');
        $otherSeller = User::factory()->create(['role' => Role::SELLER]);
        $this->actingAs($otherSeller)
            ->getJson('/api/seller/payouts')
            ->assertOk()
            ->assertJsonCount(0, 'payouts.data');
    }

    public function test_non_admin_cannot_reconcile_or_record_a_payout_and_online_payments_are_not_in_cod_payout_flow(): void
    {
        $actors = $this->codOrder();
        $remittance = CodRemittance::create([
            'reference' => 'FG-COD-'.now()->format('Y').'-TESTREFERENCE',
            'rider_id' => $actors['rider']->id,
            'submitted_by' => $actors['rider']->id,
            'expected_amount_cents' => 10000,
            'status' => 'SUBMITTED',
            'submitted_at' => now(),
        ]);
        $this->actingAs($actors['seller'])
            ->postJson('/api/admin/cod/remittances/'.$remittance->id.'/reconcile', ['received_amount_cents' => 1])
            ->assertForbidden();

        $this->collectCashAsRider($actors)
            ->assertCreated();
        $actors['order']->forceFill(['payment_method' => 'GCASH', 'payment_status' => 'PAID', 'status' => OrderStatus::COMPLETED])->save();
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $policy = $this->createActivePayoutPolicy($admin, 'online-test-policy');
        $this->acknowledgePayoutPolicy($actors['seller'], $policy);
        $this->createVerifiedDestination($actors['seller'], $admin);
        app(SystemSettingsService::class)->update(
            ['manual_seller_payouts_enabled' => true],
            $admin->id,
            'Approved COD payout policy reference FIN-01; payout destination verification completed outside Farmgate.',
        );
        $this->actingAs($admin)
            ->postJson('/api/admin/orders/'.$actors['order']->id.'/seller-payout', [
                'amount_cents' => 1000,
                'method' => 'OTHER',
                'reason' => 'Online provider settlement is not integrated.',
            ])
            ->assertUnprocessable();
        $this->assertSame(0, SellerPayout::query()->count());
    }

    public function test_zero_saved_fee_uses_discounted_product_subtotal_without_delivery_fee_and_stays_pending_on_weekend(): void
    {
        Carbon::setTestNow(now()->next(Carbon::SATURDAY)->setTime(10, 0));
        try {
            $actors = $this->codOrder();
            $actors['order']->forceFill([
                'subtotal_amount' => '90.00',
                'seller_fee' => '0.00',
                'discount_amount' => '20.00',
                'delivery_fee' => '10.00',
                'total_amount' => '100.00',
            ])->save();
            $this->collectCashAsRider($actors)->assertCreated();
            $this->actingAs($actors['rider'])
                ->postJson('/api/riders/cod/remittances', [
                    'method_type' => 'CASH_HANDOVER',
                    'receiver_name' => 'Farmgate receiving staff',
                ])
                ->assertCreated();
            $admin = User::factory()->create(['role' => Role::ADMIN]);
            $remittance = CodRemittance::query()->firstOrFail();
            $this->actingAs($admin)
                ->postJson('/api/admin/cod/remittances/'.$remittance->id.'/reconcile', [
                    'received_amount_cents' => 10000,
                    'verification_confirmed' => true,
                    'reason' => 'Verified full remittance received on a weekend.',
                ])
                ->assertOk()
                ->assertJsonPath('remittance.status', 'RECONCILED');

            $payout = SellerPayout::query()->firstOrFail();
            $this->assertSame(9000, $payout->amount_cents);
            $this->assertSame('PENDING_SETUP', $payout->status);
            $this->assertNull($payout->paid_at);
            $this->assertSame('PAID', $actors['order']->fresh()->payment_status);
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_collection_rejects_non_cod_orders_without_changing_payment(): void
    {
        $actors = $this->codOrder();
        $actors['order']->forceFill(['payment_method' => 'GCASH'])->save();
        $this->collectCashAsRider($actors)
            ->assertUnprocessable();
        $this->assertSame('UNPAID', $actors['order']->fresh()->payment_status);
        $this->assertSame(0, CodCollection::query()->count());
    }

    public function test_underpayment_is_saved_for_review_and_does_not_mark_order_paid_after_batch_reconciliation(): void
    {
        $actors = $this->codOrder();
        $this->collectCashAsRider($actors, amountCents: 9000)
            ->assertCreated()
            ->assertJsonPath('collection.status', 'NEEDS_REVIEW')
            ->assertJsonPath('collection.collected_amount_cents', 9000);
        $this->assertSame('UNPAID', $actors['order']->fresh()->payment_status);

        $this->actingAs($actors['rider'])
            ->postJson('/api/riders/cod/remittances', [
                'method_type' => 'CASH_HANDOVER',
                'receiver_name' => 'Farmgate receiving staff',
            ])
            ->assertCreated()
            ->assertJsonPath('remittance.expected_amount_cents', 9000);
        $remittance = CodRemittance::query()->firstOrFail();
        $this->actingAs(User::factory()->create(['role' => Role::ADMIN]))
            ->postJson('/api/admin/cod/remittances/'.$remittance->id.'/reconcile', [
                'received_amount_cents' => 9000,
                'verification_confirmed' => true,
                'reason' => 'Verified the partial cash amount received.',
            ])
            ->assertOk()
            ->assertJsonPath('remittance.status', 'RECONCILED');

        $this->assertSame('NEEDS_REVIEW', CodCollection::query()->firstOrFail()->status);
        $this->assertSame('UNPAID', $actors['order']->fresh()->payment_status);
        $this->assertNull($actors['order']->fresh()->paid_at);
    }

    public function test_manual_payouts_stay_disabled_until_admin_records_policy_and_destination_setup(): void
    {
        $actors = $this->codOrder();
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $actors['order']->forceFill(['status' => OrderStatus::COMPLETED, 'payment_status' => 'PAID'])->save();

        $this->actingAs($admin)
            ->postJson('/api/admin/orders/'.$actors['order']->id.'/seller-payout', [
                'amount_cents' => 1000,
                'method' => 'CASH',
                'reason' => 'Attempt before policy setup.',
            ])
            ->assertStatus(503);

        $this->actingAs($admin)->putJson('/api/admin/settings', [
            'settings' => ['manual_seller_payouts_enabled' => true],
        ])->assertUnprocessable();
        $this->assertFalse(app(SystemSettingsService::class)->getBoolean('manual_seller_payouts_enabled'));

        $policy = $this->createActivePayoutPolicy($admin, 'enable-test-policy');
        $this->acknowledgePayoutPolicy($actors['seller'], $policy);
        $this->createVerifiedDestination($actors['seller'], $admin);
        $this->actingAs($admin)->putJson('/api/admin/settings', [
            'settings' => ['manual_seller_payouts_enabled' => true],
            'reason' => 'Approved payout policy FIN-01 and payout destinations verified outside Farmgate.',
        ])->assertOk();
        $this->assertTrue(app(SystemSettingsService::class)->getBoolean('manual_seller_payouts_enabled'));
        $this->assertDatabaseHas('system_setting_history', [
            'key' => 'manual_seller_payouts_enabled',
            'changed_by' => $admin->id,
            'change_reason' => 'Approved payout policy FIN-01 and payout destinations verified outside Farmgate.',
        ]);
    }

    public function test_electronic_remittance_reference_is_encrypted_and_duplicate_submission_is_rejected(): void
    {
        $actors = $this->codOrder();
        $this->collectCashAsRider($actors)->assertCreated();
        $method = CodReceivingMethod::query()->create([
            'method_type' => 'BANK_TRANSFER',
            'label' => 'Farmgate test receiving account',
            'instructions' => 'Transfer only to Farmgate.',
            'account_holder' => 'Farmgate Operations',
            'bank_name' => 'Sample Bank',
            'account_number' => '123456789012',
            'status' => 'ACTIVE',
            'configured_by' => User::factory()->create(['role' => Role::ADMIN])->id,
        ]);
        $payload = [
            'method_type' => 'BANK_TRANSFER',
            'receiving_method_id' => $method->id,
            'transaction_reference' => 'BANK-TXN-ONCE-12345',
            'proof' => UploadedFile::fake()->image('transfer-proof.png'),
        ];

        $this->actingAs($actors['rider'])
            ->post('/api/riders/cod/remittances', $payload)
            ->assertCreated()
            ->assertJsonPath('remittance.status', 'SUBMITTED');
        $this->actingAs($actors['rider'])
            ->post('/api/riders/cod/remittances', [...$payload, 'proof' => UploadedFile::fake()->image('duplicate-proof.png')])
            ->assertStatus(409);

        $this->assertSame(1, CodRemittance::query()->count());
        $remittance = CodRemittance::query()->firstOrFail();
        $storedReference = DB::table('cod_remittances')->where('id', $remittance->id)->value('transaction_reference');
        $this->assertNotSame('BANK-TXN-ONCE-12345', $storedReference);
        $this->assertSame('BANK-TXN-ONCE-12345', $remittance->transaction_reference);
        $this->assertNotSame('BANK-TXN-ONCE-12345', $remittance->transaction_reference_hash);
        $this->assertStringNotContainsString('transaction_reference_hash', $remittance->toJson());
        $this->actingAs($actors['rider'])
            ->getJson('/api/riders/cod/remittances')
            ->assertOk()
            ->assertJsonMissing(['transaction_reference' => 'BANK-TXN-ONCE-12345']);
        $this->assertDatabaseHas('audit_logs', [
            'user_id' => $actors['rider']->id,
            'action' => 'POST api/riders/cod/remittances',
            'status_code' => 409,
        ]);
    }

    public function test_paymongo_remittance_submission_requires_provider_readiness(): void
    {
        config([
            'services.paymongo.secret_key' => null,
            'services.paymongo.webhook_secret' => null,
            'payments.paymongo.configuration_verified' => false,
        ]);
        $actors = $this->codOrder();
        $this->collectCashAsRider($actors)->assertCreated();
        $method = CodReceivingMethod::query()->create([
            'method_type' => 'PAYMONGO_QR',
            'label' => 'Farmgate PayMongo receiving QR',
            'instructions' => 'Transfer only to Farmgate.',
            'account_holder' => 'Farmgate Operations',
            'bank_name' => 'PayMongo',
            'account_number' => 'merchant-12345',
            'status' => 'ACTIVE',
            'configured_by' => User::factory()->create(['role' => Role::ADMIN])->id,
        ]);
        $payload = [
            'method_type' => 'PAYMONGO_QR',
            'receiving_method_id' => $method->id,
            'transaction_reference' => 'PAYMONGO-TXN-ONCE-12345',
            'proof' => UploadedFile::fake()->image('paymongo-transfer-proof.png'),
        ];

        $this->actingAs($actors['rider'])
            ->post('/api/riders/cod/remittances', $payload)
            ->assertStatus(503);
        $this->assertSame(0, CodRemittance::query()->count());

        config([
            'services.paymongo.secret_key' => 'sk_test_server-only-example',
            'services.paymongo.webhook_secret' => 'whsk_server-only-example',
            'payments.paymongo.configuration_verified' => true,
        ]);
        $this->actingAs($actors['rider'])
            ->post('/api/riders/cod/remittances', $payload)
            ->assertCreated()
            ->assertJsonPath('remittance.status', 'SUBMITTED');
    }

    /**
     * @return array{buyer: User, seller: User, rider: User, order: Order, delivery: Delivery}
     */
    private function codOrder(): array
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $rider = User::factory()->create(['role' => Role::RIDER]);
        RiderProfile::create(['user_id' => $rider->id, 'availability' => 'OFFLINE', 'is_verified' => true]);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::FULFILLING,
            'delivery_method' => 'STANDARD_DELIVERY',
            'payment_method' => 'COD',
            'payment_status' => 'UNPAID',
            'subtotal_amount' => '90.00',
            'seller_fee' => '10.00',
            'total_amount' => '100.00',
        ]);
        $delivery = Delivery::create([
            'order_id' => $order->id,
            'rider_id' => $rider->id,
            'status' => DeliveryStatus::DELIVERED,
            'delivery_verified_at' => now(),
        ]);

        return compact('buyer', 'seller', 'rider', 'order', 'delivery');
    }

    /**
     * @param  array{rider: User, delivery: Delivery}  $actors
     */
    private function collectCashAsRider(array $actors, ?User $rider = null, int $amountCents = 10000)
    {
        return $this->actingAs($rider ?? $actors['rider'])
            ->post('/api/deliveries/'.$actors['delivery']->id.'/cod-collection', [
                'amount_cents' => $amountCents,
                'proof' => UploadedFile::fake()->image('handover.png'),
            ]);
    }

    private function createActivePayoutPolicy(User $admin, string $version = 'cod-payout-v1'): SellerPayoutPolicy
    {
        $path = 'seller-payout-policies/'.$version.'.pdf';
        Storage::disk('delivery_proofs')->put($path, 'test supporting policy');

        return SellerPayoutPolicy::query()->create([
            'version' => $version,
            'effective_date' => today(),
            'policy_text' => str_repeat('Actual policy terms prepared for test workflows. ', 4),
            'supporting_document_path' => $path,
            'supporting_document_mime_type' => 'application/pdf',
            'status' => 'PUBLISHED',
            'created_by' => $admin->id,
            'approved_by' => $admin->id,
            'published_by' => $admin->id,
            'approved_at' => now(),
            'published_at' => now(),
            'approval_reason' => 'Approved test payout policy.',
            'publication_reason' => 'Published test payout policy.',
        ]);
    }

    private function acknowledgePayoutPolicy(User $seller, SellerPayoutPolicy $policy): void
    {
        SellerPayoutPolicyAcknowledgement::query()->create([
            'seller_id' => $seller->id,
            'seller_payout_policy_id' => $policy->id,
            'acknowledged_at' => now(),
        ]);
    }

    private function createVerifiedDestination(User $seller, User $admin): SellerPayoutDestination
    {
        return SellerPayoutDestination::query()->create([
            'seller_id' => $seller->id,
            'destination_type' => 'BANK',
            'account_holder' => $seller->name,
            'bank_name' => 'Test Bank',
            'account_number' => '123456789012',
            'status' => 'VERIFIED',
            'consent_version' => 'seller-payout-ops-v1',
            'consent_accepted_at' => now(),
            'verified_by' => $admin->id,
            'verified_at' => now(),
        ]);
    }
}
