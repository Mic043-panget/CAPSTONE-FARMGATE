<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Models\User;
use App\Services\SystemSettingsService;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Storage;
use Laravel\Socialite\Contracts\Provider;
use Laravel\Socialite\Facades\Socialite;
use Laravel\Socialite\Two\User as GoogleUser;
use Tests\TestCase;

class AuthenticationTest extends TestCase
{
    use RefreshDatabase;

    public function test_buyer_can_register_and_access_their_authenticated_profile(): void
    {
        $response = $this->postJson('/api/auth/register', [
            'name' => 'Maria Santos',
            'email' => 'maria@example.com',
            'password' => 'password123',
            'password_confirmation' => 'password123',
            'phone_number' => '09171234567',
        ]);

        $response
            ->assertCreated()
            ->assertJsonPath('user.role', Role::BUYER->value)
            ->assertJsonPath('user.email', 'maria@example.com')
            ->assertJsonPath('user.phone_number', '+639171234567')
            ->assertJsonPath('user.phone_verified_at', null);

        $this->getJson('/api/auth/user')
            ->assertOk()
            ->assertJsonPath('user.name', 'Maria Santos');
    }

    public function test_seller_registration_creates_a_seller_profile(): void
    {
        $this->postJson('/api/auth/register', [
            'name' => 'Juan Cruz',
            'email' => 'juan@example.com',
            'password' => 'password123',
            'password_confirmation' => 'password123',
            'phone_number' => '+639171234568',
            'role' => Role::SELLER->value,
        ])->assertUnprocessable()->assertJsonValidationErrors('phone_verification_token');

        $this->assertDatabaseMissing('users', ['email' => 'juan@example.com']);
        $this->assertDatabaseMissing('seller_profiles', ['user_id' => User::where('email', 'juan@example.com')->value('id')]);
    }

    public function test_admin_and_rider_cannot_self_register(): void
    {
        foreach ([Role::ADMIN, Role::RIDER] as $role) {
            $this->postJson('/api/auth/register', [
                'name' => $role->value,
                'email' => strtolower($role->value).'@example.com',
                'password' => 'password123',
                'password_confirmation' => 'password123',
                'phone_number' => '09171234569',
                'role' => $role->value,
            ])->assertUnprocessable()->assertJsonValidationErrors('role');
        }
    }

    public function test_unauthenticated_user_cannot_access_their_profile(): void
    {
        $this->assertNotNull(route('login'));
        $this->getJson('/api/auth/user')->assertUnauthorized();
    }

    public function test_buyer_can_update_their_profile_without_changing_email_or_role(): void
    {
        $buyer = User::factory()->create([
            'name' => 'Demo Buyer',
            'email' => 'buyer@example.com',
            'role' => Role::BUYER,
            'phone_number' => '+639171234567',
            'phone_verified_at' => now(),
        ]);

        $this->actingAs($buyer)->putJson('/api/profile', [
            'name' => 'Rony Buyer',
            'username' => 'ronyku',
            'email' => 'attacker@example.com',
            'phone_number' => '+639171234568',
        ])->assertOk()
            ->assertJsonPath('user.name', 'Rony Buyer')
            ->assertJsonPath('user.username', 'ronyku')
            ->assertJsonPath('user.phone_number', '+639171234567')
            ->assertJsonPath('user.phone_verified_at', $buyer->phone_verified_at->toISOString())
            ->assertJsonPath('user.email', 'buyer@example.com')
            ->assertJsonPath('user.role', Role::BUYER->value);

        $this->assertDatabaseHas('users', [
            'id' => $buyer->id,
            'name' => 'Rony Buyer',
            'username' => 'ronyku',
            'email' => 'buyer@example.com',
            'role' => Role::BUYER->value,
            'phone_number' => '+639171234567',
        ]);
    }

    public function test_seller_can_update_account_and_business_details_and_email_change_requires_verification(): void
    {
        Notification::fake();
        $seller = User::factory()->create([
            'name' => 'Old Seller',
            'username' => 'oldseller',
            'email' => 'seller@example.com',
            'role' => Role::SELLER,
            'email_verified_at' => now(),
        ]);
        $seller->sellerProfile()->create(['business_name' => 'Old Farm']);

        $this->actingAs($seller)->putJson('/api/profile', [
            'name' => 'New Seller',
            'username' => 'newseller',
            'email' => 'NEWSELLER@example.com',
            'business_name' => 'New Farm',
            'business_phone' => '+639171234567',
            'business_address' => 'Bongabong, Oriental Mindoro',
        ])->assertOk()
            ->assertJsonPath('email_verification_required', true)
            ->assertJsonPath('user.name', 'New Seller')
            ->assertJsonPath('user.username', 'newseller')
            ->assertJsonPath('user.email', 'newseller@example.com')
            ->assertJsonPath('user.email_verified_at', null)
            ->assertJsonPath('user.seller_profile.business_name', 'New Farm')
            ->assertJsonPath('user.seller_profile.phone', '+639171234567')
            ->assertJsonPath('user.seller_profile.address', 'Bongabong, Oriental Mindoro');

        $this->assertDatabaseHas('users', [
            'id' => $seller->id,
            'email' => 'newseller@example.com',
            'email_verified_at' => null,
            'role' => Role::SELLER->value,
        ]);
        Notification::assertSentTo($seller->fresh(), VerifyEmail::class);
    }

    public function test_seller_can_change_password_with_current_password_and_privileged_roles_are_denied(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER, 'password' => 'password']);
        $this->actingAs($seller)->putJson('/api/profile/password', [
            'current_password' => 'wrong-password',
            'password' => 'new-password123',
            'password_confirmation' => 'new-password123',
        ])->assertUnprocessable()->assertJsonValidationErrors('current_password');

        $this->actingAs($seller)->putJson('/api/profile/password', [
            'current_password' => 'password',
            'password' => 'new-password123',
            'password_confirmation' => 'new-password123',
        ])->assertOk();
        $this->assertTrue(Hash::check('new-password123', $seller->fresh()->password));

        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $this->actingAs($admin)->putJson('/api/profile/password', [
            'current_password' => 'password',
            'password' => 'new-password123',
            'password_confirmation' => 'new-password123',
        ])->assertForbidden();
    }

    public function test_seller_profile_updates_validate_unique_email_and_business_field_lengths(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $existingUser = User::factory()->create(['email' => 'taken@example.com']);
        $seller->sellerProfile()->create(['business_name' => 'Original Farm']);

        $this->actingAs($seller)->putJson('/api/profile', [
            'name' => $seller->name,
            'username' => $seller->username ?? 'sellername',
            'email' => $existingUser->email,
            'business_name' => 'Changed Farm',
        ])->assertUnprocessable()->assertJsonValidationErrors('email');

        $this->actingAs($seller)->putJson('/api/profile', [
            'name' => $seller->name,
            'username' => $seller->username ?? 'sellername',
            'business_name' => str_repeat('F', 256),
        ])->assertUnprocessable()->assertJsonValidationErrors('business_name');

        $this->assertSame('Original Farm', $seller->fresh()->sellerProfile->business_name);
        $this->assertSame($seller->email, $seller->fresh()->email);
    }

    public function test_buyer_can_change_password_after_confirming_the_current_password(): void
    {
        $buyer = User::factory()->create(['password' => 'password']);

        $this->actingAs($buyer)->putJson('/api/profile/password', [
            'current_password' => 'password',
            'password' => 'new-password123',
            'password_confirmation' => 'new-password123',
        ])->assertOk()->assertJson(['message' => 'Password updated.']);

        $this->assertTrue(Hash::check('new-password123', $buyer->fresh()->password));
    }

    public function test_buyer_can_upload_and_remove_a_profile_photo(): void
    {
        Storage::fake('public');
        $buyer = User::factory()->create(['role' => Role::BUYER]);

        $this->actingAs($buyer)->postJson('/api/profile/photo', [
            'photo' => UploadedFile::fake()->image('profile.png'),
        ])->assertOk();

        $photoPath = $buyer->fresh()->profile_photo_path;
        $this->assertNotNull($photoPath);
        /** @var FilesystemAdapter $publicDisk */
        $publicDisk = Storage::disk('public');
        $publicDisk->assertExists($photoPath);

        $this->actingAs($buyer)->deleteJson('/api/profile/photo')
            ->assertOk()
            ->assertJsonPath('user.profile_photo_url', null);
        $publicDisk->assertMissing($photoPath);
    }

    public function test_verified_google_callback_creates_and_authenticates_a_buyer(): void
    {
        config([
            'services.google.client_id' => 'test-client-id',
            'services.google.client_secret' => 'test-client-secret',
        ]);
        $googleUser = GoogleUser::fake([
            'id' => 'google-user-123',
            'name' => 'Rony Buyer',
            'email' => 'rony@example.com',
            'email_verified' => true,
        ]);
        $provider = \Mockery::mock(Provider::class);
        $provider->shouldReceive('user')->once()->andReturn($googleUser);
        Socialite::shouldReceive('driver')->once()->with('google')->andReturn($provider);

        $this->get('/api/auth/google/callback')
            ->assertRedirect('http://127.0.0.1:5173/?oauth=success#marketplace');

        $buyer = User::query()->where('email', 'rony@example.com')->firstOrFail();
        $this->assertSame(Role::BUYER, $buyer->role);
        $this->assertSame('google-user-123', $buyer->google_id);
        $this->assertNotNull($buyer->email_verified_at);
        $this->assertAuthenticatedAs($buyer);
        $this->getJson('/api/auth/user')->assertOk()->assertJsonPath('user.email_verified_at', $buyer->email_verified_at->toISOString());
    }

    public function test_verified_google_callback_links_an_existing_account_without_changing_its_role(): void
    {
        config([
            'services.google.client_id' => 'test-client-id',
            'services.google.client_secret' => 'test-client-secret',
        ]);
        $seller = User::factory()->create(['email' => 'seller@example.com', 'role' => Role::SELLER]);
        $googleUser = GoogleUser::fake([
            'id' => 'google-seller-456',
            'name' => $seller->name,
            'email' => 'seller@example.com',
            'email_verified' => true,
        ]);
        $provider = \Mockery::mock(Provider::class);
        $provider->shouldReceive('user')->once()->andReturn($googleUser);
        Socialite::shouldReceive('driver')->once()->with('google')->andReturn($provider);

        $this->get('/api/auth/google/callback')->assertRedirect('http://127.0.0.1:5173/?oauth=success#marketplace');

        $this->assertSame('google-seller-456', $seller->fresh()->google_id);
        $this->assertSame(Role::SELLER, $seller->fresh()->role);
        $this->assertNotNull($seller->fresh()->email_verified_at);
        $this->assertAuthenticatedAs($seller);
    }

    public function test_unverified_google_email_cannot_create_an_account(): void
    {
        config([
            'services.google.client_id' => 'test-client-id',
            'services.google.client_secret' => 'test-client-secret',
        ]);
        $googleUser = GoogleUser::fake([
            'id' => 'google-unverified-789',
            'email' => 'unverified@example.com',
            'email_verified' => false,
        ]);
        $provider = \Mockery::mock(Provider::class);
        $provider->shouldReceive('user')->once()->andReturn($googleUser);
        Socialite::shouldReceive('driver')->once()->with('google')->andReturn($provider);

        $this->get('/api/auth/google/callback')
            ->assertRedirect('http://127.0.0.1:5173/?oauth=unverified#marketplace');

        $this->assertDatabaseMissing('users', ['email' => 'unverified@example.com']);
        $this->assertGuest();
    }

    public function test_login_records_successful_and_failed_attempts(): void
    {
        $user = User::factory()->create([
            'email' => 'buyer@example.com',
            'password' => 'password123',
        ]);

        $this->postJson('/api/auth/login', [
            'email' => 'buyer@example.com',
            'password' => 'password123',
        ])->assertOk();

        $this->postJson('/api/auth/login', [
            'email' => 'buyer@example.com',
            'password' => 'wrong-password',
        ])->assertUnprocessable();

        $this->assertDatabaseHas('login_history', ['was_successful' => true, 'user_id' => $user->id]);
        $this->assertDatabaseHas('login_history', ['was_successful' => false, 'attempted_identifier' => 'buyer@example.com']);
    }

    public function test_login_respects_maximum_attempts_and_account_lockout_window(): void
    {
        $admin = User::factory()->create(['email' => 'lockout@example.com', 'password' => 'password123', 'role' => Role::BUYER]);
        app(SystemSettingsService::class)->update([
            'maximum_login_attempts' => 2,
            'account_lockout_minutes' => 15,
        ], $admin->id, 'Lockout test');

        $this->postJson('/api/auth/login', ['email' => 'lockout@example.com', 'password' => 'wrong-1'])->assertUnprocessable();
        $this->postJson('/api/auth/login', ['email' => 'lockout@example.com', 'password' => 'wrong-2'])->assertUnprocessable();
        $this->postJson('/api/auth/login', ['email' => 'lockout@example.com', 'password' => 'wrong-3'])->assertStatus(429)
            ->assertJson(['message' => 'This account is temporarily locked due to repeated failed login attempts.']);
    }

    public function test_forgot_password_does_not_reveal_account_existence(): void
    {
        $this->postJson('/api/auth/forgot-password', ['email' => 'unknown@example.com'])
            ->assertOk()
            ->assertJson(['message' => 'If the account exists, reset instructions have been sent.']);
    }
}
