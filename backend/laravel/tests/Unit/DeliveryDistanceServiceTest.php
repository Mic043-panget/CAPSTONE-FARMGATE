<?php

namespace Tests\Unit;

use App\Services\DeliveryDistanceService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class DeliveryDistanceServiceTest extends TestCase
{
    public function test_route_distance_converts_meters_to_kilometers_with_longitude_latitude_order(): void
    {
        Http::fake([
            'https://router.project-osrm.org/*' => Http::response([
                'code' => 'Ok',
                'routes' => [['distance' => 143200]],
            ]),
        ]);

        $result = app(DeliveryDistanceService::class)->calculate(
            ['latitude' => 12.7771, 'longitude' => 121.3654],
            ['latitude' => 12.7321, 'longitude' => 121.3821],
        );

        $this->assertSame(143.2, $result['distance_km']);
        $this->assertSame('OSRM_ROAD_ROUTE', $result['method']);
        Http::assertSent(fn ($request): bool => str_contains(
            $request->url(),
            '/121.3654000,12.7771000;121.3821000,12.7321000',
        ));
    }

    public function test_identical_valid_coordinates_are_still_resolved_by_the_road_router(): void
    {
        Http::fake([
            'https://router.project-osrm.org/*' => Http::response([
                'code' => 'Ok',
                'routes' => [['distance' => 0]],
            ]),
        ]);

        $result = app(DeliveryDistanceService::class)->calculate(
            ['latitude' => 12.7771, 'longitude' => 121.3654],
            ['latitude' => 12.7771, 'longitude' => 121.3654],
        );

        $this->assertSame(0.0, $result['distance_km']);
        $this->assertSame('OSRM_ROAD_ROUTE', $result['method']);
        Http::assertSentCount(1);
    }

    public function test_invalid_coordinates_are_rejected_without_using_a_distance_fallback(): void
    {
        Http::fake();

        try {
            app(DeliveryDistanceService::class)->calculate(
                ['latitude' => 91, 'longitude' => 121],
                ['latitude' => 12, 'longitude' => 121],
            );
            $this->fail('Invalid coordinates should be rejected.');
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey('delivery_location', $exception->errors());
        }

        Http::assertNothingSent();
    }

    public function test_unavailable_road_route_is_rejected_without_using_a_distance_estimate(): void
    {
        Http::fake([
            'https://router.project-osrm.org/*' => Http::response(['code' => 'NoRoute', 'routes' => []]),
        ]);

        try {
            app(DeliveryDistanceService::class)->calculate(
                ['latitude' => 12.7771, 'longitude' => 121.3654],
                ['latitude' => 12.7321, 'longitude' => 121.3821],
            );
            $this->fail('A missing road route must not be estimated.');
        } catch (ValidationException $exception) {
            $this->assertStringContainsString('Road distance is unavailable', $exception->errors()['delivery_location'][0]);
        }

        Http::assertSentCount(1);
    }

    public function test_routing_service_errors_are_rejected_without_using_a_distance_estimate(): void
    {
        Http::fake([
            'https://router.project-osrm.org/*' => Http::response(['message' => 'Unavailable'], 503),
        ]);

        try {
            app(DeliveryDistanceService::class)->calculate(
                ['latitude' => 12.7771, 'longitude' => 121.3654],
                ['latitude' => 12.7321, 'longitude' => 121.3821],
            );
            $this->fail('A routing service error must not be estimated.');
        } catch (ValidationException $exception) {
            $this->assertStringContainsString('Road distance is unavailable', $exception->errors()['delivery_location'][0]);
        }

        Http::assertSentCount(1);
    }

    public function test_missing_coordinates_are_rejected_without_calling_the_router(): void
    {
        Http::fake();

        try {
            app(DeliveryDistanceService::class)->calculate(
                ['latitude' => null, 'longitude' => null],
                ['latitude' => 12.7321, 'longitude' => 121.3821],
            );
            $this->fail('Missing coordinates must be rejected.');
        } catch (ValidationException $exception) {
            $this->assertStringContainsString(
                'pin is missing or invalid',
                $exception->errors()['delivery_location'][0],
            );
        }

        Http::assertNothingSent();
    }

    public function test_missing_seller_pin_uses_verified_barangay_points_and_osrm_road_distance(): void
    {
        Cache::flush();
        Http::fake(function ($request) {
            if (str_contains($request->url(), 'nominatim.openstreetmap.org')) {
                $barangay = str_contains(urldecode($request->url()), 'Poblacion') ? 'Poblacion' : 'Tuno';

                return Http::response([[
                    'lat' => $barangay === 'Poblacion' ? '12.7771' : '12.7321',
                    'lon' => $barangay === 'Poblacion' ? '121.3654' : '121.3821',
                    'address' => [
                        'suburb' => $barangay,
                        'city' => 'Bongabong',
                        'state' => 'Oriental Mindoro',
                        'country' => 'Philippines',
                    ],
                ]]);
            }

            return Http::response(['code' => 'Ok', 'routes' => [['distance' => 6432]]]);
        });

        $result = app(DeliveryDistanceService::class)->calculate(
            [
                'latitude' => null,
                'longitude' => null,
                'pickup_barangay' => 'Poblacion',
                'pickup_city_municipality' => 'Bongabong',
                'pickup_province' => 'Oriental Mindoro',
            ],
            [
                'latitude' => 12.7321,
                'longitude' => 121.3821,
                'barangay' => 'Tuno',
                'city_municipality' => 'Bongabong',
                'province' => 'Oriental Mindoro',
            ],
        );

        $this->assertSame(6.43, $result['distance_km']);
        $this->assertSame('OSRM_BARANGAY_ESTIMATE', $result['method']);
        Http::assertSentCount(3);
        Http::assertSent(fn ($request): bool => str_contains(
            $request->url(),
            '/121.3654000,12.7771000;121.3821000,12.7321000',
        ));
    }

    public function test_unverified_barangay_match_blocks_checkout_without_routing(): void
    {
        Cache::flush();
        Http::fake([
            'https://nominatim.openstreetmap.org/*' => Http::response([[
                'lat' => '12.7771',
                'lon' => '121.3654',
                'address' => [
                    'suburb' => 'A different barangay',
                    'city' => 'Bongabong',
                    'state' => 'Oriental Mindoro',
                    'country' => 'Philippines',
                ],
            ]]),
            'https://router.project-osrm.org/*' => Http::response(['code' => 'Ok', 'routes' => [['distance' => 6432]]]),
        ]);

        try {
            app(DeliveryDistanceService::class)->calculate(
                [
                    'latitude' => null,
                    'longitude' => null,
                    'pickup_barangay' => 'Poblacion',
                    'pickup_city_municipality' => 'Bongabong',
                    'pickup_province' => 'Oriental Mindoro',
                ],
                [
                    'barangay' => 'Tuno',
                    'city_municipality' => 'Bongabong',
                    'province' => 'Oriental Mindoro',
                ],
            );
            $this->fail('A barangay mismatch must not be used to calculate a fee.');
        } catch (ValidationException $exception) {
            $this->assertStringContainsString('could not be verified', $exception->errors()['delivery_location'][0]);
        }

        Http::assertSentCount(1);
    }
}
