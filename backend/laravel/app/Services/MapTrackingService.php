<?php

namespace App\Services;

use App\Services\SystemSettingsService;

class MapTrackingService
{
    public function __construct(private readonly SystemSettingsService $settings) {}

    public function getMapMetadata(float $pickupLat, float $pickupLng, float $riderLat, float $riderLng): array
    {
        return [
            'provider' => 'leaflet-openstreetmap',
            'pickup' => ['latitude' => $pickupLat, 'longitude' => $pickupLng],
            'rider' => ['latitude' => $riderLat, 'longitude' => $riderLng],
            'route' => [
                'distance_km' => round(max(0.1, $this->settings->distanceKm($pickupLat, $pickupLng, $riderLat, $riderLng)), 1),
            ],
        ];
    }
}
