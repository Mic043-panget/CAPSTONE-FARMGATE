<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

class UniSmsService
{
    /**
     * Deliver a message using the configured UniSMS sender.
     *
     * The endpoint and payload follow the UniSMS send-message API. Keep this
     * call explicit: a successful response only means the provider accepted
     * the request, not that the handset received it.
     */
    public function send(string $recipient, string $message): void
    {
        $apiKey = trim((string) config('services.unisms.api_key'));
        $senderId = trim((string) config('services.unisms.sender_id'));
        $apiUrl = trim((string) config('services.unisms.api_url'));

        if ($apiKey === '' || $senderId === '' || $apiUrl === '') {
            Log::error('UniSMS is not configured.', [
                'has_api_key' => $apiKey !== '',
                'has_sender_id' => $senderId !== '',
                'has_api_url' => $apiUrl !== '',
            ]);
            throw new UniSmsException('UniSMS is not configured.');
        }

        $this->validateConfiguration($apiUrl, $senderId);
        $recipient = trim($recipient);
        $message = trim($message);

        if (! preg_match('/^\+?[0-9][0-9(). -]{5,28}$/', $recipient)) {
            throw new UniSmsException('The SMS recipient number is invalid.');
        }

        if ($message === '' || mb_strlen($message) > 670 || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', $message)) {
            throw new UniSmsException('The SMS message is invalid.');
        }

        try {
            $response = Http::acceptJson()
                ->withBasicAuth($apiKey, '')
                ->connectTimeout(min(10, max(1, (int) config('services.unisms.timeout', 10))))
                ->timeout(min(30, max(1, (int) config('services.unisms.timeout', 10))))
                ->post($apiUrl, [
                    'recipient' => $recipient,
                    'content' => $message,
                    'sender_id' => $senderId,
                ]);
        } catch (Throwable $exception) {
            // Do not propagate transport exception details: they can include
            // request metadata, and callers only need a safe delivery failure.
            $curlErrorCode = preg_match('/\bcURL error (\d+)\b/i', $exception->getMessage(), $matches)
                ? (int) $matches[1]
                : null;

            Log::warning('UniSMS request failed at the transport layer.', [
                'exception_class' => $exception::class,
                'curl_error_code' => $curlErrorCode,
            ]);
            throw new UniSmsException('UniSMS could not be reached.');
        }

        if (! $response->successful()) {
            Log::warning('UniSMS rejected the SMS request.', [
                'http_status' => $response->status(),
            ]);
            throw new UniSmsException('UniSMS rejected the SMS request.');
        }
    }

    private function validateConfiguration(string $apiUrl, string $senderId): void
    {
        $url = parse_url($apiUrl);

        if (
            ! is_array($url)
            || strtolower((string) ($url['scheme'] ?? '')) !== 'https'
            || empty($url['host'])
            || isset($url['user'])
            || isset($url['pass'])
            || preg_match('/[\r\n]/', $apiUrl)
        ) {
            Log::error('UniSMS configuration is invalid.', ['reason' => 'invalid_api_url']);
            throw new UniSmsException('The UniSMS API URL must be a valid HTTPS URL.');
        }

        if (preg_match('/[\r\n]/', $senderId) || mb_strlen($senderId) > 32) {
            Log::error('UniSMS configuration is invalid.', ['reason' => 'invalid_sender_id']);
            throw new UniSmsException('The UniSMS sender ID is invalid.');
        }
    }
}
