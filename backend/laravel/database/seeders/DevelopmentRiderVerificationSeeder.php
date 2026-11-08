<?php

namespace Database\Seeders;

use App\Enums\Role;
use App\Models\RiderApplication;
use App\Models\RiderApplicationHistory;
use App\Models\RiderProfile;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class DevelopmentRiderVerificationSeeder extends Seeder
{
    private const EMAILS = [
        'rider@farmgate.test',
        'rider1@farmgate.test',
    ];

    public function run(): void
    {
        if (! app()->environment(['local', 'testing'])) {
            throw new \RuntimeException('Development rider verification is only allowed in local or testing environments.');
        }

        $users = User::query()->whereIn('email', self::EMAILS)->get();
        if ($users->count() !== count(self::EMAILS) || $users->contains(fn (User $user): bool => $user->role !== Role::RIDER)) {
            throw new \RuntimeException('Both configured Farmgate test rider accounts must already exist and have the RIDER role.');
        }

        DB::transaction(function () use ($users): void {
            foreach ($users as $user) {
                $phone = $user->phone_number ?: $this->developmentPhone($user);
                $user->forceFill([
                    'email_verified_at' => $user->email_verified_at ?? now(),
                    'phone_number' => $phone,
                    'phone_verified_at' => $user->phone_verified_at ?? now(),
                ])->save();

                RiderProfile::query()->updateOrCreate(
                    ['user_id' => $user->id],
                    [
                        'phone' => $phone,
                        'vehicle_type' => 'Development test vehicle',
                        'plate_number' => 'TEST'.$user->id,
                        'vehicle_make_model' => 'Synthetic test vehicle',
                        'vehicle_color' => 'Unspecified',
                        'license_expires_on' => now()->addYear()->toDateString(),
                        'vehicle_registration_expires_on' => now()->addYear()->toDateString(),
                        'availability' => 'AVAILABLE',
                        'is_verified' => true,
                    ],
                );

                $application = RiderApplication::query()->firstOrNew(['user_id' => $user->id]);
                $previousStatus = $application->status;
                $application->forceFill([
                    'date_of_birth' => $application->date_of_birth ?? '1990-01-01',
                    'residential_address' => $application->residential_address ?? 'Synthetic development test address',
                    'status' => 'APPROVED',
                    'privacy_policy_version' => 'DEVELOPMENT-ONLY',
                    'privacy_accepted_at' => $application->privacy_accepted_at ?? now(),
                    'terms_version' => 'DEVELOPMENT-ONLY',
                    'terms_accepted_at' => $application->terms_accepted_at ?? now(),
                    'safety_policy_version' => 'DEVELOPMENT-ONLY',
                    'safety_policy_accepted_at' => $application->safety_policy_accepted_at ?? now(),
                    'submitted_at' => $application->submitted_at ?? now(),
                    'reviewer_id' => null,
                    'reviewed_at' => now(),
                    'decision_reason' => 'Development-only test override. No identity, license, or vehicle documents were verified. Never use as real rider approval.',
                ])->save();

                if (! RiderApplicationHistory::query()
                    ->where('rider_application_id', $application->id)
                    ->where('action', 'DEVELOPMENT_TEST_OVERRIDE')
                    ->exists()) {
                    RiderApplicationHistory::create([
                        'rider_application_id' => $application->id,
                        'actor_id' => null,
                        'from_status' => $previousStatus,
                        'to_status' => 'APPROVED',
                        'action' => 'DEVELOPMENT_TEST_OVERRIDE',
                        'reason' => 'Development-only test override; no real identity or documents verified.',
                    ]);
                }
            }
        });

        $this->command?->info('Enabled local-only test verification for rider@farmgate.test and rider1@farmgate.test. These accounts are synthetic test fixtures, not identity-verified riders.');
    }

    private function developmentPhone(User $user): string
    {
        $candidate = '0999'.str_pad((string) $user->id, 7, '0', STR_PAD_LEFT);
        if (User::query()->where('phone_number', $candidate)->whereKeyNot($user->id)->exists()) {
            throw new \RuntimeException('The deterministic development test phone number is already assigned.');
        }

        return $candidate;
    }
}
