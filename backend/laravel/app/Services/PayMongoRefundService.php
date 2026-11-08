<?php

namespace App\Services;

use App\Enums\ComplaintStatus;
use App\Models\Complaint;
use App\Models\Order;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class PayMongoRefundService
{
    public function __construct(private readonly OrderCaseWorkflowService $workflow) {}

    public function approve(Complaint $case, int $adminId, float $amount): Complaint
    {
        abort_unless($case->case_type === 'RETURN_REFUND' && $case->refund_status === 'REQUESTED', 409, 'This refund request has already been processed.');
        $order = $case->order;
        abort_unless($order->payment_method !== 'COD' && $order->payment_status === 'PAID', 422, 'Only paid PayMongo orders can use an automatic refund.');
        abort_unless(filled($order->paymongo_checkout_session_id), 422, 'The PayMongo checkout reference is missing; admin reconciliation is required.');

        $paymentId = $this->retrievePaymentId($order->paymongo_checkout_session_id);
        $issueNow = false;
        $updated = DB::transaction(function () use ($case, $adminId, $amount, $order, $paymentId, &$issueNow): Complaint {
            $lockedOrder = Order::query()
                ->where('paymongo_checkout_session_id', $order->paymongo_checkout_session_id)
                ->orderBy('id')
                ->lockForUpdate()
                ->get();
            abort_unless($lockedOrder->contains(fn (Order $item): bool => $item->id === $order->id && $item->payment_status === 'PAID'), 409, 'The PayMongo order is not confirmed as paid.');
            $lockedCase = Complaint::query()->lockForUpdate()->findOrFail($case->id);
            abort_unless($lockedCase->case_type === 'RETURN_REFUND' && $lockedCase->refund_status === 'REQUESTED', 409, 'This refund request has already been processed.');
            $caseOrder = $lockedOrder->firstWhere('id', $order->id);
            abort_if($amount < 1 || $amount > (float) $caseOrder->total_amount, 422, 'The approved amount must be between PHP 1.00 and this order total.');

            $orderIds = $lockedOrder->pluck('id');
            $reservedForOrder = (float) Complaint::query()
                ->where('order_id', $order->id)
                ->whereIn('refund_status', ['AWAITING_RETURN', 'PROCESSING', 'PENDING_PROVIDER', 'PAID', 'MANUAL_ACTION_REQUIRED', 'ACTION_REQUIRED'])
                ->where('id', '!=', $lockedCase->id)
                ->sum('approved_refund_amount');
            abort_if(round($reservedForOrder + $amount, 2) > round((float) $caseOrder->total_amount, 2), 422, 'The approved refunds exceed the amount paid for this order.');
            $reservedAmount = (float) Complaint::query()
                ->whereIn('order_id', $orderIds)
                ->whereIn('refund_status', ['AWAITING_RETURN', 'PROCESSING', 'PENDING_PROVIDER', 'PAID', 'MANUAL_ACTION_REQUIRED', 'ACTION_REQUIRED'])
                ->where('id', '!=', $lockedCase->id)
                ->sum('approved_refund_amount');
            $paymentCapacity = (float) $lockedOrder->sum('total_amount');
            abort_if(round($reservedAmount + $amount, 2) > round($paymentCapacity, 2), 422, 'The approved refunds exceed the amount paid through this PayMongo checkout.');

            $from = $lockedCase->status->value;
            $lockedCase->forceFill([
                'approved_by' => $adminId,
                'approved_refund_amount' => number_format($amount, 2, '.', ''),
                'refund_approved_at' => now(),
                'paymongo_payment_id' => $paymentId,
                'refund_status' => $lockedCase->return_method === 'RETURN_AND_REFUND' ? 'AWAITING_RETURN' : 'PROCESSING',
                'status' => ComplaintStatus::UNDER_REVIEW,
            ])->save();
            $lockedCase->statusHistory()->create([
                'changed_by' => $adminId,
                'from_status' => $from,
                'to_status' => ComplaintStatus::UNDER_REVIEW->value,
                'reason' => 'Admin approved the PayMongo refund request.',
            ]);
            $this->workflow->activity($lockedCase, $adminId, 'REFUND_APPROVED', 'Admin approved a PHP '.number_format($amount, 2).' PayMongo refund.');
            $issueNow = $lockedCase->return_method !== 'RETURN_AND_REFUND';

            return $lockedCase;
        });

        if ($issueNow) {
            return $this->submit($updated);
        }

        $this->workflow->notifyParticipants($updated, 'The return was approved. The refund will be submitted after receipt of the livestock return is confirmed.');

        return $updated->fresh();
    }

    public function markReturnReceived(Complaint $case, int $adminId): Complaint
    {
        $updated = DB::transaction(function () use ($case, $adminId): Complaint {
            $locked = Complaint::query()->lockForUpdate()->findOrFail($case->id);
            abort_unless($locked->case_type === 'RETURN_REFUND' && $locked->return_method === 'RETURN_AND_REFUND', 422, 'This case does not require a physical return.');
            abort_unless($locked->refund_status === 'AWAITING_RETURN', 409, 'The case is not waiting for a return to be received.');
            $locked->forceFill(['return_received_at' => now(), 'refund_status' => $locked->order->payment_method === 'COD' ? 'MANUAL_ACTION_REQUIRED' : 'PROCESSING'])->save();
            $this->workflow->activity($locked, $adminId, 'RETURN_RECEIVED', 'Admin confirmed receipt of the returned livestock.');

            return $locked;
        });

        if ($updated->order->payment_method === 'COD') {
            $this->workflow->notifyParticipants($updated, 'The returned livestock was received. Admin will record the approved manual COD payout.');

            return $updated->fresh();
        }

        return $this->submit($updated);
    }

    public function recordManualPayout(Complaint $case, int $adminId, string $reference, ?string $evidencePath): Complaint
    {
        $updated = DB::transaction(function () use ($case, $adminId, $reference, $evidencePath): Complaint {
            $locked = Complaint::query()->lockForUpdate()->findOrFail($case->id);
            abort_unless($locked->case_type === 'RETURN_REFUND' && $locked->order->payment_method === 'COD', 422, 'Manual payout recording is only for cash-on-delivery orders.');
            abort_unless($locked->refund_status === 'MANUAL_ACTION_REQUIRED', 409, 'This case is not waiting for a manual COD payout.');
            abort_if($locked->return_method === 'RETURN_AND_REFUND' && $locked->return_received_at === null, 409, 'Confirm the physical return before recording the COD payout.');
            $from = $locked->status->value;
            $locked->forceFill([
                'payout_reference' => $reference,
                'payout_evidence_path' => $evidencePath,
                'refund_status' => 'PAID',
                'refund_completed_at' => now(),
                'status' => ComplaintStatus::RESOLVED,
                'resolved_by' => $adminId,
                'resolved_at' => now(),
                'resolution_reason' => 'Manual COD payout recorded by admin.',
            ])->save();
            $locked->statusHistory()->create([
                'changed_by' => $adminId,
                'from_status' => $from,
                'to_status' => ComplaintStatus::RESOLVED->value,
                'reason' => 'Manual COD payout recorded; reference '.$reference,
            ]);
            $this->workflow->activity($locked, $adminId, 'COD_PAYOUT_RECORDED', 'Admin recorded a manual COD payout. Reference: '.$reference);

            return $locked;
        });
        $this->workflow->notifyParticipants($updated, 'The manual COD reimbursement was recorded as paid.');

        return $updated->fresh();
    }

    public function sync(Complaint $case, ?string $providerRefundId = null): Complaint
    {
        abort_unless(in_array($case->refund_status, ['PENDING_PROVIDER', 'FAILED', 'ACTION_REQUIRED'], true), 409, 'This case has no PayMongo refund waiting for reconciliation.');
        abort_if(filled($case->paymongo_refund_id) && filled($providerRefundId) && $case->paymongo_refund_id !== $providerRefundId, 422, 'The supplied refund ID does not match the saved PayMongo refund.');
        $refundId = $case->paymongo_refund_id ?: $providerRefundId;
        abort_unless(is_string($refundId) && $refundId !== '', 422, 'Enter the PayMongo refund ID from the provider dashboard to reconcile this case.');
        $secret = config('services.paymongo.secret_key');
        abort_if(! filled($secret), 503, 'PayMongo is not configured.');

        try {
            $response = Http::withBasicAuth($secret, '')
                ->acceptJson()
                ->connectTimeout(10)
                ->timeout(20)
                ->get('https://api.paymongo.com/v2/refunds/'.rawurlencode($refundId));
        } catch (ConnectionException $exception) {
            report($exception);
            abort(502, 'PayMongo refund status could not be checked. Try again later.');
        }

        abort_unless($response->successful(), 502, 'PayMongo refund status could not be checked.');
        $status = $response->json('data.attributes.status');
        $paymentId = $response->json('data.attributes.payment_id');
        $amount = $response->json('data.attributes.amount');
        abort_unless(
            is_string($status)
            && is_string($paymentId)
            && $paymentId === $case->paymongo_payment_id
            && is_numeric($amount)
            && (int) $amount === (int) round((float) $case->approved_refund_amount * 100),
            422,
            'The PayMongo refund does not match the payment and approved amount for this case.',
        );
        if (! $case->paymongo_refund_id) {
            $case->forceFill(['paymongo_refund_id' => $refundId])->save();
        }

        return $this->applyStatus($case, $status);
    }

    public function markStaleSubmission(Complaint $case): bool
    {
        $updated = DB::transaction(function () use ($case): ?Complaint {
            $locked = Complaint::query()->lockForUpdate()->find($case->id);
            if (! $locked || $locked->refund_status !== 'PROCESSING' || $locked->updated_at?->isAfter(now()->subMinutes(20))) {
                return null;
            }
            $message = 'Refund submission did not finish in time. Check PayMongo before taking any further action.';
            $locked->forceFill(['refund_status' => 'ACTION_REQUIRED', 'refund_error' => $message])->save();
            $this->workflow->activity($locked, $locked->approved_by, 'REFUND_ACTION_REQUIRED', $message);

            return $locked->fresh();
        });
        if ($updated === null) {
            return false;
        }
        $this->workflow->notifyParticipants($updated, 'The refund submission needs admin reconciliation. Check PayMongo before taking any further action.');

        return true;
    }

    private function submit(Complaint $case): Complaint
    {
        $secret = config('services.paymongo.secret_key');
        if (! filled($secret)) {
            $this->markActionRequired($case, 'PayMongo is not configured. Check provider setup before taking further action.');
            abort(503, 'PayMongo is not configured. The refund is action-required; check provider setup before taking further action.');
        }

        try {
            $response = Http::withBasicAuth($secret, '')
                ->acceptJson()
                ->connectTimeout(10)
                ->timeout(20)
                ->post('https://api.paymongo.com/v2/refunds', [
                    'data' => ['attributes' => [
                        'payment_id' => $case->paymongo_payment_id,
                        'amount' => (int) round((float) $case->approved_refund_amount * 100),
                        'reason' => 'requested_by_customer',
                        'notes' => 'FARMGATE return/refund case #'.$case->id,
                        'metadata' => ['farmgate_case_id' => (string) $case->id],
                    ]],
                ]);
        } catch (ConnectionException $exception) {
            report($exception);
            $this->markActionRequired($case, 'PayMongo response was not received. Verify the provider dashboard before taking further action.');
            abort(502, 'PayMongo did not confirm the refund request. The case is action-required; verify it in the PayMongo dashboard before proceeding.');
        }

        if (! $response->successful() || ! is_string($response->json('data.id')) || ! is_string($response->json('data.attributes.status'))) {
            report(new RuntimeException('PayMongo refund request returned HTTP '.$response->status().'.'));
            $this->markActionRequired($case, 'PayMongo did not confirm the refund request. Admin reconciliation is required.');
            abort(502, 'PayMongo did not confirm the refund request. Admin reconciliation is required; duplicate submission is blocked.');
        }

        $case->forceFill(['paymongo_refund_id' => $response->json('data.id')])->save();

        return $this->applyStatus($case, $response->json('data.attributes.status'));
    }

    private function retrievePaymentId(string $checkoutSessionId): string
    {
        $secret = config('services.paymongo.secret_key');
        abort_if(! filled($secret), 503, 'PayMongo is not configured.');

        try {
            $response = Http::withBasicAuth($secret, '')
                ->acceptJson()
                ->connectTimeout(10)
                ->timeout(20)
                ->get('https://api.paymongo.com/v2/checkout_sessions/'.rawurlencode($checkoutSessionId));
        } catch (ConnectionException $exception) {
            report($exception);
            abort(502, 'The PayMongo payment could not be verified. No refund was submitted.');
        }

        abort_unless($response->successful(), 502, 'The PayMongo payment could not be verified. No refund was submitted.');
        $payments = $response->json('data.attributes.payments');
        $paymentId = is_array($payments) ? ($payments[0]['id'] ?? null) : null;
        abort_unless(is_string($paymentId) && $paymentId !== '', 422, 'PayMongo has not exposed a payment ID for this checkout. Admin reconciliation is required; no refund was submitted.');

        return $paymentId;
    }

    private function applyStatus(Complaint $case, string $providerStatus): Complaint
    {
        $normalized = match (strtolower($providerStatus)) {
            'pending' => 'PENDING_PROVIDER',
            'succeeded', 'success' => 'PAID',
            'failed' => 'FAILED',
            default => 'ACTION_REQUIRED',
        };
        $updated = DB::transaction(function () use ($case, $normalized, $providerStatus): Complaint {
            $locked = Complaint::query()->lockForUpdate()->findOrFail($case->id);
            if ($locked->refund_status === 'PAID') {
                return $locked;
            }
            $from = $locked->status->value;
            $locked->forceFill([
                'refund_status' => $normalized,
                'refund_error' => $normalized === 'ACTION_REQUIRED' ? 'Provider status requires admin reconciliation: '.$providerStatus : null,
                'refund_completed_at' => $normalized === 'PAID' ? now() : null,
                'status' => $normalized === 'PAID' ? ComplaintStatus::RESOLVED : $locked->status,
                'resolved_by' => $normalized === 'PAID' ? $locked->approved_by : $locked->resolved_by,
                'resolved_at' => $normalized === 'PAID' ? now() : $locked->resolved_at,
                'resolution_reason' => $normalized === 'PAID' ? 'PayMongo confirmed the refund.' : $locked->resolution_reason,
            ])->save();
            if ($normalized === 'PAID') {
                $locked->statusHistory()->create([
                    'changed_by' => $locked->approved_by,
                    'from_status' => $from,
                    'to_status' => ComplaintStatus::RESOLVED->value,
                    'reason' => 'PayMongo confirmed the refund.',
                ]);
            }
            $this->workflow->activity($locked, $locked->approved_by, 'PAYMONGO_REFUND_'.$normalized, 'PayMongo refund status: '.$normalized.'.');

            return $locked;
        });
        $this->workflow->notifyParticipants($updated, $updated->refund_status === 'PAID'
            ? 'PayMongo confirmed the refund.'
            : ($updated->refund_status === 'PENDING_PROVIDER'
                ? 'PayMongo accepted the refund request; confirmation is pending.'
                : ($updated->refund_status === 'FAILED'
                    ? 'PayMongo reported that the refund failed. Admin review is required.'
                    : 'The PayMongo refund needs admin reconciliation.')));

        return $updated->fresh();
    }

    private function markActionRequired(Complaint $case, string $message): void
    {
        $case->forceFill(['refund_status' => 'ACTION_REQUIRED', 'refund_error' => $message])->save();
        $this->workflow->activity($case, $case->approved_by, 'REFUND_ACTION_REQUIRED', $message);
        $this->workflow->notifyParticipants($case, 'The refund needs admin reconciliation before any further action.');
    }
}
