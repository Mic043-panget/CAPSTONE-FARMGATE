<?php

namespace Tests\Feature;

use App\Enums\DeliveryStatus;
use App\Enums\OrderStatus;
use App\Enums\Role;
use App\Models\Delivery;
use App\Models\Order;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AdminOrderFiltersTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_order_search_filters_status_and_reports_counts(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $buyer = User::factory()->create(['role' => Role::BUYER, 'name' => 'Alex Buyer']);
        $seller = User::factory()->create(['role' => Role::SELLER, 'name' => 'Farm Seller']);
        $pending = $this->createOrder($buyer, $seller, OrderStatus::PENDING_CONFIRMATION, 250);
        $delivered = $this->createOrder($buyer, $seller, OrderStatus::FULFILLING, 500);
        Delivery::query()->create([
            'order_id' => $delivered->id,
            'status' => DeliveryStatus::DELIVERED,
        ]);
        $other = $this->createOrder(User::factory()->create(['role' => Role::BUYER, 'name' => 'Other Buyer']), $seller, OrderStatus::CONFIRMED, 100);

        $this->actingAs($admin)
            ->getJson('/api/admin/orders?search=Alex&status=DELIVERED&sort=total_desc')
            ->assertOk()
            ->assertJsonPath('orders.total', 1)
            ->assertJsonPath('orders.data.0.id', $delivered->id)
            ->assertJsonPath('orders.data.0.display_status', 'DELIVERED')
            ->assertJsonPath('status_counts.all', 2)
            ->assertJsonPath('status_counts.PENDING_CONFIRMATION', 1)
            ->assertJsonPath('status_counts.FULFILLING', 0)
            ->assertJsonPath('status_counts.DELIVERED', 1);

        $this->actingAs($admin)
            ->getJson('/api/admin/orders?search=Farm%20Seller&sort=total_asc')
            ->assertOk()
            ->assertJsonPath('orders.data.0.id', $other->id)
            ->assertJsonPath('orders.total', 3);

        $this->actingAs($admin)
            ->getJson('/api/admin/orders?search=Farm%20Seller&sort=total_desc')
            ->assertOk()
            ->assertJsonPath('orders.data.0.id', $delivered->id);
    }

    public function test_admin_order_sort_orders_by_buyer_name(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $zuluBuyer = User::factory()->create(['role' => Role::BUYER, 'name' => 'Zulu Buyer']);
        $alphaBuyer = User::factory()->create(['role' => Role::BUYER, 'name' => 'Alpha Buyer']);
        $zuluOrder = $this->createOrder($zuluBuyer, $seller, OrderStatus::CONFIRMED, 100);
        $alphaOrder = $this->createOrder($alphaBuyer, $seller, OrderStatus::CONFIRMED, 100);

        $this->actingAs($admin)
            ->getJson('/api/admin/orders?sort=buyer_asc')
            ->assertOk()
            ->assertJsonPath('orders.data.0.id', $alphaOrder->id)
            ->assertJsonPath('orders.data.1.id', $zuluOrder->id);
    }

    public function test_admin_can_open_order_details_with_current_delivery_status(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $buyer = User::factory()->create(['role' => Role::BUYER, 'name' => 'Order Buyer']);
        $seller = User::factory()->create(['role' => Role::SELLER, 'name' => 'Order Seller']);
        $order = $this->createOrder($buyer, $seller, OrderStatus::FULFILLING, 325);
        Delivery::query()->create([
            'order_id' => $order->id,
            'status' => DeliveryStatus::DELIVERED,
        ]);

        $this->actingAs($admin)
            ->getJson('/api/admin/orders/'.$order->id)
            ->assertOk()
            ->assertJsonPath('order.id', $order->id)
            ->assertJsonPath('order.buyer.name', 'Order Buyer')
            ->assertJsonPath('order.seller.name', 'Order Seller')
            ->assertJsonPath('order.display_status', 'DELIVERED');

        $this->actingAs($buyer)->getJson('/api/admin/orders/'.$order->id)->assertForbidden();
    }

    private function createOrder(User $buyer, User $seller, OrderStatus $status, int $total): Order
    {
        return Order::query()->create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => $status,
            'total_amount' => $total,
        ]);
    }
}
