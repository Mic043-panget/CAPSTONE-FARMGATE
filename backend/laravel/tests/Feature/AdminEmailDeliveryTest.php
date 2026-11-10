<?php

namespace Tests\Feature;

use App\Exceptions\MailDeliveryException;
use App\Jobs\SendAdminMailConfigurationTest;
use App\Mail\AdminMailConfigurationTest;
use App\Models\MailTestDelivery;
use App\Models\User;
use App\Services\EmailDeliveryConfiguration;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use RuntimeException;
use Tests\TestCase;

class AdminEmailDeliveryTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureSmtp();
    }

    public function test_email_status_is_admin_only_and_never_exposes_smtp_credentials(): void
    {
        config([
            'mail.mailers.smtp.username' => 'private-smtp-user',
            'mail.mailers.smtp.password' => 'private-smtp-password',
            'mail.from.address' => 'notifications@farmgate.test',
        ]);
        $admin = User::factory()->create(['role' => 'ADMIN']);
        $buyer = User::factory()->create(['role' => 'BUYER']);

        $this->getJson('/api/admin/settings/email-delivery')->assertUnauthorized();
        $this->actingAs($buyer)->getJson('/api/admin/settings/email-delivery')->assertForbidden();
        $response = $this->actingAs($admin)->getJson('/api/admin/settings/email-delivery')
            ->assertOk()
            ->assertJsonPath('email.status', 'ready')
            ->assertJsonPath('email.configured', true)
            ->assertJsonPath('can_test', true);

        $response->assertDontSee('private-smtp-user');
        $response->assertDontSee('private-smtp-password');
        $response->assertDontSee('notifications@farmgate.test');
    }

    public function test_unconfigured_mail_is_reported_as_setup_required_and_test_is_rejected(): void
    {
        config(['mail.default' => 'log']);
        $admin = User::factory()->create(['role' => 'ADMIN']);

        $this->actingAs($admin)->getJson('/api/admin/settings/email-delivery')
            ->assertOk()
            ->assertJsonPath('email.status', 'setup_required')
            ->assertJsonPath('email.configured', false)
            ->assertJsonPath('can_test', false);
        $this->actingAs($admin)->postJson('/api/admin/settings/email-delivery/test')
            ->assertUnprocessable()
            ->assertJsonPath('code', 'SMTP_SETUP_REQUIRED');

        $this->assertSame(0, MailTestDelivery::query()->count());
    }

    public function test_test_message_is_queued_only_to_the_authenticated_admins_verified_address(): void
    {
        Queue::fake();
        $admin = User::factory()->create(['role' => 'ADMIN']);

        $response = $this->actingAs($admin)->postJson('/api/admin/settings/email-delivery/test', [
            'email' => 'attacker@example.test',
            'user_id' => 99999,
        ])->assertAccepted()
            ->assertJsonPath('test.status', 'queued');

        $delivery = MailTestDelivery::query()->findOrFail($response->json('test.id'));
        $this->assertSame($admin->id, $delivery->user_id);
        Queue::assertPushed(SendAdminMailConfigurationTest::class, fn (SendAdminMailConfigurationTest $job): bool => $job->deliveryId === $delivery->id);
    }

    public function test_unverified_admin_cannot_request_a_test_message(): void
    {
        Queue::fake();
        $admin = User::factory()->unverified()->create(['role' => 'ADMIN']);

        $this->actingAs($admin)->postJson('/api/admin/settings/email-delivery/test')
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VERIFIED_EMAIL_REQUIRED');
        Queue::assertNothingPushed();
        $this->assertSame(0, MailTestDelivery::query()->count());
    }

    public function test_test_job_delivers_plain_test_message_and_records_outcome(): void
    {
        Mail::fake();
        $admin = User::factory()->create(['role' => 'ADMIN']);
        $delivery = MailTestDelivery::query()->create(['user_id' => $admin->id]);

        (new SendAdminMailConfigurationTest($delivery->id))->handle(app(EmailDeliveryConfiguration::class));

        $this->assertSame('delivered', $delivery->fresh()->status);
        $this->assertSame(1, $delivery->fresh()->attempts);
        Mail::assertSent(AdminMailConfigurationTest::class, function (AdminMailConfigurationTest $mail) use ($admin): bool {
            $this->assertTrue($mail->hasTo($admin->email));
            $this->assertStringContainsString('No account, order, or personal transaction information', $mail->render());

            return true;
        });
    }

    public function test_provider_failure_records_only_exception_class_and_allows_queue_retry(): void
    {
        $admin = User::factory()->create(['role' => 'ADMIN']);
        $delivery = MailTestDelivery::query()->create(['user_id' => $admin->id]);
        $exception = new RuntimeException('provider response includes private body content');
        Mail::shouldReceive('to')->once()->with($admin->email)->andThrow($exception);

        try {
            (new SendAdminMailConfigurationTest($delivery->id))->handle(app(EmailDeliveryConfiguration::class));
            $this->fail('The provider error should be retried by the queue.');
        } catch (RuntimeException $caught) {
            $this->assertInstanceOf(MailDeliveryException::class, $caught);
            $this->assertSame(RuntimeException::class, $caught->providerExceptionClass);
        }

        $this->assertSame('queued', $delivery->fresh()->status);
        $this->assertSame(RuntimeException::class, $delivery->fresh()->last_error);
        $this->assertStringNotContainsString('private body content', $delivery->fresh()->last_error);
        (new SendAdminMailConfigurationTest($delivery->id))->failed($caught);
        $this->assertSame('failed', $delivery->fresh()->status);
    }

    private function configureSmtp(): void
    {
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
}
