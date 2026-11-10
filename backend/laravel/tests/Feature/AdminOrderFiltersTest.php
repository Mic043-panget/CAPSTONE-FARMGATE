<?php

namespace Tests\Feature;

use App\Enums\DeliveryStatus;
use App\Enums\OrderStatus;
use App\Enums\Role;
use App\Models\AuditLog;
use App\Models\Complaint;
use App\Models\ComplaintStatusHistory;
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

    public function test_admin_can_review_and_correct_premature_completion_without_changing_cod_payment(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $order = $this->createOrder($buyer, $seller, OrderStatus::COMPLETED, 11091);
        $order->forceFill([
            'delivery_method' => 'STANDARD_DELIVERY',
            'payment_method' => 'COD',
            'payment_status' => 'UNPAID',
        ])->save();
        $delivery = Delivery::query()->create([
            'order_id' => $order->id,
            'status' => DeliveryStatus::PICKED_UP,
            'pickup_verified_at' => now(),
        ]);

        $this->actingAs($admin)
            ->getJson('/api/admin/orders/'.$order->id)
            ->assertOk()
            ->assertJsonPath('order.delivery_reconciliation_required', true)
            ->assertJsonPath('order.status', OrderStatus::COMPLETED->value)
            ->assertJsonPath('order.payment_status', 'UNPAID')
            ->assertJsonPath('order.delivery.delivery_reference', $delivery->delivery_reference)
            ->assertJsonPath('order.cod_reconciliation_evidence', null);

        $this->actingAs($admin)
            ->postJson('/api/admin/orders/'.$order->id.'/reconciliation', [
                'decision' => 'restore_to_fulfilling',
                'reason' => 'Delivery is still picked up and unverified.',
                'evidence_reviewed' => false,
            ])->assertUnprocessable();
        $this->assertSame(OrderStatus::COMPLETED, $order->fresh()->status);

        $this->actingAs($buyer)
            ->postJson('/api/admin/orders/'.$order->id.'/reconciliation', [
                'decision' => 'restore_to_fulfilling',
                'reason' => 'Delivery is still picked up and unverified.',
                'evidence_reviewed' => true,
            ])->assertForbidden();
        $this->assertSame(OrderStatus::COMPLETED, $order->fresh()->status);

        $this->actingAs($admin)
            ->postJson('/api/admin/orders/'.$order->id.'/reconciliation', [
                'decision' => 'restore_to_fulfilling',
                'reason' => 'Delivery is still picked up and unverified.',
                'evidence_reviewed' => true,
            ])->assertOk()
            ->assertJsonPath('order.status', OrderStatus::FULFILLING->value)
            ->assertJsonPath('order.payment_status', 'UNPAID');

        $this->assertSame('UNPAID', $order->fresh()->payment_status);
        $this->assertDatabaseHas('order_status_history', [
            'order_id' => $order->id,
            'from_status' => OrderStatus::COMPLETED->value,
            'to_status' => OrderStatus::FULFILLING->value,
            'reason' => 'ADMIN_RECONCILIATION: Delivery is still picked up and unverified.',
        ]);
        $audit = AuditLog::query()
            ->whereIn('entity_type', [Order::class, class_basename(Order::class)])
            ->where('entity_id', (string) $order->id)
            ->latest()
            ->firstOrFail();
        $this->assertSame('COMPLETED', $audit->before_values['status']);
        $this->assertSame('FULFILLING', $audit->after_values['status']);
        $this->assertSame('Delivery is still picked up and unverified.', $audit->reason);

        $this->actingAs($admin)
            ->postJson('/api/admin/orders/'.$order->id.'/reconciliation', [
                'decision' => 'restore_to_fulfilling',
                'reason' => 'Delivery is still picked up and unverified.',
                'evidence_reviewed' => true,
            ])->assertStatus(409);
        $this->assertSame(1, $order->statusHistory()
            ->where('from_status', OrderStatus::COMPLETED->value)
            ->where('to_status', OrderStatus::FULFILLING->value)
            ->count());
        $this->assertSame('UNPAID', $order->fresh()->payment_status);
    }

    public function test_admin_order_details_resolve_complaint_history_actor(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $order = $this->createOrder($buyer, $seller, OrderStatus::COMPLETED, 400);
        $complaint = Complaint::query()->create([
            'order_id' => $order->id,
            'opened_by' => $buyer->id,
            'respondent_id' => $seller->id,
            'case_type' => 'ORDER_ISSUE',
            'reason' => 'Item condition',
            'description' => 'Admin review requested.',
        ]);
        ComplaintStatusHistory::query()->create([
            'complaint_id' => $complaint->id,
            'changed_by' => $admin->id,
            'from_status' => 'OPEN',
            'to_status' => 'UNDER_REVIEW',
            'reason' => 'Reviewing the submitted evidence.',
        ]);

        $this->actingAs($admin)
            ->getJson('/api/admin/orders/'.$order->id)
            ->assertOk()
            ->assertJsonPath('order.complaints.0.status_history.0.actor.name', $admin->name);
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
