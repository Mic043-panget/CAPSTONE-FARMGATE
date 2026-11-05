<?php

namespace Tests\Feature;

use App\Enums\ListingStatus;
use App\Enums\OrderStatus;
use App\Enums\PricingType;
use App\Enums\Role;
use App\Models\Category;
use App\Models\Complaint;
use App\Models\Delivery;
use App\Models\LivestockListing;
use App\Models\Order;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class ReportTest extends TestCase
{
    use RefreshDatabase;

    public function test_seller_sales_report_is_scoped_and_filterable(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $otherSeller = User::factory()->create(['role' => Role::SELLER]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);

        Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::COMPLETED,
            'total_amount' => 500,
        ]);
        Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::PENDING_CONFIRMATION,
            'total_amount' => 300,
        ]);
        Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $otherSeller->id,
            'status' => OrderStatus::COMPLETED,
            'total_amount' => 900,
        ]);

        $this->actingAs($seller)->getJson('/api/reports/sales?per_page=10')
            ->assertOk()
            ->assertJsonPath('summary.total', 1)
            ->assertJsonPath('data.data.0.total_amount', '500.00');

        $this->actingAs($seller)->getJson('/api/reports/transactions?status=PENDING_CONFIRMATION')
            ->assertOk()
            ->assertJsonPath('summary.total', 1)
            ->assertJsonPath('data.data.0.status', 'PENDING_CONFIRMATION');
    }

    public function test_seller_report_pages_and_filters_never_expose_another_sellers_records(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER, 'name' => 'Current Seller']);
        $otherSeller = User::factory()->create(['role' => Role::SELLER, 'name' => 'Private Other Seller']);
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $rider = User::factory()->create(['role' => Role::RIDER]);
        $category = Category::create(['name' => 'Seller Scope Goat', 'slug' => 'seller-scope-goat']);

        $sellerListing = LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'My Report Goat',
            'quantity' => 2,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 1500,
            'status' => ListingStatus::ACTIVE,
        ]);
        LivestockListing::create([
            'seller_id' => $otherSeller->id,
            'category_id' => $category->id,
            'name' => 'Private Other Goat',
            'quantity' => 5,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 2500,
            'status' => ListingStatus::ACTIVE,
        ]);

        $sellerOrders = collect([1, 2])->map(fn () => Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::COMPLETED,
            'total_amount' => 3000,
        ]));
        $otherOrder = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $otherSeller->id,
            'status' => OrderStatus::COMPLETED,
            'total_amount' => 12500,
        ]);
        Delivery::create(['order_id' => $sellerOrders->first()->id, 'rider_id' => $rider->id]);
        Delivery::create(['order_id' => $otherOrder->id, 'rider_id' => $rider->id]);

        $this->actingAs($seller)->getJson('/api/reports/sales?per_page=1&page=2&seller_id='.$otherSeller->id)
            ->assertOk()
            ->assertJsonPath('summary.total', 2)
            ->assertJsonPath('data.data.0.seller_id', $seller->id);

        $this->actingAs($seller)->getJson('/api/reports/transactions?seller_id='.$otherSeller->id)
            ->assertOk()
            ->assertJsonPath('summary.total', 2)
            ->assertJsonMissing(['name' => 'Private Other Seller']);

        $this->actingAs($seller)->getJson('/api/reports/listings?search=Report&seller_id='.$otherSeller->id)
            ->assertOk()
            ->assertJsonPath('summary.total', 1)
            ->assertJsonPath('data.data.0.id', $sellerListing->id)
            ->assertJsonPath('data.data.0.seller_id', $seller->id);

        $this->actingAs($seller)->getJson('/api/reports/deliveries?per_page=1&seller_id='.$otherSeller->id)
            ->assertOk()
            ->assertJsonPath('summary.total', 1)
            ->assertJsonPath('data.data.0.order.seller_id', $seller->id);
    }

    public function test_only_admin_can_view_user_report(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        User::factory()->create(['role' => Role::SELLER, 'name' => 'Report Seller']);

        $this->actingAs($admin)->getJson('/api/reports/users?search=seller')
            ->assertOk()
            ->assertJsonPath('summary.total', 1);

        $this->actingAs(User::factory()->create(['role' => Role::BUYER]))
            ->getJson('/api/reports/users')
            ->assertForbidden();
    }

    public function test_admin_user_report_filters_email_verification_status(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        User::factory()->create([
            'role' => Role::SELLER,
            'name' => 'Verified Seller',
            'email_verified_at' => now(),
        ]);
        User::factory()->create([
            'role' => Role::BUYER,
            'name' => 'Unverified Buyer',
            'email_verified_at' => null,
        ]);

        $this->actingAs($admin)->getJson('/api/reports/users?status=VERIFIED')
            ->assertOk()
            ->assertJsonPath('summary.total', 2)
            ->assertJsonPath('data.data.0.email_verified_at', fn ($value) => $value !== null);

        $this->actingAs($admin)->getJson('/api/reports/users?status=UNVERIFIED')
            ->assertOk()
            ->assertJsonPath('summary.total', 1)
            ->assertJsonPath('data.data.0.email_verified_at', null);
    }

    public function test_seller_can_load_a_listing_report_for_frontend_printing(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $category = Category::create(['name' => 'Goat', 'slug' => 'goat']);
        LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Young Goat',
            'quantity' => 2,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 1500,
            'status' => ListingStatus::ACTIVE,
        ]);

        $this->actingAs($seller)->getJson('/api/reports/listings?from=2026-01-01&to=2026-12-31')
            ->assertOk()
            ->assertJsonPath('summary.total', 1)
            ->assertJsonPath('data.data.0.name', 'Young Goat');
    }

    public function test_admin_report_types_include_complaints_and_support_all_result_pages(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $rider = User::factory()->create(['role' => Role::RIDER]);
        $category = Category::create(['name' => 'Goat', 'slug' => 'goat']);
        LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => 'Report Goat',
            'quantity' => 3,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 2000,
            'status' => ListingStatus::ACTIVE,
        ]);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::COMPLETED,
            'total_amount' => 6000,
        ]);
        Delivery::create(['order_id' => $order->id, 'rider_id' => $rider->id]);
        Complaint::create([
            'order_id' => $order->id,
            'opened_by' => $buyer->id,
            'respondent_id' => $seller->id,
            'reason' => 'Livestock condition',
            'description' => 'Please review this order.',
            'status' => 'OPEN',
        ]);

        foreach (['sales', 'transactions', 'listings', 'users', 'sellers', 'buyers', 'riders', 'categories', 'deliveries', 'complaints'] as $type) {
            $this->actingAs($admin)->getJson("/api/reports/{$type}?per_page=1")
                ->assertOk()
                ->assertJsonPath('report', $type)
                ->assertJsonPath('data.per_page', 1)
                ->assertJsonPath('summary.total', fn ($total) => $total >= 1);
        }

        $this->actingAs($seller)->getJson('/api/reports/complaints')->assertForbidden();
    }

    public function test_admin_complaint_report_respects_status_date_and_search_filters(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::COMPLETED,
            'total_amount' => 500,
        ]);
        $complaint = Complaint::create([
            'order_id' => $order->id,
            'opened_by' => $buyer->id,
            'respondent_id' => $seller->id,
            'reason' => 'Delivery issue',
            'description' => 'A matching report complaint.',
            'status' => 'OPEN',
        ]);
        DB::table('complaints')->where('id', $complaint->id)->update([
            'created_at' => '2026-10-09 15:59:59',
            'updated_at' => '2026-10-09 15:59:59',
        ]);

        $this->actingAs($admin)->getJson('/api/reports/complaints?search=matching&status=OPEN&from=2026-10-01&to=2026-10-31')
            ->assertOk()
            ->assertJsonPath('summary.total', 1)
            ->assertJsonPath('data.data.0.reason', 'Delivery issue');

        $this->actingAs($admin)->getJson('/api/reports/complaints?status=RESOLVED')
            ->assertOk()
            ->assertJsonPath('summary.total', 0);
    }

    public function test_admin_sales_filters_combine_payment_order_amount_search_and_inclusive_local_dates(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $seller = User::factory()->create(['role' => Role::SELLER, 'name' => 'North Farm Seller']);
        $buyer = User::factory()->create(['role' => Role::BUYER, 'name' => 'Buyer With Reference']);
        $matching = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::COMPLETED,
            'payment_status' => 'PAID',
            'payment_method' => 'GCASH',
            'total_amount' => 1500,
        ]);
        DB::table('orders')->where('id', $matching->id)->update([
            'created_at' => '2026-10-10 15:59:59',
            'updated_at' => '2026-10-10 15:59:59',
        ]);
        $unpaid = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::COMPLETED,
            'payment_status' => 'UNPAID',
            'payment_method' => 'COD',
            'total_amount' => 1200,
        ]);
        DB::table('orders')->where('id', $unpaid->id)->update([
            'created_at' => '2026-10-09 15:59:59',
            'updated_at' => '2026-10-09 15:59:59',
        ]);
        $outsideAmount = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::COMPLETED,
            'payment_status' => 'PAID',
            'payment_method' => 'GCASH',
            'total_amount' => 2500,
        ]);
        DB::table('orders')->where('id', $outsideAmount->id)->update([
            'created_at' => '2026-10-09 15:59:59',
            'updated_at' => '2026-10-09 15:59:59',
        ]);
        $afterBoundary = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::COMPLETED,
            'payment_status' => 'PAID',
            'payment_method' => 'GCASH',
            'total_amount' => 1500,
        ]);
        DB::table('orders')->where('id', $afterBoundary->id)->update([
            'created_at' => '2026-10-10 16:00:00',
            'updated_at' => '2026-10-10 16:00:00',
        ]);

        $this->actingAs($admin)->getJson('/api/reports/sales?order_status=COMPLETED&payment_status=PAID&amount_min=1000&amount_max=2000&search=reference&from=2026-10-10&to=2026-10-10')
            ->assertOk()
            ->assertJsonPath('timezone', 'Asia/Manila')
            ->assertJsonPath('summary.total', 1)
            ->assertJsonPath('data.data.0.id', $matching->id);
    }

    public function test_admin_user_filters_search_phone_role_and_email_verification(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $seller = User::factory()->create([
            'role' => Role::SELLER,
            'name' => 'Verified Phone Seller',
            'phone_number' => '+639171234567',
            'email_verified_at' => now(),
        ]);
        User::factory()->create([
            'role' => Role::BUYER,
            'name' => 'Other Verified Buyer',
            'email_verified_at' => now(),
        ]);

        $this->actingAs($admin)->getJson('/api/reports/users?search=917123&role=SELLER&account_status=VERIFIED')
            ->assertOk()
            ->assertJsonPath('summary.total', 1)
            ->assertJsonPath('data.data.0.id', $seller->id)
            ->assertJsonPath('data.data.0.phone_number', '+639171234567');
    }

    public function test_admin_complaint_type_and_resolution_filters_can_be_combined(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $buyer = User::factory()->create(['role' => Role::BUYER, 'name' => 'Reporting Buyer']);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::COMPLETED,
            'total_amount' => 500,
        ]);
        $resolved = Complaint::create([
            'order_id' => $order->id,
            'opened_by' => $buyer->id,
            'respondent_id' => $seller->id,
            'reason' => 'Livestock delivery delay',
            'description' => 'A reportable complaint.',
            'status' => 'RESOLVED',
            'resolved_at' => now(),
        ]);
        Complaint::create([
            'order_id' => $order->id,
            'opened_by' => $buyer->id,
            'respondent_id' => $seller->id,
            'reason' => 'Livestock delivery concern',
            'description' => 'An unresolved concern.',
            'status' => 'OPEN',
        ]);

        $this->actingAs($admin)->getJson('/api/reports/complaints?search=reporting&complaint_type=delay&resolution_status=RESOLVED')
            ->assertOk()
            ->assertJsonPath('summary.total', 1)
            ->assertJsonPath('data.data.0.id', $resolved->id);
    }

    public function test_admin_report_rejects_invalid_date_and_amount_ranges(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);

        $this->actingAs($admin)->getJson('/api/reports/transactions?from=2026-10-11&to=2026-10-10')
            ->assertUnprocessable()
            ->assertJsonValidationErrors('to');

        $this->actingAs($admin)->getJson('/api/reports/transactions?amount_min=100&amount_max=50')
            ->assertUnprocessable()
            ->assertJsonValidationErrors('amount_max');
    }
}
