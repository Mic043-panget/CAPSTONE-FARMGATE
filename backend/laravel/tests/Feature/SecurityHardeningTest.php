<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
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
}
