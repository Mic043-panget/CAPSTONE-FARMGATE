<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Models\SystemSetting;
use App\Models\SystemSettingHistory;
use App\Models\User;
use App\Services\SystemSettingsService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SystemSettingsTest extends TestCase
{
    use RefreshDatabase;

    public function test_only_admin_can_read_and_update_settings_and_changes_are_audited(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $admin = User::factory()->create(['role' => Role::ADMIN]);

        $this->actingAs($buyer)->getJson('/api/admin/settings')->assertForbidden();
        $this->actingAs($admin)->putJson('/api/admin/settings', [
            'settings' => [
                'platform_fee_percent' => 2.5,
                'delivery_base_fee' => 50,
                'delivery_included_km' => 5,
                'delivery_rate_per_km' => 12,
                'delivery_min_fee' => 50,
                'delivery_max_fee' => 500,
                'rider_offer_radius_km' => 25,
                'rider_offer_expiry_minutes' => 15,
            ],
            'reason' => 'Initial operating rates',
        ])->assertOk();

        $this->assertSame('2.5', SystemSetting::where('key', 'platform_fee_percent')->value('value'));
        $this->assertDatabaseHas('system_setting_history', ['key' => 'platform_fee_percent', 'changed_by' => $admin->id, 'change_reason' => 'Initial operating rates']);
        $this->assertGreaterThan(0, SystemSettingHistory::count());
    }

    public function test_invalid_fee_bounds_are_rejected(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $this->actingAs($admin)->putJson('/api/admin/settings', [
            'settings' => [
                'platform_fee_percent' => 2,
                'delivery_base_fee' => 0,
                'delivery_included_km' => 0,
                'delivery_rate_per_km' => 0,
                'delivery_min_fee' => 500,
                'delivery_max_fee' => 50,
                'rider_offer_radius_km' => 25,
                'rider_offer_expiry_minutes' => 10,
            ],
        ])->assertStatus(422);
    }

    public function test_delivery_minimum_is_a_floor_and_configured_rate_applies_beyond_included_distance(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $settings = app(SystemSettingsService::class);
        $settings->update([
            'delivery_base_fee' => 50,
            'delivery_included_km' => 1,
            'delivery_rate_per_km' => 10,
            'delivery_min_fee' => 50,
            'delivery_max_fee' => 0,
            'delivery_tiers_enabled' => false,
        ], $admin->id, 'Verify distance-based delivery fee');

        $this->assertSame(50.0, $settings->deliveryFee(1));
        $this->assertSame(90.0, $settings->deliveryFee(5));
    }

    public function test_partial_delivery_setting_update_keeps_existing_fee_bounds(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $settings = app(SystemSettingsService::class);

        $settings->update(['delivery_included_km' => 1], $admin->id, 'Correct delivery fee distance threshold');

        $this->assertSame(1.0, $settings->getDecimal('delivery_included_km'));
        $this->assertSame(90.0, $settings->deliveryFee(5));
    }

    public function test_settings_require_authentication_and_tiers_cannot_overlap(): void
    {
        $this->getJson('/api/admin/settings')->assertUnauthorized();
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $admin = User::factory()->create(['role' => Role::ADMIN]);

        $this->actingAs($buyer)->putJson('/api/admin/settings', ['settings' => ['maintenance_mode' => true]])->assertForbidden();
        $this->actingAs($admin)->postJson('/api/admin/settings/tiers', [
            'name' => 'Short distance', 'min_km' => 0, 'max_km' => 5, 'base_fee' => 50, 'fee_per_km' => 0,
        ])->assertCreated();
        $this->actingAs($admin)->postJson('/api/admin/settings/tiers', [
            'name' => 'Overlapping', 'min_km' => 4, 'max_km' => 8, 'base_fee' => 70, 'fee_per_km' => 10,
        ])->assertUnprocessable();
    }

    public function test_maintenance_mode_blocks_non_admin_access_but_allows_admin_routes(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);

        $this->actingAs($admin)->putJson('/api/admin/settings', ['settings' => ['maintenance_mode' => true]])->assertOk();

        $this->actingAs($buyer)->getJson('/api/categories')->assertStatus(503);
        $this->actingAs($buyer)->getJson('/api/orders')->assertStatus(503);
        $this->actingAs($admin)->getJson('/api/admin/settings')->assertOk();
    }
}
