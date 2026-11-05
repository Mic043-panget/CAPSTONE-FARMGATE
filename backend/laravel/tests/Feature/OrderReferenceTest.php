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
use App\Services\OrderReferenceGenerator;
use App\Support\CategoryReferenceCode;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use LogicException;
use Tests\TestCase;

class OrderReferenceTest extends TestCase
{
    use RefreshDatabase;

    public function test_new_orders_receive_unique_uncontrollable_references(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);

        $first = $this->createOrder($buyer, $seller, 'FG-'.str_repeat('A', 32));
        $second = $this->createOrder($buyer, $seller);

        $this->assertMatchesRegularExpression(
            '/^FG-OT-S'.str_pad((string) $seller->id, 5, '0', STR_PAD_LEFT).'-P00000-[23456789A-HJ-NP-Z]{16}$/',
            $first->order_reference,
        );
        $this->assertMatchesRegularExpression(
            '/^FG-OT-S'.str_pad((string) $seller->id, 5, '0', STR_PAD_LEFT).'-P00000-[23456789A-HJ-NP-Z]{16}$/',
            $second->order_reference,
        );
        $this->assertNotSame($first->order_reference, $second->order_reference);

        try {
            DB::table('orders')->where('id', $second->id)->update([
                'order_reference' => $first->order_reference,
            ]);
            $this->fail('The unique order-reference constraint should reject duplicates.');
        } catch (QueryException) {
            $this->assertDatabaseHas('orders', [
                'id' => $second->id,
                'order_reference' => $second->order_reference,
            ]);
        }
    }

    public function test_public_verification_returns_only_non_private_order_facts(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $order = $this->createOrder($buyer, $seller);

        $response = $this->getJson('/api/orders/verify/'.$order->order_reference)->assertOk();

        $this->assertSame(
            ['order_reference', 'status', 'created_at'],
            array_keys($response->json('order')),
        );
        $response
            ->assertJsonPath('order.order_reference', $order->order_reference)
            ->assertJsonPath('order.status', OrderStatus::PENDING_CONFIRMATION->value)
            ->assertJsonMissingPath('order.id')
            ->assertJsonMissingPath('order.buyer_id')
            ->assertJsonMissingPath('order.shipping_address')
            ->assertJsonMissingPath('order.payment_status');
    }

    public function test_public_verification_does_not_claim_payment_for_an_order(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $order = $this->createOrder($buyer, $seller);

        $this->getJson('/api/orders/verify/'.$order->order_reference)
            ->assertOk()
            ->assertJsonMissingPath('order.payment_status');
    }

    public function test_public_verification_resolves_a_legacy_receipt_reference(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $order = $this->createOrder($buyer, $seller);
        $legacyReference = 'FG-'.strtoupper(bin2hex(random_bytes(16)));

        DB::table('order_reference_aliases')->insert([
            'order_id' => $order->id,
            'legacy_reference' => $legacyReference,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->getJson('/api/orders/verify/'.$legacyReference)
            ->assertOk()
            ->assertJsonPath('order.order_reference', $order->order_reference);
    }

    public function test_an_order_reference_cannot_be_changed_after_order_creation(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $order = $this->createOrder($buyer, $seller);

        $order->order_reference = 'FG-'.str_repeat('B', 32);

        $this->expectException(LogicException::class);
        $order->save();
    }

    public function test_category_reference_codes_cover_supported_categories_and_default_to_other(): void
    {
        $this->assertSame('SW', CategoryReferenceCode::forSlugAndName('swine', 'Swine'));
        $this->assertSame('SW', CategoryReferenceCode::forSlugAndName('pig', 'Pig'));
        $this->assertSame('CA', CategoryReferenceCode::forSlugAndName('carabao', 'Carabao'));
        $this->assertSame('CT', CategoryReferenceCode::forSlugAndName('cattle', 'Cattle'));
        $this->assertSame('GO', CategoryReferenceCode::forSlugAndName('goat', 'Goat'));
        $this->assertSame('SH', CategoryReferenceCode::forSlugAndName('sheep', 'Sheep'));
        $this->assertSame('CH', CategoryReferenceCode::forSlugAndName('chicken', 'Chicken'));
        $this->assertSame('CH', CategoryReferenceCode::forSlugAndName('poultry', 'Poultry'));
        $this->assertSame('DU', CategoryReferenceCode::forSlugAndName('duck', 'Duck'));
        $this->assertSame('FI', CategoryReferenceCode::forSlugAndName('fish', 'Fish'));
        $this->assertSame('OT', CategoryReferenceCode::forSlugAndName('other-livestock', 'Other livestock'));
        $this->assertSame('OT', CategoryReferenceCode::forSlugAndName('unmapped', 'Unmapped'));
    }

    public function test_different_categories_with_the_same_code_use_mixed_category_reference(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $chicken = Category::create(['name' => 'Chicken', 'slug' => 'chicken']);
        $poultry = Category::create(['name' => 'Poultry', 'slug' => 'poultry']);
        $listings = collect([$chicken, $poultry])->map(fn (Category $category): LivestockListing => LivestockListing::create([
            'seller_id' => $seller->id,
            'category_id' => $category->id,
            'name' => $category->name.' listing',
            'quantity' => 1,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 100,
            'status' => ListingStatus::ACTIVE,
        ]));

        $reference = app(OrderReferenceGenerator::class)->generate(
            (int) $seller->id,
            $listings->pluck('id')->reverse()->map(fn ($id): int => (int) $id)->all(),
        );

        $this->assertStringStartsWith(
            'FG-MX-S'.str_pad((string) $seller->id, 5, '0', STR_PAD_LEFT).'-P'.str_pad((string) $listings->first()->id, 5, '0', STR_PAD_LEFT).'-',
            $reference,
        );
        $this->assertMatchesRegularExpression('/-[23456789A-HJ-NP-Z]{16}$/', $reference);
    }

    public function test_category_reference_code_is_persisted_and_cannot_be_changed(): void
    {
        $category = Category::create(['name' => 'Goat', 'slug' => 'goat']);

        $this->assertSame('GO', $category->reference_code);
        $this->assertDatabaseHas('categories', ['id' => $category->id, 'reference_code' => 'GO']);

        $category->reference_code = 'OT';
        $this->expectException(LogicException::class);
        $category->save();
    }

    public function test_admin_can_search_orders_by_public_reference(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $order = $this->createOrder($buyer, $seller);

        $this->actingAs($admin)
            ->getJson('/api/admin/orders?search='.urlencode($order->order_reference))
            ->assertOk()
            ->assertJsonCount(1, 'orders.data')
            ->assertJsonPath('orders.data.0.order_reference', $order->order_reference);
    }

    private function createOrder(User $buyer, User $seller, ?string $clientSuppliedReference = null): Order
    {
        return Order::query()->create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => OrderStatus::PENDING_CONFIRMATION,
            'total_amount' => '250.00',
            'order_reference' => $clientSuppliedReference,
        ]);
    }
}
