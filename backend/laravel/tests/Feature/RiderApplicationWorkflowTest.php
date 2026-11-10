<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Models\AuditLog;
use App\Models\RiderApplication;
use App\Models\RiderPolicyPublication;
use App\Models\RiderProfile;
use App\Models\User;
use App\Services\SystemSettingsService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class RiderApplicationWorkflowTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        Cache::forget('farmgate.setting.account_registration_enabled');
        Cache::forget('farmgate.setting.rider_registration_enabled');
        RiderPolicyPublication::query()->delete();
        $settingsAdmin = User::factory()->create(['role' => Role::ADMIN]);
        app(SystemSettingsService::class)->update([
            'account_registration_enabled' => true,
            'rider_registration_enabled' => false,
        ], $settingsAdmin->id, 'Reset rider registration controls for an isolated test.');
    }

    public function test_registration_stays_closed_until_policy_and_admin_settings_are_adopted(): void
    {
        $this->getJson('/api/rider-registration/policy')
            ->assertOk()
            ->assertJsonPath('registration_open', false)
            ->assertJsonPath('registration_status', 'POLICY_NOT_PUBLISHED')
            ->assertJsonPath('minimum_password_length', app(SystemSettingsService::class)->getInt('minimum_password_length'))
            ->assertJsonPath('documents', null);

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

    public function test_policy_publication_requires_admin_complete_text_and_effective_date(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $this->actingAs($buyer)->getJson('/api/admin/rider-policies')->assertForbidden();
        $this->actingAs($buyer)->putJson('/api/admin/rider-policies/draft', [
            'version' => 'TEST-1',
        ])->assertForbidden();

        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $draft = $this->actingAs($admin)->putJson('/api/admin/rider-policies/draft', [
            'version' => 'TEST-1',
            'effective_date' => today()->toDateString(),
            'privacy_contact' => 'privacy@example.test',
            'privacy_content' => 'Draft text only.',
        ])->assertOk()->json('policy');

        $this->actingAs($admin)->postJson('/api/admin/rider-policies/'.$draft['id'].'/approve', ['approval_confirmed' => true])
            ->assertUnprocessable();
        $this->actingAs($admin)->postJson('/api/admin/rider-policies/'.$draft['id'].'/publish', ['publish_confirmed' => true])
            ->assertStatus(409);
        $this->getJson('/api/rider-registration/policy')
            ->assertOk()
            ->assertJsonPath('registration_open', false)
            ->assertJsonPath('registration_status', 'POLICY_DRAFT')
            ->assertJsonPath('documents', null);
        $this->assertSame(0, User::query()->where('email', 'not-created@example.test')->count());
        $this->postJson('/api/rider-registration', [
            'email' => 'not-created@example.test',
        ])->assertForbidden();

        $complete = $this->completePolicyInput('TEST-1');
        $this->putJson('/api/admin/rider-policies/draft', [
            'policy_id' => $draft['id'],
            ...$complete,
        ])->assertOk();
        $this->postJson('/api/admin/rider-policies/'.$draft['id'].'/publish', ['publish_confirmed' => true])
            ->assertStatus(409);
        $this->postJson('/api/admin/rider-policies/'.$draft['id'].'/approve', ['approval_confirmed' => true])
            ->assertOk()
            ->assertJsonPath('policy.approved_by', $admin->name)
            ->assertJsonPath('policy.approved_at', fn ($value) => is_string($value));
        $this->getJson('/api/admin/rider-policies')
            ->assertOk()
            ->assertJsonFragment(['action' => 'rider.policy.approved', 'actor' => $admin->name, 'version' => 'TEST-1']);
        $this->putJson('/api/admin/rider-policies/draft', [
            'policy_id' => $draft['id'],
            ...$complete,
        ])->assertOk()->assertJsonPath('policy.approved_at', null);
        $this->postJson('/api/admin/rider-policies/'.$draft['id'].'/publish', ['publish_confirmed' => true])
            ->assertStatus(409);
        $this->postJson('/api/admin/rider-policies/'.$draft['id'].'/approve', ['approval_confirmed' => true])->assertOk();
        $this->postJson('/api/admin/rider-policies/'.$draft['id'].'/publish', ['publish_confirmed' => true])
            ->assertOk()
            ->assertJsonPath('policy.status', 'PUBLISHED')
            ->assertJsonPath('policy.published_by', $admin->name);

        $this->getJson('/api/rider-registration/policy')
            ->assertOk()
            ->assertJsonPath('registration_open', false)
            ->assertJsonPath('registration_status', 'REGISTRATION_DISABLED')
            ->assertJsonPath('policy_version', 'TEST-1')
            ->assertJsonPath('documents.retention', trim($complete['retention_content']));

        $this->putJson('/api/admin/rider-policies/draft', [
            'policy_id' => $draft['id'],
            ...$complete,
        ])->assertStatus(409);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'rider.policy.published',
            'user_id' => $admin->id,
            'entity_type' => 'RIDER_POLICY_PUBLICATION',
            'entity_id' => $draft['id'],
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'rider.policy.approved',
            'user_id' => $admin->id,
            'entity_type' => 'RIDER_POLICY_PUBLICATION',
            'entity_id' => $draft['id'],
        ]);
        $auditPayloads = AuditLog::query()
            ->whereIn('action', ['PUT api/admin/rider-policies/draft', 'POST api/admin/rider-policies/'.$draft['id'].'/publish'])
            ->get()
            ->toJson();
        $this->assertStringNotContainsString('TEST ONLY', $auditPayloads);
    }

    public function test_admin_can_save_and_reopen_an_incomplete_policy_draft_without_opening_registration(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $draft = $this->actingAs($admin)->putJson('/api/admin/rider-policies/draft', [
            'version' => 'Draft version (incomplete)',
            'effective_date' => null,
            'privacy_contact' => null,
            'privacy_content' => 'Unfinished privacy draft.',
            'terms_content' => null,
            'safety_content' => 'Safety work in progress.',
            'retention_content' => null,
            'package_appendix' => 'Administrative adoption procedure reference.',
        ])->assertOk()
            ->assertJsonPath('policy.status', 'DRAFT')
            ->assertJsonPath('policy.version', 'Draft version (incomplete)')
            ->assertJsonPath('policy.privacy_content', 'Unfinished privacy draft.')
            ->assertJsonPath('policy.safety_content', 'Safety work in progress.')
            ->assertJsonPath('policy.package_appendix', 'Administrative adoption procedure reference.')
            ->assertJsonPath('audit_history.0.action', 'rider.policy.draft_saved')
            ->json('policy');

        $this->getJson('/api/admin/rider-policies')
            ->assertOk()
            ->assertJsonPath('has_draft', true)
            ->assertJsonPath('policy.id', $draft['id'])
            ->assertJsonPath('policy.terms_content', '')
            ->assertJsonPath('policy.package_appendix', 'Administrative adoption procedure reference.')
            ->assertJsonPath('policy.last_saved_at', $draft['last_saved_at']);

        $this->getJson('/api/rider-registration/policy')
            ->assertOk()
            ->assertJsonPath('registration_open', false)
            ->assertJsonPath('registration_status', 'POLICY_DRAFT')
            ->assertJsonPath('documents', null);

        $this->assertDatabaseHas('audit_logs', [
            'action' => 'rider.policy.draft_saved',
            'user_id' => $admin->id,
            'entity_type' => 'RIDER_POLICY_PUBLICATION',
            'entity_id' => $draft['id'],
        ]);
        $audit = AuditLog::query()->where('entity_type', 'RIDER_POLICY_PUBLICATION')->where('entity_id', $draft['id'])->firstOrFail();
        $this->assertContains('privacy_content', $audit->metadata['changed_fields']);
        $this->assertStringNotContainsString('Unfinished privacy draft.', $audit->toJson());
    }

    public function test_future_published_policy_does_not_open_registration(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $futureDate = today()->addDays(3)->toDateString();
        $draft = $this->actingAs($admin)->putJson('/api/admin/rider-policies/draft', [
            'version' => 'FUTURE-1',
            ...$this->completePolicyInput('FUTURE-1', $futureDate),
        ])->assertOk()->json('policy');
        $this->postJson('/api/admin/rider-policies/'.$draft['id'].'/approve', ['approval_confirmed' => true])->assertOk();
        $this->postJson('/api/admin/rider-policies/'.$draft['id'].'/publish', ['publish_confirmed' => true])
            ->assertOk();

        $this->getJson('/api/rider-registration/policy')
            ->assertOk()
            ->assertJsonPath('registration_open', false)
            ->assertJsonPath('registration_status', 'POLICY_SCHEDULED')
            ->assertJsonPath('documents', null);
    }

    public function test_registration_stays_open_after_published_policy_effective_date(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        app(SystemSettingsService::class)->update([
            'account_registration_enabled' => true,
            'rider_registration_enabled' => true,
        ], $admin->id, 'Enable registration for a published rider policy regression test.');
        $policy = $this->createPublishedPolicy('ACTIVE-1');

        $this->travelTo(today()->addDay()->startOfDay());
        $this->getJson('/api/rider-registration/policy')
            ->assertOk()
            ->assertJsonPath('registration_open', true)
            ->assertJsonPath('registration_status', 'OPEN')
            ->assertJsonPath('policy_version', $policy->version)
            ->assertJsonPath('missing_documents', []);
    }

    public function test_source_placeholders_block_policy_approval(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $input = $this->completePolicyInput('PLACEHOLDER-1');
        $input['terms_content'] .= "\n[SERVICE / APP NAME]";
        $draft = $this->actingAs($admin)->putJson('/api/admin/rider-policies/draft', [
            'version' => 'PLACEHOLDER-1',
            ...$input,
        ])->assertOk()->json('policy');

        $this->postJson('/api/admin/rider-policies/'.$draft['id'].'/approve', ['approval_confirmed' => true])
            ->assertUnprocessable();
        $this->assertDatabaseHas('rider_policy_publications', [
            'id' => $draft['id'],
            'status' => 'DRAFT',
            'approved_by' => null,
            'approved_at' => null,
        ]);
        $this->getJson('/api/rider-registration/policy')
            ->assertOk()
            ->assertJsonPath('registration_open', false);
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
            ->assertJsonMissingPath('applications.data.0.residential_address');

        $this->actingAs($admin)->getJson('/api/admin/rider-applications/'.$application->id)
            ->assertOk()
            ->assertJsonPath('application.residential_address', 'Private residential address');
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
        $this->createPublishedPolicy('2.0');
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
            'retention_consent' => true,
            'optional_updates_consent' => false,
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
            'vehicle_photos' => [UploadedFile::fake()->image('vehicle.jpg', 800, 600)],
        ];
        $this->actingAs(User::findOrFail($riderId))->postJson('/api/rider/application/submit', [
            ...$submission,
            'selfie' => UploadedFile::fake()->image('not-collected.jpg', 600, 600),
        ])->assertUnprocessable();
        $submissionResponse = $this->actingAs(User::findOrFail($riderId))->postJson('/api/rider/application/submit', $submission)
            ->assertOk()
            ->assertJsonPath('application.status', 'SUBMITTED')
            ->assertJsonCount(3, 'application.documents');
        $this->assertSame('2.0', $registration->json('application.retention_policy_version'));
        $this->assertNotNull($registration->json('application.retention_policy_accepted_at'));
        $this->assertFalse($registration->json('application.optional_updates_consent'));
        $this->assertNull($registration->json('application.optional_updates_consented_at'));
        $application = RiderApplication::query()->where('user_id', $riderId)->firstOrFail();
        $licenseDocument = $application->documents()->where('document_type', 'DRIVER_LICENSE')->firstOrFail();
        $this->assertTrue(Storage::disk('rider_private')->exists($licenseDocument->path));

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
        unset($replacement['vehicle_registration'], $replacement['vehicle_photos']);
        $this->actingAs(User::findOrFail($riderId))->postJson('/api/rider/application/submit', $replacement)
            ->assertOk()
            ->assertJsonPath('application.status', 'SUBMITTED')
            ->assertJsonCount(3, 'application.documents');
        $this->assertNotNull($licenseDocument->fresh()->deleted_at);
        $this->assertFalse(Storage::disk('rider_private')->exists($licenseDocument->path));

        $this->actingAs($admin)->patchJson('/api/admin/rider-applications/'.$application->id, ['status' => 'APPROVED'])
            ->assertOk()
            ->assertJsonPath('application.status', 'APPROVED');
        $profile = RiderProfile::query()->where('user_id', $riderId)->firstOrFail();
        $this->assertTrue($profile->is_verified);
        $this->assertSame('ABC 1234', $profile->plate_number);
    }

    public function test_applicant_can_save_and_resume_an_encrypted_application_draft_before_submission(): void
    {
        $this->createPublishedPolicy('3.0');
        Storage::fake('rider_private');
        Notification::fake();
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        app(SystemSettingsService::class)->update([
            'account_registration_enabled' => true,
            'rider_registration_enabled' => true,
        ], $admin->id, 'Enable policy-approved rider registration for draft-save test.');

        $registration = $this->postJson('/api/rider-registration', [
            'name' => 'Rider Applicant',
            'date_of_birth' => '1990-04-03',
            'residential_address' => 'Labasan, Bongabong, Oriental Mindoro',
            'email' => 'rider.draft@example.test',
            'phone_number' => '09171234567',
            'password' => 'safe-password',
            'password_confirmation' => 'safe-password',
            'policy_version' => '3.0',
            'privacy_consent' => true,
            'terms_consent' => true,
            'safety_consent' => true,
            'retention_consent' => true,
        ])->assertCreated();
        $rider = User::findOrFail($registration->json('user.id'));
        $futureDate = now()->addYear()->toDateString();
        $draft = [
            'name' => 'Rider Applicant Updated',
            'license_number' => 'DL-7654321',
            'plate_number' => 'ABC 1234',
            'vehicle_type' => 'Motorcycle',
            'vehicle_make_model' => 'Honda Click',
            'vehicle_color' => 'Red',
            'license_expires_on' => $futureDate,
            'vehicle_registration_expires_on' => $futureDate,
            'driver_license' => UploadedFile::fake()->image('license.jpg', 600, 400),
            'vehicle_registration' => UploadedFile::fake()->image('registration.jpg', 600, 400),
            'vehicle_photos' => [UploadedFile::fake()->image('vehicle.jpg', 800, 600)],
        ];

        $this->actingAs($rider)->postJson('/api/rider/application/draft', $draft)
            ->assertOk()
            ->assertJsonPath('application.status', 'DRAFT')
            ->assertJsonPath('application.name', 'Rider Applicant Updated')
            ->assertJsonPath('application.plate_number', 'ABC 1234')
            ->assertJsonCount(3, 'application.documents')
            ->assertJsonFragment(['action' => 'APPLICATION_DRAFT_SAVED']);

        $application = RiderApplication::query()->where('user_id', $rider->id)->firstOrFail();
        foreach ($application->documents as $document) {
            $this->assertTrue(Storage::disk('rider_private')->exists($document->path));
        }
        $this->actingAs($rider)->getJson('/api/rider/application')
            ->assertOk()
            ->assertJsonPath('application.status', 'DRAFT')
            ->assertJsonPath('application.vehicle_make_model', 'Honda Click')
            ->assertJsonCount(3, 'application.documents');

        $this->actingAs($rider)->postJson('/api/rider/application/submit', [
            'name' => 'Rider Applicant Updated',
            'date_of_birth' => '1990-04-03',
            'residential_address' => 'Labasan, Bongabong, Oriental Mindoro',
            'license_number' => 'DL-7654321',
            'plate_number' => 'ABC 1234',
            'vehicle_type' => 'Motorcycle',
            'vehicle_make_model' => 'Honda Click',
            'vehicle_color' => 'Red',
            'license_expires_on' => $futureDate,
            'vehicle_registration_expires_on' => $futureDate,
        ])->assertOk()
            ->assertJsonPath('application.status', 'SUBMITTED')
            ->assertJsonCount(3, 'application.documents');
    }

    public function test_vehicle_updates_remain_pending_until_admin_approval(): void
    {
        $this->createPublishedPolicy('2.0');
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
            ->assertJsonMissingPath('vehicle_changes.data.0.documents');

        $this->actingAs($admin)->getJson('/api/admin/rider-vehicle-changes/'.$changeId)
            ->assertOk()
            ->assertJsonCount(3, 'vehicle_change.documents');

        $this->actingAs($admin)->patchJson('/api/admin/rider-vehicle-changes/'.$changeId, ['status' => 'APPROVED'])
            ->assertOk()
            ->assertJsonPath('vehicle_change.status', 'APPROVED');
        $this->assertSame('NEW 5678', $profile->fresh()->plate_number);
        $this->assertSame('New model', $profile->fresh()->vehicle_make_model);
    }

    private function createPublishedPolicy(string $version): RiderPolicyPublication
    {
        $policy = (new RiderPolicyPublication)->fill([
            'version' => $version,
            'effective_date' => today(),
            'privacy_contact' => 'test-contact@example.test',
            'privacy_content' => str_repeat('TEST ONLY — privacy notice content, not an adopted policy. ', 6),
            'terms_content' => str_repeat('TEST ONLY — rider terms content, not an adopted policy. ', 6),
            'safety_content' => str_repeat('TEST ONLY — safety content, not an adopted policy. ', 6),
            'retention_content' => str_repeat('TEST ONLY — retention content, not an adopted policy. ', 6),
        ]);
        $policy->forceFill([
            'status' => 'PUBLISHED',
            'published_by' => User::factory()->create(['role' => Role::ADMIN])->id,
            'published_at' => now(),
        ])->save();

        return $policy;
    }

    private function completePolicyInput(string $version, ?string $effectiveDate = null): array
    {
        return [
            'version' => $version,
            'effective_date' => $effectiveDate ?? today()->toDateString(),
            'privacy_contact' => 'privacy@example.test',
            'privacy_content' => str_repeat('TEST ONLY — privacy notice content, not an adopted policy. ', 6),
            'terms_content' => str_repeat('TEST ONLY — rider terms content, not an adopted policy. ', 6),
            'safety_content' => str_repeat('TEST ONLY — safety content, not an adopted policy. ', 6),
            'retention_content' => str_repeat('TEST ONLY — retention content, not an adopted policy. ', 6),
        ];
    }
}
