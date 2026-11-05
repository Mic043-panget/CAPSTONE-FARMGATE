<?php

namespace App\Http\Controllers\Api;

use App\Enums\ListingStatus;
use App\Enums\PricingType;
use App\Enums\ReviewStatus;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Jobs\ModerateListing;
use App\Models\Category;
use App\Models\LivestockListing;
use App\Models\Review;
use App\Models\User;
use App\Services\PromotionPricingService;
use App\Services\SystemSettingsService;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class ListingController extends Controller
{
    public function index(Request $request, SystemSettingsService $settings, PromotionPricingService $promotionPricing): JsonResponse
    {
        $query = LivestockListing::query()
            ->with(['category', 'images', 'seller:id,name'])
            ->where('status', ListingStatus::ACTIVE);
        if ($request->boolean('promotions')) {
            $now = now();
            $query->whereExists(function ($promotionQuery) use ($now): void {
                $promotionQuery->selectRaw('1')
                    ->from('seller_promotions')
                    ->whereColumn('seller_promotions.seller_id', 'livestock_listings.seller_id')
                    ->where('seller_promotions.status', 'ACTIVE')
                    ->where('seller_promotions.starts_at', '<=', $now)
                    ->where('seller_promotions.ends_at', '>=', $now)
                    ->where(function ($scopeQuery): void {
                        $scopeQuery->where('seller_promotions.applies_to_all', true)
                            ->orWhereExists(function ($selectedQuery): void {
                                $selectedQuery->selectRaw('1')
                                    ->from('seller_promotion_listings')
                                    ->whereColumn('seller_promotion_listings.promotion_id', 'seller_promotions.id')
                                    ->whereColumn('seller_promotion_listings.listing_id', 'livestock_listings.id');
                            });
                    });
            });
        }

        $expirationDays = max(0, $settings->getInt('listing_expiration_days'));
        if ($expirationDays > 0) {
            $query->where('created_at', '>=', now()->subDays($expirationDays));
        }

        if ($request->filled('q')) {
            $term = trim((string) $request->q);
            $query->where(function ($listingQuery) use ($term): void {
                $listingQuery->where('name', 'like', "%{$term}%")
                    ->orWhere('breed', 'like', "%{$term}%")
                    ->orWhere('description', 'like', "%{$term}%");
            });
        }

        if ($request->filled('category_id')) {
            $query->where('category_id', (int) $request->category_id);
        }

        if ($request->filled('pricing_type')) {
            $pricingType = $request->pricing_type;
            abort_unless(in_array($pricingType, array_map(fn (PricingType $type): string => $type->value, PricingType::cases()), true), 422);
            $query->where('pricing_type', $pricingType);
        }

        if ($request->filled('min_price')) {
            $minPrice = (float) $request->min_price;
            $query->where(function ($priceQuery) use ($minPrice): void {
                $priceQuery->where(function ($q) use ($minPrice): void {
                    $q->where('pricing_type', PricingType::PER_HEAD)
                        ->where('price_per_head', '>=', $minPrice);
                })->orWhere(function ($q) use ($minPrice): void {
                    $q->where('pricing_type', PricingType::PER_KILO)
                        ->where('price_per_kilo', '>=', $minPrice);
                });
            });
        }

        if ($request->filled('max_price')) {
            $maxPrice = (float) $request->max_price;
            $query->where(function ($priceQuery) use ($maxPrice): void {
                $priceQuery->where(function ($q) use ($maxPrice): void {
                    $q->where('pricing_type', PricingType::PER_HEAD)
                        ->where('price_per_head', '<=', $maxPrice);
                })->orWhere(function ($q) use ($maxPrice): void {
                    $q->where('pricing_type', PricingType::PER_KILO)
                        ->where('price_per_kilo', '<=', $maxPrice);
                });
            });
        }

        $sort = strtolower((string) ($request->input('sort', 'newest')));
        $allowedSorts = ['newest', 'oldest', 'price_asc', 'price_desc', 'popular'];
        abort_unless(in_array($sort, $allowedSorts, true), 422);

        if ($sort === 'popular') {
            $query->withCount('interests');
        }

        match ($sort) {
            'newest' => $query->orderByDesc('created_at')->orderByDesc('id'),
            'oldest' => $query->orderBy('created_at')->orderBy('id'),
            'price_asc' => $query->orderByRaw('COALESCE(price_per_head, price_per_kilo) ASC')->orderByDesc('id'),
            'price_desc' => $query->orderByRaw('COALESCE(price_per_head, price_per_kilo) DESC')->orderByDesc('id'),
            'popular' => $query->orderByDesc('interests_count')->orderByDesc('created_at')->orderByDesc('id'),
        };

        $listings = $query->paginate(15)->appends($request->query());
        $promotionPricing->attach($listings->getCollection());

        return response()->json($listings);
    }

    public function show(LivestockListing $listing, SystemSettingsService $settings, PromotionPricingService $promotionPricing): JsonResponse
    {
        abort_unless($listing->status === ListingStatus::ACTIVE, 404);

        $expirationDays = max(0, $settings->getInt('listing_expiration_days'));
        if ($expirationDays > 0 && $listing->created_at->lt(now()->subDays($expirationDays))) {
            abort(404);
        }

        $listing->load(['category', 'images', 'seller:id,name']);
        $related = LivestockListing::query()
            ->with(['category', 'images', 'seller:id,name'])
            ->where('status', ListingStatus::ACTIVE)
            ->where('category_id', $listing->category_id)
            ->whereKeyNot($listing->id)
            ->latest()
            ->limit(4)
            ->get();
        $promotionPricing->attach(collect([$listing])->concat($related));
        $reviewQuery = Review::query()
            ->where('status', ReviewStatus::PUBLISHED)
            ->whereHas('order.items', fn ($query) => $query->where('listing_id', $listing->id));
        $reviews = (clone $reviewQuery)
            ->with('buyer:id,name')
            ->latest()
            ->limit(12)
            ->get()
            ->map(fn (Review $review): array => [
                'rating' => $review->rating,
                'comment' => $review->comment,
                'buyer_name' => $review->buyer?->name ?? 'Buyer',
                'created_at' => $review->created_at,
            ]);

        return response()->json([
            'listing' => $listing,
            'related' => $related,
            'rating_average' => round((float) ((clone $reviewQuery)->avg('rating') ?? 0), 1),
            'review_count' => (clone $reviewQuery)->count(),
            'reviews' => $reviews,
        ]);
    }

    public function mine(Request $request): JsonResponse
    {
        abort_unless($request->user()?->role === Role::SELLER, 403);

        $filters = $request->validate([
            'q' => ['nullable', 'string', 'max:120'],
            'sort' => ['nullable', Rule::in(['name', 'category', 'price', 'quantity', 'status'])],
            'direction' => ['nullable', Rule::in(['asc', 'desc'])],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);
        $query = $request->user()->livestockListings()->with(['category', 'images']);
        $term = trim((string) ($filters['q'] ?? ''));
        if ($term !== '') {
            $query->where(function ($listingQuery) use ($term): void {
                $listingQuery->where('name', 'like', "%{$term}%")
                    ->orWhereHas('category', fn ($categoryQuery) => $categoryQuery->where('name', 'like', "%{$term}%"));
            });
        }

        $sort = $filters['sort'] ?? 'created_at';
        $direction = $filters['direction'] ?? 'desc';
        match ($sort) {
            'name' => $query->orderBy('name', $direction),
            'category' => $query->orderBy(Category::query()->select('name')->whereColumn('categories.id', 'livestock_listings.category_id'), $direction),
            'price' => $query->orderByRaw('COALESCE(price_per_head, price_per_kilo) '.strtoupper($direction)),
            'quantity' => $query->orderBy('quantity', $direction),
            'status' => $query->orderBy('status', $direction),
            default => $query->orderByDesc('created_at'),
        };
        $query->orderByDesc('id');

        return response()->json(['listings' => $query->paginate(15)->appends($request->query())]);
    }

    public function store(Request $request, SystemSettingsService $settings): JsonResponse
    {
        abort_unless($request->user()?->role === Role::SELLER, 403);
        if ($settings->getBoolean('seller_verification_required')) {
            $profile = $request->user()->sellerProfile()->first();
            abort_unless($profile && $profile->is_verified, 403, 'Seller verification is required before creating listings.');
        }
        $data = $this->validated($request, $settings);
        $images = $data['images'] ?? [];
        $imageFiles = $data['image_files'] ?? [];
        unset($data['images'], $data['image_files']);
        $storedPaths = [];

        try {
            $listing = DB::transaction(function () use ($request, $data, $images, $imageFiles, &$storedPaths): LivestockListing {
                $listing = $request->user()->livestockListings()->create($data + ['status' => ListingStatus::DRAFT]);
                $this->saveListingImages($listing, $images, $imageFiles, $storedPaths);

                return $listing->load(['category', 'images']);
            });
        } catch (\Throwable $exception) {
            Storage::disk('public')->delete($storedPaths);
            throw $exception;
        }

        return response()->json(['listing' => $listing], 201);
    }

    public function update(Request $request, LivestockListing $listing, SystemSettingsService $settings): JsonResponse
    {
        abort_unless($request->user()?->role === Role::SELLER && $listing->seller_id === $request->user()->id, 403);
        abort_unless(in_array($listing->status, [ListingStatus::DRAFT, ListingStatus::REJECTED], true), 409);

        $data = $this->validated($request, $settings);
        $imagesProvided = array_key_exists('images', $data) || array_key_exists('image_files', $data);
        $images = $data['images'] ?? [];
        $imageFiles = $data['image_files'] ?? [];
        unset($data['images'], $data['image_files']);
        $storedPaths = [];
        try {
            DB::transaction(function () use ($request, $listing, $data, $imagesProvided, $images, $imageFiles, &$storedPaths): void {
                $locked = LivestockListing::query()->lockForUpdate()->findOrFail($listing->id);
                abort_unless($locked->seller_id === $request->user()->id, 403);
                abort_unless(in_array($locked->status, [ListingStatus::DRAFT, ListingStatus::REJECTED], true), 409);
                $locked->update($data);
                if ($imagesProvided) {
                    $locked->images()->delete();
                    $this->saveListingImages($locked, $images, $imageFiles, $storedPaths);
                }
            });
        } catch (\Throwable $exception) {
            Storage::disk('public')->delete($storedPaths);
            throw $exception;
        }

        return response()->json(['listing' => $listing->refresh()->load(['category', 'images'])]);
    }

    public function destroy(Request $request, LivestockListing $listing): JsonResponse
    {
        abort_unless($request->user()?->role === Role::SELLER && $listing->seller_id === $request->user()->id, 403);

        DB::transaction(function () use ($request, $listing): void {
            $locked = LivestockListing::query()->lockForUpdate()->findOrFail($listing->id);
            abort_unless($locked->seller_id === $request->user()->id, 403);
            abort_unless(in_array($locked->status, [ListingStatus::DRAFT, ListingStatus::REJECTED], true), 409);
            $locked->delete();
        });

        return response()->json(['message' => 'Listing deleted.']);
    }

    public function cancel(Request $request, LivestockListing $listing): JsonResponse
    {
        abort_unless($request->user()?->role === Role::SELLER && $listing->seller_id === $request->user()->id, 403);

        DB::transaction(function () use ($request, $listing): void {
            $locked = LivestockListing::query()->lockForUpdate()->findOrFail($listing->id);
            abort_unless($locked->seller_id === $request->user()->id, 403);
            abort_unless(in_array($locked->status, [ListingStatus::ACTIVE, ListingStatus::PENDING_REVIEW], true), 409, 'Only active or pending listings can be cancelled.');
            $locked->update(['status' => ListingStatus::DRAFT]);
        });

        return response()->json([
            'message' => 'Listing cancelled and returned to drafts.',
            'listing' => $listing->refresh()->load(['category', 'images']),
        ]);
    }

    public function submit(Request $request, LivestockListing $listing, SystemSettingsService $settings): JsonResponse
    {
        abort_unless($request->user()?->role === Role::SELLER && $listing->seller_id === $request->user()->id, 403);
        abort_unless(in_array($listing->status, [ListingStatus::DRAFT, ListingStatus::REJECTED], true), 409);

        $this->assertActiveListingLimit($listing->seller_id, $settings, $listing->id);

        if ($settings->getBoolean('seller_listing_approval_required')) {
            DB::transaction(function () use ($listing): void {
                $locked = LivestockListing::query()->lockForUpdate()->findOrFail($listing->id);
                abort_unless(in_array($locked->status, [ListingStatus::DRAFT, ListingStatus::REJECTED], true), 409);
                $locked->update(['status' => ListingStatus::PENDING_REVIEW]);
            });
            ModerateListing::dispatch($listing->id)->onConnection('database')->afterCommit();
            $listing->refresh();

            return response()->json(['listing' => $listing]);
        }

        DB::transaction(function () use ($request, $listing, $settings): void {
            $locked = LivestockListing::query()->lockForUpdate()->findOrFail($listing->id);
            abort_unless($locked->seller_id === $request->user()->id, 403);
            abort_unless(in_array($locked->status, [ListingStatus::DRAFT, ListingStatus::REJECTED], true), 409);
            User::query()->lockForUpdate()->findOrFail($locked->seller_id);
            $this->assertActiveListingLimit($locked->seller_id, $settings, $locked->id);
            $locked->update(['status' => ListingStatus::ACTIVE]);
        });
        $listing->refresh();

        return response()->json(['listing' => $listing]);
    }

    public function review(Request $request, LivestockListing $listing, SystemSettingsService $settings): JsonResponse
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
        $data = $request->validate(['status' => ['required', Rule::in([ListingStatus::ACTIVE->value, ListingStatus::REJECTED->value, ListingStatus::DISABLED->value])]]);
        abort_unless($listing->status === ListingStatus::PENDING_REVIEW, 409);

        if ($data['status'] === ListingStatus::ACTIVE->value) {
            $this->assertActiveListingLimit($listing->seller_id, $settings, $listing->id);
        }

        $listing->update(['status' => $data['status']]);

        return response()->json(['listing' => $listing]);
    }

    private function assertActiveListingLimit(int $sellerId, SystemSettingsService $settings, ?int $excludeListingId = null): void
    {
        $limit = max(0, $settings->getInt('maximum_active_listings'));
        $activeCount = LivestockListing::query()
            ->where('seller_id', $sellerId)
            ->where('status', ListingStatus::ACTIVE)
            ->when($excludeListingId !== null, fn ($query) => $query->whereKeyNot($excludeListingId))
            ->count();

        if ($activeCount >= $limit) {
            abort(422, 'Maximum active listings reached.');
        }
    }

    private function validated(Request $request, SystemSettingsService $settings): array
    {
        $data = $request->validate([
            'category_id' => ['required', 'integer', 'exists:categories,id'],
            'name' => ['required', 'string', 'max:180'],
            'breed' => ['nullable', 'string', 'max:120'],
            'sex' => ['nullable', 'string', 'max:20'],
            'age_months' => ['nullable', 'integer', 'min:0', 'max:600'],
            'estimated_weight_kg' => ['nullable', 'numeric', 'gt:0'],
            'quantity' => ['required', 'integer', 'min:'.$settings->getInt('minimum_livestock_quantity'), 'max:'.$settings->getInt('maximum_livestock_quantity')],
            'description' => ['nullable', 'string', 'max:5000'],
            'pickup_location' => ['nullable', 'string', 'max:500'],
            'health_information' => ['nullable', 'string', 'max:3000'],
            'vaccination_information' => ['nullable', 'string', 'max:3000'],
            'pricing_type' => ['required', Rule::enum(PricingType::class)],
            'price_per_kilo' => ['nullable', 'numeric', 'gt:0', 'required_if:pricing_type,'.PricingType::PER_KILO->value],
            'price_per_head' => ['nullable', 'numeric', 'gt:0', 'required_if:pricing_type,'.PricingType::PER_HEAD->value],
            'images' => ['nullable', 'array', 'max:5'],
            'images.*' => ['url:http,https', 'max:2048'],
            'image_files' => ['nullable', 'array', 'max:5'],
            'image_files.*' => ['file', 'image', 'mimes:jpg,jpeg,png,webp', 'max:5120'],
        ]);

        if (count($data['images'] ?? []) + count($data['image_files'] ?? []) > 5) {
            throw ValidationException::withMessages([
                'image_files' => 'A listing can have at most five photos.',
            ]);
        }

        return $data;
    }

    /**
     * @param  array<int, string>  $urls
     * @param  array<int, UploadedFile>  $files
     * @param  array<int, string>  $storedPaths
     */
    private function saveListingImages(LivestockListing $listing, array $urls, array $files, array &$storedPaths): void
    {
        foreach ($urls as $index => $url) {
            $listing->images()->create(['url' => $url, 'sort_order' => $index]);
        }

        foreach ($files as $index => $file) {
            $path = $file->storePublicly('listing-images', 'public');
            if (! is_string($path) || $path === '') {
                throw new \RuntimeException('Listing photo storage failed.');
            }
            $storedPaths[] = $path;
            /** @var FilesystemAdapter $publicDisk */
            $publicDisk = Storage::disk('public');
            $listing->images()->create([
                'url' => $publicDisk->url($path),
                'sort_order' => count($urls) + $index,
            ]);
        }
    }
}
