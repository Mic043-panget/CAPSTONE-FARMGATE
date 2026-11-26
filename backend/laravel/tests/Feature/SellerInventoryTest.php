<?php

namespace Tests\Feature;

use App\Enums\OrderStatus;
use App\Enums\PricingType;
use App\Enums\Role;
use App\Models\Category;
use App\Models\Complaint;
use App\Models\LivestockListing;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SellerInventoryTest extends TestCase
{
    use RefreshDatabase;

    public function test_inventory_is_seller_scoped_and_only_completed_orders_count_as_sales(): void
    {
        [$seller, $buyer, $category, $listing] = $this->sellerAndListing('Goat', 'Boer Goat', 7);
        $otherSeller = User::factory()->create(['role' => Role::SELLER]);
        $otherListing = $this->listing($otherSeller, $category, 'Other Goat', 9);

        $completed = $this->order($seller, $buyer, OrderStatus::COMPLETED, '2026-11-20 10:00:00');
        $this->item($completed, $listing, 2, 100);
        $cancelled = $this->order($seller, $buyer, OrderStatus::CANCELLED, '2026-11-21 10:00:00');
        $this->item($cancelled, $listing, 3, 100);
        $rejected = $this->order($seller, $buyer, OrderStatus::REJECTED, '2026-11-22 10:00:00');
        $this->item($rejected, $listing, 2, 100);
        $this->item($this->order($otherSeller, $buyer, OrderStatus::COMPLETED), $otherListing, 4, 250);

        $response = $this->actingAs($seller)->getJson('/api/seller/inventory')->assertOk();
        $row = $response->json('inventory.data.0');

        $this->assertSame('Boer Goat', $row['name']);
        $this->assertSame(7, $row['available_quantity']);
        $this->assertSame(2, $row['quantity_sold']);
        $this->assertSame('200.00', $row['sales_total']);
        $this->assertSame('PER_HEAD', $row['pricing_type']);
        $this->assertSame('ACTIVE', $row['status']);
        $this->assertSame('Boer', $row['breed']);
        $this->assertSame('MALE', $row['sex']);
        $this->assertSame(12, $row['age_months']);
        $this->assertSame('Healthy animal', $row['health_information']);
        $this->assertSame('Vaccinated', $row['vaccination_information']);
        $this->assertSame('Bongabong, Oriental Mindoro', $row['pickup_location']);
        $this->assertArrayNotHasKey('id', $row);
        $this->assertArrayNotHasKey('id', $row);
        $this->assertArrayNotHasKey('listing_id', $row);
        $this->assertSame(3, $response->json('history.total'));
        $this->assertSame(1, count($response->json('listing_options')));
        $this->assertArrayNotHasKey('id', $response->json('listing_options.0'));

        $sellerListing = $this->actingAs($seller)->getJson('/api/seller/listings')
            ->assertOk()
            ->json('listings.data.0');
        $this->assertIsString($sellerListing['inventory_key']);
        $this->assertSame($row['listing_key'], $sellerListing['inventory_key']);
    }

    public function test_inventory_filters_by_listing_category_order_status_and_date_and_paginates(): void
    {
        [$seller, $buyer, $goatCategory, $goat] = $this->sellerAndListing('Goat', 'Farm Goat', 5);
        $cowCategory = Category::create(['name' => 'Cow', 'slug' => 'cow']);
        $cow = $this->listing($seller, $cowCategory, 'Farm Cow', 3);

        $oldOrder = $this->order($seller, $buyer, OrderStatus::COMPLETED, '2026-11-01 10:00:00');
        $this->item($oldOrder, $goat, 1, 150);
        $recentOrder = $this->order($seller, $buyer, OrderStatus::PENDING_CONFIRMATION, '2026-11-22 10:00:00');
        $this->item($recentOrder, $cow, 1, 500);

        $listingOptions = $this->actingAs($seller)->getJson('/api/seller/inventory')->json('listing_options');
        $listingKey = collect($listingOptions)->firstWhere('name', 'Farm Goat')['listing_key'];
        $response = $this->actingAs($seller)->getJson('/api/seller/inventory?'.http_build_query([
            'listing_key' => $listingKey,
            'category' => 'goat',
            'order_status' => OrderStatus::COMPLETED->value,
            'from' => '2026-11-15',
            'to' => '2026-11-30',
            'per_page' => 5,
        ]))->assertOk();

        $this->assertSame(1, $response->json('inventory.total'));
        $this->assertSame('Farm Goat', $response->json('inventory.data.0.name'));
        $this->assertSame(0, $response->json('history.total'));

        $this->actingAs($seller)->getJson('/api/seller/inventory?'.http_build_query([
            'listing_key' => $listingKey,
            'category' => 'goat',
            'order_status' => OrderStatus::COMPLETED->value,
            'from' => '2026-11-01',
            'to' => '2026-11-15',
        ]))->assertOk()
            ->assertJsonPath('history.total', 1)
            ->assertJsonPath('history.data.0.listing_name', 'Farm Goat');

        $this->actingAs($seller)->getJson('/api/seller/inventory?per_page=5&sort=name&direction=asc')
            ->assertOk()
            ->assertJsonPath('inventory.data.0.name', 'Farm Cow')
            ->assertJsonPath('history.total', 2);
    }

    public function test_inventory_and_history_have_independent_pagination_and_history_sorting(): void
    {
        [$seller, $buyer, $category] = $this->sellerAndListing('Goat', 'Initial Goat', 2);
        for ($index = 1; $index <= 6; $index++) {
            $listing = $this->listing($seller, $category, "Stock Goat {$index}", 2);
            $order = $this->order($seller, $buyer, OrderStatus::COMPLETED);
            $this->item($order, $listing, 1, 100 + $index);
        }

        $this->actingAs($seller)->getJson('/api/seller/inventory?'.http_build_query([
            'per_page' => 5,
            'inventory_page' => 2,
            'history_page' => 2,
            'sort' => 'name',
            'direction' => 'asc',
            'history_sort' => 'amount',
            'history_direction' => 'asc',
        ]))->assertOk()
            ->assertJsonPath('inventory.total', 7)
            ->assertJsonPath('inventory.current_page', 2)
            ->assertJsonPath('inventory.per_page', 5)
            ->assertJsonPath('history.total', 6)
            ->assertJsonPath('history.current_page', 2)
            ->assertJsonPath('history.per_page', 5)
            ->assertJsonPath('history.data.0.amount', '106.00');
    }

    public function test_paid_refund_items_are_removed_from_inventory_totals(): void
    {
        [$seller, $buyer, , $listing] = $this->sellerAndListing('Goat', 'Refunded Goat', 2);
        $order = $this->order($seller, $buyer, OrderStatus::COMPLETED);
        $item = $this->item($order, $listing, 3, 100);
        Complaint::query()->create([
            'order_id' => $order->id,
            'opened_by' => $buyer->id,
            'respondent_id' => $seller->id,
            'case_type' => 'RETURN_REFUND',
            'reason' => 'Item issue',
            'description' => 'Requested a partial refund.',
            'status' => 'RESOLVED',
            'requested_items' => [[
                'order_item_id' => $item->id,
                'listing_id' => $listing->id,
                'quantity' => 1,
                'requested_amount' => 100,
            ]],
            'approved_refund_amount' => 100,
            'refund_status' => 'PAID',
        ]);

        $this->actingAs($seller)->getJson('/api/seller/inventory')
            ->assertOk()
            ->assertJsonPath('inventory.data.0.quantity_sold', 2)
            ->assertJsonPath('inventory.data.0.sales_total', '200.00');
    }

    public function test_order_details_use_public_reference_and_reject_orders_from_other_sellers(): void
    {
        [$seller, $buyer, , $listing] = $this->sellerAndListing('Goat', 'Order Goat', 3);
        $order = $this->order($seller, $buyer, OrderStatus::COMPLETED);
        $this->item($order, $listing, 1, 125);
        $order->statusHistory()->create([
            'from_status' => OrderStatus::FULFILLING,
            'to_status' => OrderStatus::COMPLETED,
            'changed_by' => $seller->id,
            'reason' => 'Delivered',
        ]);
        $otherSeller = User::factory()->create(['role' => Role::SELLER]);
        $otherOrder = $this->order($otherSeller, $buyer, OrderStatus::COMPLETED);

        $response = $this->actingAs($seller)->getJson('/api/seller/inventory/orders/'.$order->order_reference)->assertOk();
        $this->assertSame($order->order_reference, $response->json('order.order_reference'));
        $this->assertSame($buyer->name, $response->json('order.buyer_name'));
        $this->assertSame('Order Goat', $response->json('order.items.0.listing_name'));
        $this->assertSame('COMPLETED', $response->json('order.status_history.0.to_status'));
        $this->assertArrayNotHasKey('id', $response->json('order'));
        $this->assertArrayNotHasKey('shipping_address', $response->json('order'));
        $this->assertArrayNotHasKey('email', $response->json('order'));

        $this->actingAs($seller)->getJson('/api/seller/inventory/orders/'.$otherOrder->order_reference)->assertNotFound();
    }

    private function sellerAndListing(string $categoryName, string $listingName, int $quantity): array
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $category = Category::create(['name' => $categoryName, 'slug' => strtolower($categoryName)]);

        return [$seller, $buyer, $category, $this->listing($seller, $category, $listingName, $quantity)];
    }

    private function listing(User $seller, Category $category, string $name, int $quantity): LivestockListing
    {
        return LivestockListing::query()->create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => $name,
            'breed' => 'Boer',
            'sex' => 'MALE',
            'age_months' => 12,
            'estimated_weight_kg' => 35,
            'description' => 'Healthy livestock for sale.',
            'quantity' => $quantity,
            'pickup_location' => 'Bongabong, Oriental Mindoro',
            'health_information' => 'Healthy animal',
            'vaccination_information' => 'Vaccinated',
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 100,
            'status' => 'ACTIVE',
        ]);
    }

    private function order(User $seller, User $buyer, OrderStatus $status, ?string $createdAt = null): Order
    {
        $order = Order::query()->create([
            'seller_id' => $seller->id,
            'buyer_id' => $buyer->id,
            'status' => $status,
            'payment_status' => 'PAID',
            'payment_method' => 'COD',
            'total_amount' => 1000,
            'subtotal_amount' => 1000,
        ]);
        if ($createdAt !== null) {
            $order->forceFill(['created_at' => $createdAt, 'updated_at' => $createdAt])->save();
        }

        return $order;
    }

    private function item(Order $order, LivestockListing $listing, int $quantity, float $unitPrice): OrderItem
    {
        return OrderItem::query()->create([
            'order_id' => $order->id,
            'listing_id' => $listing->id,
            'quantity' => $quantity,
            'unit_price' => $unitPrice,
            'total_amount' => $quantity * $unitPrice,
            'pricing_type' => PricingType::PER_HEAD,
        ]);
    }
}
