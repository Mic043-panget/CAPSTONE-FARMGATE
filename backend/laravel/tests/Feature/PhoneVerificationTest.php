<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\PhoneVerificationChallenge;
use App\Models\User;
use App\Services\PhoneVerificationException;
use App\Services\PhoneVerificationService;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as ClientRequest;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class PhoneVerificationTest extends TestCase
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

    public function test_authenticated_user_can_request_and_use_a_hashed_single_use_code(): void
    {
        $code = null;
        Http::fake(function (ClientRequest $request) use (&$code) {
            preg_match('/code is (\d{6})\./', $request->data()['content'], $matches);
            $code = $matches[1] ?? null;

            return Http::response(['message' => ['status' => 'pending']], 201);
        });

        $user = User::factory()->create(['phone_number' => null, 'phone_verified_at' => null]);

        $this->actingAs($user)->postJson('/api/profile/phone/send', [
            'phone_number' => '09 171-234-567',
        ])->assertOk()
            ->assertJsonPath('user.phone_number', '+639171234567')
            ->assertJsonPath('user.phone_verified_at', null)
            ->assertJsonMissingPath('code')
            ->assertJsonMissingPath('otp');

        $this->assertNotNull($code);
        $challenge = PhoneVerificationChallenge::query()->where('user_id', $user->id)->firstOrFail();
        $this->assertNotSame($code, $challenge->otp_hash);
        $this->assertSame(hash_hmac('sha256', $code, (string) config('app.key')), $challenge->otp_hash);
        $auditText = json_encode(AuditLog::query()->latest('id')->firstOrFail()->toArray());
        $this->assertStringNotContainsString($code, $auditText);
        $this->assertStringNotContainsString($challenge->otp_hash, $auditText);
        $this->assertStringNotContainsString('+639171234567', $auditText);

        $this->postJson('/api/profile/phone/verify', ['code' => $code])
            ->assertOk()
            ->assertJsonPath('message', 'Phone number verified.')
            ->assertJsonPath('user.phone_number', '+639171234567')
            ->assertJsonStructure(['user' => ['phone_verified_at']]);

        $this->assertNotNull($user->fresh()->phone_verified_at);
        $this->assertNull($challenge->fresh()->otp_hash);
        $this->postJson('/api/profile/phone/verify', ['code' => $code])->assertUnprocessable();
        Http::assertSentCount(1);
    }

    public function test_wrong_and_expired_codes_do_not_verify_the_phone(): void
    {
        $code = null;
        Http::fake(function (ClientRequest $request) use (&$code) {
            preg_match('/code is (\d{6})\./', $request->data()['content'], $matches);
            $code = $matches[1] ?? null;

            return Http::response(['message' => ['status' => 'pending']], 201);
        });

        $user = User::factory()->create(['phone_number' => null, 'phone_verified_at' => null]);
        $this->actingAs($user)->postJson('/api/profile/phone/send', ['phone_number' => '09171234567'])->assertOk();

        $this->postJson('/api/profile/phone/verify', ['code' => $code === '000000' ? '000001' : '000000'])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'The verification code is invalid or expired.');
        $this->assertNull($user->fresh()->phone_verified_at);

        PhoneVerificationChallenge::query()->where('user_id', $user->id)->update(['expires_at' => now()->subMinute()]);
        $this->postJson('/api/profile/phone/verify', ['code' => $code])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'The verification code is invalid or expired.');
        $this->assertNull($user->fresh()->phone_verified_at);
    }

    public function test_resend_cooldown_and_invalid_numbers_are_enforced(): void
    {
        Http::fake(['unismsapi.com/*' => Http::response(['message' => ['status' => 'pending']], 201)]);
        $user = User::factory()->create();
        $this->actingAs($user);

        $this->postJson('/api/profile/phone/send', ['phone_number' => '12345'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('phone_number');
        Http::assertNothingSent();

        $this->postJson('/api/profile/phone/send', ['phone_number' => '+639171234567'])->assertOk();
        $this->postJson('/api/profile/phone/send', ['phone_number' => '+639171234567'])
            ->assertStatus(429);
        Http::assertSentCount(1);
    }

    public function test_phone_verification_endpoints_require_an_authenticated_account(): void
    {
        $this->postJson('/api/profile/phone/send', ['phone_number' => '09171234567'])->assertUnauthorized();
        $this->postJson('/api/profile/phone/verify', ['code' => '123456'])->assertUnauthorized();
    }

    public function test_persistent_send_and_attempt_limits_apply_across_requests(): void
    {
        Http::fake(['unismsapi.com/*' => Http::response(['message' => ['status' => 'pending']], 201)]);
        $user = User::factory()->create();
        $service = app(PhoneVerificationService::class);
        $start = now();
        Carbon::setTestNow($start);

        try {
            for ($send = 0; $send < 5; $send++) {
                Carbon::setTestNow($start->copy()->addSeconds(61 * $send));
                $this->assertTrue($service->send($user, '09171234567'));
            }

            Carbon::setTestNow($start->copy()->addSeconds(61 * 5));
            try {
                $service->send($user, '09171234567');
                $this->fail('The per-hour SMS send limit should reject an additional send.');
            } catch (PhoneVerificationException $exception) {
                $this->assertSame(429, $exception->httpStatus);
            }

            $challenge = PhoneVerificationChallenge::query()->where('user_id', $user->id)->firstOrFail();
            $wrongCode = $challenge->otp_hash === hash_hmac('sha256', '000000', (string) config('app.key')) ? '000001' : '000000';
            for ($attempt = 0; $attempt < 10; $attempt++) {
                try {
                    $service->verify($user, $wrongCode);
                    $this->fail('An incorrect code should never be accepted.');
                } catch (PhoneVerificationException $exception) {
                    $this->assertSame($attempt === 9 ? 429 : 422, $exception->httpStatus);
                }
            }

            $this->assertSame(10, $challenge->fresh()->attempts);
            $this->assertNull($challenge->fresh()->otp_hash);
        } finally {
            Carbon::setTestNow();
        }
    }
}
