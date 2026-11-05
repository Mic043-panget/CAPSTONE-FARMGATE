<?php

namespace App\Services;

use App\Models\Order;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use RuntimeException;

class OrderReferenceGenerator
{
    private const RANDOM_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

    public function generate(int $sellerId, array $listingIds = []): string
    {
        $listingIds = array_values(array_unique(array_filter(
            array_map('intval', $listingIds),
            fn (int $id): bool => $id > 0,
        )));
        sort($listingIds, SORT_NUMERIC);
        $listingRows = collect();

        if ($listingIds !== []) {
            $listingRows = DB::table('livestock_listings as listings')
                ->leftJoin('categories', 'categories.id', '=', 'listings.category_id')
                ->whereIn('listings.id', $listingIds)
                ->orderBy('listings.id')
                ->get([
                    'listings.id',
                    'listings.category_id',
                    'categories.reference_code',
                ]);

            if ($listingRows->count() !== count($listingIds)) {
                throw new RuntimeException('An order reference cannot be generated for an unknown listing.');
            }
        }

        $categoryIds = $listingRows->pluck('category_id')->unique()->values();
        $categoryCodes = $listingRows
            ->pluck('reference_code')
            ->map(fn ($code): string => is_string($code) && preg_match('/^[A-Z]{2}$/', $code) === 1 ? $code : 'OT')
            ->values();
        $categoryCode = $categoryIds->count() > 1 ? 'MX' : ($categoryCodes->first() ?? 'OT');
        $productId = (int) ($listingRows->first()->id ?? 0);
        $sellerCode = 'S'.str_pad((string) max(0, $sellerId), 5, '0', STR_PAD_LEFT);
        $productCode = 'P'.str_pad((string) $productId, 5, '0', STR_PAD_LEFT);

        for ($attempt = 0; $attempt < 10; $attempt++) {
            $reference = sprintf('FG-%s-%s-%s-%s', $categoryCode, $sellerCode, $productCode, $this->randomCode());

            if (! Order::withTrashed()->where('order_reference', $reference)->exists()) {
                return $reference;
            }
        }

        throw new RuntimeException('A unique order reference could not be generated.');
    }

    public function createOrder(array $attributes, int $sellerId, array $listingIds): Order
    {
        for ($attempt = 0; $attempt < 10; $attempt++) {
            $order = new Order($attributes);
            $order->order_reference = $this->generate($sellerId, $listingIds);

            try {
                $order->save();

                return $order;
            } catch (QueryException $exception) {
                if (! $this->isReferenceUniqueViolation($exception) || $attempt === 9) {
                    throw $exception;
                }
            }
        }

        throw new RuntimeException('A unique order reference could not be generated.');
    }

    private function randomCode(): string
    {
        $code = '';
        $maxIndex = strlen(self::RANDOM_ALPHABET) - 1;

        for ($index = 0; $index < 16; $index++) {
            $code .= self::RANDOM_ALPHABET[random_int(0, $maxIndex)];
        }

        return $code;
    }

    private function isReferenceUniqueViolation(QueryException $exception): bool
    {
        $message = strtolower($exception->getMessage());

        return str_contains($message, 'order_reference')
            && in_array((string) ($exception->errorInfo[0] ?? ''), ['23000', '23505'], true);
    }
}
