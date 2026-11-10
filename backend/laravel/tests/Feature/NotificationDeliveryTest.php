<?php

namespace Tests\Feature;

use App\Enums\OrderStatus;
use App\Exceptions\MailDeliveryException;
use App\Jobs\DeliverFarmgateNotificationEmail;
use App\Jobs\DeliverFarmgatePushNotification;
use App\Mail\FarmgateNotificationMail;
use App\Models\NotificationDelivery;
use App\Models\PushSubscription;
use App\Models\User;
use App\Notifications\CalendarEventNotification;
use App\Notifications\OrderCaseUpdatedNotification;
use App\Notifications\OrderStatusChangedNotification;
use App\Notifications\RiderApplicationStatusNotification;
use App\Notifications\SellerPayoutRecordedNotification;
use App\Services\EmailDeliveryConfiguration;
use App\Services\WebPushNotificationSender;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Minishlink\WebPush\MessageSentReport;
use Mockery;
use RuntimeException;
use Tests\TestCase;

class NotificationDeliveryTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'mail.default' => 'smtp',
            'mail.mailers.smtp.scheme' => 'smtp',
            'mail.mailers.smtp.host' => 'smtp.farmgate.test',
            'mail.mailers.smtp.port' => 587,
            'mail.mailers.smtp.username' => 'notifications@farmgate.test',
            'mail.mailers.smtp.password' => 'test-only-password',
            'mail.from.address' => 'notifications@farmgate.test',
        ]);
    }

    public function test_notification_is_deduplicated_and_delivery_statuses_are_visible_only_to_its_owner(): void
    {
        $buyer = User::factory()->create(['role' => 'BUYER']);
        $other = User::factory()->create(['role' => 'SELLER']);
        $notification = new OrderCaseUpdatedNotification(71, 'FG-C-71', 18, 'FG-O-18', 'COMPLAINT', 'A case was updated.');
        Queue::fake();

        $buyer->notify($notification);
        $buyer->notify($notification);

        $this->assertSame(1, $buyer->notifications()->count());
        $this->assertDatabaseHas('notification_deliveries', [
            'notifiable_id' => $buyer->id,
            'channel' => 'email',
            'status' => 'queued',
        ]);
        $this->assertDatabaseHas('notification_deliveries', [
            'notifiable_id' => $buyer->id,
            'channel' => 'push',
            'status' => 'not_configured',
        ]);

        $notificationId = $buyer->notifications()->value('id');
        $this->actingAs($buyer)->getJson('/api/notifications')
            ->assertOk()
            ->assertJsonPath('notifications.0.id', $notificationId)
            ->assertJsonPath('notifications.0.delivery_statuses.0.channel', 'email');

        $other->notify(new CalendarEventNotification(7, 'Market day', 'APPROVED', 'approved', now()->toIso8601String()));
        $this->actingAs($buyer)->getJson('/api/notifications')
            ->assertJsonMissing(['id' => $other->notifications()->value('id')]);
    }

    public function test_optional_event_email_preference_does_not_remove_in_app_notification(): void
    {
        $user = User::factory()->create([
            'role' => 'BUYER',
            'account_preferences' => ['event_notifications' => false],
        ]);

        $user->notify(new CalendarEventNotification(10, 'Community event', 'APPROVED', 'updated', now()->toIso8601String()));

        $this->assertSame(1, $user->notifications()->count());
        $this->assertDatabaseHas('notification_deliveries', [
            'notifiable_id' => $user->id,
            'channel' => 'email',
            'status' => 'skipped',
        ]);
    }

    public function test_email_job_sends_branded_notification_and_marks_delivery(): void
    {
        Mail::fake();
        Queue::fake();
        $user = User::factory()->create(['role' => 'BUYER']);
        $user->notify(new OrderCaseUpdatedNotification(72, 'FG-C-72', 19, 'FG-O-19', 'RETURN_REFUND', 'A refund decision was recorded.'));
        $delivery = NotificationDelivery::query()->where('channel', 'email')->firstOrFail();

        (new DeliverFarmgateNotificationEmail($delivery->id))->handle(app(EmailDeliveryConfiguration::class));

        $this->assertSame('delivered', $delivery->fresh()->status);
        Mail::assertSent(FarmgateNotificationMail::class, function (FarmgateNotificationMail $mail): bool {
            $this->assertSame('View buyer update', $mail->actionLabel);
            $this->assertStringContainsString('notification=', $mail->notificationUrl);
            $this->assertStringContainsString('#notifications', $mail->notificationUrl);
            $this->assertStringNotContainsString('A refund decision was recorded.', $mail->content()->with['notificationMessage']);

            return true;
        });
    }

    public function test_order_confirmation_email_uses_the_reference_and_a_signed_in_record_link(): void
    {
        Mail::fake();
        Queue::fake();
        $buyer = User::factory()->create(['role' => 'BUYER']);
        $buyer->notify(new OrderStatusChangedNotification(205, OrderStatus::CONFIRMED, 'FG-OT-S00043-P00205-Q5BNDYL3X459PCCA'));
        $delivery = NotificationDelivery::query()->where('channel', 'email')->firstOrFail();

        (new DeliverFarmgateNotificationEmail($delivery->id))->handle(app(EmailDeliveryConfiguration::class));

        Mail::assertSent(FarmgateNotificationMail::class, function (FarmgateNotificationMail $mail): bool {
            $content = $mail->content();
            $this->assertSame('FARMGATE update: Order FG-OT-S00043-P00205-Q5BNDYL3X459PCCA confirmed', $mail->envelope()->subject);
            $this->assertSame('View order', $mail->actionLabel);
            $this->assertStringContainsString('The status of your order is now confirmed.', $content->with['notificationMessage']);
            $this->assertStringContainsString('#order/205', $mail->notificationUrl);

            return true;
        });
    }

    public function test_seller_payout_email_uses_a_seller_link_without_exposing_payment_details(): void
    {
        Mail::fake();
        Queue::fake();
        $seller = User::factory()->create(['role' => 'SELLER']);
        $seller->notify(new SellerPayoutRecordedNotification(206, 'FG-OT-206', 123456));
        $delivery = NotificationDelivery::query()->where('channel', 'email')->firstOrFail();

        (new DeliverFarmgateNotificationEmail($delivery->id))->handle(app(EmailDeliveryConfiguration::class));

        Mail::assertSent(FarmgateNotificationMail::class, function (FarmgateNotificationMail $mail): bool {
            $content = $mail->content();
            $this->assertSame('View payout update', $mail->actionLabel);
            $this->assertStringContainsString('payout', strtolower($content->with['title']));
            $this->assertStringContainsString('review its status', $content->with['notificationMessage']);
            $this->assertStringNotContainsString('1234.56', serialize($content->with));

            return true;
        });
    }

    public function test_rider_application_email_uses_generic_safe_update_content(): void
    {
        Mail::fake();
        Queue::fake();
        $rider = User::factory()->create(['role' => 'RIDER']);
        $rider->notify(new RiderApplicationStatusNotification(32, 'FG-RA-32', 'MORE_INFORMATION_REQUIRED', 'Sensitive reviewer note', true));
        $delivery = NotificationDelivery::query()->where('channel', 'email')->firstOrFail();

        (new DeliverFarmgateNotificationEmail($delivery->id))->handle(app(EmailDeliveryConfiguration::class));

        Mail::assertSent(FarmgateNotificationMail::class, function (FarmgateNotificationMail $mail): bool {
            $content = $mail->content();
            $this->assertSame('View application update', $mail->actionLabel);
            $this->assertStringContainsString('rider application', strtolower($content->with['title']));
            $this->assertStringNotContainsString('Sensitive reviewer note', serialize($content->with));

            return true;
        });
    }

    public function test_push_subscription_is_authenticated_encrypted_and_scoped_to_the_current_account(): void
    {
        config([
            'services.webpush.public_key' => 'public',
            'services.webpush.private_key' => 'private',
        ]);
        $buyer = User::factory()->create(['role' => 'BUYER']);
        $other = User::factory()->create(['role' => 'BUYER']);
        $subscription = [
            'endpoint' => 'https://fcm.googleapis.com/fcm/send/opaque-token',
            'keys' => ['p256dh' => 'public-device-key', 'auth' => 'auth-device-key'],
        ];

        $this->getJson('/api/notifications/push-config')->assertUnauthorized();
        $this->actingAs($buyer)->getJson('/api/notifications/push-config')
            ->assertOk()
            ->assertJsonPath('enabled', true)
            ->assertJsonPath('public_key', 'public');
        $this->actingAs($buyer)->postJson('/api/notifications/push-subscriptions', $subscription)
            ->assertCreated();

        $stored = DB::table('push_subscriptions')->where('user_id', $buyer->id)->value('subscription');
        $this->assertStringNotContainsString('fcm.googleapis.com', $stored);
        $this->assertSame(1, $buyer->pushSubscriptions()->count());
        $this->actingAs($other)->deleteJson('/api/notifications/push-subscriptions', ['endpoint' => $subscription['endpoint']])
            ->assertOk();
        $this->assertSame(1, $buyer->pushSubscriptions()->count());
        $this->actingAs($buyer)->deleteJson('/api/notifications/push-subscriptions', ['endpoint' => $subscription['endpoint']])
            ->assertOk();
        $this->assertSame(0, $buyer->pushSubscriptions()->count());
    }

    public function test_push_subscription_rejects_untrusted_endpoint_hosts(): void
    {
        config([
            'services.webpush.public_key' => 'public',
            'services.webpush.private_key' => 'private',
        ]);
        $buyer = User::factory()->create(['role' => 'BUYER']);

        $this->actingAs($buyer)->postJson('/api/notifications/push-subscriptions', [
            'endpoint' => 'https://attacker.example.test/push',
            'keys' => ['p256dh' => 'public-device-key', 'auth' => 'auth-device-key'],
        ])->assertUnprocessable();
        $this->assertSame(0, $buyer->pushSubscriptions()->count());
    }

    public function test_push_job_uses_a_stored_subscription_and_records_success(): void
    {
        Queue::fake();
        config([
            'services.webpush.public_key' => 'public',
            'services.webpush.private_key' => 'private',
        ]);
        $buyer = User::factory()->create(['role' => 'BUYER']);
        PushSubscription::query()->create([
            'user_id' => $buyer->id,
            'endpoint_hash' => hash('sha256', 'https://fcm.googleapis.com/fcm/send/opaque-token'),
            'subscription' => [
                'endpoint' => 'https://fcm.googleapis.com/fcm/send/opaque-token',
                'keys' => ['p256dh' => 'public-device-key', 'auth' => 'auth-device-key'],
                'contentEncoding' => 'aes128gcm',
            ],
        ]);
        $buyer->notify(new OrderCaseUpdatedNotification(74, 'FG-C-74', 21, 'FG-O-21', 'COMPLAINT', 'A case was updated.'));
        $delivery = NotificationDelivery::query()->where('channel', 'push')->firstOrFail();
        $this->assertSame('queued', $delivery->status);

        $report = Mockery::mock(MessageSentReport::class);
        $report->shouldReceive('isSuccess')->once()->andReturn(true);
        $report->shouldReceive('getEndpoint')->once()->andReturn('https://fcm.googleapis.com/fcm/send/opaque-token');
        $sender = Mockery::mock(WebPushNotificationSender::class);
        $sender->shouldReceive('send')->once()->andReturn([$report]);
        $this->app->instance(WebPushNotificationSender::class, $sender);

        (new DeliverFarmgatePushNotification($delivery->id))->handle($sender);

        $this->assertSame('delivered', $delivery->fresh()->status);
        $this->assertNotNull($delivery->fresh()->delivered_at);
    }

    public function test_push_provider_errors_are_retried_and_reported(): void
    {
        Queue::fake();
        config([
            'services.webpush.public_key' => 'public',
            'services.webpush.private_key' => 'private',
        ]);
        $buyer = User::factory()->create(['role' => 'BUYER']);
        PushSubscription::query()->create([
            'user_id' => $buyer->id,
            'endpoint_hash' => hash('sha256', 'https://fcm.googleapis.com/fcm/send/opaque-token'),
            'subscription' => [
                'endpoint' => 'https://fcm.googleapis.com/fcm/send/opaque-token',
                'keys' => ['p256dh' => 'public-device-key', 'auth' => 'auth-device-key'],
            ],
        ]);
        $buyer->notify(new OrderCaseUpdatedNotification(75, 'FG-C-75', 22, 'FG-O-22', 'COMPLAINT', 'A case was updated.'));
        $delivery = NotificationDelivery::query()->where('channel', 'push')->firstOrFail();
        $failure = new RuntimeException('Push gateway unavailable.');
        $sender = Mockery::mock(WebPushNotificationSender::class);
        $sender->shouldReceive('send')->once()->andThrow($failure);
        $job = new DeliverFarmgatePushNotification($delivery->id);

        try {
            $job->handle($sender);
            $this->fail('The provider error should be retried by the queue.');
        } catch (RuntimeException $caught) {
            $this->assertSame($failure, $caught);
        }

        $this->assertSame('queued', $delivery->fresh()->status);
        $this->assertSame(1, $delivery->fresh()->attempts);
        $job->failed($failure);
        $this->assertDatabaseHas('notification_deliveries', [
            'id' => $delivery->id,
            'channel' => 'push',
            'status' => 'failed',
            'last_error' => RuntimeException::class,
        ]);
    }

    public function test_email_provider_failures_are_counted_and_marked_after_retries(): void
    {
        Queue::fake();
        $user = User::factory()->create(['role' => 'BUYER']);
        $user->notify(new OrderCaseUpdatedNotification(73, 'FG-C-73', 20, 'FG-O-20', 'COMPLAINT', 'A case was updated.'));
        $delivery = NotificationDelivery::query()->where('channel', 'email')->firstOrFail();
        $exception = new RuntimeException('Email provider unavailable.');
        Mail::shouldReceive('to')->once()->with($user->email)->andThrow($exception);
        $job = new DeliverFarmgateNotificationEmail($delivery->id);

        try {
            $job->handle(app(EmailDeliveryConfiguration::class));
            $this->fail('The provider error should be retried by the queue.');
        } catch (RuntimeException $caught) {
            $this->assertInstanceOf(MailDeliveryException::class, $caught);
            $this->assertSame(RuntimeException::class, $caught->providerExceptionClass);
        }

        $this->assertSame(1, $delivery->fresh()->attempts);
        $this->assertSame(1, $user->notifications()->count());
        $this->assertSame('not_configured', NotificationDelivery::query()
            ->where('notification_id', $user->notifications()->value('id'))
            ->where('channel', 'push')
            ->value('status'));
        $job->failed($caught);
        $this->assertDatabaseHas('notification_deliveries', [
            'id' => $delivery->id,
            'status' => 'failed',
            'attempts' => 1,
            'last_error' => RuntimeException::class,
        ]);
    }

    public function test_missing_smtp_keeps_in_app_and_push_channels_independent(): void
    {
        config(['mail.default' => 'log']);
        Queue::fake();
        $user = User::factory()->create(['role' => 'BUYER']);

        $user->notify(new OrderCaseUpdatedNotification(74, 'FG-C-74', 21, 'FG-O-21', 'COMPLAINT', 'Private case details.'));

        $this->assertSame(1, $user->notifications()->count());
        $this->assertDatabaseHas('notification_deliveries', [
            'notifiable_id' => $user->id,
            'channel' => 'email',
            'status' => 'not_configured',
        ]);
        $this->assertDatabaseHas('notification_deliveries', [
            'notifiable_id' => $user->id,
            'channel' => 'push',
            'status' => 'not_configured',
        ]);
        Queue::assertNotPushed(DeliverFarmgateNotificationEmail::class);
    }
}
