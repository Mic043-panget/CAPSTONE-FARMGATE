<?php

namespace Tests\Feature;

use App\Jobs\SendOrderStatusEmail;
use App\Models\Order;
use App\Models\OrderStatusEmailDelivery;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use RuntimeException;
use Tests\TestCase;

class OrderStatusEmailDeliveryTest extends TestCase
{
    use RefreshDatabase;

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
            $job->handle();
            $this->fail('The provider error should be retried by the queue.');
        } catch (RuntimeException $caught) {
            $this->assertSame($exception, $caught);
        }

        $this->assertSame(1, $delivery->fresh()->attempts);
        $job->failed($exception);
        $this->assertDatabaseHas('order_status_email_deliveries', [
            'id' => $delivery->id,
            'delivery_status' => 'FAILED',
            'attempts' => 1,
            'error_code' => RuntimeException::class,
        ]);
    }
}
