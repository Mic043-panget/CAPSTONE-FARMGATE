<?php

namespace App\Http\Controllers\Api\Seller;

use App\Enums\ListingStatus;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\LivestockListing;
use App\Models\SellerPromotion;
use App\Models\User;
use App\Services\PromotionPricingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Throwable;

class PromotionController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $seller = $this->seller($request);

        return response()->json([
            'promotions' => SellerPromotion::query()
                ->where('seller_id', $seller->id)
                ->with(['listings:id,name,status,pricing_type,price_per_kilo,price_per_head'])
                ->latest()
                ->paginate(15),
        ]);
    }

    public function eligibleListings(Request $request): JsonResponse
    {
        $seller = $this->seller($request);

        return response()->json([
            'listings' => LivestockListing::query()
                ->where('seller_id', $seller->id)
                ->where('status', ListingStatus::ACTIVE)
                ->select(['id', 'seller_id', 'name', 'status', 'pricing_type', 'price_per_kilo', 'price_per_head'])
                ->orderBy('name')
                ->paginate(100),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $seller = $this->seller($request);
        $data = $this->validated($request);
        $image = $data['image'] ?? null;
        unset($data['image'], $data['remove_image']);
        $imagePath = $image?->storePublicly('promotion-images', 'public');
        if ($image && (! is_string($imagePath) || $imagePath === '')) {
            throw new \RuntimeException('Promotion image storage failed.');
        }

        try {
            $promotion = DB::transaction(function () use ($seller, $data, $imagePath): SellerPromotion {
                User::query()->whereKey($seller->id)->lockForUpdate()->firstOrFail();
                $listingIds = $this->validateListings($seller->id, $data);
                $this->validateFixedDiscount($data, $listingIds, $seller->id);
                $promotion = SellerPromotion::create([
                    'seller_id' => $seller->id,
                    'name' => $data['name'],
                    'description' => $data['description'] ?? null,
                    'image_path' => $imagePath,
                    'discount_type' => $data['discount_type'],
                    'discount_value' => $data['discount_value'],
                    'applies_to_all' => $data['applies_to_all'],
                    'status' => 'DRAFT',
                    'starts_at' => $data['starts_at'],
                    'ends_at' => $data['ends_at'],
                ]);
                $promotion->listings()->sync($data['applies_to_all'] ? [] : $listingIds);
                $this->audit($seller->id, 'seller.promotion.created', $promotion, [
                    'name' => $promotion->name,
                    'description' => $promotion->description,
                    'has_image' => $promotion->image_path !== null,
                    'discount_type' => $promotion->discount_type,
                    'discount_value' => $promotion->discount_value,
                    'applies_to_all' => $promotion->applies_to_all,
                    'listing_ids' => $promotion->applies_to_all ? [] : $listingIds,
                    'starts_at' => $promotion->starts_at,
                    'ends_at' => $promotion->ends_at,
                    'status' => 'DRAFT',
                ]);

                return $promotion;
            });
        } catch (Throwable $exception) {
            if ($imagePath) {
                Storage::disk('public')->delete($imagePath);
            }

            throw $exception;
        }

        return response()->json(['promotion' => $promotion->load('listings:id,name')], 201);
    }

    public function update(Request $request, SellerPromotion $promotion): JsonResponse
    {
        $seller = $this->seller($request);
        abort_unless((int) $promotion->seller_id === (int) $seller->id, 404);
        abort_unless(in_array($promotion->status, ['DRAFT', 'PAUSED', 'ACTIVE'], true), 409, 'This promotion can no longer be edited.');
        $data = $this->validated($request);
        $image = $data['image'] ?? null;
        $removeImage = (bool) ($data['remove_image'] ?? false);
        unset($data['image'], $data['remove_image']);
        $newImagePath = $image?->storePublicly('promotion-images', 'public');
        if ($image && (! is_string($newImagePath) || $newImagePath === '')) {
            throw new \RuntimeException('Promotion image storage failed.');
        }
        $oldImagePath = null;

        try {
            DB::transaction(function () use ($seller, $promotion, $data, $newImagePath, $removeImage, &$oldImagePath): void {
                User::query()->whereKey($seller->id)->lockForUpdate()->firstOrFail();
                $locked = SellerPromotion::query()->where('seller_id', $seller->id)->lockForUpdate()->findOrFail($promotion->id);
                abort_unless(in_array($locked->status, ['DRAFT', 'PAUSED', 'ACTIVE'], true), 409);
                $listingIds = $this->validateListings($seller->id, $data);
                $this->validateFixedDiscount($data, $listingIds, $seller->id);
                $before = [
                    'name' => $locked->name,
                    'description' => $locked->description,
                    'has_image' => $locked->image_path !== null,
                    'discount_type' => $locked->discount_type,
                    'discount_value' => $locked->discount_value,
                    'applies_to_all' => $locked->applies_to_all,
                    'listing_ids' => $locked->listings()->pluck('livestock_listings.id')->all(),
                    'starts_at' => $locked->starts_at,
                    'ends_at' => $locked->ends_at,
                    'status' => $locked->status,
                ];
                $updates = [
                    'name' => $data['name'],
                    'description' => $data['description'] ?? null,
                    'discount_type' => $data['discount_type'],
                    'discount_value' => $data['discount_value'],
                    'applies_to_all' => $data['applies_to_all'],
                    'starts_at' => $data['starts_at'],
                    'ends_at' => $data['ends_at'],
                ];
                if ($newImagePath !== null || $removeImage) {
                    $oldImagePath = $locked->image_path;
                    $updates['image_path'] = $newImagePath;
                }
                $locked->update($updates);
                $locked->listings()->sync($data['applies_to_all'] ? [] : $listingIds);
                if ($locked->status === 'ACTIVE') {
                    $locked->load('listings:id,seller_id,status,pricing_type,price_per_kilo,price_per_head');
                    $this->validateActivation($locked, $seller->id);
                    $this->assertNoOverlap($locked, $seller->id);
                }
                $this->audit($seller->id, 'seller.promotion.updated', $locked, [
                    'name' => $locked->name,
                    'description' => $locked->description,
                    'has_image' => $locked->image_path !== null,
                    'discount_type' => $locked->discount_type,
                    'discount_value' => $locked->discount_value,
                    'applies_to_all' => $locked->applies_to_all,
                    'listing_ids' => $locked->applies_to_all ? [] : $listingIds,
                    'starts_at' => $locked->starts_at,
                    'ends_at' => $locked->ends_at,
                    'status' => $locked->status,
                ], $before);
            });
        } catch (Throwable $exception) {
            if ($newImagePath) {
                Storage::disk('public')->delete($newImagePath);
            }

            throw $exception;
        }
        if ($oldImagePath && $oldImagePath !== $newImagePath) {
            Storage::disk('public')->delete($oldImagePath);
        }

        return response()->json(['promotion' => $promotion->fresh()->load('listings:id,name')]);
    }

    public function destroy(Request $request, SellerPromotion $promotion): JsonResponse
    {
        $seller = $this->seller($request);
        abort_unless((int) $promotion->seller_id === (int) $seller->id, 404);
        abort_unless($promotion->status === 'DRAFT', 409, 'Only draft promotions can be deleted.');
        $imagePath = null;

        DB::transaction(function () use ($seller, $promotion, &$imagePath): void {
            User::query()->whereKey($seller->id)->lockForUpdate()->firstOrFail();
            $locked = SellerPromotion::query()->where('seller_id', $seller->id)->lockForUpdate()->findOrFail($promotion->id);
            abort_unless($locked->status === 'DRAFT', 409);
            $imagePath = $locked->image_path;
            $this->audit($seller->id, 'seller.promotion.deleted', $locked, ['status' => 'DELETED'], ['status' => $locked->status]);
            $locked->delete();
        });
        if ($imagePath) {
            Storage::disk('public')->delete($imagePath);
        }

        return response()->json(['message' => 'Draft promotion deleted.']);
    }

    public function activate(Request $request, SellerPromotion $promotion): JsonResponse
    {
        return $this->transition($request, $promotion, ['DRAFT', 'PAUSED'], 'ACTIVE', 'activated');
    }

    public function pause(Request $request, SellerPromotion $promotion): JsonResponse
    {
        return $this->transition($request, $promotion, ['ACTIVE'], 'PAUSED', 'paused');
    }

    public function end(Request $request, SellerPromotion $promotion): JsonResponse
    {
        return $this->transition($request, $promotion, ['ACTIVE', 'PAUSED'], 'ENDED', 'ended');
    }

    private function transition(Request $request, SellerPromotion $promotion, array $from, string $to, string $action): JsonResponse
    {
        $seller = $this->seller($request);
        abort_unless((int) $promotion->seller_id === (int) $seller->id, 404);

        $updated = DB::transaction(function () use ($seller, $promotion, $from, $to, $action): SellerPromotion {
            User::query()->whereKey($seller->id)->lockForUpdate()->firstOrFail();
            $locked = SellerPromotion::query()
                ->where('seller_id', $seller->id)
                ->with('listings:id,seller_id,status,pricing_type,price_per_kilo,price_per_head')
                ->lockForUpdate()
                ->findOrFail($promotion->id);
            abort_unless(in_array($locked->status, $from, true), 409, 'This promotion cannot make that state transition.');
            if ($to === 'ACTIVE') {
                abort_if($locked->ends_at->lte(now()), 422, 'The promotion end date has passed.');
                $this->validateActivation($locked, $seller->id);
                $this->assertNoOverlap($locked, $seller->id);
            }

            $previousStatus = $locked->status;
            $locked->update(['status' => $to]);
            $this->audit($seller->id, 'seller.promotion.'.$action, $locked, ['status' => $to], ['status' => $previousStatus]);

            return $locked->fresh()->load('listings:id,name');
        });

        return response()->json(['promotion' => $updated]);
    }

    private function validateActivation(SellerPromotion $promotion, int $sellerId): void
    {
        if ($promotion->applies_to_all) {
            $listings = LivestockListing::query()
                ->where('seller_id', $sellerId)
                ->where('status', ListingStatus::ACTIVE)
                ->get();
            abort_if($listings->isEmpty(), 422, 'There are no active listings eligible for this promotion.');
        } else {
            $listings = $promotion->listings;
            abort_if($listings->isEmpty(), 422, 'Choose at least one active listing for this promotion.');
            abort_if($listings->contains(fn (LivestockListing $listing): bool => $listing->status !== ListingStatus::ACTIVE || (int) $listing->seller_id !== $sellerId), 422, 'Promotions can only include your active listings.');
        }

        if ($promotion->discount_type === 'FIXED') {
            foreach ($listings as $listing) {
                $price = PromotionPricingService::toCents($listing->pricing_type->value === 'PER_HEAD' ? $listing->price_per_head : $listing->price_per_kilo);
                abort_if(PromotionPricingService::toCents($promotion->discount_value) > $price, 422, 'The fixed discount cannot exceed the price of an eligible listing.');
            }
        }
    }

    private function assertNoOverlap(SellerPromotion $promotion, int $sellerId): void
    {
        $overlap = SellerPromotion::query()
            ->where('seller_id', $sellerId)
            ->where('status', 'ACTIVE')
            ->whereKeyNot($promotion->id)
            ->where('starts_at', '<=', $promotion->ends_at)
            ->where('ends_at', '>=', $promotion->starts_at)
            ->where(function ($query) use ($promotion): void {
                if ($promotion->applies_to_all) {
                    $query->whereRaw('1 = 1');
                } else {
                    $listingIds = $promotion->listings->modelKeys();
                    $query->where('applies_to_all', true)
                        ->orWhereHas('listings', fn ($listingsQuery) => $listingsQuery->whereIn('livestock_listings.id', $listingIds));
                }
            })
            ->first(['id', 'name']);

        if ($overlap) {
            throw ValidationException::withMessages([
                'starts_at' => "The date range overlaps the active promotion \"{$overlap->name}\" for at least one of these listings.",
            ]);
        }
    }

    private function validateListings(int $sellerId, array $data): array
    {
        if ($data['applies_to_all']) {
            return [];
        }

        $listingIds = array_values(array_unique($data['listing_ids']));
        $count = LivestockListing::query()
            ->where('seller_id', $sellerId)
            ->where('status', ListingStatus::ACTIVE)
            ->whereIn('id', $listingIds)
            ->count();
        if ($count !== count($listingIds)) {
            throw ValidationException::withMessages([
                'listing_ids' => 'Select only your active listings.',
            ]);
        }

        return $listingIds;
    }

    private function validateFixedDiscount(array $data, array $listingIds, int $sellerId): void
    {
        if ($data['discount_type'] !== 'FIXED') {
            return;
        }

        $query = LivestockListing::query()
            ->where('seller_id', $sellerId)
            ->where('status', ListingStatus::ACTIVE);
        if (! $data['applies_to_all']) {
            $query->whereIn('id', $listingIds);
        }
        $discountCents = PromotionPricingService::toCents($data['discount_value']);
        foreach ($query->get() as $listing) {
            $price = PromotionPricingService::toCents($listing->pricing_type->value === 'PER_HEAD' ? $listing->price_per_head : $listing->price_per_kilo);
            if ($discountCents > $price) {
                throw ValidationException::withMessages([
                    'discount_value' => 'The fixed discount cannot exceed the lowest eligible listing price.',
                ]);
            }
        }
    }

    private function validated(Request $request): array
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'description' => ['nullable', 'string', 'max:2000'],
            'image' => ['nullable', 'file', 'image', 'mimes:jpg,jpeg,png,webp', 'max:5120'],
            'remove_image' => ['sometimes', 'boolean'],
            'discount_type' => ['required', Rule::in(['PERCENTAGE', 'FIXED'])],
            'discount_value' => ['required', 'numeric', 'decimal:0,2', 'gt:0', 'max:9999999999.99'],
            'applies_to_all' => ['required', 'boolean'],
            'listing_ids' => ['required_if:applies_to_all,false', 'array', 'min:1', 'max:100'],
            'listing_ids.*' => ['integer', 'distinct', 'exists:livestock_listings,id'],
            'starts_at' => ['required', 'date'],
            'ends_at' => ['required', 'date', 'after:starts_at'],
        ]);

        if ($data['discount_type'] === 'PERCENTAGE' && (float) $data['discount_value'] > 100) {
            throw ValidationException::withMessages(['discount_value' => 'Percentage discounts cannot exceed 100%.']);
        }

        if (now()->parse($data['ends_at'])->lte(now())) {
            throw ValidationException::withMessages(['ends_at' => 'The promotion end date must be in the future.']);
        }

        return $data;
    }

    private function seller(Request $request): User
    {
        abort_unless($request->user()?->role === Role::SELLER, 403);

        return $request->user();
    }

    private function audit(int $sellerId, string $action, SellerPromotion $promotion, array $after, ?array $before = null): void
    {
        $databaseAction = str_contains($action, '.created') ? 'INSERT' : (str_contains($action, '.deleted') ? 'DELETE' : 'UPDATE');
        AuditLog::create([
            'user_id' => $sellerId,
            'action' => $action,
            'method' => 'API',
            'route' => request()->path(),
            'status_code' => str_contains($action, '.created') ? 201 : 200,
            'database_action' => $databaseAction,
            'entity_type' => SellerPromotion::class,
            'entity_id' => $promotion->id,
            'description' => 'Seller promotion '.$action,
            'before_values' => $before,
            'after_values' => $after,
            'changed_fields' => array_values(array_filter(array_keys($after), fn (string $field): bool => $before === null || json_encode($before[$field] ?? null) !== json_encode($after[$field] ?? null))),
        ]);
    }
}
