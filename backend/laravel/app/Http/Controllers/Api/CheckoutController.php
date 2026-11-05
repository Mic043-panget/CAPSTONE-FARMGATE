<?php

namespace App\Http\Controllers\Api;

use App\Enums\DeliveryStatus;
use App\Enums\ListingStatus;
use App\Enums\OrderStatus;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\Cart;
use App\Models\CartItem;
use App\Models\Delivery;
use App\Models\LivestockListing;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\OrderStatusHistory;
use App\Models\SellerProfile;
use App\Notifications\OrderStatusChangedNotification;
use App\Services\OrderReferenceGenerator;
use App\Services\PromotionPricingService;
use App\Services\RiderAssignmentService;
use App\Services\SystemSettingsService;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

class CheckoutController extends Controller
{
    public function quote(Request $request, SystemSettingsService $settings, PromotionPricingService $promotionPricing): JsonResponse
    {
        abort_unless($request->user()?->role === Role::BUYER, 403);

        $data = $request->validate([
            'listing_id' => ['nullable', 'integer', 'exists:livestock_listings,id'],
            'quantity' => ['required_with:listing_id', 'integer', 'min:1'],
            'items' => ['sometimes', 'array', 'min:1'],
            'items.*.cart_item_id' => ['required_with:items', 'integer', 'distinct'],
            'items.*.quantity' => ['required_with:items', 'integer', 'min:1'],
            'delivery_method' => ['required', 'in:SELF_PICKUP,SELLER_DELIVERY,STANDARD_DELIVERY'],
            'latitude' => ['required_if:delivery_method,SELLER_DELIVERY,STANDARD_DELIVERY', 'nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['required_if:delivery_method,SELLER_DELIVERY,STANDARD_DELIVERY', 'nullable', 'numeric', 'between:-180,180'],
        ]);

        if (isset($data['listing_id'])) {
            abort_if(isset($data['items']), 422, 'Choose either a single listing or cart quantities.');
            $listing = LivestockListing::query()->with('seller.sellerProfile')->findOrFail($data['listing_id']);
            $items = collect([(object) ['listing' => $listing, 'quantity' => $data['quantity']]]);
        } else {
            $cart = $request->user()->cart()->first();
            abort_if(! $cart || $cart->items()->count() === 0, 422, 'Your cart is empty.');
            $items = $this->cartItemsWithSelectedQuantities($cart, $data['items'] ?? null);
        }

        $subtotalCents = 0;
        $deliveryFeeCents = 0;
        $otherFeesCents = 0;
        $distances = [];

        foreach ($items->groupBy(fn ($item) => $item->listing->seller_id) as $sellerId => $sellerItems) {
            $sellerSubtotalCents = 0;
            foreach ($sellerItems as $item) {
                $listing = $item->listing;
                abort_unless($listing->status === ListingStatus::ACTIVE, 409);
                abort_if($item->quantity > $listing->quantity, 422, 'The requested quantity is no longer available.');
                $price = $promotionPricing->unitPrice($listing);
                $sellerSubtotalCents = PromotionPricingService::addCents(
                    $sellerSubtotalCents,
                    PromotionPricingService::multiplyCents(PromotionPricingService::toCents($price), $item->quantity),
                );
            }
            $subtotalCents = PromotionPricingService::addCents($subtotalCents, $sellerSubtotalCents);
            $sellerSubtotal = $sellerSubtotalCents / 100;

            if ($data['delivery_method'] !== 'SELF_PICKUP') {
                $profile = $sellerItems->first()->listing->seller?->sellerProfile;
                abort_if($profile?->latitude === null || $profile?->longitude === null, 422, 'A seller has not pinned their pickup location yet. Contact the seller or choose self pickup.');
                $distance = $settings->distanceKm((float) $data['latitude'], (float) $data['longitude'], (float) $profile->latitude, (float) $profile->longitude);
                $maxDistance = $settings->getDecimal('delivery_distance_limit_km');
                abort_if($maxDistance > 0 && $distance > $maxDistance, 422, 'The requested delivery distance exceeds the configured delivery limit.');
                $distances[(string) $sellerId] = $distance;
                $deliveryFeeCents = PromotionPricingService::addCents(
                    $deliveryFeeCents,
                    PromotionPricingService::toCents($settings->deliveryFee($distance, $sellerSubtotal)),
                );
            }
            $platformRate = $settings->getDecimal('platform_service_fee_rate') ?: $settings->getDecimal('platform_fee_percent');
            $combinedRate = (
                $platformRate
                + $settings->getDecimal('transaction_fee_rate')
                + $settings->getDecimal('payment_processing_fee_rate')
                + $settings->getDecimal('buyer_service_fee_rate')
            );
            $sellerFeesCents = PromotionPricingService::percentageOfCents($sellerSubtotalCents, $combinedRate);
            $processingFeeCents = PromotionPricingService::toCents($settings->getDecimal('order_processing_fee'));
            $otherFeesCents = PromotionPricingService::addCents(
                $otherFeesCents,
                PromotionPricingService::addCents($sellerFeesCents, $processingFeeCents),
            );
        }

        return response()->json([
            'subtotal' => PromotionPricingService::fromCents($subtotalCents),
            'shipping' => PromotionPricingService::fromCents($deliveryFeeCents),
            'fees' => PromotionPricingService::fromCents($otherFeesCents),
            'total' => PromotionPricingService::fromCents(
                PromotionPricingService::addCents(
                    PromotionPricingService::addCents($subtotalCents, $deliveryFeeCents),
                    $otherFeesCents,
                ),
            ),
            'delivery_distances_km' => $distances,
        ]);
    }

    public function store(Request $request, SystemSettingsService $settings, OrderReferenceGenerator $referenceGenerator, PromotionPricingService $promotionPricing): JsonResponse
    {
        abort_unless($request->user()?->role === Role::BUYER, 403);

        $data = $request->validate([
            'listing_id' => ['nullable', 'integer', 'exists:livestock_listings,id'],
            'quantity' => ['required_with:listing_id', 'integer', 'min:1'],
            'items' => ['sometimes', 'array', 'min:1'],
            'items.*.cart_item_id' => ['required_with:items', 'integer', 'distinct'],
            'items.*.quantity' => ['required_with:items', 'integer', 'min:1'],
            'delivery_method' => ['sometimes', 'in:SELF_PICKUP,SELLER_DELIVERY,STANDARD_DELIVERY'],
            'payment_method' => ['sometimes', 'in:COD,GCASH,CARD,GOOGLE_PAY'],
            'buyer_address_id' => ['nullable', 'integer'],
            'shipping_address' => ['nullable', 'array'],
            'shipping_address.recipient_name' => ['required_with:shipping_address', 'string', 'max:120'],
            'shipping_address.phone_number' => ['required_with:shipping_address', 'string', 'max:30'],
            'shipping_address.province' => ['required_with:shipping_address', 'string', 'max:120'],
            'shipping_address.city_municipality' => ['required_with:shipping_address', 'string', 'max:120'],
            'shipping_address.barangay' => ['required_with:shipping_address', 'string', 'max:120'],
            'shipping_address.postal_code' => ['required_with:shipping_address', 'string', 'max:12'],
            'shipping_address.street_address' => ['required_with:shipping_address', 'string', 'max:255'],
            'shipping_address.address_line2' => ['nullable', 'string', 'max:255'],
            'shipping_address.delivery_notes' => ['nullable', 'string', 'max:1000'],
            'shipping_address.latitude' => ['required_with:shipping_address', 'numeric', 'between:-90,90'],
            'shipping_address.longitude' => ['required_with:shipping_address', 'numeric', 'between:-180,180'],
            'buyer_location' => ['nullable', 'array'],
            'buyer_location.recipient_name' => ['nullable', 'string', 'max:120'],
            'buyer_location.phone_number' => ['nullable', 'string', 'max:30'],
            'buyer_location.province' => ['nullable', 'string', 'max:120'],
            'buyer_location.city_municipality' => ['nullable', 'string', 'max:120'],
            'buyer_location.barangay' => ['nullable', 'string', 'max:120'],
            'buyer_location.postal_code' => ['nullable', 'string', 'max:12'],
            'buyer_location.street_address' => ['nullable', 'string', 'max:255'],
            'buyer_location.address_line2' => ['nullable', 'string', 'max:255'],
            'buyer_location.latitude' => ['required_with:buyer_location', 'numeric', 'between:-90,90'],
            'buyer_location.longitude' => ['required_with:buyer_location', 'numeric', 'between:-180,180'],
        ]);
        $deliveryMethod = $data['delivery_method'] ?? 'SELF_PICKUP';
        $paymentMethod = $data['payment_method'] ?? 'COD';
        $shippingAddress = null;
        if ($deliveryMethod !== 'SELF_PICKUP') {
            if (! empty($data['buyer_address_id'])) {
                $address = $request->user()->buyerAddresses()->whereKey($data['buyer_address_id'])->firstOrFail();
                $shippingAddress = $address->only([
                    'label', 'recipient_name', 'phone_number', 'province', 'city_municipality',
                    'postal_code', 'street_address', 'address_line2', 'delivery_notes', 'latitude', 'longitude',
                ]);
                $shippingAddress['barangay'] = $address->barangay ?? '';
            } else {
                abort_if(empty($data['shipping_address']), 422, 'Enter a delivery address and pin your location before continuing.');
                $shippingAddress = $data['shipping_address'];
            }
        } elseif (! empty($data['buyer_address_id'])) {
            $address = $request->user()->buyerAddresses()->whereKey($data['buyer_address_id'])->firstOrFail();
            $shippingAddress = $address->only([
                'label', 'recipient_name', 'phone_number', 'province', 'city_municipality',
                'postal_code', 'street_address', 'address_line2', 'delivery_notes', 'latitude', 'longitude',
            ]);
            $shippingAddress['barangay'] = $address->barangay ?? '';
        } elseif (! empty($data['buyer_location'])) {
            $buyerLocation = $data['buyer_location'];
            $shippingAddress = [
                'recipient_name' => $buyerLocation['recipient_name'] ?? $request->user()->name,
                'phone_number' => $buyerLocation['phone_number'] ?? $request->user()->phone_number,
                'province' => $buyerLocation['province'] ?? null,
                'city_municipality' => $buyerLocation['city_municipality'] ?? null,
                'barangay' => $buyerLocation['barangay'] ?? null,
                'postal_code' => $buyerLocation['postal_code'] ?? null,
                'street_address' => $buyerLocation['street_address'] ?? null,
                'address_line2' => $buyerLocation['address_line2'] ?? null,
                'latitude' => $buyerLocation['latitude'],
                'longitude' => $buyerLocation['longitude'],
            ];
        }
        $cart = null;
        if (isset($data['listing_id'])) {
            abort_if(isset($data['items']), 422, 'Choose either a single listing or cart quantities.');
            $listing = LivestockListing::query()->findOrFail($data['listing_id']);
            $item = new CartItem(['listing_id' => $listing->id, 'quantity' => $data['quantity']]);
            $item->setRelation('listing', $listing);
            $items = collect([$item]);
        } else {
            $cart = $request->user()->cart()->first();
            abort_if(! $cart || $cart->items()->count() === 0, 422, 'Your cart is empty.');
            $items = $this->cartItemsWithSelectedQuantities($cart, $data['items'] ?? null);
        }
        abort_if($items->count() > $settings->getInt('maximum_items_per_order'), 422, 'This order exceeds the maximum number of items.');
        abort_if($paymentMethod !== 'COD' && ! filled(config('services.paymongo.secret_key')), 503, 'PayMongo is not configured. Use cash on delivery or contact support.');

        $orders = DB::transaction(function () use ($request, $cart, $items, $settings, $referenceGenerator, $promotionPricing, $deliveryMethod, $paymentMethod, $shippingAddress): Collection {
            $sellerIds = $items->pluck('listing.seller_id')->unique();
            $orders = collect();

            foreach ($sellerIds as $sellerId) {
                $sellerItems = $items->filter(fn (CartItem $item): bool => $item->listing->seller_id === $sellerId);
                $subtotalCents = 0;

                foreach ($sellerItems as $item) {
                    $listing = LivestockListing::query()->lockForUpdate()->findOrFail($item->listing_id);
                    abort_unless($listing->status === ListingStatus::ACTIVE, 409);
                    abort_if($item->quantity > $listing->quantity, 422, 'The requested quantity is no longer available.');
                    $item->setRelation('listing', $listing);
                    $unitPrice = $promotionPricing->unitPrice($listing, true);
                    $item->setAttribute('checkout_unit_price', $unitPrice);
                    $subtotalCents = PromotionPricingService::addCents(
                        $subtotalCents,
                        PromotionPricingService::multiplyCents(PromotionPricingService::toCents($unitPrice), $item->quantity),
                    );
                    $listing->decrement('quantity', $item->quantity);
                }
                $subtotal = $subtotalCents / 100;

                $minimumOrderCents = PromotionPricingService::toCents($settings->getDecimal('minimum_order_amount'));
                $maximumOrderCents = PromotionPricingService::toCents($settings->getDecimal('maximum_order_amount'));
                abort_if($subtotalCents < $minimumOrderCents, 422, 'The order does not meet the minimum amount.');
                abort_if($maximumOrderCents > 0 && $subtotalCents > $maximumOrderCents, 422, 'The order exceeds the maximum amount.');

                $platformRate = $settings->getDecimal('platform_service_fee_rate') ?: $settings->getDecimal('platform_fee_percent');
                $transactionRate = $settings->getDecimal('transaction_fee_rate');
                $paymentRate = $settings->getDecimal('payment_processing_fee_rate');
                $buyerServiceRate = $settings->getDecimal('buyer_service_fee_rate');
                $platformFeeCents = PromotionPricingService::percentageOfCents($subtotalCents, $platformRate);
                $transactionFeeCents = PromotionPricingService::percentageOfCents($subtotalCents, $transactionRate);
                $paymentFeeCents = PromotionPricingService::percentageOfCents($subtotalCents, $paymentRate);
                $buyerServiceFeeCents = PromotionPricingService::percentageOfCents($subtotalCents, $buyerServiceRate);
                $orderProcessingFeeCents = PromotionPricingService::toCents($settings->getDecimal('order_processing_fee'));
                $deliveryDistance = null;
                $sellerProfile = null;
                if ($deliveryMethod !== 'SELF_PICKUP') {
                    $sellerProfile = SellerProfile::query()->where('user_id', $sellerId)->first();
                    abort_if($sellerProfile?->latitude === null || $sellerProfile?->longitude === null, 422, 'A seller has not pinned their pickup location yet. Contact the seller or choose self pickup.');
                    $deliveryDistance = $settings->distanceKm(
                        (float) $shippingAddress['latitude'],
                        (float) $shippingAddress['longitude'],
                        (float) $sellerProfile->latitude,
                        (float) $sellerProfile->longitude,
                    );
                    $maxDistance = $settings->getDecimal('delivery_distance_limit_km');
                    abort_if($maxDistance > 0 && $deliveryDistance > $maxDistance, 422, 'The requested delivery distance exceeds the configured delivery limit.');
                }
                $deliveryFeeCents = $deliveryDistance === null ? 0 : PromotionPricingService::toCents($settings->deliveryFee($deliveryDistance, $subtotal));
                $discountCents = 0;
                $totalCents = $subtotalCents;
                foreach ([$deliveryFeeCents, $platformFeeCents, $transactionFeeCents, $paymentFeeCents, $buyerServiceFeeCents, $orderProcessingFeeCents] as $amountCents) {
                    $totalCents = PromotionPricingService::addCents($totalCents, $amountCents);
                }
                $totalCents -= $discountCents;

                $order = $referenceGenerator->createOrder([
                    'buyer_id' => $request->user()->id,
                    'seller_id' => $sellerId,
                    'status' => OrderStatus::PENDING_CONFIRMATION,
                    'stock_reserved_at' => now(),
                    'delivery_method' => $deliveryMethod,
                    'payment_method' => $paymentMethod,
                    'shipping_address' => $shippingAddress,
                    'subtotal_amount' => PromotionPricingService::fromCents($subtotalCents),
                    'delivery_fee' => PromotionPricingService::fromCents($deliveryFeeCents),
                    'platform_fee' => PromotionPricingService::fromCents($platformFeeCents),
                    'order_processing_fee' => PromotionPricingService::fromCents($orderProcessingFeeCents),
                    'transaction_fee' => PromotionPricingService::fromCents($transactionFeeCents),
                    'payment_processing_fee' => PromotionPricingService::fromCents($paymentFeeCents),
                    'buyer_service_fee' => PromotionPricingService::fromCents($buyerServiceFeeCents),
                    'seller_fee' => PromotionPricingService::fromCents(PromotionPricingService::percentageOfCents($subtotalCents, $settings->getDecimal('seller_fee_rate'))),
                    'discount_amount' => PromotionPricingService::fromCents($discountCents),
                    'delivery_distance_km' => $deliveryDistance,
                    'delivery_base_fee_snapshot' => number_format($settings->getDecimal('delivery_base_fee'), 2, '.', ''),
                    'delivery_rate_per_km_snapshot' => number_format($settings->getDecimal('delivery_rate_per_km'), 2, '.', ''),
                    'platform_fee_rate_snapshot' => $platformRate,
                    'total_amount' => PromotionPricingService::fromCents($totalCents),
                ], (int) $sellerId, $sellerItems->map(fn (CartItem $item): int => (int) $item->listing_id)->all());
                $orders->push($order);

                OrderStatusHistory::create(['order_id' => $order->id, 'to_status' => OrderStatus::PENDING_CONFIRMATION, 'changed_by' => $request->user()->id]);
                if ($deliveryMethod === 'STANDARD_DELIVERY') {
                    Delivery::create([
                        'order_id' => $order->id,
                        'status' => DeliveryStatus::WAITING_FOR_RIDER,
                        'pickup_latitude' => $sellerProfile?->latitude,
                        'pickup_longitude' => $sellerProfile?->longitude,
                        'pickup_address' => $sellerProfile?->address ?: 'Seller pickup location',
                    ]);
                }
                if ($paymentMethod === 'COD') {
                    DB::afterCommit(function () use ($order): void {
                        app(RiderAssignmentService::class)->dispatchForOrder($order->id);
                        $seller = $order->seller;
                        if ($seller?->accountPreferenceEnabled('order_notifications')) {
                            $seller->notify(new OrderStatusChangedNotification($order->id, OrderStatus::PENDING_CONFIRMATION, $order->order_reference));
                        }
                    });
                }

                foreach ($sellerItems as $item) {
                    $listing = $item->listing;
                    $unitPrice = $item->getAttribute('checkout_unit_price');
                    $amountCents = PromotionPricingService::multiplyCents(PromotionPricingService::toCents($unitPrice), $item->quantity);
                    OrderItem::create(['order_id' => $order->id, 'listing_id' => $listing->id, 'quantity' => $item->quantity, 'unit_price' => $unitPrice, 'total_amount' => PromotionPricingService::fromCents($amountCents), 'pricing_type' => $listing->pricing_type]);
                }
            }

            if ($paymentMethod === 'COD') {
                $cart?->items()->delete();
            }

            return $orders;
        });
        $order = $orders->firstOrFail();

        $checkoutUrl = null;
        if ($paymentMethod !== 'COD') {
            $secretKey = config('services.paymongo.secret_key');
            foreach ($orders as $currentOrder) {
                $currentOrder->load('items.listing');
            }
            $lineItems = [];
            $orderIds = $orders->pluck('id')->map(fn (int $id): string => (string) $id)->all();
            foreach ($orders as $currentOrder) {
                foreach ($currentOrder->items as $item) {
                    $lineItems[] = [
                        'currency' => 'PHP',
                        'amount' => (int) round((float) $item->unit_price * 100),
                        'name' => $item->listing?->name ?? 'Livestock',
                        'quantity' => $item->quantity,
                        'description' => 'Order '.$currentOrder->order_reference,
                    ];
                }
                $deliveryFee = (int) round((float) $currentOrder->delivery_fee * 100);
                if ($deliveryFee > 0) {
                    $lineItems[] = [
                        'currency' => 'PHP',
                        'amount' => $deliveryFee,
                        'name' => 'Delivery fee',
                        'quantity' => 1,
                        'description' => 'Distance-based delivery for order '.$currentOrder->order_reference,
                    ];
                }
                $otherFees = max(0, (int) round(((float) $currentOrder->total_amount - (float) $currentOrder->subtotal_amount - (float) $currentOrder->delivery_fee) * 100));
                if ($otherFees > 0) {
                    $lineItems[] = [
                        'currency' => 'PHP',
                        'amount' => $otherFees,
                        'name' => 'Service and processing fees',
                        'quantity' => 1,
                        'description' => 'Applicable order fees',
                    ];
                }
            }

            $method = match ($paymentMethod) {
                'GCASH' => 'gcash',
                'GOOGLE_PAY' => 'google_pay_card',
                default => 'card',
            };
            $frontendUrl = rtrim((string) config('services.frontend_url'), '/');
            try {
                $response = Http::withBasicAuth($secretKey, '')
                    ->acceptJson()
                    ->post('https://api.paymongo.com/v2/checkout_sessions', [
                        'data' => ['attributes' => [
                            'line_items' => $lineItems,
                            'payment_method_types' => [$method],
                            'success_url' => $frontendUrl.'/?payment=success&order_id='.$order->id.'#marketplace',
                            'cancel_url' => $frontendUrl.'/?payment=cancelled&order_id='.$order->id.'#marketplace',
                            'description' => 'FARMGATE order '.$order->order_reference,
                            // The payment callback resolves this internal order ID; it is not the public order reference.
                            'reference_number' => (string) $order->id,
                            'metadata' => ['order_ids' => implode(',', $orderIds)],
                        ]],
                    ]);
            } catch (ConnectionException $exception) {
                report($exception);
                foreach ($orders as $currentOrder) {
                    $this->releaseFailedOnlineOrder($currentOrder);
                }
                abort(502, 'PayMongo could not be reached. Your order was not completed; try again or use cash on delivery.');
            }
            if (! $response->successful() || ! is_string($response->json('data.id')) || ! is_string($response->json('data.attributes.checkout_url'))) {
                report(new \RuntimeException('PayMongo checkout session could not be created: '.$response->body()));
                foreach ($orders as $currentOrder) {
                    $this->releaseFailedOnlineOrder($currentOrder);
                }
                abort(502, 'PayMongo could not start payment. Your order was not completed; try again or use cash on delivery.');
            }
            foreach ($orders as $currentOrder) {
                $currentOrder->forceFill([
                    'payment_status' => 'PENDING',
                    'paymongo_checkout_session_id' => $response->json('data.id'),
                ])->save();
            }
            $checkoutUrl = $response->json('data.attributes.checkout_url');
            $cart?->items()->delete();
        } else {
            foreach ($orders as $currentOrder) {
                $currentOrder->forceFill(['payment_status' => 'UNPAID'])->save();
            }
        }

        return response()->json([
            'message' => $checkoutUrl ? 'Redirecting to PayMongo checkout.' : 'Checkout successful.',
            'order' => $order->load('items'),
            'orders' => $orders->values()->map(fn (Order $currentOrder): Order => $currentOrder->load('items')),
            'checkout_url' => $checkoutUrl,
        ]);
    }

    private function releaseFailedOnlineOrder(Order $order): void
    {
        DB::transaction(function () use ($order): void {
            $order->refresh();
            if ($order->status !== OrderStatus::PENDING_CONFIRMATION) {
                return;
            }

            foreach ($order->items as $item) {
                LivestockListing::withTrashed()->whereKey($item->listing_id)->increment('quantity', $item->quantity);
            }

            $order->forceFill(['status' => OrderStatus::CANCELLED, 'payment_status' => 'FAILED', 'stock_reserved_at' => null])->save();
            OrderStatusHistory::create([
                'order_id' => $order->id,
                'from_status' => OrderStatus::PENDING_CONFIRMATION,
                'to_status' => OrderStatus::CANCELLED,
                'changed_by' => $order->buyer_id,
                'reason' => 'PayMongo checkout creation failed.',
            ]);
        });
    }

    private function cartItemsWithSelectedQuantities(Cart $cart, ?array $selections): Collection
    {
        $items = $cart->items()->with('listing.seller.sellerProfile')->get();
        if ($selections === null) {
            return $items;
        }

        $selectedQuantities = collect($selections)->keyBy('cart_item_id');
        abort_unless(
            $selectedQuantities->count() === $items->count()
                && $items->every(fn (CartItem $item): bool => $selectedQuantities->has($item->id)),
            422,
            'Checkout quantities must match the items in your cart.',
        );

        return $items->map(function (CartItem $item) use ($selectedQuantities): CartItem {
            $item->quantity = (int) $selectedQuantities->get($item->id)['quantity'];

            return $item;
        });
    }
}
