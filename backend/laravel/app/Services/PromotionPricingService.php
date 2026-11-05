<?php

namespace App\Services;

use App\Models\LivestockListing;
use App\Models\SellerPromotion;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;

class PromotionPricingService
{
    /**
     * Attach the current display price and its applicable promotion to listings.
     *
     * @param  Collection<int, LivestockListing>  $listings
     */
    public function attach(Collection $listings): void
    {
        if ($listings->isEmpty()) {
            return;
        }

        $now = now();
        $sellerIds = $listings->pluck('seller_id')->unique()->values();
        $listingIds = $listings->pluck('id')->values();
        $promotions = SellerPromotion::query()
            ->with('listings:id')
            ->whereIn('seller_id', $sellerIds)
            ->where('status', 'ACTIVE')
            ->where('starts_at', '<=', $now)
            ->where('ends_at', '>=', $now)
            ->where(function ($query) use ($listingIds): void {
                $query->where('applies_to_all', true)
                    ->orWhereHas('listings', fn ($listingsQuery) => $listingsQuery->whereIn('livestock_listings.id', $listingIds));
            })
            ->orderBy('id')
            ->get();

        foreach ($listings as $listing) {
            $promotion = $promotions->first(function (SellerPromotion $candidate) use ($listing): bool {
                return (int) $candidate->seller_id === (int) $listing->seller_id
                    && ($candidate->applies_to_all || $candidate->listings->contains('id', $listing->id));
            });
            $basePrice = self::toCents($listing->pricing_type->value === 'PER_HEAD' ? $listing->price_per_head : $listing->price_per_kilo);
            $effectivePrice = $this->discountedPrice($basePrice, $promotion);

            $listing->setAttribute('original_price', self::fromCents($basePrice));
            $listing->setAttribute('current_price', self::fromCents($effectivePrice));
            $listing->setAttribute('promotion', $promotion ? [
                'id' => $promotion->id,
                'name' => $promotion->name,
                'description' => $promotion->description,
                'image_url' => $promotion->image_url,
                'discount_type' => $promotion->discount_type,
                'discount_value' => $promotion->discount_value,
                'ends_at' => $promotion->ends_at,
            ] : null);
        }
    }

    public function unitPrice(LivestockListing $listing, bool $lockPromotion = false): string
    {
        $basePrice = self::toCents($listing->pricing_type->value === 'PER_HEAD' ? $listing->price_per_head : $listing->price_per_kilo);
        $now = now();
        $query = SellerPromotion::query()
            ->where('seller_id', $listing->seller_id)
            ->where('status', 'ACTIVE')
            ->where('starts_at', '<=', $now)
            ->where('ends_at', '>=', $now)
            ->where(function ($builder) use ($listing): void {
                $builder->where('applies_to_all', true)
                    ->orWhereHas('listings', fn ($listingsQuery) => $listingsQuery->whereKey($listing->id));
            })
            ->orderBy('id');
        if ($lockPromotion) {
            $query->lockForUpdate();
        }

        return self::fromCents($this->discountedPrice($basePrice, $query->first()));
    }

    public static function toCents(string|int|float|null $amount): int
    {
        $amount = trim((string) $amount);
        $negative = str_starts_with($amount, '-');
        $amount = ltrim($amount, '+-');
        [$whole, $fraction] = array_pad(explode('.', $amount, 2), 2, '0');
        $cents = ((int) $whole * 100) + (int) str_pad(substr($fraction, 0, 2), 2, '0');

        return $negative ? -$cents : $cents;
    }

    public static function fromCents(int $cents): string
    {
        $absolute = abs($cents);
        $value = intdiv($absolute, 100).'.'.str_pad((string) ($absolute % 100), 2, '0', STR_PAD_LEFT);

        return $cents < 0 ? '-'.$value : $value;
    }

    public static function multiplyCents(int $unitPriceCents, int $quantity): int
    {
        if ($quantity < 0 || ($quantity > 0 && $unitPriceCents > intdiv(PHP_INT_MAX, $quantity))) {
            throw ValidationException::withMessages([
                'quantity' => 'The requested order amount exceeds the supported limit.',
            ]);
        }

        return $unitPriceCents * $quantity;
    }

    public static function addCents(int $currentCents, int $additionalCents): int
    {
        if ($additionalCents < 0 || $currentCents > PHP_INT_MAX - $additionalCents) {
            throw ValidationException::withMessages([
                'quantity' => 'The requested order amount exceeds the supported limit.',
            ]);
        }

        return $currentCents + $additionalCents;
    }

    public static function percentageOfCents(int $amountCents, string|int|float $percentage): int
    {
        $percentageCents = self::toCents($percentage);
        if ($percentageCents < 0 || ($percentageCents > 0 && $amountCents > intdiv(PHP_INT_MAX - 5_000, $percentageCents))) {
            throw ValidationException::withMessages([
                'amount' => 'The requested order amount exceeds the supported limit.',
            ]);
        }

        return intdiv(($amountCents * $percentageCents) + 5_000, 10_000);
    }

    private function discountedPrice(int $basePriceCents, ?SellerPromotion $promotion): int
    {
        if (! $promotion) {
            return $basePriceCents;
        }

        $discountCents = self::toCents($promotion->discount_value);
        if ($promotion->discount_type === 'PERCENTAGE') {
            // A percentage of 15.25% is stored as 1,525 hundredths of a percent.
            $discountCents = self::percentageOfCents($basePriceCents, $promotion->discount_value);
        }

        return max(0, $basePriceCents - $discountCents);
    }
}
