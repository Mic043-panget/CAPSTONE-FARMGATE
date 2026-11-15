<?php

namespace Tests\Feature;

use App\Enums\DeliveryStatus;
use App\Enums\OrderStatus;
use App\Enums\Role;
use App\Models\Delivery;
use App\Models\Order;
use App\Models\RiderPayoutDestination;
use App\Models\RiderPayoutMethod;
use App\Models\RiderProfile;
use App\Models\User;
use App\Notifications\RiderPayoutStatusNotification;
use App\Services\RiderEarningsService;
use App\Services\SystemSettingsService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class RiderPayoutWorkflowTest extends TestCase
{
    use RefreshDatabase;

    public function test_verified_delivery_uses_a_frozen_rider_rate_snapshot_and_is_idempotent(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $actors = $this->completedDelivery();
        $settings = app(SystemSettingsService::class);
        $settings->update([
            'rider_base_compensation' => 40,
            'rider_per_km_compensation' => 10,
            'rider_minimum_compensation' => 50,
            'rider_maximum_compensation' => 100,
        ], $admin->id, 'Configure rider compensation rates for this test.');

        $service = app(RiderEarningsService::class);
        $first = $service->recordCompletedDelivery($actors['delivery']);
        $settings->update(['rider_base_compensation' => 99], $admin->id, 'Update rate for future deliveries only.');
        $second = $service->recordCompletedDelivery($actors['delivery']);

        $this->assertSame($first->id, $second->id);
        $this->assertSame(6_000, $first->gross_amount_cents);
        $this->assertSame(12_000, $first->delivery_fee_cents);
        $this->assertSame('READY', $first->eligibility_status);
        $this->assertSame(4_000, $first->calculation_snapshot['base_compensation_cents']);
        $this->assertSame('UNPAID', $actors['order']->fresh()->payment_status);
        $this->assertDatabaseCount('rider_earnings', 1);
        $this->assertDatabaseHas('rider_earning_histories', [
            'rider_earning_id' => $first->id,
            'action' => 'CALCULATED',
            'to_status' => 'READY',
        ]);
    }

    public function test_rider_payout_destination_is_encrypted_masked_and_requires_admin_verification(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $verifier = User::factory()->create(['role' => Role::ADMIN]);
        $rider = $this->rider();
        $method = $this->activeMethod($admin, $verifier, 'BANK');

        $this->actingAs($rider)->putJson('/api/rider/payout-destination', [
            'current_password' => 'password',
            'destination_type' => 'BANK',
            'account_holder' => 'Rider Example',
            'bank_name' => 'Sample Bank',
            'account_number' => '1234567890123456',
        ])->assertOk()
            ->assertJsonPath('destination.status', 'PENDING_VERIFICATION')
            ->assertJsonPath('destination.account_number_masked', '•••• 3456')
            ->assertJsonMissing(['account_number' => '1234567890123456']);

        $destination = RiderPayoutDestination::query()->where('rider_id', $rider->id)->firstOrFail();
        $stored = DB::table('rider_payout_destinations')->where('id', $destination->id)->value('account_number');
        $this->assertNotSame('1234567890123456', $stored);
        $this->assertSame('1234567890123456', $destination->account_number);
        $this->actingAs(User::factory()->create(['role' => Role::BUYER]))
            ->getJson('/api/admin/rider-payout-destinations')
            ->assertForbidden();

        $this->actingAs($verifier)->postJson('/api/admin/rider-payout-destinations/'.$destination->id.'/verify', [
            'decision' => 'VERIFIED',
            'reason' => 'Destination details reviewed through the approved verification process.',
        ])->assertOk()->assertJsonPath('destination.status', 'VERIFIED');
        $this->assertDatabaseHas('rider_payout_destination_histories', [
            'rider_payout_destination_id' => $destination->id,
            'action' => 'VERIFIED',
            'actor_id' => $verifier->id,
        ]);
    }

    public function test_payout_creation_is_idempotent_and_manual_payment_needs_an_independent_admin(): void
    {
        Storage::fake('delivery_proofs');
        $creator = User::factory()->create(['role' => Role::ADMIN]);
        $confirmer = User::factory()->create(['role' => Role::ADMIN]);
        $actors = $this->completedDelivery();
        $secondDelivery = $this->completedDelivery($actors['rider']);
        app(SystemSettingsService::class)->update([
            'rider_base_compensation' => 40,
            'rider_per_km_compensation' => 10,
            'rider_minimum_compensation' => 50,
            'rider_maximum_compensation' => 100,
        ], $creator->id, 'Configure compensation for individual delivery payout tests.');
        $firstEarning = $this->app->make(RiderEarningsService::class)->recordCompletedDelivery($actors['delivery']);
        $secondEarning = $this->app->make(RiderEarningsService::class)->recordCompletedDelivery($secondDelivery['delivery']);
        $this->activeMethod($creator, $confirmer, 'BANK');
        $destination = RiderPayoutDestination::query()->create([
            'rider_id' => $actors['rider']->id,
            'destination_type' => 'BANK',
            'account_holder' => 'Rider Example',
            'bank_name' => 'Sample Bank',
            'account_number' => '1234567890123456',
            'status' => 'VERIFIED',
            'verified_by' => $confirmer->id,
            'verified_at' => now(),
        ]);
        $payload = [
            'earning_id' => $firstEarning->id,
            'reason' => 'Approve this delivery payout after destination verification.',
            'idempotency_key' => 'rider-delivery-idempotency-0001',
        ];
        $firstResponse = $this->actingAs($creator)->postJson('/api/admin/rider-payouts', $payload)->assertCreated();
        $payoutId = $firstResponse->json('payout.id');
        $this->actingAs($creator)->postJson('/api/admin/rider-payouts', $payload)->assertCreated()->assertJsonPath('payout.id', $payoutId);
        $this->assertDatabaseCount('rider_payouts', 1);
        $this->assertCount(1, $firstResponse->json('payout.earnings'));
        $this->assertSame($actors['delivery']->reference, $firstResponse->json('payout.earnings.0.delivery_reference'));
        $this->assertDatabaseHas('rider_earnings', [
            'delivery_id' => $actors['delivery']->id,
            'payout_id' => $payoutId,
            'payout_status' => 'IN_PAYOUT',
        ]);

        $secondPayoutResponse = $this->actingAs($creator)->postJson('/api/admin/rider-payouts', [
            'earning_id' => $secondEarning->id,
            'reason' => 'Approve a separate payout for the next completed delivery.',
            'idempotency_key' => 'rider-delivery-idempotency-0002',
        ])->assertCreated();
        $secondPayoutId = $secondPayoutResponse->json('payout.id');
        $this->assertNotSame($payoutId, $secondPayoutId);
        $this->assertCount(1, $secondPayoutResponse->json('payout.earnings'));
        $this->assertSame($secondDelivery['delivery']->reference, $secondPayoutResponse->json('payout.earnings.0.delivery_reference'));
        $this->assertSame($secondEarning->net_amount_cents, $secondPayoutResponse->json('payout.amount_cents'));

        $this->actingAs($creator)->postJson('/api/admin/rider-payouts/'.$secondPayoutId.'/status', [
            'status' => 'PROCESSING',
            'reason' => 'Record the attempted external transfer for this delivery.',
        ])->assertOk();
        $this->actingAs($creator)->postJson('/api/admin/rider-payouts/'.$secondPayoutId.'/status', [
            'status' => 'FAILED',
            'reason' => 'The external transfer failed and must be attempted again.',
        ])->assertOk();
        $this->actingAs($creator)
            ->getJson('/api/admin/rider-payouts?status=FAILED&search='.$secondDelivery['delivery']->reference)
            ->assertOk()
            ->assertJsonPath('payouts.data.0.earnings.0.delivery_reference', $secondDelivery['delivery']->reference);
        $retryResponse = $this->actingAs($creator)->postJson('/api/admin/rider-payouts', [
            'earning_id' => $secondEarning->id,
            'reason' => 'Create a new individual payout after the prior transfer failed.',
            'idempotency_key' => 'rider-delivery-idempotency-retry',
        ])->assertCreated();
        $this->assertNotSame($secondPayoutId, $retryResponse->json('payout.id'));
        $this->assertSame($secondDelivery['delivery']->reference, $retryResponse->json('payout.earnings.0.delivery_reference'));
        $riderEarnings = $this->actingAs($actors['rider'])->getJson('/api/rider/earnings')->assertOk()->json('earnings.data');
        $secondRiderEarning = collect($riderEarnings)->firstWhere('id', $secondEarning->id);
        $this->assertNotNull($secondRiderEarning);
        $this->assertEqualsCanonicalizing(
            [$secondPayoutResponse->json('payout.reference'), $retryResponse->json('payout.reference')],
            collect($secondRiderEarning['payout_history'])->pluck('reference')->all(),
        );
        $this->assertDatabaseCount('rider_payouts', 3);

        $this->actingAs($creator)->postJson('/api/admin/rider-payouts/'.$payoutId.'/status', [
            'status' => 'PROCESSING',
            'reason' => 'External transfer requested through bank operations.',
        ])->assertOk();
        $transfer = [
            'transfer_reference' => 'BANK-TRANSFER-556677',
            'amount_cents' => $firstResponse->json('payout.amount_cents'),
            'transfer_date' => today()->toDateString(),
            'reason' => 'Independently checked bank statement and confirmed external settlement.',
            'receipt' => UploadedFile::fake()->create('receipt.pdf', 20, 'application/pdf'),
        ];
        $this->actingAs($creator)
            ->post('/api/admin/rider-payouts/'.$payoutId.'/manual-confirm', $transfer)
            ->assertForbidden();
        $this->actingAs($confirmer)
            ->post('/api/admin/rider-payouts/'.$payoutId.'/manual-confirm', $transfer)
            ->assertOk()
            ->assertJsonPath('payout.status', 'PAID')
            ->assertJsonPath('payout.transfer_reference_masked', '•••• 6677');

        $this->assertDatabaseHas('rider_payouts', [
            'id' => $payoutId,
            'status' => 'PAID',
            'confirmed_by' => $confirmer->id,
        ]);
        $this->assertDatabaseHas('rider_earnings', ['payout_id' => $payoutId, 'payout_status' => 'PAID']);
        $this->assertDatabaseHas('rider_payout_histories', [
            'rider_payout_id' => $payoutId,
            'action' => 'MANUAL_TRANSFER_CONFIRMED',
            'actor_id' => $confirmer->id,
        ]);
        $this->actingAs($actors['rider'])->getJson('/api/rider-payouts/'.$payoutId.'/receipt')->assertOk();
        $otherRider = $this->rider();
        $this->actingAs($otherRider)->getJson('/api/rider-payouts/'.$payoutId.'/receipt')->assertForbidden();
        $this->actingAs($confirmer)->postJson('/api/admin/rider-payouts/'.$payoutId.'/manual-confirm', [])->assertOk()->assertJsonPath('idempotent', true);
        $this->assertNotNull($destination->fresh());
    }

    public function test_rider_payout_notification_uses_the_existing_in_app_and_email_outbox(): void
    {
        config(['mail.default' => 'array']);
        $rider = $this->rider();
        $rider->notify(new RiderPayoutStatusNotification(
            'FG-RP-2026-TEST000001',
            'PAID',
            7_500,
            'Your externally completed payout was confirmed.',
        ));

        $this->assertDatabaseHas('notifications', ['notifiable_id' => $rider->id]);
        $this->assertDatabaseHas('notification_deliveries', [
            'notifiable_id' => $rider->id,
            'channel' => 'email',
            'status' => 'not_configured',
        ]);
    }

    public function test_unconfigured_method_and_ineligible_earnings_cannot_be_paid(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $rider = $this->rider();
        $this->actingAs($rider)->putJson('/api/rider/payout-destination', [
            'current_password' => 'password',
            'destination_type' => 'BANK',
            'account_holder' => 'Rider Example',
            'bank_name' => 'Sample Bank',
            'account_number' => '1234567890123456',
        ])->assertStatus(409);

        $actors = $this->completedDelivery();
        $actors['delivery']->forceFill(['delivery_verified_at' => null])->save();
        $service = app(RiderEarningsService::class);
        $earning = $service->recordCompletedDelivery($actors['delivery']);
        $this->assertSame('PENDING_ELIGIBILITY', $earning->eligibility_status);
        $this->actingAs($admin)->postJson('/api/admin/rider-payouts', [
            'earning_id' => $earning->id,
            'reason' => 'Attempt a payout for an ineligible delivery.',
            'idempotency_key' => 'rider-delivery-ineligible-0001',
        ])->assertStatus(409);
    }

    private function activeMethod(User $configurer, User $verifier, string $type): RiderPayoutMethod
    {
        return RiderPayoutMethod::query()->create([
            'method_type' => $type,
            'status' => 'ACTIVE',
            'configured_by' => $configurer->id,
            'verified_by' => $verifier->id,
            'verified_at' => now(),
        ]);
    }

    private function rider(): User
    {
        $rider = User::factory()->create(['role' => Role::RIDER]);
        RiderProfile::query()->create(['user_id' => $rider->id, 'is_verified' => true, 'availability' => 'OFFLINE']);

        return $rider;
    }

    /**
     * @return array{rider: User, order: Order, delivery: Delivery}
     */
    private function completedDelivery(?User $rider = null): array
    {
        $rider ??= $this->rider();
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $order = Order::query()->create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::FULFILLING,
            'delivery_method' => 'STANDARD_DELIVERY',
            'payment_method' => 'COD',
            'payment_status' => 'UNPAID',
            'delivery_fee' => '120.00',
            'delivery_distance_km' => '2.00',
            'total_amount' => '500.00',
        ]);
        $delivery = Delivery::query()->create([
            'order_id' => $order->id,
            'rider_id' => $rider->id,
            'status' => DeliveryStatus::DELIVERED,
            'pickup_verified_at' => now()->subMinutes(20),
            'delivery_verified_at' => now(),
        ]);
        $delivery->forceFill([
            'delivery_proof_path' => 'proofs/private.jpg',
            'recipient_confirmed' => true,
            'delivery_recipient_name' => 'Recipient Example',
        ])->save();

        return compact('rider', 'order', 'delivery');
    }
}
