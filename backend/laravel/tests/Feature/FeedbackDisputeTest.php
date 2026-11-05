<?php

namespace Tests\Feature;

use App\Enums\ComplaintStatus;
use App\Enums\OrderStatus;
use App\Enums\Role;
use App\Models\Complaint;
use App\Models\Order;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class FeedbackDisputeTest extends TestCase
{
    use RefreshDatabase;

    public function test_buyer_can_review_completed_order_once(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $order = Order::create(['buyer_id' => $buyer->id, 'seller_id' => $seller->id, 'status' => OrderStatus::COMPLETED, 'total_amount' => 700]);

        $this->actingAs($buyer)->postJson("/api/orders/{$order->id}/review", ['rating' => 5, 'comment' => 'Good transaction.'])
            ->assertCreated()
            ->assertJsonPath('review.rating', 5);

        $this->actingAs($buyer)->getJson('/api/buyer/reviews')
            ->assertOk()
            ->assertJsonPath('reviews.0.order.order_reference', $order->order_reference);

        $this->actingAs($buyer)->postJson("/api/orders/{$order->id}/review", ['rating' => 4])
            ->assertStatus(422);
    }

    public function test_buyer_can_open_complaint_and_seller_can_see_it(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $order = Order::create(['buyer_id' => $buyer->id, 'seller_id' => $seller->id, 'status' => OrderStatus::COMPLETED, 'total_amount' => 700]);

        $response = $this->actingAs($buyer)->postJson("/api/orders/{$order->id}/complaint", [
            'reason' => 'Damaged livestock',
            'description' => 'The order did not match the agreed condition.',
            'evidence' => 'Photo reference stored with the order.',
        ])->assertCreated();

        $complaintId = $response->json('complaint.id');
        $this->actingAs($seller)->getJson('/api/seller/complaints')
            ->assertOk()
            ->assertJsonPath('complaints.data.0.id', $complaintId)
            ->assertJsonPath('action_required_total', 1);
        $this->assertDatabaseHas('complaint_status_histories', ['complaint_id' => $complaintId, 'to_status' => ComplaintStatus::OPEN->value]);
    }

    public function test_admin_resolution_requires_reason_and_records_history(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $complaint = Complaint::create([
            'order_id' => Order::create(['buyer_id' => $buyer->id, 'seller_id' => $seller->id, 'status' => OrderStatus::COMPLETED, 'total_amount' => 700])->id,
            'opened_by' => $buyer->id,
            'respondent_id' => $seller->id,
            'reason' => 'Late delivery',
            'description' => 'The order arrived late.',
            'status' => ComplaintStatus::OPEN,
        ]);

        $this->actingAs($admin)->patchJson("/api/admin/complaints/{$complaint->id}", ['status' => 'RESOLVED'])->assertStatus(422);
        $this->actingAs($admin)->patchJson("/api/admin/complaints/{$complaint->id}", ['status' => 'RESOLVED', 'reason' => 'Seller issued a verified resolution.'])
            ->assertOk()
            ->assertJsonPath('complaint.status', 'RESOLVED');

        $this->assertDatabaseHas('complaint_status_histories', ['complaint_id' => $complaint->id, 'to_status' => 'RESOLVED', 'changed_by' => $admin->id]);
        $this->actingAs($seller)->getJson('/api/seller/complaints')->assertOk()->assertJsonPath('action_required_total', 0);
    }
}
