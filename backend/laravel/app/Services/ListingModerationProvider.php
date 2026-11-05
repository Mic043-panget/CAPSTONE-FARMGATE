<?php

namespace App\Services;

use App\Models\LivestockListing;

interface ListingModerationProvider
{
    /**
     * @return array<string, mixed>
     */
    public function review(LivestockListing $listing): array;
}
