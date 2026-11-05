<?php

namespace App\Services;

use App\Models\SellerRegistrationPhoneVerification;
use App\Support\PhilippinePhoneNumber;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class SellerRegistrationPhoneVerificationService
{
    private const CODE_LIFETIME_MINUTES = 10;

    private const REGISTRATION_TOKEN_LIFETIME_MINUTES = 15;

    private const RESEND_COOLDOWN_SECONDS = 60;

    private const MAX_SENDS_PER_HOUR = 5;

    private const MAX_ATTEMPTS_PER_HOUR = 10;

    public function send(string $phoneNumber): void
    {
        $normalized = PhilippinePhoneNumber::normalize($phoneNumber);
        if (! $normalized) {
            throw new PhoneVerificationException('Enter a valid Philippine mobile number (09XXXXXXXXX or +639XXXXXXXXX).');
        }

        $issue = DB::transaction(function () use ($normalized): array {
            $challenge = SellerRegistrationPhoneVerification::query()
                ->where('phone_number', $normalized)
                ->lockForUpdate()
                ->first();
            $now = now();

            if ($challenge?->last_sent_at && $challenge->last_sent_at->gt($now->copy()->subSeconds(self::RESEND_COOLDOWN_SECONDS))) {
                throw new PhoneVerificationException('Please wait before requesting another code.', 429);
            }

            if (! $challenge || ! $challenge->send_window_started_at || $challenge->send_window_started_at->lte($now->copy()->subHour())) {
                $sendWindowStartedAt = $now;
                $sendCount = 0;
                $attemptWindowStartedAt = $now;
                $attempts = 0;
            } else {
                $sendWindowStartedAt = $challenge->send_window_started_at;
                $sendCount = $challenge->send_count;
                $attemptWindowStartedAt = $challenge->attempt_window_started_at ?? $now;
                $attempts = $challenge->attempts;
            }

            if ($sendCount >= self::MAX_SENDS_PER_HOUR) {
                throw new PhoneVerificationException('Too many verification codes were requested. Please try again later.', 429);
            }

            if ($attemptWindowStartedAt->lte($now->copy()->subHour())) {
                $attemptWindowStartedAt = $now;
                $attempts = 0;
            }

            $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
            $hash = $this->hashValue($code);
            $values = [
                'otp_hash' => $hash,
                'expires_at' => $now->copy()->addMinutes(self::CODE_LIFETIME_MINUTES),
                'verified_at' => null,
                'registration_token_hash' => null,
                'registration_token_expires_at' => null,
                'attempts' => $attempts,
                'send_count' => $sendCount + 1,
                'attempt_window_started_at' => $attemptWindowStartedAt,
                'send_window_started_at' => $sendWindowStartedAt,
                'last_sent_at' => $now,
            ];

            if ($challenge) {
                $challenge->forceFill($values)->save();
            } else {
                $challenge = SellerRegistrationPhoneVerification::query()->create([
                    'phone_number' => $normalized,
                    ...$values,
                ]);
            }

            return [
                'code' => $code,
                'hash' => $hash,
                'challenge_id' => $challenge->getKey(),
                'phone_number' => $normalized,
            ];
        });

        try {
            app(UniSmsService::class)->send(
                $issue['phone_number'],
                'Your FARMGATE seller registration code is '.$issue['code'].'. It expires in 10 minutes. Do not share this code.',
            );
        } catch (UniSmsException) {
            SellerRegistrationPhoneVerification::query()
                ->whereKey($issue['challenge_id'])
                ->where('otp_hash', $issue['hash'])
                ->update(['otp_hash' => null, 'expires_at' => null]);

            throw new PhoneVerificationException('The verification code could not be sent. Please try again shortly.', 503);
        }
    }

    public function verify(string $phoneNumber, string $code): string
    {
        $normalized = PhilippinePhoneNumber::normalize($phoneNumber);
        if (! $normalized) {
            throw new PhoneVerificationException('Enter a valid Philippine mobile number (09XXXXXXXXX or +639XXXXXXXXX).');
        }

        $result = DB::transaction(function () use ($normalized, $code): array {
            $challenge = SellerRegistrationPhoneVerification::query()
                ->where('phone_number', $normalized)
                ->lockForUpdate()
                ->first();
            $now = now();

            if (! $challenge || ! $challenge->otp_hash || ! $challenge->expires_at) {
                return ['status' => 'missing'];
            }

            if ($challenge->expires_at->lte($now)) {
                $challenge->forceFill(['otp_hash' => null, 'expires_at' => null])->save();

                return ['status' => 'expired'];
            }

            $attemptWindowStartedAt = $challenge->attempt_window_started_at ?? $now;
            $attempts = $challenge->attempts;
            if ($attemptWindowStartedAt->lte($now->copy()->subHour())) {
                $attemptWindowStartedAt = $now;
                $attempts = 0;
            }

            if ($attempts >= self::MAX_ATTEMPTS_PER_HOUR) {
                return ['status' => 'limited'];
            }

            if (! hash_equals($challenge->otp_hash, $this->hashValue($code))) {
                $attempts++;
                $challenge->forceFill([
                    'attempts' => $attempts,
                    'attempt_window_started_at' => $attemptWindowStartedAt,
                    'otp_hash' => $attempts >= self::MAX_ATTEMPTS_PER_HOUR ? null : $challenge->otp_hash,
                    'expires_at' => $attempts >= self::MAX_ATTEMPTS_PER_HOUR ? null : $challenge->expires_at,
                ])->save();

                return ['status' => $attempts >= self::MAX_ATTEMPTS_PER_HOUR ? 'limited' : 'incorrect'];
            }

            $token = Str::random(64);
            $challenge->forceFill([
                'otp_hash' => null,
                'expires_at' => null,
                'verified_at' => $now,
                'registration_token_hash' => $this->hashValue($token),
                'registration_token_expires_at' => $now->copy()->addMinutes(self::REGISTRATION_TOKEN_LIFETIME_MINUTES),
            ])->save();

            return ['status' => 'verified', 'token' => $token];
        });

        if ($result['status'] === 'limited') {
            throw new PhoneVerificationException('Too many verification attempts. Please request a new code later.', 429);
        }

        if ($result['status'] === 'expired') {
            throw new PhoneVerificationException('This verification code has expired. Request a new code.');
        }

        if ($result['status'] === 'missing') {
            throw new PhoneVerificationException('No active verification code was found. Request a new code.');
        }

        if ($result['status'] !== 'verified') {
            throw new PhoneVerificationException('That verification code is incorrect. Check it and try again.');
        }

        return $result['token'];
    }

    public function consumeVerifiedRegistration(string $phoneNumber, string $token): Carbon
    {
        $challenge = SellerRegistrationPhoneVerification::query()
            ->where('phone_number', $phoneNumber)
            ->lockForUpdate()
            ->first();
        $now = now();

        if (! $challenge || ! $challenge->verified_at || ! $challenge->registration_token_hash) {
            throw new PhoneVerificationException('Verify your phone number before creating a seller account.');
        }

        if (! $challenge->registration_token_expires_at || $challenge->registration_token_expires_at->lte($now)) {
            $challenge->forceFill([
                'verified_at' => null,
                'registration_token_hash' => null,
                'registration_token_expires_at' => null,
            ])->save();

            throw new PhoneVerificationException('Phone verification has expired. Request a new code and verify your number again.');
        }

        if (! hash_equals($challenge->registration_token_hash, $this->hashValue($token))) {
            throw new PhoneVerificationException('Verify your phone number before creating a seller account.');
        }

        $verifiedAt = $challenge->verified_at;
        $challenge->forceFill([
            'verified_at' => null,
            'registration_token_hash' => null,
            'registration_token_expires_at' => null,
        ])->save();

        return $verifiedAt;
    }

    private function hashValue(string $value): string
    {
        $key = (string) config('app.key');
        if ($key === '') {
            throw new \RuntimeException('The application key is required for phone verification.');
        }

        return hash_hmac('sha256', $value, $key);
    }
}
