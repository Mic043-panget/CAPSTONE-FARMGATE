<?php

namespace App\Http\Controllers\Api;

use App\Enums\ListingStatus;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\Cart;
use App\Models\CartItem;
use App\Models\LivestockListing;
use App\Services\PromotionPricingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class CartController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        abort_unless($request->user()?->role === Role::BUYER, 403);

        $cart = $request->user()->cart()->withTrashed()->with(['items.listing.category'])->first();
        if (! $cart) {
            $cart = $request->user()->cart()->create(['user_id' => $request->user()->id]);
        } elseif ($cart->trashed()) {
            $cart->restore();
        }

        return response()->json($this->payload($cart));
    }

    public function addItem(Request $request): JsonResponse
    {
        abort_unless($request->user()?->role === Role::BUYER, 403);

        $data = $request->validate([
            'listing_id' => ['required', 'integer', 'exists:livestock_listings,id'],
            'quantity' => ['required', 'integer', 'min:1'],
        ]);

        $item = DB::transaction(function () use ($request, $data): CartItem {
            $listing = LivestockListing::query()->lockForUpdate()->findOrFail($data['listing_id']);
            abort_unless($listing->status === ListingStatus::ACTIVE, 409);
            $cart = $request->user()->cart()->withTrashed()->first();
            if (! $cart) {
                $cart = $request->user()->cart()->create(['user_id' => $request->user()->id]);
            } elseif ($cart->trashed()) {
                $cart->restore();
            }
            $existing = $cart->items()->withTrashed()->where('listing_id', $listing->id)->first();
            $existingQuantity = $existing && ! $existing->trashed() ? $existing->quantity : 0;
            abort_if($existingQuantity + $data['quantity'] > $listing->quantity, 422, 'The requested quantity is no longer available.');
            if ($existing) {
                $existing->restore();
                $existing->quantity += $data['quantity'];
                $existing->unit_price = app(PromotionPricingService::class)->unitPrice($listing);
                $existing->save();

                return $existing;
            }

            return $cart->items()->create([
                'listing_id' => $listing->id,
                'quantity' => $data['quantity'],
                'unit_price' => app(PromotionPricingService::class)->unitPrice($listing),
            ]);
        });
        $cart = $item->cart;

        return response()->json([
            'message' => 'Livestock listing added to cart.',
            'cart' => $this->payload($cart),
            'item' => $item,
        ]);
    }

    public function updateItem(Request $request, CartItem $cartItem): JsonResponse
    {
        abort_unless($request->user()?->role === Role::BUYER, 403);
        $cart = $request->user()->cart()->first();
        abort_unless($cart && $cartItem->cart_id === $cart->id, 404);
        $data = $request->validate(['quantity' => ['required', 'integer', 'min:1']]);

        DB::transaction(function () use ($cart, $cartItem, $data): void {
            $item = CartItem::query()->where('cart_id', $cart->id)->lockForUpdate()->findOrFail($cartItem->id);
            $listing = LivestockListing::query()->lockForUpdate()->findOrFail($item->listing_id);
            abort_unless($listing->status === ListingStatus::ACTIVE, 409);
            abort_if($data['quantity'] > $listing->quantity, 422, 'The requested quantity is no longer available.');
            $item->update([
                'quantity' => $data['quantity'],
                'unit_price' => app(PromotionPricingService::class)->unitPrice($listing),
            ]);
        });

        return response()->json($this->payload($cart));
    }

    public function removeItem(Request $request, CartItem $cartItem): JsonResponse
    {
        abort_unless($request->user()?->role === Role::BUYER, 403);
        $cart = $request->user()->cart()->first();
        abort_unless($cart && $cartItem->cart_id === $cart->id, 404);
        $cartItem->delete();

        return response()->json($this->payload($cart));
    }

    private function payload(Cart $cart): array
    {
        $items = $cart->items()->with('listing.category', 'listing.images')->get();
        app(PromotionPricingService::class)->attach($items->pluck('listing')->filter());
        $payloadItems = $items->map(function (CartItem $item): array {
            $listing = $item->listing;
            $unitPrice = $listing
                ? (float) $listing->current_price
                : (float) $item->unit_price;

            return [
                'id' => $item->id,
                'listing_id' => $item->listing_id,
                'quantity' => $item->quantity,
                'unit_price' => $unitPrice,
                'listing' => $listing ? [
                    'id' => $listing->id,
                    'name' => $listing->name,
                    'status' => $listing->status->value,
                    'quantity' => $listing->quantity,
                    'pricing_type' => $listing->pricing_type->value,
                    'original_price' => $listing->original_price,
                    'current_price' => $listing->current_price,
                    'promotion' => $listing->promotion,
                    'category' => $listing->category?->name,
                    'images' => $listing->images->map(fn ($image): array => ['url' => $image->url, 'alt_text' => $image->alt_text]),
                ] : null,
            ];
        });

        return [
            'items' => $payloadItems,
            'subtotal' => $payloadItems->sum(fn (array $item): float => $item['quantity'] * $item['unit_price']),
        ];
    }
}
