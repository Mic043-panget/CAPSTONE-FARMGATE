<?php

namespace Tests\Feature;

use App\Enums\ListingStatus;
use App\Enums\OrderStatus;
use App\Enums\Role;
use App\Models\User;
use Database\Seeders\FarmgateDemoDataSeeder;
use Database\Seeders\ResetFarmgateDemoDataSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class FarmgateDemoDataSeederTest extends TestCase
{
    use RefreshDatabase;

    public function test_demo_data_seeds_one_hundred_records_and_can_be_reset_without_removing_regular_accounts(): void
    {
        $regularUser = User::factory()->create(['role' => Role::BUYER]);

        $this->seed(FarmgateDemoDataSeeder::class);

        $this->assertDatabaseCount('livestock_listings', 100);
        $this->assertDatabaseCount('orders', 100);
        $this->assertDatabaseCount('interests', 100);
        $this->assertSame(10, User::query()->where('email', 'like', 'farmgate-demo-seller-%@farmgate.test')->count());
        $this->assertSame(20, User::query()->where('email', 'like', 'farmgate-demo-buyer-%@farmgate.test')->count());
        $this->assertSame(count(ListingStatus::cases()), \Illuminate\Support\Facades\DB::table('livestock_listings')->distinct()->count('status'));
        $this->assertSame(count(OrderStatus::cases()), \Illuminate\Support\Facades\DB::table('orders')->distinct()->count('status'));
        $this->assertSame(7, \Illuminate\Support\Facades\DB::table('livestock_listings')->where('status', ListingStatus::ACTIVE->value)->distinct()->count('category_id'));

        $this->seed(ResetFarmgateDemoDataSeeder::class);

        $this->assertDatabaseCount('livestock_listings', 0);
        $this->assertDatabaseCount('orders', 0);
        $this->assertDatabaseCount('interests', 0);
        $this->assertDatabaseHas('users', ['id' => $regularUser->id]);
        $this->assertSame(0, User::query()->where('email', 'like', 'farmgate-demo-seller-%@farmgate.test')->count());
        $this->assertSame(0, User::query()->where('email', 'like', 'farmgate-demo-buyer-%@farmgate.test')->count());
    }
}