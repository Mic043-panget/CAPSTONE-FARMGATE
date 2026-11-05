<?php

namespace Tests\Feature;

use App\Enums\ListingStatus;
use App\Enums\OrderStatus;
use App\Enums\PricingType;
use App\Enums\Role;
use App\Models\Category;
use App\Models\LivestockListing;
use App\Models\Order;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AnalyticsDashboardTest extends TestCase
{
    use RefreshDatabase;

    public function test_seller_analytics_are_scoped_to_authenticated_seller_and_include_real_order_metrics(): void
    {
        $this->travelTo(now()->startOfDay());
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $otherSeller = User::factory()->create(['role' => Role::SELLER]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $category = Category::create(['name' => 'Cattle', 'slug' => 'cattle']);
        $listing = $this->listing($seller, $category, 'Calf');
        $otherListing = $this->listing($otherSeller, $category, 'Other calf');
        $order = $this->completedOrder($seller, $buyer, $listing, 1200, 2);
        $this->completedOrder($otherSeller, User::factory()->create(['role' => Role::BUYER]), $otherListing, 500, 1);

        $response = $this->actingAs($seller)->getJson('/api/analytics?from='.now()->subDays(10)->toDateString().'&to='.now()->toDateString());

        $response->assertOk()
            ->assertJsonPath('summary.gross_sales', 1200)
            ->assertJsonPath('summary.orders', 1)
            ->assertJsonPath('summary.units_sold', 2)
            ->assertJsonPath('products.0.id', $listing->id)
            ->assertJsonPath('products.0.revenue', 1200)
            ->assertJsonStructure(['products' => [['listed_at']]])
            ->assertJsonPath('inventory.0.id', $listing->id);
        $this->assertSame($seller->id, $order->fresh()->seller_id);
    }

    public function test_admin_can_filter_marketplace_analytics_by_seller_and_other_roles_are_forbidden(): void
    {
        $this->travelTo(now()->startOfDay());
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $category = Category::create(['name' => 'Swine', 'slug' => 'swine']);
        $listing = $this->listing($seller, $category, 'Pig');
        $this->completedOrder($seller, $buyer, $listing, 800, 1);
        $admin = User::factory()->create(['role' => Role::ADMIN]);

        $this->actingAs($admin)->getJson('/api/analytics?from='.now()->subDays(5)->toDateString().'&to='.now()->toDateString().'&seller_id='.$seller->id)
            ->assertOk()
            ->assertJsonPath('summary.gross_sales', 800)
            ->assertJsonPath('seller_performance.0.id', $seller->id);

        $this->actingAs($buyer)->getJson('/api/analytics?from='.now()->subDays(5)->toDateString().'&to='.now()->toDateString())
            ->assertForbidden();
    }

    public function test_product_sort_uses_sales_units_name_and_listing_date_with_consistent_categories(): void
    {
        $this->travelTo(now()->startOfDay());
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $category = Category::create(['name' => 'Cattle', 'slug' => 'cattle']);
        $zulu = $this->listing($seller, $category, 'Zulu');
        $maple = $this->listing($seller, $category, 'Maple');
        $apple = $this->listing($seller, $category, 'Apple');
        $zulu->forceFill(['created_at' => now()->subDays(3)])->save();
        $maple->forceFill(['created_at' => now()->subDays(2)])->save();
        $apple->forceFill(['created_at' => now()->subDay()])->save();
        $this->completedOrder($seller, $buyer, $zulu, 100, 1);
        $this->completedOrder($seller, $buyer, $maple, 50, 3);
        $this->completedOrder($seller, $buyer, $apple, 200, 2);
        $url = '/api/analytics?from='.now()->subDays(10)->toDateString().'&to='.now()->toDateString();

        $this->actingAs($seller)->getJson($url.'&sort=name_asc')
            ->assertOk()
            ->assertJsonPath('products.0.name', 'Apple')
            ->assertJsonPath('products.0.category', 'Cattle')
            ->assertJsonPath('products.2.name', 'Zulu');

        $this->getJson($url.'&sort=listed_newest')
            ->assertOk()
            ->assertJsonPath('products.0.name', 'Apple')
            ->assertJsonPath('products.2.name', 'Zulu');

        $this->getJson($url.'&sort=quantity_desc')
            ->assertOk()
            ->assertJsonPath('products.0.name', 'Maple')
            ->assertJsonPath('products.0.units', 3);

        $this->getJson($url.'&category_id='.$category->id.'&listing_id='.$maple->id)
            ->assertOk()
            ->assertJsonCount(1, 'products')
            ->assertJsonPath('products.0.name', 'Maple')
            ->assertJsonPath('products.0.category', 'Cattle');
    }

    public function test_analytics_rejects_invalid_range_and_excessive_period(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $this->actingAs($seller)->getJson('/api/analytics?from=2026-02-01&to=2026-01-01')->assertUnprocessable();
        $this->actingAs($seller)->getJson('/api/analytics?from=2024-01-01&to=2026-01-01')->assertUnprocessable();
    }

    private function listing(User $seller, Category $category, string $name): LivestockListing
    {
        return LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => $name,
            'quantity' => 2,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 600,
            'status' => ListingStatus::ACTIVE,
        ]);
    }

    private function completedOrder(User $seller, User $buyer, LivestockListing $listing, int $amount, int $quantity): Order
    {
        $date = now()->subDays(2);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::COMPLETED,
            'total_amount' => $amount,
            'subtotal_amount' => $amount,
            'seller_fee' => 0,
            'payment_status' => 'PAID',
        ]);
        $order->forceFill(['created_at' => $date, 'updated_at' => $date])->save();
        $order->items()->create([
            'listing_id' => $listing->id,
            'quantity' => $quantity,
            'unit_price' => $amount / $quantity,
            'total_amount' => $amount,
            'pricing_type' => PricingType::PER_HEAD,
        ]);

        return $order;
    }
}
