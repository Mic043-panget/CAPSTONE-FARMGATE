<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Models\AuditLog;
use App\Models\User;
use App\Services\SystemSettingsService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class UserAccountControlTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_can_record_a_violation_without_deactivating_the_account(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);

        $this->actingAs($admin)
            ->postJson("/api/admin/users/{$buyer->id}/violations", ['reason' => 'Repeated prohibited listing'])
            ->assertCreated()
            ->assertJsonPath('message', 'Violation record added to the account audit history.');

        $this->assertFalse($buyer->fresh()->trashed());
        $this->assertDatabaseHas('audit_logs', [
            'user_id' => $admin->id,
            'action' => 'admin.user.violation_recorded',
            'entity_type' => User::class,
            'entity_id' => (string) $buyer->id,
            'reason' => 'Repeated prohibited listing',
        ]);
        $this->assertSame(1, $buyer->moderationViolations()->count());

        $this->actingAs($admin)
            ->getJson("/api/admin/users/{$buyer->id}/violations")
            ->assertOk()
            ->assertJsonPath('violations.0.reason', 'Repeated prohibited listing')
            ->assertJsonPath('violations.0.actor.id', $admin->id);
    }

    public function test_admin_can_deactivate_and_reactivate_with_audited_reasons(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $seller->createToken('seller-session');

        $this->actingAs($admin)
            ->postJson("/api/admin/users/{$seller->id}/deactivate", ['reason' => 'Account verification concern'])
            ->assertOk()
            ->assertJsonPath('message', 'Account deactivated. The user must sign in again after reactivation.');

        $inactiveSeller = User::withTrashed()->findOrFail($seller->id);
        $this->assertTrue($inactiveSeller->trashed());
        $this->assertSame(0, $inactiveSeller->tokens()->count());
        $this->assertDatabaseHas('audit_logs', [
            'user_id' => $admin->id,
            'action' => 'admin.user.account_deactivated',
            'entity_id' => (string) $seller->id,
            'reason' => 'Account verification concern',
        ]);

        $userListing = $this->actingAs($admin)
            ->getJson('/api/admin/users?role=SELLER')
            ->assertOk();
        $this->assertNotNull($userListing->json('users.data.0.deleted_at'));

        $this->actingAs($admin)
            ->postJson("/api/admin/users/{$seller->id}/reactivate", ['reason' => 'Verification completed'])
            ->assertOk()
            ->assertJsonPath('message', 'Account reactivated. The user can sign in again.');

        $this->assertNotNull(User::find($seller->id));
        $this->assertDatabaseHas('audit_logs', [
            'user_id' => $admin->id,
            'action' => 'admin.user.account_reactivated',
            'entity_id' => (string) $seller->id,
            'reason' => 'Verification completed',
        ]);
    }

    public function test_account_controls_require_an_admin_and_cannot_target_admin_accounts(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $otherAdmin = User::factory()->create(['role' => Role::ADMIN]);

        $this->actingAs($buyer)
            ->postJson("/api/admin/users/{$otherAdmin->id}/deactivate", ['reason' => 'No access'])
            ->assertForbidden();

        $this->actingAs($admin)
            ->postJson("/api/admin/users/{$otherAdmin->id}/deactivate", ['reason' => 'Admin protection'])
            ->assertForbidden();

        $this->actingAs($admin)
            ->postJson("/api/admin/users/{$admin->id}/deactivate", ['reason' => 'Self protection'])
            ->assertForbidden();
    }

    public function test_deactivation_requires_reason_and_respects_system_setting(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);

        $this->actingAs($admin)
            ->postJson("/api/admin/users/{$buyer->id}/deactivate", ['reason' => 'bad'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('reason');

        app(SystemSettingsService::class)->update(['allow_account_deactivation' => false], $admin->id, 'Disable admin account deactivation');

        $this->actingAs($admin)
            ->postJson("/api/admin/users/{$buyer->id}/deactivate", ['reason' => 'Policy review requested'])
            ->assertStatus(409);

        $this->assertFalse(User::find($buyer->id)->trashed());
        $this->assertSame(0, AuditLog::query()->where('entity_id', (string) $buyer->id)->count());
    }
}
