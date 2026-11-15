<?php

namespace Tests\Feature;

use App\Enums\DeliveryStatus;
use App\Enums\OrderStatus;
use App\Enums\Role;
use App\Models\Delivery;
use App\Models\Order;
use App\Models\RiderEarning;
use App\Models\RiderEarningSettingHistory;
use App\Models\RiderEarningsSetting;
use App\Models\RiderPayout;
use App\Models\RiderProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class RiderEarningsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('delivery_proofs');
    }

    public function test_rider_earnings_settings_are_unconfigured_until_an_admin_saves_and_audits_them(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);

        $this->actingAs($admin)->getJson('/api/admin/rider-earnings/settings')
            ->assertOk()
            ->assertJsonPath('configured', false)
            ->assertJsonPath('setting', null);
        $this->actingAs($buyer)->putJson('/api/admin/rider-earnings/settings', [
            'percentage' => 50,
            'cap_scope' => 'NO_CAP',
            'reason' => 'Approved rider payout policy.',
        ])->assertForbidden();

        $this->actingAs($admin)->putJson('/api/admin/rider-earnings/settings', [
            'percentage' => 100.01,
            'cap_scope' => 'NO_CAP',
            'reason' => 'Approved rider payout policy.',
        ])->assertUnprocessable();
        $this->actingAs($admin)->putJson('/api/admin/rider-earnings/settings', [
            'percentage' => 50,
            'cap_scope' => 'PER_DELIVERY',
            'cap_amount' => 0,
            'reason' => 'Approved rider payout policy.',
        ])->assertUnprocessable();
        $this->assertSame(0, RiderEarningsSetting::query()->count());

        $this->actingAs($admin)->putJson('/api/admin/rider-earnings/settings', [
            'percentage' => 0,
            'cap_scope' => 'NO_CAP',
            'cap_amount' => null,
            'reason' => 'Approved zero percent policy.',
        ])->assertOk()
            ->assertJsonPath('configured', true)
            ->assertJsonPath('setting.percentage', '0.00')
            ->assertJsonPath('setting.cap_scope', 'NO_CAP')
            ->assertJsonPath('setting.cap_amount', null);

        $history = RiderEarningSettingHistory::query()->firstOrFail();
        $this->assertSame($admin->id, $history->actor_id);
        $this->assertSame('Approved zero percent policy.', $history->reason);
        $this->assertNotNull($history->created_at);
        $this->assertDatabaseHas('rider_earnings_settings', [
            'id' => RiderEarningsSetting::SINGLETON_ID,
            'percentage' => '0.00',
            'cap_scope' => 'NO_CAP',
            'cap_amount' => null,
        ]);

        ['rider' => $rider, 'delivery' => $delivery, 'token' => $token] = $this->deliveryWithFee('20.00');
        $this->verifyDelivery($rider, $delivery, $token);
        $earning = RiderEarning::query()->where('delivery_id', $delivery->id)->firstOrFail();
        $this->assertSame('0.00', $earning->percentage_snapshot);
        $this->assertSame(0, $earning->amount_cents);
        $this->assertSame(0, RiderPayout::query()->count());
    }

    public function test_verified_buyer_qr_snapshots_round_half_up_and_queues_only_configured_manual_payouts(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $this->saveSettings($admin, '50', 'NO_CAP');
        ['rider' => $rider, 'delivery' => $delivery, 'token' => $token] = $this->deliveryWithFee('10.01');

        $this->verifyDelivery($rider, $delivery, $token);

        $earning = RiderEarning::query()->where('delivery_id', $delivery->id)->firstOrFail();
        $this->assertSame(1001, $earning->delivery_fee_cents);
        $this->assertSame('50.00', $earning->percentage_snapshot);
        $this->assertSame('NO_CAP', $earning->cap_scope_snapshot);
        $this->assertNull($earning->cap_amount_snapshot);
        $this->assertSame(501, $earning->amount_cents);
        $this->assertSame(DeliveryStatus::DELIVERED, $delivery->fresh()->status);
        $this->assertSame('PENDING', $earning->payout?->status);
        $this->assertSame(501, $earning->payout?->amount_cents);
        $this->assertNull($earning->payout?->external_reference);

        $this->saveSettings($admin, '100', 'PER_PAYOUT', '2.00');
        $this->assertSame(501, $earning->fresh()->amount_cents);

        $this->actingAs($admin)->getJson('/api/admin/rider-payouts?group=queue')
            ->assertOk()
            ->assertJsonPath('payouts.total', 1)
            ->assertJsonPath('payouts.data.0.earning.delivery.delivery_reference', $delivery->delivery_reference);

        $this->actingAs($rider)->getJson('/api/rider/earnings')
            ->assertOk()
            ->assertJsonPath('configuration_status', 'CONFIGURED')
            ->assertJsonPath('summary.earned_cents', 501)
            ->assertJsonPath('earnings.data.0.percentage_snapshot', '50.00')
            ->assertJsonPath('earnings.data.0.amount_cents', 501);
        $otherRider = User::factory()->create(['role' => Role::RIDER]);
        RiderProfile::create(['user_id' => $otherRider->id, 'availability' => 'OFFLINE', 'is_verified' => true]);
        $this->actingAs($otherRider)->getJson('/api/rider/earnings')
            ->assertOk()
            ->assertJsonPath('summary.earned_cents', 0)
            ->assertJsonPath('earnings.total', 0);

        $payout = $earning->payout;
        $this->actingAs($admin)->postJson('/api/admin/rider-payouts/'.$payout->id.'/manual-confirm', [
            'external_reference' => 'FG-RIDER-TRANSFER-1',
            'method' => 'BANK_TRANSFER',
            'amount_cents' => 500,
            'paid_at' => now()->toDateString(),
            'reason' => 'Verified external transfer.',
            'externally_completed_confirmed' => true,
        ])->assertUnprocessable();
        $this->assertSame('PENDING', $payout->fresh()->status);

        $this->actingAs($admin)->postJson('/api/admin/rider-payouts/'.$payout->id.'/manual-confirm', [
            'external_reference' => 'FG-RIDER-TRANSFER-1',
            'method' => 'BANK_TRANSFER',
            'amount_cents' => 501,
            'paid_at' => now()->toDateString(),
            'reason' => 'Verified external transfer.',
            'externally_completed_confirmed' => true,
        ])->assertCreated()
            ->assertJsonPath('payout.status', 'PAID')
            ->assertJsonPath('payout.amount_cents', 501);

        $this->assertSame($admin->id, $payout->fresh()->recorded_by);
        $this->assertSame(1, RiderPayout::query()->where('status', 'PAID')->count());
        $this->actingAs($admin)->getJson('/api/admin/rider-payouts?group=recorded')
            ->assertOk()
            ->assertJsonPath('payouts.total', 1)
            ->assertJsonPath('payouts.data.0.status', 'PAID');
    }

    public function test_missing_configuration_does_not_block_delivery_or_create_retroactive_earnings(): void
    {
        ['rider' => $rider, 'delivery' => $delivery, 'token' => $token] = $this->deliveryWithFee('25.00');

        $this->verifyDelivery($rider, $delivery, $token);

        $this->assertSame(DeliveryStatus::DELIVERED, $delivery->fresh()->status);
        $this->assertSame(0, RiderEarning::query()->count());
        $this->assertSame(0, RiderPayout::query()->count());
        $this->actingAs($rider)->getJson('/api/rider/earnings')
            ->assertOk()
            ->assertJsonPath('configuration_status', 'NOT_CONFIGURED')
            ->assertJsonPath('earnings.total', 0);

        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $this->saveSettings($admin, '100', 'NO_CAP');
        $this->assertSame(0, RiderEarning::query()->count());
    }

    public function test_free_delivery_snapshots_zero_earnings_and_cancelled_deliveries_are_ineligible(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $this->saveSettings($admin, '75', 'PER_DELIVERY', '3.00');
        ['rider' => $rider, 'delivery' => $freeDelivery, 'token' => $token] = $this->deliveryWithFee('0.00');
        $this->verifyDelivery($rider, $freeDelivery, $token);

        $freeEarning = RiderEarning::query()->where('delivery_id', $freeDelivery->id)->firstOrFail();
        $this->assertSame(0, $freeEarning->amount_cents);
        $this->assertSame('PER_DELIVERY', $freeEarning->cap_scope_snapshot);
        $this->assertSame(0, RiderPayout::query()->count());

        ['rider' => $cancelledRider, 'delivery' => $cancelled] = $this->deliveryWithFee('10.00', DeliveryStatus::CANCELLED);
        $this->actingAs($cancelledRider)->post('/api/deliveries/'.$cancelled->id.'/proof', [
            'photo' => UploadedFile::fake()->image('proof.jpg'),
            'recipient_confirmed' => '1',
            'recipient_name' => 'Buyer',
            'captured_at' => now()->toISOString(),
        ])->assertStatus(409);
        $this->assertSame(0, RiderEarning::query()->where('delivery_id', $cancelled->id)->count());
    }

    public function test_delivery_and_payout_caps_limit_the_snapshotted_amount(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $this->saveSettings($admin, '75', 'PER_DELIVERY', '3.00');
        ['rider' => $deliveryCapRider, 'delivery' => $deliveryCapped, 'token' => $deliveryToken] = $this->deliveryWithFee('10.01');
        $this->verifyDelivery($deliveryCapRider, $deliveryCapped, $deliveryToken);

        $deliveryCapEarning = RiderEarning::query()->where('delivery_id', $deliveryCapped->id)->firstOrFail();
        $this->assertSame('PER_DELIVERY', $deliveryCapEarning->cap_scope_snapshot);
        $this->assertSame(300, $deliveryCapEarning->amount_cents);
        $this->assertSame(300, $deliveryCapEarning->payout?->amount_cents);

        $this->saveSettings($admin, '75', 'PER_PAYOUT', '2.00');
        ['rider' => $payoutCapRider, 'delivery' => $payoutCapped, 'token' => $payoutToken] = $this->deliveryWithFee('10.01');
        $this->verifyDelivery($payoutCapRider, $payoutCapped, $payoutToken);

        $payoutCapEarning = RiderEarning::query()->where('delivery_id', $payoutCapped->id)->firstOrFail();
        $this->assertSame('PER_PAYOUT', $payoutCapEarning->cap_scope_snapshot);
        $this->assertSame(200, $payoutCapEarning->amount_cents);
        $this->assertSame(200, $payoutCapEarning->payout?->amount_cents);
    }

    private function saveSettings(User $admin, string $percentage, string $capScope, ?string $capAmount = null): void
    {
        $payload = [
            'percentage' => $percentage,
            'cap_scope' => $capScope,
            'reason' => 'Approved rider earnings policy.',
        ];
        if ($capAmount !== null) {
            $payload['cap_amount'] = $capAmount;
        } elseif ($capScope === 'NO_CAP') {
            $payload['cap_amount'] = null;
        }

        $this->actingAs($admin)->putJson('/api/admin/rider-earnings/settings', $payload)->assertOk();
    }

    private function deliveryWithFee(string $fee, DeliveryStatus $status = DeliveryStatus::IN_TRANSIT): array
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
            'shipping_address' => [
                'recipient_name' => 'Buyer',
                'latitude' => 12.7321,
                'longitude' => 121.3654,
            ],
            'delivery_fee' => $fee,
            'total_amount' => 100,
        ]);
        $token = str_repeat('D', 64);
        $delivery = Delivery::create([
            'order_id' => $order->id,
            'rider_id' => $rider->id,
            'status' => $status,
            'delivery_qr_token_hash' => hash('sha256', $token),
            'delivery_qr_expires_at' => now()->addMinutes(30),
        ]);

        return compact('rider', 'delivery', 'token');
    }

    private function verifyDelivery(User $rider, Delivery $delivery, string $token): void
    {
        $this->actingAs($rider)->post('/api/deliveries/'.$delivery->id.'/proof', [
            'photo' => UploadedFile::fake()->image('proof.jpg'),
            'recipient_confirmed' => '1',
            'recipient_name' => 'Buyer',
            'captured_at' => now()->toISOString(),
        ])->assertOk();

        $this->actingAs($rider)->postJson('/api/deliveries/'.$delivery->id.'/delivery-verify', [
            'qr_token' => $token,
            'latitude' => 12.7321,
            'longitude' => 121.3654,
        ])->assertOk();
    }
}
