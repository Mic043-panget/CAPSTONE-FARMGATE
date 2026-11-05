<?php

namespace Database\Seeders;

use App\Models\Category;
use App\Models\User;
use App\Enums\Role;
use App\Models\SystemSetting;
use App\Models\DeliveryRateTier;
use App\Services\SystemSettingsService;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        foreach (SystemSettingsService::DEFINITIONS as $key => $definition) {
            $default = $definition['default'];
            $setting = SystemSetting::firstOrNew(['key' => $key]);
            if (! $setting->exists) {
                $setting->value = is_array($default) ? json_encode($default, JSON_THROW_ON_ERROR) : (string) $default;
            }
            $setting->fill([
                'type' => $definition['type'],
                'category' => $definition['category'],
                'label' => $definition['label'],
                'is_active' => true,
                'is_public' => false,
            ])->save();
        }
        if (! DeliveryRateTier::query()->exists()) {
            DeliveryRateTier::create(['name' => 'Default', 'min_km' => 0, 'max_km' => null, 'base_fee' => 0, 'fee_per_km' => 0, 'priority' => 0]);
        }
        foreach (['Swine', 'Cattle', 'Carabao', 'Goat', 'Chicken', 'Duck', 'Other livestock'] as $name) {
            Category::updateOrCreate(
                ['slug' => str($name)->slug()],
                ['name' => $name, 'is_active' => true],
            );
        }

        $accounts = [
            ['name' => 'Farmgate Admin', 'email' => 'admin@farmgate.test', 'role' => Role::ADMIN],
            ['name' => 'Demo Seller', 'email' => 'seller@farmgate.test', 'role' => Role::SELLER],
            ['name' => 'Demo Buyer', 'email' => 'buyer@farmgate.test', 'role' => Role::BUYER],
            ['name' => 'Demo Rider', 'email' => 'rider@farmgate.test', 'role' => Role::RIDER],
        ];

        foreach ($accounts as $account) {
            $user = User::updateOrCreate(
                ['email' => $account['email']],
                $account + ['password' => 'Farmgate123!'],
            );

            if ($user->role === Role::SELLER) {
                $user->sellerProfile()->updateOrCreate([], ['business_name' => 'Demo Livestock Farm', 'is_verified' => true]);
            }

            if ($user->role === Role::RIDER) {
                $user->riderProfile()->updateOrCreate([], ['phone' => '09170000000', 'vehicle_type' => 'motorbike', 'availability' => 'AVAILABLE', 'is_verified' => true]);
            }
        }
    }
}
