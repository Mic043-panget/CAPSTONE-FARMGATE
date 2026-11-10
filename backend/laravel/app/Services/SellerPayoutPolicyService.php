<?php

namespace App\Services;

use App\Enums\Role;
use App\Models\SellerPayout;
use App\Models\SellerPayoutDestination;
use App\Models\SellerPayoutHistory;
use App\Models\SellerPayoutPolicy;
use App\Models\SellerPayoutPolicyAcknowledgement;
use App\Models\User;
use App\Notifications\CodWorkflowStatusNotification;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class SellerPayoutPolicyService
{
    public const REQUIRED_POLICY_SECTIONS = [
        'eligibility' => 'Payout eligibility',
        'calculation' => 'Payout calculation',
        'timing' => 'Payout timing',
        'destination_requirements' => 'Payout destination requirements',
        'fees' => 'Applicable fees',
        'failed_returned' => 'Failed or returned payouts',
        'dispute_corrections' => 'Disputes and corrections',
    ];

    /**
     * @param  array<string, string>  $sections
     */
    public function compileCompletePolicy(array $sections): string
    {
        $errors = [];
        $content = [];

        foreach (self::REQUIRED_POLICY_SECTIONS as $key => $label) {
            $value = trim($sections[$key] ?? '');
            if (mb_strlen($value) < 20 || preg_match('/\b(?:todo|tbd|placeholder|to be determined|fill in|not specified)\b|\[[^\]]+\]/i', $value)) {
                $errors["policy_sections.{$key}"] = ["Provide the actual approved terms for {$label}; placeholders and incomplete terms cannot be published."];

                continue;
            }

            $content[] = $label."\n".$value;
        }

        if ($errors) {
            throw ValidationException::withMessages($errors);
        }

        return implode("\n\n", $content);
    }

    public function effective(): ?SellerPayoutPolicy
    {
        return SellerPayoutPolicy::query()
            ->where('status', 'PUBLISHED')
            ->whereNotNull('published_at')
            ->whereDate('effective_date', '<=', today())
            ->orderByDesc('effective_date')
            ->orderByDesc('id')
            ->first();
    }

    public function isAcknowledged(int $sellerId, ?SellerPayoutPolicy $policy = null): bool
    {
        $policy ??= $this->effective();

        return $policy !== null && SellerPayoutPolicyAcknowledgement::query()
            ->where('seller_id', $sellerId)
            ->where('seller_payout_policy_id', $policy->id)
            ->exists();
    }

    /**
     * @return array{policy: ?SellerPayoutPolicy, acknowledged: bool, destination_verified: bool, eligible: bool, unmet: array<int, string>}
     */
    public function eligibility(int $sellerId): array
    {
        $policy = $this->effective();
        $acknowledged = $this->isAcknowledged($sellerId, $policy);
        $destinationVerified = SellerPayoutDestination::query()
            ->where('seller_id', $sellerId)
            ->where('status', 'VERIFIED')
            ->exists();
        $unmet = [];

        if (! $policy) {
            $unmet[] = 'An approved seller payout policy must be published and effective.';
        } elseif (! $acknowledged) {
            $unmet[] = 'The seller must acknowledge the effective seller payout policy.';
        }
        if (! $destinationVerified) {
            $unmet[] = 'The seller must have an administrator-verified payout destination.';
        }

        return [
            'policy' => $policy,
            'acknowledged' => $acknowledged,
            'destination_verified' => $destinationVerified,
            'eligible' => $unmet === [],
            'unmet' => $unmet,
        ];
    }

    public function acknowledge(User $seller, SellerPayoutPolicy $policy): SellerPayoutPolicyAcknowledgement
    {
        abort_unless($seller->role === Role::SELLER, 403);
        abort_unless($policy->status === 'PUBLISHED' && $policy->published_at && $policy->effective_date?->lte(today()), 409, 'Only the currently effective published payout policy can be acknowledged.');
        abort_unless($this->effective()?->is($policy), 409, 'A newer effective payout policy is available. Refresh and review it first.');

        return DB::transaction(function () use ($seller, $policy): SellerPayoutPolicyAcknowledgement {
            $acknowledgement = SellerPayoutPolicyAcknowledgement::query()->firstOrCreate(
                ['seller_id' => $seller->id, 'seller_payout_policy_id' => $policy->id],
                ['acknowledged_at' => now()],
            );
            $destination = SellerPayoutDestination::query()
                ->where('seller_id', $seller->id)
                ->where('status', 'VERIFIED')
                ->first();

            if ($destination) {
                SellerPayout::query()
                    ->where('seller_id', $seller->id)
                    ->where('status', 'PENDING_SETUP')
                    ->whereNull('payout_destination_id')
                    ->lockForUpdate()
                    ->get()
                    ->each(fn (SellerPayout $payout) => $this->makePayoutEligible($payout, $destination, $seller));
            }

            return $acknowledgement;
        });
    }

    public function makePayoutEligible(SellerPayout $payout, SellerPayoutDestination $destination, User $actor): void
    {
        $current = $this->eligibility($payout->seller_id);
        if (! $current['eligible'] || ! $destination->is($this->verifiedDestination($payout->seller_id))) {
            return;
        }
        if ($payout->status !== 'PENDING_SETUP') {
            return;
        }

        $payout->forceFill([
            'payout_destination_id' => $destination->id,
            'method' => $destination->destination_type,
            'status' => 'PENDING',
        ])->save();
        SellerPayoutHistory::query()->create([
            'seller_payout_id' => $payout->id,
            'actor_id' => $actor->id,
            'action' => 'PAYOUT_PREREQUISITES_MET',
            'from_status' => 'PENDING_SETUP',
            'to_status' => 'PENDING',
            'reason' => 'Effective policy acknowledged and verified destination available.',
        ]);
        $orderReference = $payout->order?->order_reference ?? 'Order';
        DB::afterCommit(function () use ($payout, $orderReference): void {
            User::query()->find($payout->seller_id)?->notify(new CodWorkflowStatusNotification(
                'seller_payout_pending',
                $payout->order_id,
                $orderReference,
                'PENDING',
                'Your payout policy acknowledgment and verified destination are on file. The seller payout is pending.',
            ));
        });
    }

    private function verifiedDestination(int $sellerId): ?SellerPayoutDestination
    {
        return SellerPayoutDestination::query()
            ->where('seller_id', $sellerId)
            ->where('status', 'VERIFIED')
            ->first();
    }
}
