<?php

namespace App\Http\Controllers\Api;

use App\Enums\ListingStatus;
use App\Http\Controllers\Controller;
use App\Models\LivestockListing;
use App\Models\SellerPromotion;
use App\Services\PromotionPricingService;
use App\Services\SystemSettingsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PromotionPageController extends Controller
{
    public function index(Request $request, SystemSettingsService $settings, PromotionPricingService $pricing): JsonResponse
    {
        $filters = $request->validate([
            'category' => ['nullable', 'in:discounts,special-deals'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);
        $now = now();
        $expirationDays = max(0, $settings->getInt('listing_expiration_days'));
        $promotions = SellerPromotion::query()
            ->with('seller:id,name')
            ->where('status', 'ACTIVE')
            ->where('ends_at', '>=', $now)
            ->when(($filters['category'] ?? null) === 'discounts', fn ($query) => $query->where('discount_type', 'PERCENTAGE'))
            ->when(($filters['category'] ?? null) === 'special-deals', fn ($query) => $query->where('discount_type', 'FIXED'))
            ->where(function ($scope) use ($expirationDays, $now): void {
                $scope->where(function ($all) use ($expirationDays, $now): void {
                    $all->where('applies_to_all', true)
                        ->whereExists(function ($listing) use ($expirationDays, $now): void {
                            $listing->selectRaw('1')
                                ->from('livestock_listings')
                                ->whereColumn('livestock_listings.seller_id', 'seller_promotions.seller_id')
                                ->where('livestock_listings.status', ListingStatus::ACTIVE->value)
                                ->whereNull('livestock_listings.deleted_at')
                                ->when($expirationDays > 0, fn ($query) => $query->where('livestock_listings.created_at', '>=', $now->copy()->subDays($expirationDays)));
                        });
                })->orWhere(function ($selected) use ($expirationDays, $now): void {
                    $selected->where('applies_to_all', false)
                        ->whereExists(function ($pivot) use ($expirationDays, $now): void {
                            $pivot->selectRaw('1')
                                ->from('seller_promotion_listings')
                                ->join('livestock_listings', 'livestock_listings.id', '=', 'seller_promotion_listings.listing_id')
                                ->whereColumn('seller_promotion_listings.promotion_id', 'seller_promotions.id')
                                ->whereColumn('livestock_listings.seller_id', 'seller_promotions.seller_id')
                                ->where('livestock_listings.status', ListingStatus::ACTIVE->value)
                                ->whereNull('livestock_listings.deleted_at')
                                ->when($expirationDays > 0, fn ($query) => $query->where('livestock_listings.created_at', '>=', $now->copy()->subDays($expirationDays)));
                        });
                });
            })
            ->orderBy('starts_at')
            ->orderBy('id')
            ->paginate(12)
            ->withQueryString();

        $promotions->getCollection()->transform(function (SellerPromotion $promotion) use ($now, $pricing, $expirationDays): array {
            $listingsQuery = LivestockListing::query()
                ->where('seller_id', $promotion->seller_id)
                ->where('status', ListingStatus::ACTIVE)
                ->when($expirationDays > 0, fn ($query) => $query->where('created_at', '>=', $now->copy()->subDays($expirationDays)))
                ->with(['images:id,listing_id,url,alt_text']);

            if (! $promotion->applies_to_all) {
                $listingsQuery->whereExists(function ($query) use ($promotion): void {
                    $query->selectRaw('1')
                        ->from('seller_promotion_listings')
                        ->whereColumn('seller_promotion_listings.listing_id', 'livestock_listings.id')
                        ->where('seller_promotion_listings.promotion_id', $promotion->id);
                });
            }

            $listings = $listingsQuery->orderBy('name')->get();
            $pricing->attach($listings);

            return [
                'id' => $promotion->id,
                'name' => $promotion->name,
                'description' => $promotion->description,
                'image_url' => $promotion->image_url,
                'discount_type' => $promotion->discount_type,
                'discount_value' => $promotion->discount_value,
                'starts_at' => $promotion->starts_at->toIso8601String(),
                'ends_at' => $promotion->ends_at->toIso8601String(),
                'status' => $promotion->starts_at->gt($now) ? 'SCHEDULED' : 'ACTIVE',
                'seller' => ['id' => $promotion->seller->id, 'name' => $promotion->seller->name],
                'listings' => $listings->map(fn (LivestockListing $listing): array => [
                    'id' => $listing->id,
                    'name' => $listing->name,
                    'images' => $listing->images->map(fn ($image): array => [
                        'url' => $image->url,
                        'alt_text' => $image->alt_text,
                    ])->values(),
                    'pricing_type' => $listing->pricing_type->value,
                    'original_price' => $listing->original_price,
                    'current_price' => $listing->current_price,
                ])->values(),
            ];
        });

        return response()->json($promotions);
    }

    public function show(SellerPromotion $promotion, SystemSettingsService $settings, PromotionPricingService $pricing): JsonResponse
    {
        $now = now();
        $expirationDays = max(0, $settings->getInt('listing_expiration_days'));
        abort_unless(
            $promotion->status === 'ACTIVE'
                && $promotion->ends_at->gte($now)
                && $this->hasEligibleListings($promotion, $expirationDays),
            404,
        );

        $listingsQuery = LivestockListing::query()
            ->where('seller_id', $promotion->seller_id)
            ->where('status', ListingStatus::ACTIVE)
            ->when($expirationDays > 0, fn ($query) => $query->where('created_at', '>=', $now->copy()->subDays($expirationDays)))
            ->with(['images:id,listing_id,url,alt_text']);

        if (! $promotion->applies_to_all) {
            $listingsQuery->whereExists(function ($query) use ($promotion): void {
                $query->selectRaw('1')
                    ->from('seller_promotion_listings')
                    ->whereColumn('seller_promotion_listings.listing_id', 'livestock_listings.id')
                    ->where('seller_promotion_listings.promotion_id', $promotion->id);
            });
        }

        $listings = $listingsQuery->orderBy('name')->get();
        $pricing->attach($listings);
        $scheduled = $promotion->starts_at->gt($now);

        return response()->json(['promotion' => [
            'id' => $promotion->id,
            'name' => $promotion->name,
            'description' => $promotion->description,
            'image_url' => $promotion->image_url,
            'discount_type' => $promotion->discount_type,
            'discount_value' => $promotion->discount_value,
            'applies_to_all' => $promotion->applies_to_all,
            'starts_at' => $promotion->starts_at->toIso8601String(),
            'ends_at' => $promotion->ends_at->toIso8601String(),
            'status' => $scheduled ? 'SCHEDULED' : 'ACTIVE',
            'seller' => $promotion->seller()->select(['id', 'name'])->first(['id', 'name']),
            'listings' => $listings->map(fn (LivestockListing $listing): array => [
                'id' => $listing->id,
                'name' => $listing->name,
                'description' => $listing->description,
                'pricing_type' => $listing->pricing_type->value,
                'original_price' => $listing->original_price,
                'current_price' => $listing->current_price,
                'images' => $listing->images->map(fn ($image): array => [
                    'url' => $image->url,
                    'alt_text' => $image->alt_text,
                ])->values(),
            ])->values(),
        ]]);
    }

    private function hasEligibleListings(SellerPromotion $promotion, int $expirationDays): bool
    {
        return LivestockListing::query()
            ->where('seller_id', $promotion->seller_id)
            ->where('status', ListingStatus::ACTIVE)
            ->when($expirationDays > 0, fn ($query) => $query->where('created_at', '>=', now()->subDays($expirationDays)))
            ->when(! $promotion->applies_to_all, function ($query) use ($promotion): void {
                $query->whereExists(function ($pivot) use ($promotion): void {
                    $pivot->selectRaw('1')
                        ->from('seller_promotion_listings')
                        ->whereColumn('seller_promotion_listings.listing_id', 'livestock_listings.id')
                        ->where('seller_promotion_listings.promotion_id', $promotion->id);
                });
            })
            ->exists();
    }
}
