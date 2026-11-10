<?php

namespace Tests\Feature;

use App\Exceptions\MailDeliveryException;
use App\Jobs\SendOrderStatusEmail;
use App\Mail\OrderStatusChangedMail;
use App\Models\Order;
use App\Models\OrderStatusEmailDelivery;
use App\Models\User;
use App\Services\EmailDeliveryConfiguration;
use App\Services\NotificationLinkService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use RuntimeException;
use Tests\TestCase;

class OrderStatusEmailDeliveryTest extends TestCase
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

    public function test_failed_mail_provider_attempt_is_recorded_for_queue_retry_and_outcome_tracking(): void
    {
        $buyer = User::factory()->create(['role' => 'BUYER']);
        $seller = User::factory()->create(['role' => 'SELLER']);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => 'CANCELLED',
            'total_amount' => 100,
        ]);
        $delivery = OrderStatusEmailDelivery::query()->create([
            'order_id' => $order->id,
            'recipient_id' => $buyer->id,
            'order_status' => 'CANCELLED',
        ]);
        $exception = new RuntimeException('Mail provider unavailable.');
        Mail::shouldReceive('to')
            ->once()
            ->with($buyer->email)
            ->andThrow($exception);
        $job = new SendOrderStatusEmail($delivery->id);

        try {
            $job->handle(app(EmailDeliveryConfiguration::class), app(NotificationLinkService::class));
            $this->fail('The provider error should be retried by the queue.');
        } catch (RuntimeException $caught) {
            $this->assertInstanceOf(MailDeliveryException::class, $caught);
            $this->assertSame(RuntimeException::class, $caught->providerExceptionClass);
        }

        $this->assertSame(1, $delivery->fresh()->attempts);
        $job->failed($caught);
        $this->assertDatabaseHas('order_status_email_deliveries', [
            'id' => $delivery->id,
            'delivery_status' => 'FAILED',
            'attempts' => 1,
            'error_code' => RuntimeException::class,
        ]);
    }

    public function test_order_status_email_omits_free_text_reason_and_uses_a_role_scoped_link(): void
    {
        Mail::fake();
        $buyer = User::factory()->create(['role' => 'BUYER']);
        $seller = User::factory()->create(['role' => 'SELLER']);
        $order = Order::create([
            'buyer_id' => $buyer->id,
            'seller_id' => $seller->id,
            'status' => 'CANCELLED',
            'total_amount' => 100,
        ]);
        $delivery = OrderStatusEmailDelivery::query()->create([
            'order_id' => $order->id,
            'recipient_id' => $seller->id,
            'order_status' => 'CANCELLED',
            'reason' => 'Private phone number 09170000000 and exact address.',
        ]);

        (new SendOrderStatusEmail($delivery->id))->handle(
            app(EmailDeliveryConfiguration::class),
            app(NotificationLinkService::class),
        );

        $this->assertSame('SENT', $delivery->fresh()->delivery_status);
        Mail::assertSent(OrderStatusChangedMail::class, function (OrderStatusChangedMail $mail) use ($seller): bool {
            $this->assertTrue($mail->hasTo($seller->email));
            $this->assertSame('View order update', $mail->actionLabel);
            $this->assertStringContainsString('#notifications', $mail->orderUrl);
            $this->assertStringNotContainsString('09170000000', $mail->render());
            $this->assertStringNotContainsString('exact address', $mail->render());

            return true;
        });
    }
}
