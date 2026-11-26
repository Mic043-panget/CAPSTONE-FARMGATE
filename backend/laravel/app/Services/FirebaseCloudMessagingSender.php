<?php

namespace App\Services;

use App\Models\PushSubscription;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use JsonException;
use RuntimeException;

class FirebaseCloudMessagingSender
{
    /**
     * @param  iterable<PushSubscription>  $subscriptions
     * @param  array<string, mixed>  $payload
     * @return array{successful: list<string>, expired: list<string>}
     */
    public function send(iterable $subscriptions, array $payload): array
    {
        $successful = [];
        $expired = [];
        $accessToken = $this->accessToken();
        $projectId = (string) config('services.firebase.project_id');
        $data = [];
        foreach ($payload as $key => $value) {
            if (is_scalar($value)) {
                $data[$key] = (string) $value;
            }
        }

        foreach ($subscriptions as $storedSubscription) {
            $token = $storedSubscription->subscription['token'] ?? null;
            if (! is_string($token) || $token === '') {
                throw new RuntimeException('An FCM subscription has no registration token.');
            }

            $response = Http::acceptJson()
                ->withToken($accessToken)
                ->timeout(10)
                ->post(
                    'https://fcm.googleapis.com/v1/projects/'.rawurlencode($projectId).'/messages:send',
                    [
                        'message' => [
                            'token' => $token,
                            'data' => $data,
                            'webpush' => [
                                'headers' => [
                                    'TTL' => '86400',
                                    'Urgency' => 'high',
                                ],
                            ],
                        ],
                    ],
                );

            if ($response->successful()) {
                $successful[] = $storedSubscription->endpoint_hash;
            } elseif ($this->isUnregisteredToken($response)) {
                $expired[] = $storedSubscription->endpoint_hash;
            } else {
                throw new RuntimeException('Firebase Cloud Messaging rejected a notification request with HTTP '.$response->status().'.');
            }
        }

        return ['successful' => $successful, 'expired' => $expired];
    }

    public static function isConfigured(): bool
    {
        $credentials = self::serviceAccount();
        $web = config('services.firebase.web');

        return is_array($credentials)
            && filled($credentials['client_email'] ?? null)
            && filled($credentials['private_key'] ?? null)
            && filled(config('services.firebase.project_id'))
            && is_array($web)
            && filled($web['api_key'] ?? null)
            && filled($web['auth_domain'] ?? null)
            && filled($web['project_id'] ?? null)
            && $web['project_id'] === config('services.firebase.project_id')
            && filled($web['messaging_sender_id'] ?? null)
            && filled($web['app_id'] ?? null)
            && filled($web['vapid_key'] ?? null);
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function browserConfig(): ?array
    {
        if (! self::isConfigured()) {
            return null;
        }

        $web = config('services.firebase.web');

        $config = [
            'apiKey' => $web['api_key'],
            'authDomain' => $web['auth_domain'],
            'projectId' => $web['project_id'],
            'messagingSenderId' => $web['messaging_sender_id'],
            'appId' => $web['app_id'],
        ];
        if (filled($web['storage_bucket'] ?? null)) {
            $config['storageBucket'] = $web['storage_bucket'];
        }

        return $config;
    }

    private function accessToken(): string
    {
        $credentials = self::serviceAccount();
        if (! is_array($credentials)
            || ! filled($credentials['client_email'] ?? null)
            || ! filled($credentials['private_key'] ?? null)) {
            throw new RuntimeException('Firebase service-account credentials are not configured.');
        }

        $cacheKey = 'firebase-cloud-messaging-access-token-'.hash('sha256', $credentials['client_email'].'|'.config('services.firebase.project_id'));

        return Cache::remember(
            $cacheKey,
            now()->addMinutes(55),
            function () use ($credentials): string {
                $now = time();
                $claims = [
                    'iss' => $credentials['client_email'],
                    'scope' => 'https://www.googleapis.com/auth/firebase.messaging',
                    'aud' => 'https://oauth2.googleapis.com/token',
                    'iat' => $now,
                    'exp' => $now + 3600,
                ];
                $unsignedToken = $this->base64Url(json_encode(['alg' => 'RS256', 'typ' => 'JWT'], JSON_THROW_ON_ERROR))
                    .'.'.$this->base64Url(json_encode($claims, JSON_THROW_ON_ERROR));
                $privateKey = openssl_pkey_get_private($credentials['private_key']);
                if ($privateKey === false || ! openssl_sign($unsignedToken, $signature, $privateKey, OPENSSL_ALGO_SHA256)) {
                    throw new RuntimeException('Firebase service-account signing failed.');
                }

                $response = Http::asForm()
                    ->acceptJson()
                    ->timeout(10)
                    ->post('https://oauth2.googleapis.com/token', [
                        'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                        'assertion' => $unsignedToken.'.'.$this->base64Url($signature),
                    ]);
                if (! $response->successful() || ! filled($response->json('access_token'))) {
                    throw new RuntimeException('Firebase access-token request failed with HTTP '.$response->status().'.');
                }

                return (string) $response->json('access_token');
            },
        );
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function serviceAccount(): ?array
    {
        $path = config('services.firebase.credentials');
        if (! is_string($path) || $path === '') {
            return null;
        }

        $resolvedPath = str_starts_with($path, DIRECTORY_SEPARATOR) ? $path : base_path($path);
        if (! is_readable($resolvedPath)) {
            return null;
        }

        try {
            $credentials = json_decode((string) file_get_contents($resolvedPath), true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            return null;
        }

        return is_array($credentials) ? $credentials : null;
    }

    private function base64Url(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private function isUnregisteredToken(Response $response): bool
    {
        if ($response->status() === 404) {
            return true;
        }

        foreach ((array) $response->json('error.details', []) as $detail) {
            if (is_array($detail) && ($detail['errorCode'] ?? null) === 'UNREGISTERED') {
                return true;
            }
        }

        return false;
    }
}
