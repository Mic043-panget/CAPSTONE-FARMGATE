<?php

namespace Tests\Unit;

use App\Models\PushSubscription;
use App\Services\FirebaseCloudMessagingSender;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class FirebaseCloudMessagingSenderTest extends TestCase
{
    public function test_it_sends_data_messages_to_fcm_with_a_server_generated_access_token(): void
    {
        $credentialsPath = $this->configureFirebase();
        $this->forgetAccessToken();
        Http::fake([
            'https://oauth2.googleapis.com/token' => Http::response(['access_token' => 'firebase-access-token'], 200),
            'https://fcm.googleapis.com/v1/projects/farmgate-test/messages:send' => Http::response([
                'name' => 'projects/farmgate-test/messages/123',
            ], 200),
        ]);
        $subscription = new PushSubscription;
        $subscription->endpoint_hash = hash('sha256', 'firebase-registration-token');
        $subscription->subscription = ['token' => 'firebase-registration-token'];

        try {
            $result = app(FirebaseCloudMessagingSender::class)->send(collect([$subscription]), [
                'title' => 'Farmgate update',
                'body' => 'An order was updated.',
                'url' => '/#notifications',
                'notification_id' => 'notification-123',
            ]);

            $this->assertSame([
                'successful' => [hash('sha256', 'firebase-registration-token')],
                'expired' => [],
            ], $result);
            Http::assertSent(fn (Request $request): bool => $request->url() === 'https://oauth2.googleapis.com/token'
                && $request->data()['grant_type'] === 'urn:ietf:params:oauth:grant-type:jwt-bearer');
            Http::assertSent(fn (Request $request): bool => $request->url() === 'https://fcm.googleapis.com/v1/projects/farmgate-test/messages:send'
                && $request->hasHeader('Authorization', 'Bearer firebase-access-token')
                && $request->data()['message']['token'] === 'firebase-registration-token'
                && $request->data()['message']['data']['title'] === 'Farmgate update'
                && $request->data()['message']['webpush']['headers']['Urgency'] === 'high'
                && $request->data()['message']['webpush']['headers']['TTL'] === '86400'
                && ! array_key_exists('notification', $request->data()['message']));
        } finally {
            unlink($credentialsPath);
            $this->forgetAccessToken();
        }
    }

    private function configureFirebase(): string
    {
        $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_RSA, 'private_key_bits' => 2048]);
        $this->assertNotFalse($key);
        $this->assertTrue(openssl_pkey_export($key, $privateKey));
        $credentialsPath = tempnam(sys_get_temp_dir(), 'farmgate-firebase-test-');
        $this->assertNotFalse($credentialsPath);
        file_put_contents($credentialsPath, json_encode([
            'client_email' => 'firebase-test@farmgate-test.iam.gserviceaccount.com',
            'private_key' => $privateKey,
        ], JSON_THROW_ON_ERROR));
        config([
            'services.firebase.project_id' => 'farmgate-test',
            'services.firebase.credentials' => $credentialsPath,
        ]);

        return $credentialsPath;
    }

    private function forgetAccessToken(): void
    {
        Cache::forget('firebase-cloud-messaging-access-token-'.hash(
            'sha256',
            'firebase-test@farmgate-test.iam.gserviceaccount.com|farmgate-test',
        ));
    }
}
