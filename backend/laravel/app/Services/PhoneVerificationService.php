<?php

namespace App\Services;

use App\Models\PhoneVerificationChallenge;
use App\Models\User;
use App\Support\PhilippinePhoneNumber;
use Illuminate\Support\Facades\DB;

class PhoneVerificationService
{
    private const CODE_LIFETIME_MINUTES = 10;

    private const RESEND_COOLDOWN_SECONDS = 60;

    private const MAX_SENDS_PER_HOUR = 5;

    private const MAX_ATTEMPTS_PER_HOUR = 10;

    /**
     * Issue and send a code. The boolean is false only when this exact number
     * is already verified; provider acceptance is never treated as delivery.
     */
    public function send(User $user, string $phoneNumber): bool
    {
        $normalized = PhilippinePhoneNumber::normalize($phoneNumber);
        if (! $normalized) {
            throw new PhoneVerificationException('Enter a valid Philippine mobile number (09XXXXXXXXX or +639XXXXXXXXX).');
        }

        $issue = DB::transaction(function () use ($user, $normalized): array {
            $lockedUser = User::query()->whereKey($user->getKey())->lockForUpdate()->firstOrFail();

            if ($lockedUser->phone_verified_at && $lockedUser->phone_number === $normalized) {
                return ['send' => false];
            }

            $challenge = PhoneVerificationChallenge::query()
                ->where('user_id', $lockedUser->getKey())
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
            $hash = $this->hashCode($code);

            $lockedUser->forceFill([
                'phone_number' => $normalized,
                'phone_verified_at' => null,
            ])->save();

            PhoneVerificationChallenge::query()->updateOrCreate(
                ['user_id' => $lockedUser->getKey()],
                [
                    'phone_number' => $normalized,
                    'otp_hash' => $hash,
                    'expires_at' => $now->copy()->addMinutes(self::CODE_LIFETIME_MINUTES),
                    'attempts' => $attempts,
                    'send_count' => $sendCount + 1,
                    'attempt_window_started_at' => $attemptWindowStartedAt,
                    'send_window_started_at' => $sendWindowStartedAt,
                    'last_sent_at' => $now,
                ],
            );

            return [
                'send' => true,
                'code' => $code,
                'hash' => $hash,
                'user_id' => $lockedUser->getKey(),
                'phone_number' => $normalized,
            ];
        });

        if (! $issue['send']) {
            return false;
        }

        try {
            app(UniSmsService::class)->send(
                $issue['phone_number'],
                'Your FARMGATE phone verification code is '.$issue['code'].'. It expires in 10 minutes. Do not share this code.',
            );
        } catch (UniSmsException) {
            PhoneVerificationChallenge::query()
                ->where('user_id', $issue['user_id'])
                ->where('otp_hash', $issue['hash'])
                ->update(['otp_hash' => null, 'expires_at' => null]);

            throw new PhoneVerificationException('The verification code could not be sent. Please try again shortly.', 503);
        }

        return true;
    }

    public function verify(User $user, string $code): void
    {
        $result = DB::transaction(function () use ($user, $code): string {
            $lockedUser = User::query()->whereKey($user->getKey())->lockForUpdate()->firstOrFail();
            $challenge = PhoneVerificationChallenge::query()
                ->where('user_id', $lockedUser->getKey())
                ->lockForUpdate()
                ->first();
            $now = now();

            if (
                ! $challenge
                || ! $challenge->otp_hash
                || ! $challenge->expires_at
                || $challenge->expires_at->lte($now)
                || $challenge->phone_number !== $lockedUser->phone_number
            ) {
                return 'invalid';
            }

            $attemptWindowStartedAt = $challenge->attempt_window_started_at ?? $now;
            $attempts = $challenge->attempts;
            if ($attemptWindowStartedAt->lte($now->copy()->subHour())) {
                $attemptWindowStartedAt = $now;
                $attempts = 0;
            }

            if ($attempts >= self::MAX_ATTEMPTS_PER_HOUR) {
                return 'limited';
            }

            if (! hash_equals($challenge->otp_hash, $this->hashCode($code))) {
                $attempts++;
                $challenge->forceFill([
                    'attempts' => $attempts,
                    'attempt_window_started_at' => $attemptWindowStartedAt,
                    'otp_hash' => $attempts >= self::MAX_ATTEMPTS_PER_HOUR ? null : $challenge->otp_hash,
                    'expires_at' => $attempts >= self::MAX_ATTEMPTS_PER_HOUR ? null : $challenge->expires_at,
                ])->save();

                return $attempts >= self::MAX_ATTEMPTS_PER_HOUR ? 'limited' : 'invalid';
            }

            $lockedUser->forceFill(['phone_verified_at' => $now])->save();
            $challenge->forceFill(['otp_hash' => null, 'expires_at' => null])->save();

            return 'verified';
        });

        if ($result === 'limited') {
            throw new PhoneVerificationException('Too many verification attempts. Please request a new code later.', 429);
        }

        if ($result !== 'verified') {
            throw new PhoneVerificationException('The verification code is invalid or expired.');
        }
    }

    private function hashCode(string $code): string
    {
        $key = (string) config('app.key');
        if ($key === '') {
            throw new \RuntimeException('The application key is required for phone verification.');
        }

        return hash_hmac('sha256', $code, $key);
    }
}
