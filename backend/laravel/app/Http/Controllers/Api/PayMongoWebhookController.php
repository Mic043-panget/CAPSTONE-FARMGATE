<?php

namespace App\Http\Controllers\Api;

use App\Enums\OrderStatus;
use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Notifications\OrderStatusChangedNotification;
use App\Services\PaymentProviderReadinessService;
use App\Services\RiderAssignmentService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpKernel\Exception\HttpException;

class PayMongoWebhookController extends Controller
{
    public function handle(Request $request, PaymentProviderReadinessService $providers): JsonResponse
    {
        abort_unless($providers->paymongo()['test_mode_credentials'], 503, 'PayMongo test-mode credentials are required for webhook processing.');
        $secret = config('services.paymongo.webhook_secret');
        abort_if(! filled($secret), 503, 'PayMongo webhook signing is not configured.');

        $parts = [];
        foreach (explode(',', (string) $request->header('Paymongo-Signature')) as $component) {
            [$key, $value] = array_pad(explode('=', trim($component), 2), 2, null);
            if ($key && $value) {
                $parts[$key] = $value;
            }
        }

        $timestamp = $parts['t'] ?? '';
        $signature = $parts['te'] ?? '';
        abort_unless(
            ctype_digit($timestamp)
            && abs(time() - (int) $timestamp) <= 300
            && filled($signature),
            401,
            'Invalid PayMongo webhook signature.',
        );

        $expected = hash_hmac('sha256', $timestamp.'.'.$request->getContent(), $secret);
        abort_unless(hash_equals($expected, $signature), 401, 'Invalid PayMongo webhook signature.');

        $payload = json_decode($request->getContent(), true);
        abort_unless(
            is_array($payload)
            && is_array($payload['data']['attributes'] ?? null),
            422,
            'Invalid PayMongo webhook payload.',
        );
        $event = $payload['data']['attributes'];
        $eventType = $event['type'] ?? null;

        if ($eventType !== 'checkout_session.payment.paid') {
            return response()->json(['message' => 'Webhook event ignored.']);
        }

        abort_unless(($event['livemode'] ?? null) === false, 422, 'Only test-mode PayMongo events are accepted.');
        $session = $event['data'] ?? null;
        abort_unless(
            is_array($session)
            && is_string($session['id'] ?? null)
            && str_starts_with($session['id'], 'cs_')
            && is_array($session['attributes']['payments'] ?? null),
            422,
            'Invalid PayMongo checkout payment data.',
        );

        $sessionId = $session['id'];
        $paidPayments = collect($session['attributes']['payments'])
            ->filter(fn ($payment): bool => is_array($payment)
                && ($payment['attributes']['status'] ?? $payment['status'] ?? null) === 'paid')
            ->values();
        $payment = $paidPayments->first();
        $paymentAmount = is_array($payment)
            ? ($payment['attributes']['amount'] ?? $payment['amount'] ?? null)
            : null;
        abort_unless(
            $paidPayments->count() === 1
            && is_string($payment['id'] ?? null)
            && (is_int($paymentAmount) && $paymentAmount >= 0
                || is_string($paymentAmount) && ctype_digit($paymentAmount))
            && ($payment['attributes']['currency'] ?? $payment['currency'] ?? null) === 'PHP',
            422,
            'PayMongo webhook does not contain one valid PHP payment.',
        );

        $amountCents = (int) $paymentAmount;
        $eventKey = hash('sha256', json_encode([
            'type' => $eventType,
            'session_id' => $sessionId,
            'payment_id' => $payment['id'],
            'amount' => $amountCents,
        ], JSON_THROW_ON_ERROR));
        $payloadHash = hash('sha256', $request->getContent());

        try {
            $referenceNumber = $session['attributes']['reference_number'] ?? null;
            $duplicate = DB::transaction(function () use ($eventKey, $eventType, $payloadHash, $sessionId, $amountCents, $referenceNumber): bool {
                $inserted = DB::table('paymongo_webhook_events')->insertOrIgnore([
                    'event_key' => $eventKey,
                    'payload_sha256' => $payloadHash,
                    'event_type' => $eventType,
                    'checkout_session_id' => $sessionId,
                    'status' => 'PROCESSING',
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
                if ($inserted === 0) {
                    return true;
                }

                $orders = Order::query()
                    ->where('paymongo_checkout_session_id', $sessionId)
                    ->orderBy('id')
                    ->lockForUpdate()
                    ->get();
                abort_if($orders->isEmpty(), 404, 'PayMongo checkout session is not associated with an order.');
                $validReferenceNumber = is_int($referenceNumber) && $referenceNumber > 0
                    || is_string($referenceNumber) && ctype_digit($referenceNumber);
                abort_unless(
                    $validReferenceNumber
                    && $orders->contains(fn (Order $order): bool => $order->id === (int) $referenceNumber),
                    422,
                    'PayMongo checkout session reference does not match its Farmgate order.',
                );

                $expectedAmountCents = (int) $orders->sum(
                    fn (Order $order): int => (int) round((float) $order->total_amount * 100),
                );
                if ($amountCents !== $expectedAmountCents) {
                    Log::warning('PayMongo test webhook amount did not match its Farmgate checkout session.', [
                        'checkout_session_id' => $sessionId,
                    ]);
                    throw new HttpException(422, 'PayMongo payment amount does not match the Farmgate order total.');
                }

                foreach ($orders as $order) {
                    if ($order->payment_status !== 'PENDING') {
                        continue;
                    }

                    $order->forceFill(['payment_status' => 'PAID', 'paid_at' => now()])->save();
                    DB::afterCommit(function () use ($order): void {
                        app(RiderAssignmentService::class)->dispatchForOrder($order->id);
                        $seller = $order->seller;
                        if ($seller) {
                            $seller->notify(new OrderStatusChangedNotification($order->id, OrderStatus::PENDING_CONFIRMATION, $order->order_reference));
                        }
                    });
                }

                DB::table('paymongo_webhook_events')
                    ->where('event_key', $eventKey)
                    ->update(['status' => 'PROCESSED', 'processed_at' => now(), 'updated_at' => now()]);

                return false;
            });
        } catch (HttpException $exception) {
            throw $exception;
        }

        return response()->json([
            'message' => $duplicate ? 'Duplicate webhook event ignored.' : 'Webhook received.',
        ]);
    }
}
