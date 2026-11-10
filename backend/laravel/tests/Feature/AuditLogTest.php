<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\User;
use App\Enums\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuditLogTest extends TestCase
{
    use RefreshDatabase;

    public function test_mutating_api_actions_are_recorded_without_sensitive_values(): void
    {
        $this->postJson('/api/auth/forgot-password', [
            'email' => 'unknown@example.com',
            'password' => 'do-not-store-this',
        ])->assertOk();

        $audit = AuditLog::query()->latest('id')->firstOrFail();

        $this->assertSame('POST api/auth/forgot-password', $audit->action);
        $this->assertSame('POST', $audit->method);
        $this->assertSame(200, $audit->status_code);
        $this->assertContains('email', $audit->metadata['input_keys']);
        $this->assertNotContains('password', $audit->metadata['input_keys']);
        $this->assertStringNotContainsString('do-not-store-this', $audit->toJson());
    }

    public function test_only_admin_can_read_global_audit_logs(): void
    {
        $buyer = User::factory()->create();
        $admin = User::factory()->create(['role' => Role::ADMIN]);

        $this->actingAs($buyer)->getJson('/api/admin/audit-logs')->assertForbidden();
        $this->actingAs($admin)->getJson('/api/admin/audit-logs')->assertOk();
        $this->assertDatabaseHas('audit_logs', [
            'user_id' => $buyer->id,
            'action' => 'GET api/admin/audit-logs',
            'status_code' => 403,
        ]);
    }

    public function test_admin_audit_report_generation_is_recorded_without_modifying_existing_events(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $existing = AuditLog::create([
            'user_id' => $admin->id,
            'action' => 'GET api/orders',
            'method' => 'GET',
            'route' => 'api/orders',
            'status_code' => 200,
            'database_action' => 'NONE',
            'entity_type' => 'Order',
            'entity_id' => '214',
            'description' => 'Read order details.',
        ]);

        $filters = ['date_from' => '2026-01-01'];
        $firstReport = $this->actingAs($admin)->postJson('/api/admin/audit-logs/report', [
            'filters' => $filters,
        ])->assertOk()
            ->assertJsonPath('record_count', 1)
            ->assertJsonPath('audit_logs.0.id', $existing->id);

        $secondReport = $this->actingAs($admin)->postJson('/api/admin/audit-logs/report', [
            'filters' => $filters,
        ])->assertOk()
            ->assertJsonPath('record_count', 1)
            ->assertJsonPath('audit_logs.0.id', $existing->id);

        $this->postJson('/api/admin/reports/export-audit', [
            'report_type' => 'analytics',
            'record_count' => 3,
            'filters' => ['from' => '2026-01-01'],
        ])->assertOk()->assertJsonStructure(['generated_at']);

        $this->assertSame('GET api/orders', $existing->fresh()->action);
        $this->assertDatabaseHas('audit_logs', [
            'user_id' => $admin->id,
            'action' => 'admin.audit_report.generated',
            'entity_type' => 'AuditReport',
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'user_id' => $admin->id,
            'action' => 'admin.report.exported',
            'entity_type' => 'ReportExport',
        ]);

        $this->actingAs(User::factory()->create(['role' => Role::BUYER]))
            ->postJson('/api/admin/audit-logs/report', ['filters' => []])
            ->assertForbidden();
    }

    public function test_real_settings_update_records_database_action_and_changed_fields(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);

        $this->actingAs($admin)->putJson('/api/admin/settings', [
            'settings' => ['platform_fee_percent' => 1],
        ])->assertOk();
        $this->actingAs($admin)->putJson('/api/admin/settings', [
            'settings' => ['platform_fee_percent' => 2],
        ])->assertOk();

        $audit = AuditLog::query()->where('action', 'like', 'PUT api/admin/settings')->latest('id')->firstOrFail();
        $valueChange = collect($audit->changed_fields)->firstWhere('field', 'value');
        $this->assertSame('UPDATE', $audit->database_action);
        $this->assertSame('SystemSetting', $audit->entity_type);
        $this->assertSame('1', (string) $valueChange['old']);
        $this->assertSame('2', (string) $valueChange['new']);
    }
}
