<?php

namespace App\Services;

use App\Enums\DeliveryStatus;
use App\Models\Delivery;
use App\Models\Order;
use App\Models\RiderEarning;
use App\Models\RiderEarningsSetting;
use App\Models\RiderPayout;
use App\Models\RiderPayoutDestination;
use App\Models\RiderPayoutHistory;
use LogicException;

class RiderEarningsService
{
    public function recordVerifiedDelivery(Delivery $delivery, Order $order): ?RiderEarning
    {
        if ($delivery->status !== DeliveryStatus::DELIVERED
            || $delivery->delivery_verified_at === null
            || $delivery->rider_id === null
            || $order->delivery_method !== 'STANDARD_DELIVERY') {
            return null;
        }

        $existing = RiderEarning::query()->where('delivery_id', $delivery->id)->first();
        if ($existing) {
            return $existing;
        }

        $setting = RiderEarningsSetting::query()
            ->lockForUpdate()
            ->find(RiderEarningsSetting::SINGLETON_ID);
        if (! $setting?->isConfigured()) {
            return null;
        }

        $deliveryFeeCents = $this->decimalToCents((string) ($order->delivery_fee ?? '0.00'));
        $percentageBasisPoints = $this->decimalToCents((string) $setting->percentage);
        $uncappedAmountCents = intdiv(($deliveryFeeCents * $percentageBasisPoints) + 5000, 10000);
        $capScope = $setting->cap_scope === 'PER_PAYOUT' ? 'PER_DELIVERY' : $setting->cap_scope;
        $capAmountCents = $capScope === 'NO_CAP'
            ? null
            : $this->decimalToCents((string) $setting->cap_amount);
        $amountCents = $capAmountCents === null
            ? $uncappedAmountCents
            : min($uncappedAmountCents, $capAmountCents);

        $earning = RiderEarning::query()->create([
            'delivery_id' => $delivery->id,
            'order_id' => $order->id,
            'rider_id' => $delivery->rider_id,
            'delivery_fee_cents' => $deliveryFeeCents,
            'percentage_snapshot' => $setting->percentage,
            'cap_scope_snapshot' => $capScope,
            'cap_amount_snapshot' => $setting->cap_amount,
            'amount_cents' => $amountCents,
            'calculated_at' => $delivery->delivery_verified_at,
        ]);

        if ($amountCents > 0) {
            $destinationId = RiderPayoutDestination::query()
                ->where('rider_id', $delivery->rider_id)
                ->where('is_current', true)
                ->where('status', 'VERIFIED')
                ->value('id');
            $payout = RiderPayout::query()->create([
                'rider_earning_id' => $earning->id,
                'rider_id' => $delivery->rider_id,
                'destination_id' => $destinationId,
                'amount_cents' => $amountCents,
                'status' => 'PENDING',
            ]);
            RiderPayoutHistory::query()->create([
                'rider_payout_id' => $payout->id,
                'action' => 'CREATED',
                'to_status' => 'PENDING',
                'reason' => 'Queued after successful buyer-location QR verification. No transfer was initiated.',
            ]);
        }

        return $earning->load('payout');
    }

    private function decimalToCents(string $value): int
    {
        if (! preg_match('/^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/D', trim($value), $matches)) {
            throw new LogicException('A saved rider earnings amount is not a valid monetary value.');
        }

        return ((int) $matches[1] * 100) + (int) str_pad($matches[2] ?? '', 2, '0');
    }
}
