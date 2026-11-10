<?php

namespace App\Http\Controllers\Api;

use App\Enums\ListingStatus;
use App\Enums\ReviewStatus;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\LivestockListing;
use App\Models\Review;
use App\Models\SellerPromotion;
use App\Models\User;
use App\Services\PromotionPricingService;
use App\Services\SystemSettingsService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class PublicSellerShopController extends Controller
{
    public function show(Request $request, User $seller, SystemSettingsService $settings, PromotionPricingService $pricing): JsonResponse
    {
        abort_unless($seller->role === Role::SELLER, 404);
        $filters = $request->validate([
            'search' => ['nullable', 'string', 'max:120'],
            'category_id' => ['nullable', 'integer', 'min:1'],
            'sort' => ['nullable', Rule::in(['newest', 'oldest', 'price_asc', 'price_desc', 'popular'])],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);
        $expirationDays = max(0, $settings->getInt('listing_expiration_days'));
        $listings = LivestockListing::query()
            ->with(['category:id,name,slug', 'images:id,listing_id,url,alt_text'])
            ->where('seller_id', $seller->id)
            ->where('status', ListingStatus::ACTIVE)
            ->where('quantity', '>', 0)
            ->when($expirationDays > 0, fn (Builder $query) => $query->where('created_at', '>=', now()->subDays($expirationDays)))
            ->when(isset($filters['category_id']), fn (Builder $query) => $query->where('category_id', $filters['category_id']))
            ->when(filled($filters['search'] ?? null), function (Builder $query) use ($filters): void {
                $term = trim($filters['search']);
                $query->where(function (Builder $search) use ($term): void {
                    $search->where('name', 'like', "%{$term}%")
                        ->orWhere('breed', 'like', "%{$term}%")
                        ->orWhere('description', 'like', "%{$term}%");
                });
            });

        if (($filters['sort'] ?? 'newest') === 'popular') {
            $listings->withCount('interests');
        }
        match ($filters['sort'] ?? 'newest') {
            'oldest' => $listings->orderBy('created_at')->orderBy('id'),
            'price_asc' => $listings->orderByRaw('COALESCE(price_per_head, price_per_kilo) ASC')->orderByDesc('id'),
            'price_desc' => $listings->orderByRaw('COALESCE(price_per_head, price_per_kilo) DESC')->orderByDesc('id'),
            'popular' => $listings->orderByDesc('interests_count')->orderByDesc('created_at')->orderByDesc('id'),
            default => $listings->latest()->orderByDesc('id'),
        };
        $listings = $listings->paginate(12)->withQueryString();
        $pricing->attach($listings->getCollection());

        $promotionsQuery = SellerPromotion::query()
            ->where('seller_id', $seller->id)
            ->where('status', 'ACTIVE')
            ->where('ends_at', '>=', now())
            ->where(function (Builder $scope) use ($seller, $expirationDays): void {
                $scope->where(function (Builder $all) use ($seller, $expirationDays): void {
                    $all->where('applies_to_all', true)
                        ->whereExists(function ($eligible) use ($seller, $expirationDays): void {
                            $eligible->selectRaw('1')
                                ->from('livestock_listings')
                                ->whereColumn('livestock_listings.seller_id', 'seller_promotions.seller_id')
                                ->where('livestock_listings.seller_id', $seller->id)
                                ->where('livestock_listings.status', ListingStatus::ACTIVE->value)
                                ->where('livestock_listings.quantity', '>', 0)
                                ->whereNull('livestock_listings.deleted_at')
                                ->when($expirationDays > 0, fn ($query) => $query->where('livestock_listings.created_at', '>=', now()->subDays($expirationDays)));
                        });
                })->orWhere(function (Builder $selected) use ($seller, $expirationDays): void {
                    $selected->where('applies_to_all', false)
                        ->whereExists(function ($eligible) use ($seller, $expirationDays): void {
                            $eligible->selectRaw('1')
                                ->from('seller_promotion_listings')
                                ->join('livestock_listings', 'livestock_listings.id', '=', 'seller_promotion_listings.listing_id')
                                ->whereColumn('seller_promotion_listings.promotion_id', 'seller_promotions.id')
                                ->where('livestock_listings.seller_id', $seller->id)
                                ->where('livestock_listings.status', ListingStatus::ACTIVE->value)
                                ->where('livestock_listings.quantity', '>', 0)
                                ->whereNull('livestock_listings.deleted_at')
                                ->when($expirationDays > 0, fn ($query) => $query->where('livestock_listings.created_at', '>=', now()->subDays($expirationDays)));
                        });
                });
            })
            ->with('seller:id,name')
            ->orderBy('starts_at')
            ->orderBy('id')
            ->get()
            ->map(fn (SellerPromotion $promotion): array => [
                'id' => $promotion->id,
                'name' => $promotion->name,
                'description' => $promotion->description,
                'image_url' => $promotion->image_url,
                'discount_type' => $promotion->discount_type,
                'discount_value' => $promotion->discount_value,
                'starts_at' => $promotion->starts_at->toIso8601String(),
                'ends_at' => $promotion->ends_at->toIso8601String(),
                'status' => $promotion->starts_at->gt(now()) ? 'SCHEDULED' : 'ACTIVE',
            ])->values();

        $reviewsQuery = Review::query()
            ->where('seller_id', $seller->id)
            ->where('status', ReviewStatus::PUBLISHED);
        $reviews = (clone $reviewsQuery)
            ->with('buyer:id,name')
            ->latest()
            ->paginate(6, ['id', 'buyer_id', 'rating', 'comment', 'created_at'], 'reviews_page')
            ->withQueryString();
        $reviews->getCollection()->transform(fn (Review $review): array => [
            'reference' => $review->review_reference,
            'rating' => $review->rating,
            'comment' => $review->comment,
            'buyer_name' => $review->buyer?->name ?? 'Buyer',
            'created_at' => $review->created_at?->toIso8601String(),
        ]);

        $profile = $seller->sellerProfile()->first(['business_name', 'is_verified']);
        $categories = LivestockListing::query()
            ->join('categories', 'categories.id', '=', 'livestock_listings.category_id')
            ->where('livestock_listings.seller_id', $seller->id)
            ->where('livestock_listings.status', ListingStatus::ACTIVE)
            ->where('livestock_listings.quantity', '>', 0)
            ->when($expirationDays > 0, fn (Builder $query) => $query->where('livestock_listings.created_at', '>=', now()->subDays($expirationDays)))
            ->select('categories.id', 'categories.name', 'categories.slug')
            ->distinct()
            ->orderBy('categories.name')
            ->get();

        return response()->json([
            'seller' => [
                'id' => $seller->id,
                'name' => $seller->name,
                'business_name' => $profile?->business_name,
                'is_verified' => (bool) ($profile?->is_verified ?? false),
            ],
            'listings' => $listings,
            'categories' => $categories,
            'promotions' => $promotionsQuery,
            'rating_average' => round((float) ((clone $reviewsQuery)->avg('rating') ?? 0), 1),
            'review_count' => (clone $reviewsQuery)->count(),
            'reviews' => $reviews,
        ]);
    }
}
