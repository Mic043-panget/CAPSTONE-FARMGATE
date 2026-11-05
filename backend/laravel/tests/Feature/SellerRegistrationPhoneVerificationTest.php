<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Models\SellerRegistrationPhoneVerification;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as ClientRequest;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class SellerRegistrationPhoneVerificationTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'services.unisms.api_key' => 'test-api-key',
            'services.unisms.sender_id' => 'FARMGATE',
            'services.unisms.api_url' => 'https://unismsapi.com/api/sms',
        ]);
    }

    public function test_seller_account_cannot_be_created_without_phone_verification(): void
    {
        $this->postJson('/api/auth/register', $this->sellerRegistrationPayload())
            ->assertUnprocessable()
            ->assertJsonValidationErrors('phone_verification_token');

        $this->assertDatabaseMissing('users', ['email' => 'juan@example.com']);
    }

    public function test_seller_must_confirm_the_sms_code_before_registering(): void
    {
        $code = null;
        Http::fake(function (ClientRequest $request) use (&$code) {
            preg_match('/code is (\d{6})\./', $request->data()['content'], $matches);
            $code = $matches[1] ?? null;

            return Http::response(['message' => ['status' => 'pending']], 201);
        });

        $this->postJson('/api/auth/seller-registration/phone/send', ['phone_number' => '09171234568'])
            ->assertOk()
            ->assertJsonMissingPath('code')
            ->assertJsonMissingPath('otp')
            ->assertJsonMissingPath('phone_verification_token');

        $challenge = SellerRegistrationPhoneVerification::query()->firstOrFail();
        $this->assertNull($challenge->verified_at);
        $this->assertNotSame($code, $challenge->otp_hash);
        $this->assertDatabaseMissing('users', ['phone_number' => '+639171234568']);

        $this->postJson('/api/auth/seller-registration/phone/verify', [
            'phone_number' => '09171234568',
            'code' => $code === '000000' ? '000001' : '000000',
        ])->assertUnprocessable()
            ->assertJsonPath('message', 'That verification code is incorrect. Check it and try again.');

        $verification = $this->postJson('/api/auth/seller-registration/phone/verify', [
            'phone_number' => '09171234568',
            'code' => $code,
        ])->assertOk()
            ->assertJsonPath('message', 'Phone number verified. Complete seller registration within 15 minutes.')
            ->assertJsonMissingPath('code')
            ->assertJsonMissingPath('otp');

        $token = $verification->json('phone_verification_token');
        $this->assertIsString($token);
        $this->assertSame(64, strlen($token));
        $this->assertDatabaseMissing('users', ['phone_number' => '+639171234568']);

        $this->postJson('/api/auth/register', $this->sellerRegistrationPayload([
            'phone_verification_token' => $token,
        ]))->assertCreated()
            ->assertJsonPath('user.role', Role::SELLER->value)
            ->assertJsonPath('user.phone_number', '+639171234568')
            ->assertJsonStructure(['user' => ['phone_verified_at']]);

        $seller = User::query()->where('email', 'juan@example.com')->firstOrFail();
        $this->assertNotNull($seller->phone_verified_at);
        $this->assertDatabaseHas('seller_profiles', ['user_id' => $seller->id]);
        $this->assertNull($challenge->fresh()->registration_token_hash);
        $this->assertNull($challenge->fresh()->verified_at);

        Http::assertSent(fn (ClientRequest $request): bool => $request->data()['recipient'] === '+639171234568');
        $this->postJson('/api/auth/register', $this->sellerRegistrationPayload([
            'email' => 'other@example.com',
            'phone_verification_token' => $token,
        ]))->assertUnprocessable();
        $this->assertDatabaseMissing('users', ['email' => 'other@example.com']);
        Http::assertSentCount(1);
    }

    public function test_expired_code_has_a_clear_error_and_can_be_resent(): void
    {
        $codes = [];
        Http::fake(function (ClientRequest $request) use (&$codes) {
            preg_match('/code is (\d{6})\./', $request->data()['content'], $matches);
            $codes[] = $matches[1] ?? null;

            return Http::response(['message' => ['status' => 'pending']], 201);
        });

        $this->postJson('/api/auth/seller-registration/phone/send', ['phone_number' => '+639171234568'])->assertOk();
        $challenge = SellerRegistrationPhoneVerification::query()->firstOrFail();
        $challenge->forceFill(['expires_at' => now()->subMinute()])->save();

        $this->postJson('/api/auth/seller-registration/phone/verify', [
            'phone_number' => '+639171234568',
            'code' => $codes[0],
        ])->assertUnprocessable()
            ->assertJsonPath('message', 'This verification code has expired. Request a new code.');

        $challenge->forceFill(['last_sent_at' => now()->subSeconds(61)])->save();
        $this->postJson('/api/auth/seller-registration/phone/send', ['phone_number' => '+639171234568'])
            ->assertOk()
            ->assertJsonPath('message', 'A verification code has been sent to your phone. It expires in 10 minutes.');

        $this->assertCount(2, $codes);
        $this->assertNotNull($challenge->fresh()->otp_hash);
        Http::assertSentCount(2);
    }

    private function sellerRegistrationPayload(array $overrides = []): array
    {
        return array_replace([
            'name' => 'Juan Cruz',
            'email' => 'juan@example.com',
            'password' => 'password123',
            'password_confirmation' => 'password123',
            'phone_number' => '09171234568',
            'role' => Role::SELLER->value,
        ], $overrides);
    }
}
