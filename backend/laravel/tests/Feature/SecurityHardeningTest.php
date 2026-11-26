<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

class SecurityHardeningTest extends TestCase
{
    use RefreshDatabase;

    public function test_security_headers_are_present_on_api_responses(): void
    {
        $this->getJson('/api/health')
            ->assertOk()
            ->assertHeader('X-Content-Type-Options', 'nosniff')
            ->assertHeader('X-Frame-Options', 'SAMEORIGIN')
            ->assertHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
            ->assertHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
    }

    public function test_auth_routes_are_rate_limited(): void
    {
        $response = null;
        for ($attempt = 0; $attempt < 11; $attempt++) {
            $response = $this->postJson('/api/auth/login', [
                'email' => 'rate-limit@example.com',
                'password' => 'wrong-password',
            ]);
        }

        $response->assertStatus(429);
    }

    public function test_unexpected_api_exceptions_are_sanitized_and_correlated(): void
    {
        Route::get('/api/testing/unexpected-error', static function () {
            throw new \RuntimeException('SQLSTATE[HY000]: private database detail');
        });

        $response = $this->getJson('/api/testing/unexpected-error')
            ->assertStatus(500)
            ->assertJsonPath('message', 'Farmgate could not complete the request. Please try again later.')
            ->assertJsonStructure(['reference_id'])
            ->assertHeader('X-Request-ID');

        $this->assertSame($response->headers->get('X-Request-ID'), $response->json('reference_id'));
        $response->assertDontSee('SQLSTATE');
        $response->assertDontSee('private database detail');
    }

    public function test_api_not_found_response_does_not_expose_route_details(): void
    {
        $this->getJson('/api/this-route-does-not-exist')
            ->assertNotFound()
            ->assertJsonPath('message', 'The requested information could not be found or is no longer available.')
            ->assertDontSee('this-route-does-not-exist');
    }

    public function test_api_validation_errors_keep_their_field_details(): void
    {
        $this->postJson('/api/auth/login', [])
            ->assertUnprocessable()
            ->assertJsonStructure(['message', 'errors']);
    }
}
