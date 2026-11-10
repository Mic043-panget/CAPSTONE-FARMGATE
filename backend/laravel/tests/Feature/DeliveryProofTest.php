<?php

namespace Tests\Feature;

use App\Enums\DeliveryStatus;
use App\Enums\OrderStatus;
use App\Enums\Role;
use App\Models\AuditLog;
use App\Models\Delivery;
use App\Models\DeliveryProofCorrection;
use App\Models\Order;
use App\Models\RiderProfile;
use App\Models\User;
use Illuminate\Contracts\Filesystem\Factory as FilesystemFactory;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Mockery;
use Tests\TestCase;

class DeliveryProofTest extends TestCase
{
    use RefreshDatabase;

    public function test_dropoff_requires_photo_and_recipient_confirmation_before_delivered(): void
    {
        Storage::fake('delivery_proofs');
        ['buyer' => $buyer, 'rider' => $rider, 'delivery' => $delivery, 'token' => $token] = $this->dropoff();

        $this->actingAs($rider)->post('/api/deliveries/'.$delivery->id.'/delivery-verify', [
            'qr_token' => $token,
            'recipient_confirmed' => '1',
            'recipient_name' => 'Buyer',
            'captured_at' => now()->toISOString(),
        ])->assertUnprocessable();
        $this->assertSame(DeliveryStatus::IN_TRANSIT, $delivery->fresh()->status);
        $this->assertNotNull($delivery->fresh()->delivery_qr_token_hash);

        $this->actingAs($rider)->post('/api/deliveries/'.$delivery->id.'/proof', [
            'photo' => UploadedFile::fake()->image('proof.jpg'),
            'recipient_confirmed' => '0',
            'recipient_name' => 'Buyer',
            'captured_at' => now()->toISOString(),
        ])->assertUnprocessable();
        $this->assertSame(DeliveryStatus::IN_TRANSIT, $delivery->fresh()->status);
        $this->assertNull($delivery->fresh()->delivery_verified_at);
    }

    public function test_dropoff_verifies_saved_proof_and_rejects_replay(): void
    {
        Storage::fake('delivery_proofs');
        ['rider' => $rider, 'delivery' => $delivery, 'token' => $token] = $this->dropoff();
        $proofPayload = [
            'photo' => UploadedFile::fake()->image('proof.jpg'),
            'recipient_confirmed' => '1',
            'recipient_name' => 'Received by Buyer',
            'captured_at' => now()->toISOString(),
        ];
        $this->actingAs($rider)->post('/api/deliveries/'.$delivery->id.'/proof', $proofPayload)
            ->assertOk()
            ->assertJsonPath('delivery.status', DeliveryStatus::IN_TRANSIT->value)
            ->assertJsonPath('delivery.has_delivery_proof', true);
        $verificationPayload = [
            'qr_token' => $token,
            'latitude' => 12.7321,
            'longitude' => 121.3654,
        ];

        $this->actingAs($rider)->post('/api/deliveries/'.$delivery->id.'/delivery-verify', $verificationPayload)
            ->assertOk()
            ->assertJsonPath('delivery.status', DeliveryStatus::DELIVERED->value)
            ->assertJsonPath('delivery.has_delivery_proof', true)
            ->assertJsonPath('delivery.recipient_confirmed', true);
        $saved = $delivery->fresh();
        $this->assertNotNull($saved->delivery_verified_at);
        $this->assertNotNull($saved->proof_captured_at);
        $this->assertNotNull($saved->proof_recorded_at);
        $this->assertSame(12.7321, $saved->delivery_verification_latitude);
        $this->assertTrue(Storage::disk('delivery_proofs')->exists($saved->delivery_proof_path));

        $this->actingAs($rider)->post('/api/deliveries/'.$delivery->id.'/delivery-verify', $verificationPayload)->assertStatus(409);
        $this->assertSame(1, count(Storage::disk('delivery_proofs')->allFiles()));
        $this->assertSame(1, $saved->statusHistory()->where('to_status', DeliveryStatus::DELIVERED->value)->count());
    }

    public function test_out_of_order_dropoff_does_not_consume_token_or_change_delivery(): void
    {
        Storage::fake('delivery_proofs');
        ['rider' => $rider, 'delivery' => $delivery, 'token' => $token] = $this->dropoff(DeliveryStatus::RIDER_ACCEPTED);

        $this->actingAs($rider)->post('/api/deliveries/'.$delivery->id.'/proof', [
            'photo' => UploadedFile::fake()->image('proof.jpg'),
            'recipient_confirmed' => '1',
            'recipient_name' => 'Buyer',
            'captured_at' => now()->toISOString(),
        ])->assertStatus(409);
        $this->assertSame(DeliveryStatus::RIDER_ACCEPTED, $delivery->fresh()->status);
        $this->assertNotNull($delivery->fresh()->delivery_qr_token_hash);
        $this->assertSame([], Storage::disk('delivery_proofs')->allFiles());
    }

    public function test_upload_persistence_failure_does_not_mark_delivery_delivered(): void
    {
        ['rider' => $rider, 'delivery' => $delivery, 'token' => $token] = $this->dropoff();
        $filesystem = Mockery::mock(FilesystemAdapter::class);
        $filesystem->shouldReceive('putFileAs')->once()->andReturn(false);
        $factory = Mockery::mock(FilesystemFactory::class);
        $factory->shouldReceive('disk')->once()->with('delivery_proofs')->andReturn($filesystem);
        $this->app->instance(FilesystemFactory::class, $factory);

        $this->actingAs($rider)->post('/api/deliveries/'.$delivery->id.'/proof', [
            'photo' => UploadedFile::fake()->image('proof.jpg'),
            'recipient_confirmed' => '1',
            'recipient_name' => 'Buyer',
            'captured_at' => now()->toISOString(),
        ])->assertServerError();

        $this->assertSame(DeliveryStatus::IN_TRANSIT, $delivery->fresh()->status);
        $this->assertNull($delivery->fresh()->delivery_verified_at);
    }

    public function test_proof_file_is_private_and_visible_only_to_order_participants_assigned_rider_and_admin(): void
    {
        Storage::fake('delivery_proofs');
        $actors = $this->dropoff();
        $delivery = $actors['delivery'];
        $rider = $actors['rider'];
        $this->actingAs($rider)->post('/api/deliveries/'.$delivery->id.'/proof', [
            'photo' => UploadedFile::fake()->image('proof.jpg'),
            'recipient_confirmed' => '1',
            'recipient_name' => 'Buyer',
            'captured_at' => now()->toISOString(),
        ])->assertOk();
        $this->actingAs($rider)->post('/api/deliveries/'.$delivery->id.'/delivery-verify', [
            'qr_token' => $actors['token'],
            'latitude' => 12.7321,
            'longitude' => 121.3654,
        ])->assertOk();

        $this->app['auth']->forgetGuards();
        $this->getJson('/api/deliveries/'.$delivery->id.'/proof')->assertUnauthorized();
        $this->actingAs(User::factory()->create(['role' => Role::BUYER]))
            ->get('/api/deliveries/'.$delivery->id.'/proof')->assertForbidden();
        $this->actingAs($actors['buyer'])->get('/api/deliveries/'.$delivery->id.'/proof')
            ->assertOk()
            ->assertHeader('Cache-Control', 'no-store, private')
            ->assertHeader('X-Content-Type-Options', 'nosniff');
        $this->actingAs($actors['seller'])->get('/api/deliveries/'.$delivery->id.'/proof')->assertOk();
        $this->actingAs($rider)->get('/api/deliveries/'.$delivery->id.'/proof')->assertOk();
        $this->actingAs(User::factory()->create(['role' => Role::ADMIN]))->get('/api/deliveries/'.$delivery->id.'/proof')->assertOk();
    }

    public function test_only_admin_can_correct_completed_proof_and_correction_is_audited(): void
    {
        Storage::fake('delivery_proofs');
        $actors = $this->dropoff();
        $delivery = $actors['delivery'];
        $initialCapturedAt = now()->subMinute();
        $this->actingAs($actors['rider'])->post('/api/deliveries/'.$delivery->id.'/proof', [
            'qr_token' => $actors['token'],
            'photo' => UploadedFile::fake()->image('proof.jpg'),
            'recipient_confirmed' => '1',
            'recipient_name' => 'Original Recipient',
            'captured_at' => $initialCapturedAt->toISOString(),
        ])->assertOk();
        $this->actingAs($actors['rider'])->post('/api/deliveries/'.$delivery->id.'/delivery-verify', [
            'qr_token' => $actors['token'],
            'latitude' => 12.7321,
            'longitude' => 121.3654,
        ])->assertOk();
        $verifiedAt = $delivery->fresh()->delivery_verified_at;

        $correctedCapturedAt = now();
        $correction = [
            'recipient_name' => 'Corrected Recipient',
            'photo' => UploadedFile::fake()->image('replacement.jpg'),
            'captured_at' => $correctedCapturedAt->toISOString(),
            'reason' => 'Replacing a damaged original delivery image.',
        ];
        $this->actingAs($actors['seller'])->post('/api/admin/deliveries/'.$delivery->id.'/proof-correction', $correction)->assertForbidden();
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $this->actingAs($admin)->post('/api/admin/deliveries/'.$delivery->id.'/proof-correction', [
            'recipient_name' => 'Corrected Recipient',
        ])->assertUnprocessable();
        $this->actingAs($admin)->post('/api/admin/deliveries/'.$delivery->id.'/proof-correction', $correction)
            ->assertOk()
            ->assertJsonPath('delivery.delivery_recipient_name', 'Corrected Recipient')
            ->assertJsonPath('delivery.status', DeliveryStatus::DELIVERED->value);

        $this->assertSame($verifiedAt->toISOString(), $delivery->fresh()->delivery_verified_at->toISOString());
        $history = DeliveryProofCorrection::query()->where('delivery_id', $delivery->id)->firstOrFail();
        $this->assertTrue(Storage::disk('delivery_proofs')->exists($history->old_proof_path));
        $this->assertTrue(Storage::disk('delivery_proofs')->exists($history->new_proof_path));
        $this->assertSame('Original Recipient', $history->old_recipient_name);
        $this->assertSame('Corrected Recipient', $history->new_recipient_name);
        $this->assertSame($admin->id, $history->corrected_by);
        $this->assertSame('Replacing a damaged original delivery image.', $history->reason);
        $this->assertSame($initialCapturedAt->timestamp, $history->old_proof_captured_at->timestamp);
        $this->assertSame($correctedCapturedAt->timestamp, $history->new_proof_captured_at->timestamp);
        $this->assertDatabaseHas('audit_logs', [
            'user_id' => $admin->id,
            'route' => 'api/admin/deliveries/{delivery}/proof-correction',
            'reason' => 'Replacing a damaged original delivery image.',
            'status_code' => 200,
        ]);
    }

    public function test_delivery_proof_state_is_in_scope_for_buyer_seller_rider_and_admin_views(): void
    {
        Storage::fake('delivery_proofs');
        $actors = $this->dropoff();
        $delivery = $actors['delivery'];
        $this->actingAs($actors['rider'])->post('/api/deliveries/'.$delivery->id.'/proof', [
            'photo' => UploadedFile::fake()->image('proof.jpg'),
            'recipient_confirmed' => '1',
            'recipient_name' => 'Buyer',
            'captured_at' => now()->toISOString(),
        ])->assertOk();
        $this->actingAs($actors['rider'])->post('/api/deliveries/'.$delivery->id.'/delivery-verify', [
            'qr_token' => $actors['token'],
            'latitude' => 12.7321,
            'longitude' => 121.3654,
        ])->assertOk();
        $audit = AuditLog::query()->where('route', 'api/deliveries/{delivery}/delivery-verify')->latest('id')->firstOrFail();
        $auditPayload = json_encode($audit->toArray());
        $this->assertIsString($auditPayload);
        $this->assertStringNotContainsString($delivery->fresh()->delivery_proof_path, $auditPayload);
        $this->assertStringNotContainsString($delivery->fresh()->delivery_proof_sha256, $auditPayload);
        $this->assertStringNotContainsString('Buyer', $auditPayload);

        foreach ([$actors['buyer'], $actors['seller'], $actors['rider']] as $participant) {
            $this->actingAs($participant)->getJson('/api/deliveries/'.$delivery->id.'/tracking')
                ->assertOk()
                ->assertJsonPath('delivery.has_delivery_proof', true)
                ->assertJsonPath('delivery.recipient_confirmed', true);
        }
        $this->actingAs($actors['buyer'])->getJson('/api/orders/'.$delivery->order_id)
            ->assertOk()
            ->assertJsonPath('order.delivery.has_delivery_proof', true)
            ->assertJsonMissingPath('order.delivery.delivery_proof_path');
        $this->actingAs($actors['seller'])->getJson('/api/orders/'.$delivery->order_id)
            ->assertOk()
            ->assertJsonPath('order.delivery.has_delivery_proof', true);
        $this->actingAs($actors['buyer'])->getJson('/api/dashboard/buyer')
            ->assertOk()
            ->assertJsonPath('summary.purchase_history.0.delivery.has_delivery_proof', true);
        $this->actingAs($actors['seller'])->getJson('/api/dashboard/seller')
            ->assertOk()
            ->assertJsonPath('summary.recent_orders.0.delivery.has_delivery_proof', true);
        $this->actingAs($actors['rider'])->getJson('/api/dashboard/rider')
            ->assertOk()
            ->assertJsonPath('summary.delivered_with_proof', 1);
        $this->actingAs($actors['seller'])->getJson('/api/reports/deliveries')
            ->assertOk()
            ->assertJsonPath('proof_summary.with_proof', 1)
            ->assertJsonPath('data.data.0.has_delivery_proof', true);
        $this->actingAs($actors['rider'])->getJson('/api/reports/deliveries')
            ->assertOk()
            ->assertJsonPath('data.data.0.has_delivery_proof', true);
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $this->actingAs($admin)->getJson('/api/dashboard/admin')
            ->assertOk()
            ->assertJsonPath('summary.delivered_with_proof', 1);
        $today = today()->toDateString();
        $this->actingAs($admin)->getJson('/api/analytics?from='.$today.'&to='.$today)
            ->assertOk()
            ->assertJsonPath('delivery_proof_summary.recorded', 1)
            ->assertJsonPath('delivery_proof_summary.missing', 0);
        $this->actingAs(User::factory()->create(['role' => Role::ADMIN]))
            ->getJson('/api/admin/deliveries')
            ->assertOk()
            ->assertJsonPath('deliveries.data.0.has_delivery_proof', true);
    }

    public function test_admin_delivery_list_search_and_details_use_the_stable_public_reference(): void
    {
        $actors = $this->dropoff();
        $delivery = $actors['delivery'];
        $this->assertMatchesRegularExpression('/^FG-DEL-\d{4}-[A-Z0-9]{6}$/', $delivery->delivery_reference);
        $admin = User::factory()->create(['role' => Role::ADMIN]);

        $this->actingAs($admin)
            ->getJson('/api/admin/deliveries?search='.urlencode($delivery->delivery_reference))
            ->assertOk()
            ->assertJsonPath('deliveries.data.0.delivery_reference', $delivery->delivery_reference);
        $this->actingAs($admin)
            ->getJson('/api/admin/deliveries/'.$delivery->id)
            ->assertOk()
            ->assertJsonPath('delivery.delivery_reference', $delivery->delivery_reference);
        $this->actingAs($actors['buyer'])
            ->getJson('/api/admin/deliveries/'.$delivery->id)
            ->assertForbidden();
    }

    /**
     * @return array{buyer: User, seller: User, rider: User, delivery: Delivery, token: string}
     */
    private function dropoff(DeliveryStatus $status = DeliveryStatus::IN_TRANSIT): array
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

        return compact('buyer', 'seller', 'rider', 'delivery', 'token');
    }
}
