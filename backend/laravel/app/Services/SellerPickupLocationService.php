<?php

namespace App\Services;

use App\Models\SellerProfile;

class SellerPickupLocationService
{
    public const REQUIRED_MESSAGE = 'Save a valid pickup location in Seller Settings → Pickup location before submitting or activating this listing.';

    public function hasValidLocation(int $sellerId, bool $lockForUpdate = false): bool
    {
        $query = SellerProfile::query()->where('user_id', $sellerId);
        if ($lockForUpdate) {
            $query->lockForUpdate();
        }

        $profile = $query->first();
        if (! $profile || ! $profile->pickup_location_confirmed) {
            return false;
        }

        $latitude = $profile->latitude;
        $longitude = $profile->longitude;

        return is_numeric($latitude)
            && is_numeric($longitude)
            && is_finite((float) $latitude)
            && is_finite((float) $longitude)
            && (float) $latitude >= -90
            && (float) $latitude <= 90
            && (float) $longitude >= -180
            && (float) $longitude <= 180
            && ! ((float) $latitude === 0.0 && (float) $longitude === 0.0);
    }

    public function assertValidLocation(int $sellerId, bool $lockForUpdate = false): void
    {
        abort_unless($this->hasValidLocation($sellerId, $lockForUpdate), 422, self::REQUIRED_MESSAGE);
    }
}
