<?php

namespace Database\Seeders;

use App\Enums\InterestStatus;
use App\Enums\ListingStatus;
use App\Enums\OrderStatus;
use App\Enums\PricingType;
use App\Enums\Role;
use App\Models\Category;
use App\Models\Interest;
use App\Models\LivestockListing;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\OrderStatusHistory;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;
use LogicException;
use Illuminate\Support\Str;

class FarmgateDemoDataSeeder extends Seeder
{
    private const RECORD_COUNT = 100;

    private const TEST_PASSWORD = 'FarmgateTest123!';

    public function run(): void
    {
        if (! app()->environment(['local', 'testing'])) {
            throw new LogicException('FarmGate demo data can only be seeded in local or testing environments.');
        }

        $this->call(\Database\Seeders\ResetFarmgateDemoDataSeeder::class);
        fake()->seed(20260928);

        $categories = collect(['Swine', 'Cattle', 'Carabao', 'Goat', 'Chicken', 'Duck', 'Other livestock'])
            ->map(fn (string $name) => Category::firstOrCreate(
                ['slug' => Str::slug($name)],
                ['name' => $name, 'is_active' => true],
            ));

        $sellers = collect(range(1, 10))->map(fn (int $number) => $this->createAccount(
            sprintf('farmgate-demo-seller-%02d@farmgate.test', $number),
            sprintf('Demo Farm %02d', $number),
            Role::SELLER,
            sprintf('Demo Livestock Farm %02d', $number),
        ));

        $buyers = collect(range(1, 20))->map(fn (int $number) => $this->createAccount(
            sprintf('farmgate-demo-buyer-%02d@farmgate.test', $number),
            sprintf('Demo Buyer %02d', $number),
            Role::BUYER,
        ));

        $listingStatuses = ListingStatus::cases();
        $listings = collect(range(1, self::RECORD_COUNT))->map(function (int $number) use ($categories, $sellers, $listingStatuses): LivestockListing {
            $pricingType = $number % 2 === 0 ? PricingType::PER_KILO : PricingType::PER_HEAD;
            $price = 150 + (($number * 37) % 1850);
            $category = $categories[($number - 1) % $categories->count()];
            $seller = $sellers[($number - 1) % $sellers->count()];

            return LivestockListing::create([
                'seller_id' => $seller->id,
                'category_id' => $category->id,
                'name' => sprintf('Demo %s Listing %03d', $category->name, $number),
                'breed' => fake()->randomElement(['Native', 'Anglo-Nubian', 'Brahman', 'Large White', 'Local cross']),
                'sex' => fake()->randomElement(['Male', 'Female']),
                'age_months' => fake()->numberBetween(4, 48),
                'estimated_weight_kg' => fake()->randomFloat(2, 12, 280),
                'quantity' => fake()->numberBetween(5, 80),
                'description' => sprintf('[FARMGATE-DEMO] Generated test listing %03d for marketplace and status coverage.', $number),
                'pickup_location' => fake()->randomElement(['Bongabong', 'Mansalay', 'Roxas', 'Gloria']).', Oriental Mindoro',
                'health_information' => 'Demo-only test record; not a real animal listing.',
                'vaccination_information' => 'Demo vaccination record for UI testing.',
                'pricing_type' => $pricingType,
                'price_per_kilo' => $pricingType === PricingType::PER_KILO ? $price : null,
                'price_per_head' => $pricingType === PricingType::PER_HEAD ? $price * 12 : null,
                'status' => $listingStatuses[intdiv($number - 1, $categories->count()) % count($listingStatuses)],
            ]);
        });

        $orderableListings = $listings->filter(fn (LivestockListing $listing) => in_array($listing->status, [ListingStatus::ACTIVE, ListingStatus::SOLD], true))->values();
        $orderStatuses = OrderStatus::cases();

        foreach (range(1, self::RECORD_COUNT) as $number) {
            $listing = $orderableListings[($number - 1) % $orderableListings->count()];
            $buyer = $buyers[($number - 1) % $buyers->count()];
            $pricingType = $listing->pricing_type;
            $unitPrice = (float) ($pricingType === PricingType::PER_KILO ? $listing->price_per_kilo : $listing->price_per_head);
            $quantity = fake()->numberBetween(1, 3);
            $subtotal = round($unitPrice * $quantity, 2);
            $deliveryFee = round(80 + (($number * 11) % 420), 2);
            $status = $orderStatuses[($number - 1) % count($orderStatuses)];

            $order = Order::create([
                'buyer_id' => $buyer->id,
                'seller_id' => $listing->seller_id,
                'status' => $status,
                'subtotal_amount' => $subtotal,
                'delivery_fee' => $deliveryFee,
                'platform_fee' => 0,
                'order_processing_fee' => 0,
                'transaction_fee' => 0,
                'payment_processing_fee' => 0,
                'buyer_service_fee' => 0,
                'seller_fee' => 0,
                'discount_amount' => 0,
                'delivery_base_fee_snapshot' => $deliveryFee,
                'delivery_rate_per_km_snapshot' => 0,
                'platform_fee_rate_snapshot' => 0,
                'total_amount' => $subtotal + $deliveryFee,
            ]);

            OrderItem::create([
                'order_id' => $order->id,
                'listing_id' => $listing->id,
                'quantity' => $quantity,
                'unit_price' => $unitPrice,
                'total_amount' => $subtotal,
                'pricing_type' => $pricingType,
            ]);

            OrderStatusHistory::create([
                'order_id' => $order->id,
                'from_status' => null,
                'to_status' => $status,
                'changed_by' => $listing->seller_id,
                'reason' => '[FARMGATE-DEMO] Generated status history for testing.',
            ]);
        }

        $interestStatuses = InterestStatus::cases();
        $interestCount = 0;
        foreach ($orderableListings as $listing) {
            foreach ($buyers as $buyer) {
                if ($interestCount >= self::RECORD_COUNT) {
                    break 2;
                }

                Interest::create([
                    'buyer_id' => $buyer->id,
                    'livestock_listing_id' => $listing->id,
                    'status' => $interestStatuses[$interestCount % count($interestStatuses)],
                ]);
                $interestCount++;
            }
        }

        $this->command?->info('Seeded 100 demo listings, 100 orders, 100 buyer interests, 10 sellers, and 20 buyers.');
        $this->command?->warn('Demo account password: '.self::TEST_PASSWORD);
    }

    private function createAccount(string $email, string $name, Role $role, ?string $businessName = null): User
    {
        $user = User::create([
            'name' => $name,
            'email' => $email,
            'password' => Hash::make(self::TEST_PASSWORD),
            'role' => $role,
        ]);

        if ($role === Role::SELLER) {
            $user->sellerProfile()->create([
                'business_name' => $businessName,
                'is_verified' => true,
            ]);
        }

        return $user;
    }
}