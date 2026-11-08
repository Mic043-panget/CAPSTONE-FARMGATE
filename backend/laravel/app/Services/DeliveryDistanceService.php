<?php

namespace App\Services;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;

class DeliveryDistanceService
{
    private const ROUTING_URL = 'https://router.project-osrm.org/route/v1/driving/';

    /**
     * @param  array<string, mixed>  $sellerLocation
     * @param  array<string, mixed>  $buyerLocation
     * @return array{distance_km: float, method: 'OSRM_ROAD_ROUTE'|'OSRM_BARANGAY_ESTIMATE', pickup_coordinates: array{latitude: float, longitude: float}, delivery_coordinates: array{latitude: float, longitude: float}}
     */
    public function calculate(array $sellerLocation, array $buyerLocation): array
    {
        $seller = $this->validCoordinates($sellerLocation);
        $buyer = $this->validCoordinates($buyerLocation);

        if ($seller === null) {
            $seller = $this->resolveBarangay($sellerLocation, 'seller pickup');
            $buyer = $this->resolveBarangay($buyerLocation, 'buyer delivery');

            return $this->route($seller, $buyer, 'OSRM_BARANGAY_ESTIMATE');
        }

        if ($buyer === null) {
            throw ValidationException::withMessages([
                'delivery_location' => 'A valid delivery map pin is required. Verify or update the buyer delivery location and try again.',
            ]);
        }

        return $this->route($seller, $buyer, 'OSRM_ROAD_ROUTE');
    }

    /**
     * @param  array{latitude: float, longitude: float}  $from
     * @param  array{latitude: float, longitude: float}  $to
     * @param  'OSRM_ROAD_ROUTE'|'OSRM_BARANGAY_ESTIMATE'  $method
     * @return array{distance_km: float, method: 'OSRM_ROAD_ROUTE'|'OSRM_BARANGAY_ESTIMATE', pickup_coordinates: array{latitude: float, longitude: float}, delivery_coordinates: array{latitude: float, longitude: float}}
     */
    private function route(array $from, array $to, string $method): array
    {
        $url = self::ROUTING_URL.sprintf(
            '%.7F,%.7F;%.7F,%.7F',
            $from['longitude'],
            $from['latitude'],
            $to['longitude'],
            $to['latitude'],
        );

        try {
            $response = Http::acceptJson()
                ->timeout(8)
                ->get($url, ['overview' => 'false', 'alternatives' => 'false', 'steps' => 'false']);
        } catch (ConnectionException $exception) {
            Log::warning('Delivery road routing request failed.', [
                'exception_class' => $exception::class,
            ]);

            throw $this->unavailableRoute($method === 'OSRM_BARANGAY_ESTIMATE');
        }

        $meters = $response->json('routes.0.distance');
        if (! $response->successful()
            || $response->json('code') !== 'Ok'
            || ! is_numeric($meters)
            || ! is_finite((float) $meters)
            || (float) $meters < 0) {
            Log::warning('Delivery road routing returned no valid route.', [
                'http_status' => $response->status(),
                'route_code' => is_string($response->json('code')) ? $response->json('code') : null,
            ]);

            throw $this->unavailableRoute($method === 'OSRM_BARANGAY_ESTIMATE');
        }

        return [
            'distance_km' => round((float) $meters / 1000, 2),
            'method' => $method,
            'pickup_coordinates' => $from,
            'delivery_coordinates' => $to,
        ];
    }

    /**
     * @param  array<string, mixed>  $location
     * @return array{latitude: float, longitude: float}|null
     */
    private function validCoordinates(array $location): ?array
    {
        $latitude = $location['latitude'] ?? null;
        $longitude = $location['longitude'] ?? null;

        if (! is_numeric($latitude)
            || ! is_numeric($longitude)
            || ! is_finite((float) $latitude)
            || ! is_finite((float) $longitude)
            || (float) $latitude < -90
            || (float) $latitude > 90
            || (float) $longitude < -180
            || (float) $longitude > 180) {
            return null;
        }

        return ['latitude' => (float) $latitude, 'longitude' => (float) $longitude];
    }

    /**
     * @param  array<string, mixed>  $location
     * @return array{latitude: float, longitude: float}
     */
    private function resolveBarangay(array $location, string $locationDescription): array
    {
        $barangay = $this->locationName($location, ['pickup_barangay', 'barangay']);
        $municipality = $this->locationName($location, ['pickup_city_municipality', 'city_municipality']);
        $province = $this->locationName($location, ['pickup_province', 'province']);

        if ($barangay === null || $municipality === null || $province === null) {
            throw ValidationException::withMessages([
                'delivery_location' => "The {$locationDescription} pin is missing or invalid, and its barangay, municipality or city, and province are incomplete. Verify or update the location details and try again.",
            ]);
        }

        $cacheKey = 'farmgate.delivery_barangay.'.hash('sha256', mb_strtolower(implode('|', [$barangay, $municipality, $province])));
        $coordinates = Cache::get($cacheKey);
        if (! is_array($coordinates)) {
            $coordinates = $this->lookupBarangay($barangay, $municipality, $province);
            if ($coordinates !== null) {
                Cache::put($cacheKey, $coordinates, now()->addDays(30));
            }
        }

        if ($coordinates === null) {
            throw ValidationException::withMessages([
                'delivery_location' => "The {$locationDescription} barangay could not be verified in the selected municipality and province. Correct the barangay, municipality or city, and province, then try again.",
            ]);
        }

        return $coordinates;
    }

    /**
     * @return array{latitude: float, longitude: float}|null
     */
    private function lookupBarangay(string $barangay, string $municipality, string $province): ?array
    {
        try {
            $response = Http::acceptJson()
                ->withHeaders(['User-Agent' => 'Farmgate Delivery Distance/1.0 ('.config('app.url').')'])
                ->timeout(6)
                ->get('https://nominatim.openstreetmap.org/search', [
                    'q' => "{$barangay}, {$municipality}, {$province}, Philippines",
                    'format' => 'jsonv2',
                    'addressdetails' => 1,
                    'limit' => 5,
                    'countrycodes' => 'ph',
                ]);
        } catch (ConnectionException $exception) {
            Log::warning('Delivery barangay lookup request failed.', [
                'exception_class' => $exception::class,
            ]);

            throw $this->unresolvedBarangay();
        }

        if (! $response->successful() || ! is_array($response->json())) {
            Log::warning('Delivery barangay lookup returned an invalid response.', [
                'http_status' => $response->status(),
            ]);

            throw $this->unresolvedBarangay();
        }

        foreach ($response->json() as $result) {
            if (! is_array($result)) {
                continue;
            }

            $address = is_array($result['address'] ?? null) ? $result['address'] : [];
            if (! $this->addressContains($address, ['city_district', 'suburb', 'neighbourhood', 'village', 'locality', 'quarter', 'hamlet'], $barangay)
                || ! $this->addressContains($address, ['city', 'town', 'municipality', 'county', 'state_district'], $municipality)
                || ! $this->addressContains($address, ['state', 'province', 'county', 'state_district'], $province)
                || mb_strtolower((string) ($address['country'] ?? '')) !== 'philippines') {
                continue;
            }

            $coordinates = $this->validCoordinates([
                'latitude' => $result['lat'] ?? null,
                'longitude' => $result['lon'] ?? null,
            ]);
            if ($coordinates !== null) {
                return $coordinates;
            }
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $location
     * @param  list<string>  $keys
     */
    private function locationName(array $location, array $keys): ?string
    {
        foreach ($keys as $key) {
            $value = $location[$key] ?? null;
            if (is_string($value) && trim($value) !== '') {
                return trim($value);
            }
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $address
     * @param  list<string>  $keys
     */
    private function addressContains(array $address, array $keys, string $expected): bool
    {
        $expected = $this->normalizeLocationName($expected);
        foreach ($keys as $key) {
            $value = $address[$key] ?? null;
            if (is_string($value) && $this->normalizeLocationName($value) === $expected) {
                return true;
            }
        }

        return false;
    }

    private function normalizeLocationName(string $value): string
    {
        $value = mb_strtolower(trim($value));
        $value = preg_replace('/^(?:barangay|brgy\.?|municipality of|city of|province of)\s*/u', '', $value) ?? $value;
        $value = preg_replace('/\s+(?:municipality|province)$/u', '', $value) ?? $value;

        return preg_replace('/[^a-z0-9]+/u', '', $value) ?? '';
    }

    private function unresolvedBarangay(): ValidationException
    {
        return ValidationException::withMessages([
            'delivery_location' => 'A barangay location could not be verified. Correct the seller or buyer barangay, municipality or city, and province, then try again.',
        ]);
    }

    private function unavailableRoute(bool $barangayEstimate): ValidationException
    {
        return ValidationException::withMessages([
            'delivery_location' => $barangayEstimate
                ? 'The barangay-level road distance is unavailable. Verify or update the seller and buyer barangay, municipality or city, and province, then try again.'
                : 'Road distance is unavailable for these locations. Verify or update the seller pickup pin and buyer delivery pin, then try again.',
        ]);
    }
}
