<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Models\RiderApplication;
use App\Models\RiderProfile;
use App\Models\User;
use App\Services\SystemSettingsService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class RiderApplicationWorkflowTest extends TestCase
{
    use RefreshDatabase;

    public function test_registration_stays_closed_until_policy_and_admin_settings_are_adopted(): void
    {
        config([
            'rider-registration.policy_version' => '1.0',
            'rider-registration.effective_date' => null,
            'rider-registration.privacy_contact' => null,
            'rider-registration.privacy_policy_url' => null,
            'rider-registration.terms_url' => null,
            'rider-registration.safety_policy_url' => null,
            'rider-registration.retention_policy_approved' => false,
            'rider-registration.selfie_collection_enabled' => false,
        ]);

        $this->getJson('/api/rider-registration/policy')
            ->assertOk()
            ->assertJsonPath('registration_open', false);

        $this->postJson('/api/rider-registration', [])
            ->assertForbidden();
        $this->actingAs(User::factory()->create(['role' => Role::BUYER]))
            ->postJson('/api/rider-registration', [])
            ->assertForbidden();

        $rider = User::factory()->create(['role' => Role::RIDER]);
        RiderApplication::create([
            'user_id' => $rider->id,
            'date_of_birth' => '1990-04-03',
            'residential_address' => 'Private residential address',
            'status' => 'DRAFT',
            'privacy_policy_version' => '1.0',
            'privacy_accepted_at' => now(),
            'terms_version' => '1.0',
            'terms_accepted_at' => now(),
            'safety_policy_version' => '1.0',
            'safety_policy_accepted_at' => now(),
        ]);
        $this->actingAs($rider)->postJson('/api/rider/application/submit', [])
            ->assertForbidden();
    }

    public function test_applicant_details_are_visible_only_to_the_applicant_and_admin_reviewers(): void
    {
        $rider = User::factory()->create(['role' => Role::RIDER]);
        $otherRider = User::factory()->create(['role' => Role::RIDER]);
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        RiderProfile::create(['user_id' => $rider->id, 'availability' => 'OFFLINE', 'is_verified' => false]);
        $application = RiderApplication::create([
            'user_id' => $rider->id,
            'date_of_birth' => '1990-04-03',
            'residential_address' => 'Private residential address',
            'status' => 'DRAFT',
            'privacy_policy_version' => '1.0',
            'privacy_accepted_at' => now(),
            'terms_version' => '1.0',
            'terms_accepted_at' => now(),
            'safety_policy_version' => '1.0',
            'safety_policy_accepted_at' => now(),
        ]);

        $this->actingAs($rider)->getJson('/api/rider/application')
            ->assertOk()
            ->assertJsonPath('application.id', $application->id)
            ->assertJsonPath('application.residential_address', 'Private residential address');

        $this->actingAs($otherRider)->getJson('/api/rider/application')
            ->assertOk()
            ->assertJsonPath('application', null);

        $this->actingAs($admin)->getJson('/api/admin/rider-applications?status=DRAFT')
            ->assertOk()
            ->assertJsonPath('applications.data.0.id', $application->id)
            ->assertJsonPath('applications.data.0.residential_address', 'Private residential address');
    }

    public function test_unapproved_riders_cannot_use_delivery_features(): void
    {
        $rider = User::factory()->create(['role' => Role::RIDER]);
        RiderProfile::create(['user_id' => $rider->id, 'availability' => 'OFFLINE', 'is_verified' => false]);

        $this->actingAs($rider)->getJson('/api/riders/offers')
            ->assertForbidden();
    }

    public function test_applicant_can_submit_replacements_and_only_admin_approval_enables_delivery_access(): void
    {
        config([
            'rider-registration.policy_version' => '2.0',
            'rider-registration.effective_date' => '2026-11-09',
            'rider-registration.privacy_contact' => 'privacy@farmgate.example',
            'rider-registration.privacy_policy_url' => 'https://farmgate.example/privacy',
            'rider-registration.terms_url' => 'https://farmgate.example/rider-terms',
            'rider-registration.safety_policy_url' => 'https://farmgate.example/rider-safety',
            'rider-registration.retention_policy_approved' => true,
            'rider-registration.selfie_collection_enabled' => true,
        ]);
        Storage::fake('rider_private');
        Notification::fake();
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        app(SystemSettingsService::class)->update([
            'account_registration_enabled' => true,
            'rider_registration_enabled' => true,
        ], $admin->id, 'Enable policy-approved rider registration for feature test.');
        $otherRider = User::factory()->create(['role' => Role::RIDER]);
        $futureDate = now()->addYear()->toDateString();

        $registration = $this->postJson('/api/rider-registration', [
            'name' => 'Rider Applicant',
            'date_of_birth' => '1990-04-03',
            'residential_address' => 'Labasan, Bongabong, Oriental Mindoro',
            'email' => 'rider.applicant@example.test',
            'phone_number' => '09171234567',
            'password' => 'safe-password',
            'password_confirmation' => 'safe-password',
            'policy_version' => '2.0',
            'privacy_consent' => true,
            'terms_consent' => true,
            'safety_consent' => true,
        ])->assertCreated()
            ->assertJsonPath('application.status', 'DRAFT');
        $riderId = $registration->json('user.id');
        $this->assertNotNull($riderId);

        $submission = [
            'name' => 'Rider Applicant',
            'date_of_birth' => '1990-04-03',
            'residential_address' => 'Labasan, Bongabong, Oriental Mindoro',
            'license_number' => 'DL-1234567',
            'license_expires_on' => $futureDate,
            'plate_number' => 'ABC 1234',
            'vehicle_type' => 'Motorcycle',
            'vehicle_make_model' => 'Honda Click',
            'vehicle_color' => 'Red',
            'vehicle_registration_expires_on' => $futureDate,
            'driver_license' => UploadedFile::fake()->image('license.jpg', 600, 400),
            'vehicle_registration' => UploadedFile::fake()->image('registration.jpg', 600, 400),
            'selfie' => UploadedFile::fake()->image('selfie.jpg', 600, 600),
            'vehicle_photos' => [UploadedFile::fake()->image('vehicle.jpg', 800, 600)],
        ];
        $submissionResponse = $this->actingAs(User::findOrFail($riderId))->postJson('/api/rider/application/submit', $submission)
            ->assertOk()
            ->assertJsonPath('application.status', 'SUBMITTED')
            ->assertJsonCount(4, 'application.documents');
        $application = RiderApplication::query()->where('user_id', $riderId)->firstOrFail();
        $licenseDocument = $application->documents()->where('document_type', 'DRIVER_LICENSE')->firstOrFail();
        Storage::disk('rider_private')->assertExists($licenseDocument->path);

        $this->actingAs($otherRider)->get($submissionResponse->json('application.documents.0.view_url'))
            ->assertForbidden();

        $this->actingAs($admin)->patchJson('/api/admin/rider-applications/'.$application->id, [
            'status' => 'MORE_INFORMATION_REQUIRED',
            'reason' => 'Please provide a clearer license image.',
        ])->assertOk()
            ->assertJsonPath('application.status', 'MORE_INFORMATION_REQUIRED');
        $replacement = [
            ...$submission,
            'driver_license' => UploadedFile::fake()->image('license-replacement.jpg', 700, 500),
        ];
        unset($replacement['vehicle_registration'], $replacement['selfie'], $replacement['vehicle_photos']);
        $this->actingAs(User::findOrFail($riderId))->postJson('/api/rider/application/submit', $replacement)
            ->assertOk()
            ->assertJsonPath('application.status', 'SUBMITTED')
            ->assertJsonCount(4, 'application.documents');
        $this->assertNotNull($licenseDocument->fresh()->deleted_at);
        Storage::disk('rider_private')->assertMissing($licenseDocument->path);

        $this->actingAs($admin)->patchJson('/api/admin/rider-applications/'.$application->id, ['status' => 'APPROVED'])
            ->assertOk()
            ->assertJsonPath('application.status', 'APPROVED');
        $profile = RiderProfile::query()->where('user_id', $riderId)->firstOrFail();
        $this->assertTrue($profile->is_verified);
        $this->assertSame('ABC 1234', $profile->plate_number);
    }

    public function test_vehicle_updates_remain_pending_until_admin_approval(): void
    {
        config([
            'rider-registration.policy_version' => '2.0',
            'rider-registration.effective_date' => '2026-11-09',
            'rider-registration.privacy_contact' => 'privacy@farmgate.example',
            'rider-registration.privacy_policy_url' => 'https://farmgate.example/privacy',
            'rider-registration.terms_url' => 'https://farmgate.example/rider-terms',
            'rider-registration.safety_policy_url' => 'https://farmgate.example/rider-safety',
            'rider-registration.retention_policy_approved' => true,
            'rider-registration.selfie_collection_enabled' => true,
        ]);
        Storage::fake('rider_private');
        Notification::fake();
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $rider = User::factory()->create(['role' => Role::RIDER]);
        $profile = RiderProfile::create([
            'user_id' => $rider->id,
            'availability' => 'OFFLINE',
            'is_verified' => true,
            'plate_number' => 'OLD 1234',
            'vehicle_type' => 'Motorcycle',
            'vehicle_make_model' => 'Old model',
            'vehicle_color' => 'Black',
        ]);
        $futureDate = now()->addYear()->toDateString();
        $update = [
            'plate_number' => 'NEW 5678',
            'vehicle_type' => 'Car',
            'vehicle_make_model' => 'New model',
            'vehicle_color' => 'Blue',
            'license_expires_on' => $futureDate,
            'vehicle_registration_expires_on' => $futureDate,
            'driver_license' => UploadedFile::fake()->image('license.jpg', 600, 400),
            'vehicle_registration' => UploadedFile::fake()->image('registration.jpg', 600, 400),
            'vehicle_photos' => [UploadedFile::fake()->image('vehicle.jpg', 800, 600)],
        ];

        $this->actingAs(User::factory()->create(['role' => Role::BUYER]))
            ->postJson('/api/rider/vehicle-change', $update)
            ->assertForbidden();

        $response = $this->actingAs($rider)->postJson('/api/rider/vehicle-change', $update)
            ->assertCreated()
            ->assertJsonPath('vehicle_change.status', 'PENDING');
        $changeId = $response->json('vehicle_change.id');
        $this->assertSame('OLD 1234', $profile->fresh()->plate_number);

        $this->actingAs($admin)->getJson('/api/admin/rider-vehicle-changes')
            ->assertOk()
            ->assertJsonPath('vehicle_changes.data.0.id', $changeId)
            ->assertJsonCount(3, 'vehicle_changes.data.0.documents');

        $this->actingAs($admin)->patchJson('/api/admin/rider-vehicle-changes/'.$changeId, ['status' => 'APPROVED'])
            ->assertOk()
            ->assertJsonPath('vehicle_change.status', 'APPROVED');
        $this->assertSame('NEW 5678', $profile->fresh()->plate_number);
        $this->assertSame('New model', $profile->fresh()->vehicle_make_model);
    }
}
