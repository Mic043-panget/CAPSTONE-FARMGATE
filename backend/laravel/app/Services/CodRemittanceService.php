<?php

namespace App\Services;

use App\Enums\DeliveryStatus;
use App\Enums\OrderStatus;
use App\Enums\Role;
use App\Models\CodCollection;
use App\Models\CodReceivingMethod;
use App\Models\CodRemittance;
use App\Models\CodRemittanceHistory;
use App\Models\Delivery;
use App\Models\Order;
use App\Models\SellerPayout;
use App\Models\SellerPayoutDestination;
use App\Models\SellerPayoutHistory;
use App\Models\User;
use App\Notifications\CodWorkflowStatusNotification;
use App\Notifications\SellerPayoutRecordedNotification;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class CodRemittanceService
{
    public function __construct(
        private readonly SystemSettingsService $settings,
        private readonly PaymentProviderReadinessService $providers,
        private readonly OrderWorkflowService $orders,
    ) {}

    public function collectCash(
        Delivery $delivery,
        User $rider,
        int $collectedAmountCents,
        string $proofPath,
        string $proofSha256,
        string $proofMimeType,
    ): CodCollection {
        return DB::transaction(function () use ($delivery, $rider, $collectedAmountCents, $proofPath, $proofSha256, $proofMimeType): CodCollection {
            $order = Order::query()->lockForUpdate()->findOrFail($delivery->order_id);
            $lockedDelivery = Delivery::query()->lockForUpdate()->findOrFail($delivery->id);

            abort_unless($rider->role === Role::RIDER && $lockedDelivery->rider_id === $rider->id, 403);
            abort_unless($order->payment_method === 'COD', 422, 'This order is not a cash-on-delivery order.');
            abort_unless($lockedDelivery->status === DeliveryStatus::DELIVERED, 409, 'Cash can only be recorded after delivery verification.');
            abort_unless(! in_array($order->status, [OrderStatus::CANCELLED, OrderStatus::REJECTED], true), 409);
            abort_unless($order->payment_status === 'UNPAID', 409, 'The order is already paid or has another payment state.');
            abort_unless($order->total_amount !== null && self::toCents($order->total_amount) > 0, 409, 'The order total is unavailable.');
            abort_unless($collectedAmountCents > 0, 422, 'The amount actually received must be greater than zero.');
            abort_if(CodCollection::query()->where('order_id', $order->id)->exists(), 409, 'COD cash collection has already been recorded for this order.');

            $collection = CodCollection::create([
                'order_id' => $order->id,
                'delivery_id' => $lockedDelivery->id,
                'rider_id' => $rider->id,
                'expected_amount_cents' => self::toCents($order->total_amount),
                'collected_amount_cents' => $collectedAmountCents,
                'proof_path' => $proofPath,
                'proof_sha256' => $proofSha256,
                'proof_mime_type' => $proofMimeType,
                'status' => $collectedAmountCents === self::toCents($order->total_amount) ? 'COLLECTED' : 'NEEDS_REVIEW',
                'collected_at' => now(),
            ]);
            $this->notifyRoles(
                [$order->buyer_id],
                'cod_payment_awaiting_confirmation',
                $order->id,
                $order->order_reference,
                'AWAITING_CONFIRMATION',
                'The rider reported a COD collection. Farmgate has not confirmed payment yet.',
            );
            $this->notifyRoles(
                User::query()->where('role', Role::ADMIN)->pluck('id')->all(),
                'cod_cash_collected',
                $order->id,
                $order->order_reference,
                $collection->status,
                'A rider reported COD cash collection. The buyer payment remains unpaid until remittance reconciliation.',
            );

            return $collection;
        });
    }

    public function pendingCollections(User $rider): EloquentCollection
    {
        abort_unless($rider->role === Role::RIDER, 403);

        return CodCollection::query()
            ->where('rider_id', $rider->id)
            ->whereIn('status', ['COLLECTED', 'NEEDS_REVIEW'])
            ->whereNull('remittance_id')
            ->with('order:id,order_reference')
            ->orderBy('id')
            ->get();
    }

    public function submitRemittance(
        User $rider,
        string $methodType = 'CASH_HANDOVER',
        ?CodReceivingMethod $receivingMethod = null,
        ?string $receiverName = null,
        ?string $transactionReference = null,
        ?string $evidencePath = null,
        ?string $evidenceSha256 = null,
        ?string $evidenceMimeType = null,
    ): CodRemittance {
        $referenceHash = $methodType === 'CASH_HANDOVER' || blank($transactionReference)
            ? null
            : hash_hmac(
                'sha256',
                strtoupper($methodType).':'.$receivingMethod?->id.':'.mb_strtolower(trim($transactionReference)),
                (string) config('app.key'),
            );

        return DB::transaction(function () use ($rider, $methodType, $receivingMethod, $receiverName, $transactionReference, $evidencePath, $evidenceSha256, $evidenceMimeType, $referenceHash): CodRemittance {
            abort_unless($rider->role === Role::RIDER, 403);
            abort_unless(in_array($methodType, ['CASH_HANDOVER', 'BANK_TRANSFER', 'BANK_QR', 'PAYMONGO_QR'], true), 422);
            if ($methodType === 'PAYMONGO_QR') {
                abort_unless(
                    $this->providers->paymongo()['qr_receiving_ready'],
                    503,
                    'PayMongo QR remittance is unavailable until provider configuration is ready.',
                );
            }
            if ($methodType === 'CASH_HANDOVER') {
                abort_if(blank($receiverName), 422, 'Enter the name of the authorized Farmgate receiver.');
                abort_unless($receivingMethod === null, 422, 'Cash handover does not use a bank receiving method.');
            } else {
                abort_unless(
                    $receivingMethod
                        && $receivingMethod->status === 'ACTIVE'
                        && $receivingMethod->method_type === $methodType,
                    409,
                    'The selected Farmgate receiving method is unavailable.',
                );
                abort_if(blank($transactionReference) || blank($evidencePath), 422, 'Electronic remittance requires a transaction reference and receipt proof.');
            }
            User::query()->lockForUpdate()->findOrFail($rider->id);
            abort_if(
                $referenceHash !== null
                    && CodRemittance::query()->where('transaction_reference_hash', $referenceHash)->exists(),
                409,
                'This transfer reference has already been submitted for this Farmgate receiving method.',
            );
            $collections = CodCollection::query()
                ->where('rider_id', $rider->id)
                ->whereIn('status', ['COLLECTED', 'NEEDS_REVIEW'])
                ->whereNull('remittance_id')
                ->orderBy('id')
                ->lockForUpdate()
                ->get();
            abort_if($collections->isEmpty(), 422, 'There is no collected COD cash to remit.');

            $expectedCents = $collections->sum('collected_amount_cents');
            $reference = $this->newReference();
            try {
                $remittance = CodRemittance::create([
                    'reference' => $reference,
                    'rider_id' => $rider->id,
                    'submitted_by' => $rider->id,
                    'method_type' => $methodType,
                    'receiving_method_id' => $receivingMethod?->id,
                    'receiver_name' => filled($receiverName) ? trim($receiverName) : null,
                    'transaction_reference' => filled($transactionReference) ? trim($transactionReference) : null,
                    'transaction_reference_hash' => $referenceHash,
                    'evidence_path' => $evidencePath,
                    'evidence_sha256' => $evidenceSha256,
                    'evidence_mime_type' => $evidenceMimeType,
                    'expected_amount_cents' => $expectedCents,
                    'status' => 'SUBMITTED',
                    'submitted_at' => now(),
                ]);
            } catch (QueryException $exception) {
                if ($referenceHash !== null && $this->isDuplicateTransferReference($exception)) {
                    abort(409, 'This transfer reference has already been submitted for this Farmgate receiving method.');
                }

                throw $exception;
            }
            CodRemittanceHistory::create([
                'cod_remittance_id' => $remittance->id,
                'actor_id' => $rider->id,
                'action' => 'SUBMITTED',
                'expected_amount_cents' => $expectedCents,
                'reason' => 'Rider submitted the cash batch for admin receipt and reconciliation.',
            ]);
            foreach ($collections as $collection) {
                $collection->forceFill([
                    'remittance_id' => $remittance->id,
                    'status' => $collection->status === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : 'REMITTED',
                ])->save();
            }
            $firstCollection = $collections->first();
            $firstOrder = $firstCollection?->order()->first();
            $this->notifyRoles(
                [$rider->id],
                'cod_remittance_submitted',
                (int) ($firstOrder?->id ?? 0),
                $firstOrder?->order_reference ?? $reference,
                'SUBMITTED',
                'Your COD remittance was submitted for Farmgate review. Proof is not confirmation of receipt.',
            );
            $this->notifyRoles(
                User::query()->where('role', Role::ADMIN)->pluck('id')->all(),
                'cod_remittance_submitted',
                (int) ($firstOrder?->id ?? 0),
                $firstOrder?->order_reference ?? $reference,
                'SUBMITTED',
                'A rider submitted a COD remittance for reconciliation.',
            );

            return $remittance;
        });
    }

    public function reconcile(CodRemittance $remittance, User $admin, int $receivedCents, ?string $reason): CodRemittance
    {
        return DB::transaction(function () use ($remittance, $admin, $receivedCents, $reason): CodRemittance {
            $locked = CodRemittance::query()->lockForUpdate()->findOrFail($remittance->id);
            abort_unless($admin->role === Role::ADMIN, 403);
            abort_unless(in_array($locked->status, ['SUBMITTED', 'DISPUTED'], true), 409, 'This remittance cannot be reconciled in its current state.');
            abort_if($receivedCents !== $locked->expected_amount_cents && blank($reason), 422, 'A reason is required when the received cash differs from the submitted amount.');

            $matched = $receivedCents === $locked->expected_amount_cents;
            $resolvedReason = $this->safeFinancialReason((string) $reason) ?: ($matched ? 'Received cash matched the submitted amount.' : null);
            $locked->forceFill([
                'received_amount_cents' => $receivedCents,
                'received_by' => $admin->id,
                'status' => $matched ? 'RECONCILED' : 'DISPUTED',
                'reconciliation_reason' => $resolvedReason,
                'reconciled_at' => $matched ? now() : null,
            ])->save();

            CodRemittanceHistory::create([
                'cod_remittance_id' => $locked->id,
                'actor_id' => $admin->id,
                'action' => $matched ? 'RECONCILED' : 'DISCREPANCY_RECORDED',
                'expected_amount_cents' => $locked->expected_amount_cents,
                'received_amount_cents' => $receivedCents,
                'reason' => $resolvedReason,
            ]);

            if ($matched) {
                $collections = CodCollection::query()
                    ->where('remittance_id', $locked->id)
                    ->whereIn('status', ['REMITTED', 'NEEDS_REVIEW'])
                    ->lockForUpdate()
                    ->get();
                foreach ($collections as $collection) {
                    if ($collection->collected_amount_cents !== $collection->expected_amount_cents) {
                        $collection->forceFill(['status' => 'NEEDS_REVIEW'])->save();

                        continue;
                    }

                    $collection->forceFill(['status' => 'RECONCILED'])->save();
                    $order = Order::query()->lockForUpdate()->findOrFail($collection->order_id);
                    if ($order->payment_status === 'UNPAID') {
                        $order->forceFill([
                            'payment_status' => 'PAID',
                            'paid_at' => now(),
                        ])->save();
                    }
                    if ($order->payment_status === 'PAID'
                        && $order->status === OrderStatus::FULFILLING
                        && Delivery::query()
                            ->where('order_id', $order->id)
                            ->where('status', DeliveryStatus::DELIVERED)
                            ->exists()) {
                        $this->orders->completeAfterVerifiedDelivery(
                            $order,
                            $admin,
                            'COD remittance reconciled after verified delivery.',
                        );
                    }
                    $this->createPendingPayout($order, $admin);
                    $this->notifyRoles(
                        [$order->buyer_id],
                        'cod_payment_confirmed',
                        $order->id,
                        $order->order_reference,
                        'PAID',
                        'Farmgate confirmed receipt of your COD payment.',
                    );
                }
            }

            $firstOrder = $locked->collections()->with('order:id,order_reference')->first()?->order;
            $this->notifyRoles(
                [$locked->rider_id],
                $matched ? 'cod_remittance_confirmed' : 'cod_remittance_needs_review',
                (int) ($firstOrder?->id ?? 0),
                $firstOrder?->order_reference ?? $locked->reference,
                $locked->status,
                $matched
                    ? 'Farmgate recorded receipt of your COD remittance.'
                    : 'Your COD remittance has a difference and needs administrator review.',
            );

            return $locked->load(['rider:id,name', 'histories.actor:id,name']);
        });
    }

    public function recordManualPayout(Order $order, User $admin, int $amountCents, string $reason): SellerPayout
    {
        return DB::transaction(function () use ($order, $admin, $amountCents, $reason): SellerPayout {
            $locked = Order::query()->lockForUpdate()->findOrFail($order->id);
            abort_unless($admin->role === Role::ADMIN, 403);
            abort_unless($this->settings->getBoolean('manual_seller_payouts_enabled'), 503, 'Manual seller payouts are disabled until an administrator records the approved payout policy and verifies the payout destination.');
            abort_unless($locked->payment_method === 'COD', 422, 'Only rider-reconciled COD payouts are available in this workflow.');
            abort_unless($locked->payment_status === 'PAID', 409, 'The COD payment must be reconciled before payout.');
            $collection = CodCollection::query()->where('order_id', $locked->id)->lockForUpdate()->first();
            abort_unless($collection?->status === 'RECONCILED', 409, 'COD cash must be remitted and reconciled before seller payout.');
            abort_if(SellerPayout::query()->where('order_id', $locked->id)->exists(), 409, 'A payout record already exists for this order.');
            $subtotalCents = self::toCents($locked->subtotal_amount);
            $sellerFeeCents = self::toCents($locked->seller_fee ?? '0');
            abort_if($sellerFeeCents > $subtotalCents, 409, 'The recorded seller fee exceeds the merchandise subtotal.');
            $expectedPayoutCents = $subtotalCents - $sellerFeeCents;
            abort_unless(
                $expectedPayoutCents > 0 && $amountCents === $expectedPayoutCents,
                422,
                'Payout must equal the merchandise subtotal minus the seller fee recorded for this order.',
            );
            $destination = SellerPayoutDestination::query()
                ->where('seller_id', $locked->seller_id)
                ->where('status', 'VERIFIED')
                ->first();
            abort_unless($destination, 409, 'The seller must have a verified payout destination.');
            $eligibility = app(SellerPayoutPolicyService::class)->eligibility($locked->seller_id);
            abort_unless($eligibility['eligible'], 409, implode(' ', $eligibility['unmet']));
            $safeReason = $this->safeFinancialReason($reason, $destination);

            $payout = SellerPayout::create([
                'order_id' => $locked->id,
                'seller_id' => $locked->seller_id,
                'recorded_by' => $admin->id,
                'payout_destination_id' => $destination->id,
                'amount_cents' => $amountCents,
                'method' => $destination->destination_type,
                'external_reference' => null,
                'status' => 'PENDING',
                'reason' => $safeReason,
            ]);
            SellerPayoutHistory::query()->create([
                'seller_payout_id' => $payout->id,
                'actor_id' => $admin->id,
                'action' => 'CREATED',
                'to_status' => 'PENDING',
                'reason' => $safeReason,
            ]);

            return $payout;
        });
    }

    public function confirmManualPayout(
        SellerPayout $payout,
        User $admin,
        string $externalReference,
        string $reason,
        string $paidDate,
        ?string $receiptPath,
        ?string $receiptMimeType,
        int $amountCents,
    ): SellerPayout {
        return DB::transaction(function () use ($payout, $admin, $externalReference, $reason, $paidDate, $receiptPath, $receiptMimeType, $amountCents): SellerPayout {
            $locked = SellerPayout::query()->lockForUpdate()->findOrFail($payout->id);
            abort_unless($admin->role === Role::ADMIN, 403);
            abort_unless($this->settings->getBoolean('manual_seller_payouts_enabled'), 503, 'Manual payout confirmation is disabled until an administrator records the approved payout policy and verifies the payout destination.');
            abort_unless(in_array($locked->status, ['PENDING', 'PROCESSING'], true), 409, 'Only a payout awaiting external completion can be recorded.');
            abort_unless(
                (int) $locked->recorded_by !== (int) $admin->id,
                409,
                'A different administrator must independently confirm the externally completed transfer.',
            );
            abort_unless($amountCents === $locked->amount_cents, 422, 'The recorded external transfer amount must exactly match the seller payout amount due.');
            $destination = SellerPayoutDestination::query()
                ->whereKey($locked->payout_destination_id)
                ->where('seller_id', $locked->seller_id)
                ->where('status', 'VERIFIED')
                ->first();
            abort_unless($destination, 409, 'The seller must have a verified payout destination before payout.');
            $eligibility = app(SellerPayoutPolicyService::class)->eligibility($locked->seller_id);
            abort_unless($eligibility['eligible'], 409, implode(' ', $eligibility['unmet']));
            $referenceHash = hash('sha256', mb_strtolower(trim($externalReference)));
            abort_unless(
                ! SellerPayout::query()->where('external_reference_hash', $referenceHash)->whereKeyNot($locked->id)->exists(),
                409,
                'This external transfer reference has already been recorded.',
            );
            $safeReason = $this->safeFinancialReason($reason, $destination);
            $previous = $locked->status;
            $locked->forceFill([
                'method' => $destination->destination_type,
                'external_reference' => trim($externalReference),
                'external_reference_hash' => $referenceHash,
                'provider_status' => 'MANUAL_EVIDENCE_RECORDED',
                'receipt_path' => $receiptPath,
                'receipt_mime_type' => $receiptMimeType,
                'status' => 'PAID',
                'paid_at' => Carbon::parse($paidDate)->startOfDay(),
                'reason' => $safeReason,
            ]);
            try {
                $locked->save();
            } catch (QueryException $exception) {
                if ($this->isDuplicatePayoutReference($exception)) {
                    abort(409, 'This external transfer reference has already been recorded.');
                }

                throw $exception;
            }
            SellerPayoutHistory::query()->create([
                'seller_payout_id' => $locked->id,
                'actor_id' => $admin->id,
                'action' => 'MANUAL_PAYMENT_CONFIRMED',
                'from_status' => $previous,
                'to_status' => 'PAID',
                'reason' => $safeReason,
            ]);
            $orderReference = $locked->order?->order_reference ?? 'Order';
            $amountCents = $locked->amount_cents;
            DB::afterCommit(function () use ($locked, $orderReference, $amountCents): void {
                User::query()->find($locked->seller_id)?->notify(new SellerPayoutRecordedNotification(
                    $locked->order_id,
                    $orderReference,
                    $amountCents,
                ));
            });

            return $locked->fresh(['destination']);
        });
    }

    public function updatePayoutStatus(SellerPayout $payout, User $admin, string $status, string $reason): SellerPayout
    {
        return DB::transaction(function () use ($payout, $admin, $status, $reason): SellerPayout {
            $locked = SellerPayout::query()->lockForUpdate()->findOrFail($payout->id);
            abort_unless($admin->role === Role::ADMIN, 403);
            abort_unless(in_array($status, ['PENDING', 'FAILED', 'RETURNED', 'DISPUTED'], true), 422);
            $destination = $locked->payout_destination_id
                ? SellerPayoutDestination::query()->whereKey($locked->payout_destination_id)->where('seller_id', $locked->seller_id)->first()
                : null;
            $safeReason = $this->safeFinancialReason($reason, $destination);
            $allowed = match ($status) {
                'PENDING' => ['FAILED', 'RETURNED', 'DISPUTED'],
                'FAILED' => ['PENDING', 'PROCESSING', 'DISPUTED'],
                'RETURNED' => ['PENDING', 'DISPUTED'],
                'DISPUTED' => ['PENDING', 'PAID'],
            };
            abort_unless(in_array($locked->status, $allowed, true), 409, 'This payout cannot move to the requested status.');
            $previous = $locked->status;
            $locked->forceFill([
                'status' => $status,
                'provider_status' => 'MANUAL_'.$status,
                'paid_at' => $status === 'RETURNED' ? null : $locked->paid_at,
                'reason' => $safeReason,
            ])->save();
            SellerPayoutHistory::query()->create([
                'seller_payout_id' => $locked->id,
                'actor_id' => $admin->id,
                'action' => 'STATUS_CHANGED',
                'from_status' => $previous,
                'to_status' => $status,
                'reason' => $safeReason,
            ]);
            $this->notifyRoles(
                [$locked->seller_id],
                'seller_payout_status_changed',
                $locked->order_id,
                $locked->order?->order_reference ?? 'Order',
                $status,
                'Your seller payout status changed to '.strtolower(str_replace('_', ' ', $status)).'.',
            );

            return $locked->fresh();
        });
    }

    private function createPendingPayout(Order $order, User $admin): void
    {
        $subtotalCents = self::toCents($order->subtotal_amount);
        $sellerFeeCents = self::toCents($order->seller_fee ?? '0');
        abort_if($sellerFeeCents > $subtotalCents, 409, 'The recorded seller fee exceeds the merchandise subtotal.');
        $amountCents = $subtotalCents - $sellerFeeCents;
        abort_if($amountCents < 1, 409, 'The recorded seller proceeds are not positive.');
        if (SellerPayout::query()->where('order_id', $order->id)->exists()) {
            return;
        }

        $eligibility = app(SellerPayoutPolicyService::class)->eligibility($order->seller_id);
        $destination = SellerPayoutDestination::query()
            ->where('seller_id', $order->seller_id)
            ->where('status', 'VERIFIED')
            ->first();
        $status = $destination && $eligibility['acknowledged'] && $eligibility['policy'] ? 'PENDING' : 'PENDING_SETUP';
        $payout = SellerPayout::query()->create([
            'order_id' => $order->id,
            'seller_id' => $order->seller_id,
            'recorded_by' => $admin->id,
            'payout_destination_id' => $status === 'PENDING' ? $destination?->id : null,
            'amount_cents' => $amountCents,
            'method' => $destination?->destination_type ?? 'MANUAL',
            'status' => $status,
            'reason' => 'COD remittance confirmed; proceeds calculated from the order subtotal less its snapshotted seller fee.',
        ]);
        SellerPayoutHistory::query()->create([
            'seller_payout_id' => $payout->id,
            'actor_id' => $admin->id,
            'action' => 'CREATED_AFTER_REMITTANCE',
            'to_status' => $status,
            'reason' => $payout->reason,
        ]);
        $this->notifyRoles(
            [$order->seller_id],
            'seller_payout_pending',
            $order->id,
            $order->order_reference,
            $status,
            $status === 'PENDING_SETUP'
                ? 'Your COD remittance was confirmed. Review the effective payout policy and add or verify your payout destination to make the payout eligible.'
                : 'Your COD remittance was confirmed. Seller payout is pending; Farmgate has not initiated a transfer.',
        );
    }

    /**
     * @param  array<int, int>  $userIds
     */
    private function notifyRoles(array $userIds, string $type, int $orderId, string $orderReference, string $status, string $message): void
    {
        $userIds = array_values(array_unique(array_filter($userIds)));
        DB::afterCommit(function () use ($userIds, $type, $orderId, $orderReference, $status, $message): void {
            foreach ($userIds as $userId) {
                try {
                    $recipient = User::query()->find($userId);
                    $recipient?->notify(new CodWorkflowStatusNotification($type, $orderId, $orderReference, $status, $message));
                } catch (\Throwable $exception) {
                    report($exception);
                }
            }
        });
    }

    private function safeFinancialReason(string $reason, ?SellerPayoutDestination $destination = null): string
    {
        if ($destination) {
            foreach ([$destination->account_holder, $destination->bank_name, $destination->account_number, $destination->wallet_number] as $privateValue) {
                if (filled($privateValue)) {
                    $reason = str_ireplace((string) $privateValue, '[destination detail redacted]', $reason);
                }
            }
        }

        $reason = preg_replace('/(?<!\d)(?:\d[ -]?){7,}\d(?!\d)/u', '[masked digits]', $reason) ?? $reason;

        return trim($reason);
    }

    private function isDuplicateTransferReference(QueryException $exception): bool
    {
        $message = strtolower($exception->getMessage());

        return str_contains($message, 'transaction_reference_hash')
            || str_contains($message, 'cod_remittances_transaction_ref_hash_unique');
    }

    private function isDuplicatePayoutReference(QueryException $exception): bool
    {
        $message = strtolower($exception->getMessage());

        return str_contains($message, 'external_reference_hash')
            || str_contains($message, 'seller_payouts_external_reference_hash_unique');
    }

    public static function toCents(string|int|float $amount): int
    {
        $value = trim((string) $amount);
        if (! preg_match('/^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/', $value, $parts)) {
            throw ValidationException::withMessages(['amount' => ['The stored currency value is invalid.']]);
        }

        return ((int) $parts[1] * 100) + (int) str_pad($parts[2] ?? '', 2, '0');
    }

    private function newReference(): string
    {
        do {
            $reference = 'FG-COD-'.now()->format('Y').'-'.Str::upper(Str::random(10));
        } while (CodRemittance::query()->where('reference', $reference)->exists());

        return $reference;
    }
}
