<?php

namespace Tests\Unit;

use App\Services\UniSmsException;
use App\Services\UniSmsService;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

class UniSmsServiceTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        config([
            'services.unisms.api_key' => 'test-api-key',
            'services.unisms.sender_id' => 'FARMGATE',
            'services.unisms.api_url' => 'https://unismsapi.com/api/sms',
            'services.unisms.timeout' => 8,
        ]);
    }

    public function test_it_sends_sms_using_the_configured_unisms_request(): void
    {
        Http::fake([
            'unismsapi.com/*' => Http::response(['message' => ['status' => 'pending']], 201),
        ]);

        app(UniSmsService::class)->send('+639171234567', 'Your verification code is 123456.');

        Http::assertSent(function (Request $request): bool {
            return $request->url() === 'https://unismsapi.com/api/sms'
                && $request->method() === 'POST'
                && $request->hasHeader('Authorization', 'Basic '.base64_encode('test-api-key:'))
                && $request->data() === [
                    'recipient' => '+639171234567',
                    'content' => 'Your verification code is 123456.',
                    'sender_id' => 'FARMGATE',
                ];
        });
    }

    public function test_it_refuses_to_send_when_unisms_is_not_configured(): void
    {
        config(['services.unisms.api_key' => null]);
        Http::fake();

        try {
            app(UniSmsService::class)->send('+639171234567', 'Test message.');
            $this->fail('Expected an unconfigured-provider exception.');
        } catch (UniSmsException $exception) {
            $this->assertSame('UniSMS is not configured.', $exception->getMessage());
        }

        Http::assertNothingSent();
    }

    public function test_it_rejects_invalid_recipients_and_non_https_endpoints(): void
    {
        Http::fake();
        $service = app(UniSmsService::class);

        try {
            $service->send('not-a-phone-number', 'Test message.');
            $this->fail('Expected an invalid-recipient exception.');
        } catch (UniSmsException $exception) {
            $this->assertSame('The SMS recipient number is invalid.', $exception->getMessage());
        }

        config(['services.unisms.api_url' => 'http://unismsapi.com/api/sms']);

        try {
            $service->send('+639171234567', 'Test message.');
            $this->fail('Expected an invalid-endpoint exception.');
        } catch (UniSmsException $exception) {
            $this->assertSame('The UniSMS API URL must be a valid HTTPS URL.', $exception->getMessage());
        }

        Http::assertNothingSent();
    }

    public function test_it_reports_provider_rejections_without_exposing_response_details(): void
    {
        Http::fake([
            'unismsapi.com/*' => Http::response(['error' => 'private provider detail'], 422),
        ]);
        Log::shouldReceive('warning')
            ->once()
            ->with('UniSMS rejected the SMS request.', ['http_status' => 422]);

        try {
            app(UniSmsService::class)->send('+639171234567', 'Test message.');
            $this->fail('Expected a provider-rejection exception.');
        } catch (UniSmsException $exception) {
            $this->assertSame('UniSMS rejected the SMS request.', $exception->getMessage());
            $this->assertStringNotContainsString('private provider detail', $exception->getMessage());
            $this->assertNull($exception->getPrevious());
        }
    }

    public function test_it_logs_only_the_safe_curl_code_for_transport_failures(): void
    {
        Http::fake(fn () => throw new ConnectionException(
            'cURL error 6: Could not resolve host: unismsapi.com',
        ));
        Log::shouldReceive('warning')
            ->once()
            ->with('UniSMS request failed at the transport layer.', [
                'exception_class' => ConnectionException::class,
                'curl_error_code' => 6,
            ]);

        try {
            app(UniSmsService::class)->send('+639171234567', 'Your verification code is 123456.');
            $this->fail('Expected a transport-failure exception.');
        } catch (UniSmsException $exception) {
            $this->assertSame('UniSMS could not be reached.', $exception->getMessage());
            $this->assertNull($exception->getPrevious());
        }
    }
}
