<?php

namespace Tests\Feature;

use App\Enums\ComplaintStatus;
use App\Enums\ListingStatus;
use App\Enums\OrderStatus;
use App\Enums\PricingType;
use App\Enums\Role;
use App\Models\Category;
use App\Models\Complaint;
use App\Models\ComplaintMessage;
use App\Models\LivestockListing;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\OrderStatusHistory;
use App\Models\User;
use App\Notifications\OrderCaseUpdatedNotification;
use App\Services\EscalateOrderCases;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
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
            'reason' => 'Animal arrived injured or unwell',
            'description' => 'The order did not match the agreed condition.',
            'evidence' => 'Photo reference stored with the order.',
        ])->assertCreated();

        $complaintId = $response->json('complaint.id');
        $caseReference = $response->json('complaint.case_reference');
        $this->assertMatchesRegularExpression('/^FG-CASE-\d{4}-[A-Z0-9]{5}$/', $caseReference);
        $this->assertDatabaseHas('complaints', ['id' => $complaintId, 'case_reference' => $caseReference, 'reason' => 'Animal arrived injured or unwell']);
        $notification = DB::table('notifications')->where('notifiable_id', $buyer->id)->where('type', OrderCaseUpdatedNotification::class)->first();
        $this->assertSame($caseReference, json_decode($notification->data, true)['case_reference']);
        $this->assertSame($caseReference, $this->actingAs($buyer)->getJson('/api/buyer/complaints')->assertOk()->json('complaints.0.case_reference'));
        $this->actingAs($seller)->getJson('/api/seller/complaints')
            ->assertOk()
            ->assertJsonPath('complaints.data.0.id', $complaintId)
            ->assertJsonPath('complaints.data.0.case_reference', $caseReference)
            ->assertJsonPath('action_required_total', 1);
        $this->assertDatabaseHas('complaint_status_histories', ['complaint_id' => $complaintId, 'to_status' => ComplaintStatus::OPEN->value]);
    }

    public function test_seller_case_search_matches_case_order_buyer_type_and_reason_without_leaking_other_cases(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $buyer = User::factory()->create(['role' => Role::BUYER, 'name' => 'Searchable Case Buyer']);
        $otherSeller = User::factory()->create(['role' => Role::SELLER]);
        $otherBuyer = User::factory()->create(['role' => Role::BUYER, 'name' => 'Other Searchable Case Buyer']);
        $order = Order::create(['buyer_id' => $buyer->id, 'seller_id' => $seller->id, 'status' => OrderStatus::COMPLETED, 'total_amount' => 700]);
        $case = Complaint::create([
            'order_id' => $order->id,
            'opened_by' => $buyer->id,
            'respondent_id' => $seller->id,
            'case_type' => 'RETURN_REFUND',
            'reason' => 'Searchable livestock return reason',
            'description' => 'The buyer provided a distinct case description.',
            'status' => ComplaintStatus::OPEN,
        ]);
        $otherOrder = Order::create(['buyer_id' => $otherBuyer->id, 'seller_id' => $otherSeller->id, 'status' => OrderStatus::COMPLETED, 'total_amount' => 700]);
        Complaint::create([
            'order_id' => $otherOrder->id,
            'opened_by' => $otherBuyer->id,
            'respondent_id' => $otherSeller->id,
            'case_type' => 'RETURN_REFUND',
            'reason' => 'Searchable livestock return reason',
            'description' => 'A case belonging to a different seller.',
            'status' => ComplaintStatus::OPEN,
        ]);

        foreach ([$case->case_reference, $order->order_reference, 'Searchable Case Buyer', 'RETURN_REFUND', 'Return / refund', 'Searchable livestock return reason'] as $term) {
            $this->actingAs($seller)->getJson('/api/seller/complaints?search='.urlencode($term))
                ->assertOk()
                ->assertJsonPath('complaints.total', 1)
                ->assertJsonPath('complaints.data.0.id', $case->id)
                ->assertJsonPath('complaints.data.0.order.order_reference', $order->order_reference)
                ->assertJsonPath('complaints.data.0.case_type', 'RETURN_REFUND');
        }
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

    public function test_admin_case_queue_search_includes_order_and_party_and_returns_order_items(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $buyer = User::factory()->create(['role' => Role::BUYER, 'name' => 'Queue Search Buyer']);
        $seller = User::factory()->create(['role' => Role::SELLER, 'name' => 'Queue Search Seller']);
        $order = $this->orderWithListing($buyer, $seller, ['delivery_fee' => 25], 2, 300);
        $case = Complaint::create([
            'order_id' => $order->id,
            'opened_by' => $buyer->id,
            'respondent_id' => $seller->id,
            'reason' => 'Animal arrived injured or unwell',
            'description' => 'The delivered livestock needs review.',
            'status' => ComplaintStatus::OPEN,
        ]);
        ComplaintMessage::create([
            'complaint_id' => $case->id,
            'sender_id' => $seller->id,
            'message' => 'I am reviewing the livestock report.',
        ]);

        $this->actingAs($admin)->getJson('/api/admin/complaints?search='.$order->order_reference.'&status=OPEN&sort=oldest')
            ->assertOk()
            ->assertJsonPath('complaints.total', 1)
            ->assertJsonPath('complaints.data.0.order.delivery_fee', '25.00')
            ->assertJsonPath('complaints.data.0.order.items.0.listing.name', 'Boer Goat')
            ->assertJsonPath('complaints.data.0.messages.0.sender.name', 'Queue Search Seller')
            ->assertJsonPath('complaints.data.0.messages.0.sender.role', 'SELLER');
        $this->actingAs($admin)->getJson('/api/admin/complaints?search='.$case->case_reference)
            ->assertOk()
            ->assertJsonPath('complaints.total', 1)
            ->assertJsonPath('complaints.data.0.case_reference', $case->case_reference);
    }

    public function test_buyer_can_submit_media_review_and_admin_can_moderate_a_report(): void
    {
        Storage::fake('case_media');
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $reporter = User::factory()->create(['role' => Role::BUYER]);
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $order = Order::create(['buyer_id' => $buyer->id, 'seller_id' => $seller->id, 'status' => OrderStatus::COMPLETED, 'total_amount' => 700]);

        $response = $this->actingAs($buyer)->post("/api/orders/{$order->id}/review", [
            'rating' => 5,
            'comment' => 'Healthy livestock.',
            'media' => [UploadedFile::fake()->image('review.jpg')],
        ])->assertCreated();
        $reviewId = $response->json('review.id');
        $mediaId = $response->json('review.media.0.id');
        $this->assertDatabaseHas('review_media', ['review_id' => $reviewId, 'mime_type' => 'image/jpeg']);

        $this->actingAs($reporter)->postJson("/api/buyer/reviews/{$reviewId}/reports", ['reason' => 'Please verify this review.'])->assertCreated();
        $this->actingAs($admin)->getJson('/api/admin/reviews/reports')->assertOk()
            ->assertJsonPath('reviews.data.0.id', $reviewId)
            ->assertJsonPath('reviews.data.0.open_reports_count', 1);
        $this->actingAs($admin)->patchJson("/api/admin/reviews/{$reviewId}/moderation", [
            'status' => 'HIDDEN',
            'reason' => 'Admin confirmed a moderation issue.',
        ])->assertOk()->assertJsonPath('review.status', 'HIDDEN');

        $this->get("/api/review-media/{$mediaId}")->assertNotFound();
        $this->actingAs($buyer)->get("/api/buyer/reviews/{$reviewId}/media/{$mediaId}")->assertOk();
        $this->assertDatabaseHas('order_activities', ['order_id' => $order->id, 'activity_key' => 'REVIEW_MODERATED']);
    }

    public function test_case_evidence_is_private_and_seller_response_is_recorded(): void
    {
        Storage::fake('case_media');
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $rider = User::factory()->create(['role' => Role::RIDER]);
        $order = Order::create(['buyer_id' => $buyer->id, 'seller_id' => $seller->id, 'status' => OrderStatus::COMPLETED, 'total_amount' => 700]);

        $response = $this->actingAs($buyer)->post("/api/orders/{$order->id}/complaint", [
            'reason' => 'Damaged livestock',
            'description' => 'The order arrived with an injury.',
            'media' => [UploadedFile::fake()->image('evidence.png')],
        ])->assertCreated();
        $caseId = $response->json('complaint.id');
        $mediaUrl = $response->json('complaint.evidence_media.0.url');
        $this->actingAs($buyer)->get($mediaUrl)->assertOk();
        $this->actingAs($rider)->get($mediaUrl)->assertForbidden();

        $this->actingAs($seller)->postJson("/api/cases/{$caseId}/messages", ['message' => 'Please provide additional details.'])->assertCreated();
        $this->actingAs($buyer)->getJson('/api/buyer/complaints')->assertOk()
            ->assertJsonPath('complaints.0.status', 'UNDER_REVIEW')
            ->assertJsonPath('complaints.0.messages.0.message', 'Please provide additional details.');
        $this->assertNotNull(Complaint::query()->findOrFail($caseId)->seller_responded_at);
        $this->assertDatabaseHas('complaint_status_histories', ['complaint_id' => $caseId, 'to_status' => 'UNDER_REVIEW']);
    }

    public function test_return_request_is_partial_admin_approved_and_cod_payout_is_manual(): void
    {
        Storage::fake('case_media');
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $order = $this->orderWithListing($buyer, $seller, [
            'payment_method' => 'COD',
            'payment_status' => 'UNPAID',
            'total_amount' => 600,
        ], 3, 200);

        $response = $this->actingAs($buyer)->postJson("/api/orders/{$order->id}/return-refund", [
            'reason' => 'Misrepresented',
            'description' => 'One animal did not match the listed condition.',
            'return_method' => 'REFUND_ONLY',
            'items' => [['order_item_id' => $order->items()->first()->id, 'quantity' => 1]],
        ])->assertCreated()->assertJsonPath('complaint.requested_amount', '200.00')
            ->assertJsonPath('complaint.refund_status', 'REQUESTED');
        $caseId = $response->json('complaint.id');

        $this->actingAs($admin)->postJson("/api/admin/complaints/{$caseId}/refund-approval", ['amount' => 150])
            ->assertOk()->assertJsonPath('complaint.refund_status', 'MANUAL_ACTION_REQUIRED');
        $this->actingAs($buyer)->getJson('/api/buyer/complaints')->assertOk()
            ->assertJsonPath('complaints.0.approved_refund_amount', '150.00')
            ->assertJsonPath('complaints.0.refund_status', 'MANUAL_ACTION_REQUIRED');

        $this->actingAs($admin)->post("/api/admin/complaints/{$caseId}/manual-payout", [
            'payout_reference' => 'BANK-TRANSFER-01',
            'evidence' => UploadedFile::fake()->image('payout.png'),
        ])
            ->assertOk()->assertJsonPath('complaint.refund_status', 'PAID')
            ->assertJsonPath('complaint.status', 'RESOLVED');
        $this->assertDatabaseHas('complaints', ['id' => $caseId, 'payout_reference' => 'BANK-TRANSFER-01', 'refund_status' => 'PAID']);
        $this->assertDatabaseHas('order_activities', ['order_id' => $order->id, 'activity_key' => 'COD_PAYOUT_RECORDED']);
        $this->actingAs($admin)->get("/api/cases/{$caseId}/payout-evidence")->assertOk()
            ->assertHeader('Content-Type', 'image/png');

        $this->travel(8)->days();
        $this->actingAs($buyer)->postJson("/api/orders/{$order->id}/return-refund", [
            'reason' => 'Other',
            'description' => 'Late request.',
            'other_reason' => 'Policy exception',
            'return_method' => 'REFUND_ONLY',
            'items' => [['order_item_id' => $order->items()->first()->id, 'quantity' => 1]],
        ])->assertStatus(422);
    }

    public function test_paymongo_refund_requires_admin_approval_and_provider_confirmation(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $order = $this->orderWithListing($buyer, $seller, [
            'payment_method' => 'GCASH',
            'payment_status' => 'PAID',
            'paymongo_checkout_session_id' => 'cs_test_case',
            'total_amount' => 200,
        ], 1, 200);
        config(['services.paymongo.secret_key' => 'sk_test_fake']);
        Http::fake([
            'api.paymongo.com/v2/checkout_sessions/cs_test_case' => Http::response([
                'data' => ['attributes' => ['payments' => [['id' => 'pay_test_case']]]],
            ]),
            'api.paymongo.com/v2/refunds' => Http::response([
                'data' => ['id' => 'ref_test_case', 'attributes' => ['status' => 'pending']],
            ]),
            'api.paymongo.com/v2/refunds/ref_test_case' => Http::sequence()
                ->push(['data' => ['attributes' => ['status' => 'succeeded', 'payment_id' => 'pay_test_case', 'amount' => 20000]]], 200),
        ]);
        $item = $order->items()->first();
        $case = $this->actingAs($buyer)->postJson("/api/orders/{$order->id}/return-refund", [
            'reason' => 'Damaged',
            'description' => 'The item was damaged on arrival.',
            'return_method' => 'REFUND_ONLY',
            'items' => [['order_item_id' => $item->id, 'quantity' => 1]],
        ])->assertCreated()->json('complaint');

        $this->actingAs($admin)->postJson("/api/admin/complaints/{$case['id']}/refund-approval", ['amount' => 200])
            ->assertOk()->assertJsonPath('complaint.refund_status', 'PENDING_PROVIDER')
            ->assertJsonPath('complaint.status', 'UNDER_REVIEW');
        $this->actingAs($admin)->postJson("/api/admin/complaints/{$case['id']}/refund-approval", ['amount' => 200])->assertStatus(409);
        $this->actingAs($admin)->postJson("/api/admin/complaints/{$case['id']}/refund-sync", [])
            ->assertOk()->assertJsonPath('complaint.refund_status', 'PAID')
            ->assertJsonPath('complaint.status', 'RESOLVED');
        Http::assertSentCount(3);
    }

    public function test_admin_can_reconcile_action_required_paymongo_refund_by_provider_id(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $order = $this->orderWithListing($buyer, $seller, [
            'payment_method' => 'GCASH',
            'payment_status' => 'PAID',
            'paymongo_checkout_session_id' => 'cs_reconcile_case',
            'total_amount' => 100,
        ], 1, 100);
        $case = Complaint::create([
            'order_id' => $order->id,
            'opened_by' => $buyer->id,
            'respondent_id' => $seller->id,
            'case_type' => 'RETURN_REFUND',
            'reason' => 'Damaged',
            'description' => 'Item arrived damaged.',
            'status' => ComplaintStatus::UNDER_REVIEW,
            'return_method' => 'REFUND_ONLY',
            'requested_amount' => 100,
            'approved_refund_amount' => 100,
            'refund_status' => 'ACTION_REQUIRED',
            'paymongo_payment_id' => 'pay_reconcile_case',
            'approved_by' => $admin->id,
        ]);
        config(['services.paymongo.secret_key' => 'sk_test_fake']);
        Http::fake([
            'api.paymongo.com/v2/refunds/ref_manual_case' => Http::response([
                'data' => ['attributes' => [
                    'status' => 'succeeded',
                    'payment_id' => 'pay_reconcile_case',
                    'amount' => 10000,
                ]],
            ]),
        ]);

        $this->actingAs($admin)->postJson("/api/admin/complaints/{$case->id}/refund-sync", [
            'paymongo_refund_id' => 'ref_manual_case',
        ])->assertOk()->assertJsonPath('complaint.refund_status', 'PAID');

        $this->assertDatabaseHas('complaints', [
            'id' => $case->id,
            'paymongo_refund_id' => 'ref_manual_case',
            'refund_status' => 'PAID',
        ]);
        Http::assertSentCount(1);
    }

    public function test_unanswered_case_escalates_to_admin_after_seller_deadline(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::COMPLETED,
            'total_amount' => 700,
        ]);

        $caseId = $this->actingAs($buyer)->postJson("/api/orders/{$order->id}/complaint", [
            'reason' => 'Damaged livestock',
            'description' => 'The item was damaged on arrival.',
        ])->assertCreated()->json('complaint.id');

        $this->travel(4)->days();
        $this->assertSame(1, app(EscalateOrderCases::class)->run());
        $this->assertNotNull(Complaint::query()->findOrFail($caseId)->escalated_at);
        $this->assertDatabaseHas('order_activities', [
            'order_id' => $order->id,
            'activity_key' => 'CASE_ESCALATED',
        ]);
        $this->assertSame(0, app(EscalateOrderCases::class)->run());
    }

    private function orderWithListing(User $buyer, User $seller, array $orderData, int $quantity, float $unitPrice): Order
    {
        $category = Category::create(['name' => 'Goat', 'slug' => 'goat']);
        $listing = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Boer Goat',
            'quantity' => 3,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => $unitPrice,
            'status' => ListingStatus::ACTIVE,
        ]);
        $order = Order::create($orderData + [
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::COMPLETED,
            'total_amount' => $quantity * $unitPrice,
        ]);
        OrderItem::create([
            'order_id' => $order->id,
            'listing_id' => $listing->id,
            'quantity' => $quantity,
            'unit_price' => $unitPrice,
            'total_amount' => $quantity * $unitPrice,
            'pricing_type' => PricingType::PER_HEAD,
        ]);
        OrderStatusHistory::create([
            'order_id' => $order->id,
            'from_status' => OrderStatus::FULFILLING,
            'to_status' => OrderStatus::COMPLETED,
            'changed_by' => $buyer->id,
            'reason' => 'Buyer confirmed completion.',
        ]);

        return $order->load('items');
    }
}
