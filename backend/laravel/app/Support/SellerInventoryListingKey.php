<?php

namespace App\Support;

final class SellerInventoryListingKey
{
    public static function make(int $sellerId, int $listingId): string
    {
        $key = config('app.key');
        $secret = is_string($key) ? $key : '';

        return hash_hmac('sha256', $sellerId.':'.$listingId, $secret);
    }
}
