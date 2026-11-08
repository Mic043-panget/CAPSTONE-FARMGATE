<?php

namespace Tests\Feature;

use App\Enums\DeliveryStatus;
use App\Enums\OrderStatus;
use App\Enums\Role;
use App\Models\Delivery;
use App\Models\Order;
use App\Models\RiderProfile;
use App\Models\User;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
use Tests\TestCase;

class AccountSettingsTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_read_and_update_notification_and_privacy_preferences(): void
    {
        $user = User::factory()->create(['email_verified_at' => now()]);

        $this->actingAs($user)->getJson('/api/profile/settings')
            ->assertOk()
            ->assertJsonPath('email_verified_at', $user->email_verified_at->toISOString())
            ->assertJsonPath('preferences.order_notifications', true)
            ->assertJsonPath('preferences.chat_notifications', true)
            ->assertJsonPath('preferences.allow_direct_messages', true);

        $this->actingAs($user)->putJson('/api/profile/settings', [
            'order_notifications' => false,
            'chat_notifications' => false,
            'allow_direct_messages' => false,
        ])->assertOk()
            ->assertJsonPath('preferences.order_notifications', false)
            ->assertJsonPath('preferences.chat_notifications', false)
            ->assertJsonPath('preferences.allow_direct_messages', false);

        $this->assertSame(false, $user->fresh()->account_preferences['order_notifications']);
        $this->assertSame(false, $user->fresh()->account_preferences['chat_notifications']);
        $this->assertSame(false, $user->fresh()->account_preferences['allow_direct_messages']);
    }

    public function test_seller_can_update_supported_account_preferences_without_changing_other_preferences(): void
    {
        $seller = User::factory()->create([
            'role' => Role::SELLER,
            'account_preferences' => [
                'order_notifications' => true,
                'chat_notifications' => false,
                'allow_direct_messages' => true,
            ],
        ]);

        $this->actingAs($seller)->putJson('/api/profile/settings', [
            'order_notifications' => false,
        ])->assertOk()
            ->assertJsonPath('preferences.order_notifications', false)
            ->assertJsonPath('preferences.chat_notifications', false)
            ->assertJsonPath('preferences.allow_direct_messages', true);

        $this->assertSame(false, $seller->fresh()->account_preferences['order_notifications']);
        $this->assertSame(false, $seller->fresh()->account_preferences['chat_notifications']);
        $this->assertSame(true, $seller->fresh()->account_preferences['allow_direct_messages']);
    }

    public function test_verification_email_can_be_resent_only_when_email_is_unverified(): void
    {
        Notification::fake();
        $user = User::factory()->unverified()->create();

        $this->actingAs($user)->postJson('/api/profile/email/verification-notification')
            ->assertOk()
            ->assertJsonPath('message', 'A verification link has been sent to your email address.');
        Notification::assertSentTo($user, VerifyEmail::class);

        $verifiedUser = User::factory()->create(['email_verified_at' => now()]);
        $this->actingAs($verifiedUser)->postJson('/api/profile/email/verification-notification')
            ->assertStatus(409);
        Notification::assertNotSentTo($verifiedUser, VerifyEmail::class);
    }

    public function test_signed_verification_link_updates_account_and_redirects_to_frontend(): void
    {
        $user = User::factory()->unverified()->create();
        $url = URL::temporarySignedRoute(
            'verification.verify',
            now()->addMinutes(30),
            ['id' => $user->id, 'hash' => sha1($user->getEmailForVerification())],
        );

        $this->get($url)
            ->assertRedirect('http://127.0.0.1:5173/?email_verification=success#profile');

        $this->assertNotNull($user->fresh()->email_verified_at);
    }

    public function test_rider_can_update_only_their_own_profile_and_password(): void
    {
        $rider = User::factory()->create(['role' => Role::RIDER, 'username' => 'rider-old']);
        $otherRider = User::factory()->create(['role' => Role::RIDER, 'username' => 'rider-other']);

        $this->actingAs($rider)->putJson('/api/profile', [
            'name' => 'Rider Updated',
            'username' => 'rider-updated',
            'email' => 'updated-rider@example.test',
        ])->assertOk()
            ->assertJsonPath('user.name', 'Rider Updated')
            ->assertJsonPath('user.username', 'rider-updated')
            ->assertJsonPath('email_verification_required', true);

        $this->actingAs($rider)->putJson('/api/profile/password', [
            'current_password' => 'password',
            'password' => 'new-rider-password',
            'password_confirmation' => 'new-rider-password',
        ])->assertOk();

        $this->assertSame('Rider Updated', $rider->fresh()->name);
        $this->assertSame('rider-other', $otherRider->fresh()->username);
        $this->assertTrue(password_verify('new-rider-password', $rider->fresh()->password));
    }

    public function test_rider_profile_validation_and_non_rider_authorization_are_enforced(): void
    {
        $rider = User::factory()->create(['role' => Role::RIDER]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);

        $this->actingAs($rider)->putJson('/api/profile', [
            'name' => '',
            'username' => 'bad username',
            'email' => 'not-an-email',
        ])->assertUnprocessable();
        $this->actingAs($buyer)->getJson('/api/riders/settings')->assertForbidden();
        $this->actingAs($buyer)->putJson('/api/riders/settings', ['availability' => 'AVAILABLE'])->assertForbidden();
    }

    public function test_rider_can_update_private_delivery_preferences_and_availability_with_active_delivery_guard(): void
    {
        $rider = User::factory()->create(['role' => Role::RIDER]);
        $profile = RiderProfile::create([
            'user_id' => $rider->id,
            'availability' => 'OFFLINE',
            'is_verified' => true,
            'vehicle_type' => 'motorcycle',
        ]);
        $anotherRider = User::factory()->create(['role' => Role::RIDER]);
        RiderProfile::create([
            'user_id' => $anotherRider->id,
            'availability' => 'AVAILABLE',
            'is_verified' => true,
            'vehicle_type' => 'van',
        ]);

        $this->actingAs($rider)->getJson('/api/riders/settings')
            ->assertOk()
            ->assertJsonPath('settings.availability', 'OFFLINE')
            ->assertJsonPath('settings.vehicle_type', 'motorcycle');
        $this->actingAs($rider)->putJson('/api/riders/settings', [
            'availability' => 'AVAILABLE',
        ])->assertOk()->assertJsonPath('settings.availability', 'AVAILABLE')
            ->assertJsonPath('settings.vehicle_type', 'motorcycle');

        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::FULFILLING,
            'total_amount' => 100,
        ]);
        Delivery::create([
            'order_id' => $order->id,
            'rider_id' => $rider->id,
            'status' => DeliveryStatus::IN_TRANSIT,
        ]);
        $this->actingAs($rider)->putJson('/api/riders/settings', ['availability' => 'OFFLINE'])
            ->assertStatus(409);
        $this->assertSame('AVAILABLE', $profile->fresh()->availability);

        $this->actingAs($anotherRider)->getJson('/api/riders/settings')
            ->assertOk()->assertJsonPath('settings.vehicle_type', 'van');
        $this->assertSame('motorcycle', $profile->fresh()->vehicle_type);
    }

    public function test_rider_notification_preferences_are_private_and_delivery_availability_is_validated(): void
    {
        $rider = User::factory()->create(['role' => Role::RIDER]);
        $otherRider = User::factory()->create(['role' => Role::RIDER]);
        RiderProfile::create(['user_id' => $rider->id, 'availability' => 'OFFLINE', 'is_verified' => true]);
        RiderProfile::create(['user_id' => $otherRider->id, 'availability' => 'OFFLINE', 'is_verified' => true]);

        $this->actingAs($rider)->putJson('/api/profile/settings', [
            'order_notifications' => false,
            'chat_notifications' => true,
        ])->assertOk()
            ->assertJsonPath('preferences.order_notifications', false)
            ->assertJsonPath('preferences.chat_notifications', true);
        $this->actingAs($rider)->putJson('/api/riders/settings', [
            'availability' => 'AVAILABLE',
            'vehicle_type' => str_repeat('x', 101),
        ])->assertUnprocessable();
        $this->actingAs($otherRider)->getJson('/api/profile/settings')
            ->assertOk()->assertJsonPath('preferences.order_notifications', true);
        $this->actingAs($otherRider)->putJson('/api/riders/settings', ['availability' => 'ONLINE'])
            ->assertUnprocessable();
    }

    public function test_rider_can_update_and_remove_profile_photo_with_private_account_routes(): void
    {
        Storage::fake('public');
        /** @var FilesystemAdapter $publicDisk */
        $publicDisk = Storage::disk('public');
        $rider = User::factory()->create(['role' => Role::RIDER]);
        $this->actingAs($rider)->post('/api/profile/photo', [
            'photo' => UploadedFile::fake()->image('rider.png'),
        ])->assertOk()->assertJsonPath('user.role', Role::RIDER->value);
        $path = $rider->fresh()->profile_photo_path;
        $this->assertNotNull($path);
        $publicDisk->assertExists($path);

        $this->actingAs($rider)->deleteJson('/api/profile/photo')->assertOk();
        $this->assertNull($rider->fresh()->profile_photo_path);
        $publicDisk->assertMissing($path);
    }
}
