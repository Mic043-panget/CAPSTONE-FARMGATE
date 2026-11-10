<?php

namespace App\Http\Controllers\Api;

use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\SellerPayout;
use App\Models\SellerPayoutDestination;
use App\Models\SellerPayoutDestinationHistory;
use App\Models\SellerPayoutPolicyAcknowledgement;
use App\Models\SellerProfile;
use App\Models\User;
use App\Notifications\CodWorkflowStatusNotification;
use App\Services\SellerPayoutPolicyService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class SellerPayoutDestinationController extends Controller
{
    private const CONSENT_VERSION = 'seller-payout-ops-v1';

    private const OPERATIONAL_NOTICE = 'Operational notice: provide a destination you control. Farmgate records this destination for payout operations; submitting it does not initiate a payout or guarantee a transfer. An administrator must verify it before it can be used. Keep your details current and contact Farmgate support if they are incorrect.';

    public function show(Request $request): JsonResponse
    {
        $seller = $request->user();
        abort_unless($seller?->role === Role::SELLER, 403);
        $destination = SellerPayoutDestination::query()->where('seller_id', $seller->id)->first();

        return response()->json([
            'destination' => $destination ? $this->maskedDestination($destination) : null,
            'consent' => [
                'version' => self::CONSENT_VERSION,
                'notice' => self::OPERATIONAL_NOTICE,
            ],
        ])->header('Cache-Control', 'private, no-store');
    }

    public function save(Request $request): JsonResponse
    {
        $seller = $request->user();
        abort_unless($seller?->role === Role::SELLER, 403);

        $data = $request->validate([
            'current_password' => ['required', 'current_password:web'],
            'destination_type' => ['required', Rule::in(['BANK', 'GCASH'])],
            'account_holder' => ['required', 'string', 'min:2', 'max:120', 'regex:/\\S/'],
            'bank_name' => ['required_if:destination_type,BANK', 'prohibited_unless:destination_type,BANK', 'string', 'min:2', 'max:100', 'regex:/\\S/'],
            'account_number' => ['required_if:destination_type,BANK', 'prohibited_unless:destination_type,BANK', 'string', 'min:4', 'max:40', 'regex:/^(?=.*[A-Za-z0-9])[A-Za-z0-9 -]+$/'],
            'wallet_number' => ['required_if:destination_type,GCASH', 'prohibited_unless:destination_type,GCASH', 'string', 'regex:/^\\+?[0-9][0-9 -]{6,19}$/'],
            'consent_accepted' => ['required', 'accepted'],
            'consent_version' => ['required', Rule::in([self::CONSENT_VERSION])],
            'payout_policy_id' => ['required', 'integer', 'exists:seller_payout_policies,id'],
        ]);
        $effectivePolicy = app(SellerPayoutPolicyService::class)->effective();
        abort_unless($effectivePolicy && $effectivePolicy->id === (int) $data['payout_policy_id'], 409, 'Review and acknowledge the current effective payout policy before setting up payout details.');
        abort_unless(SellerPayoutPolicyAcknowledgement::query()
            ->where('seller_id', $seller->id)
            ->where('seller_payout_policy_id', $effectivePolicy->id)
            ->exists(), 409, 'Acknowledge the effective payout policy before setting up payout details.');

        $destination = DB::transaction(function () use ($seller, $data): SellerPayoutDestination {
            // Lock the seller row as well so concurrent first-time submissions serialize.
            $lockedSeller = User::query()->whereKey($seller->id)->lockForUpdate()->firstOrFail();
            abort_unless($lockedSeller->role === Role::SELLER, 403);
            $profile = $seller->sellerProfile()->lockForUpdate()->first();
            if ($profile instanceof SellerProfile && ! $profile->is_verified) {
                abort(409, 'Your seller identity must be verified before setting up a payout destination.');
            }

            $destination = SellerPayoutDestination::query()
                ->where('seller_id', $seller->id)
                ->lockForUpdate()
                ->first();

            $fields = [
                'destination_type' => $data['destination_type'],
                'account_holder' => trim($data['account_holder']),
                'bank_name' => $data['destination_type'] === 'BANK' ? trim($data['bank_name']) : null,
                'account_number' => $data['destination_type'] === 'BANK' ? trim($data['account_number']) : null,
                'wallet_number' => $data['destination_type'] === 'GCASH' ? trim($data['wallet_number']) : null,
            ];
            $previousStatus = $destination?->status;
            $isNew = ! $destination;
            $detailsChanged = $isNew || collect($fields)->contains(
                fn (mixed $value, string $key): bool => $destination->{$key} !== $value,
            );
            if ($detailsChanged) {
                $hasInFlightPayout = SellerPayout::query()
                    ->where('seller_id', $seller->id)
                    ->whereIn('status', ['PENDING', 'PROCESSING'])
                    ->lockForUpdate()
                    ->exists();
                abort_if($hasInFlightPayout, 409, 'Resolve pending or processing payouts before changing the verified destination.');
            }

            if ($isNew) {
                $destination = new SellerPayoutDestination(['seller_id' => $seller->id]);
            }

            if ($detailsChanged) {
                $destination->fill($fields);
                $destination->status = 'PENDING_VERIFICATION';
                $destination->verified_by = null;
                $destination->verified_at = null;
            }
            $destination->consent_version = self::CONSENT_VERSION;
            $destination->consent_accepted_at = now();
            $destination->save();

            SellerPayoutDestinationHistory::query()->create([
                'seller_payout_destination_id' => $destination->id,
                'actor_id' => $seller->id,
                'action' => $isNew ? 'SUBMITTED' : ($detailsChanged ? 'UPDATED' : 'CONSENT_RENEWED'),
                'previous_status' => $previousStatus,
                'new_status' => $destination->status,
            ]);

            return $destination;
        });

        return response()->json([
            'message' => 'Payout destination saved for administrator verification.',
            'destination' => $this->maskedDestination($destination),
            'consent' => [
                'version' => self::CONSENT_VERSION,
                'accepted_at' => $destination->consent_accepted_at?->toISOString(),
                'notice' => self::OPERATIONAL_NOTICE,
            ],
        ])->header('Cache-Control', 'private, no-store');
    }

    public function adminIndex(Request $request, SellerPayoutPolicyService $policies): JsonResponse
    {
        $this->requireAdmin($request);
        $effectivePolicy = $policies->effective();
        $destinations = SellerPayoutDestination::query()
            ->with(['seller:id,name', 'verifier:id,name', 'histories.actor:id,name'])
            ->latest('updated_at')
            ->paginate(20);
        $acknowledgements = $effectivePolicy
            ? SellerPayoutPolicyAcknowledgement::query()
                ->where('seller_payout_policy_id', $effectivePolicy->id)
                ->whereIn('seller_id', $destinations->getCollection()->pluck('seller_id'))
                ->get(['seller_id', 'acknowledged_at'])
                ->keyBy('seller_id')
            : collect();

        $destinations->getCollection()->transform(fn (SellerPayoutDestination $destination): array => [
            ...$this->maskedDestination($destination),
            'seller' => [
                'id' => $destination->seller_id,
                'name' => $destination->seller?->name,
            ],
            'effective_policy_version' => $effectivePolicy?->version,
            'effective_policy_acknowledged' => $acknowledgements->has($destination->seller_id),
            'effective_policy_acknowledged_at' => $acknowledgements->get($destination->seller_id)?->acknowledged_at?->toISOString(),
            'verified_by_name' => $destination->verifier?->name,
            'verified_at' => $destination->verified_at?->toISOString(),
            'submitted_at' => $destination->created_at?->toISOString(),
            'verification_history' => $destination->histories->map(fn ($history): array => [
                'action' => $history->action,
                'actor' => $history->actor?->name,
                'reason' => $history->reason,
                'created_at' => $history->created_at?->toISOString(),
            ])->all(),
        ]);

        return response()->json(['destinations' => $destinations])
            ->header('Cache-Control', 'private, no-store');
    }

    public function verify(Request $request, SellerPayoutDestination $destination): JsonResponse
    {
        $this->requireAdmin($request);
        $data = $request->validate(['reason' => ['required', 'string', 'min:8', 'max:500']]);

        return $this->decide($request, $destination, 'VERIFIED', 'VERIFIED', $data['reason']);
    }

    public function reject(Request $request, SellerPayoutDestination $destination): JsonResponse
    {
        $this->requireAdmin($request);
        $data = $request->validate(['reason' => ['required', 'string', 'min:8', 'max:500']]);

        return $this->decide($request, $destination, 'REJECTED', 'REJECTED', $data['reason']);
    }

    private function decide(
        Request $request,
        SellerPayoutDestination $destination,
        string $newStatus,
        string $action,
        string $reason,
    ): JsonResponse {
        $reason = trim(preg_replace('/(?<!\d)(?:\d[ -]?){7,}\d(?!\d)/u', '[masked digits]', $reason) ?? $reason);
        // The global API audit middleware records this value after the controller returns.
        $request->merge(['reason' => $reason]);

        $destination = DB::transaction(function () use ($request, $destination, $newStatus, $action, &$reason): SellerPayoutDestination {
            $locked = SellerPayoutDestination::query()->whereKey($destination->id)->lockForUpdate()->firstOrFail();
            foreach ([$locked->account_holder, $locked->bank_name, $locked->account_number, $locked->wallet_number] as $privateValue) {
                if (filled($privateValue)) {
                    $reason = str_ireplace((string) $privateValue, '[destination detail redacted]', $reason);
                }
            }
            $request->merge(['reason' => $reason]);
            abort_unless($locked->status === 'PENDING_VERIFICATION', 409, 'Only a pending destination can be verified or rejected.');
            $previousStatus = $locked->status;
            $locked->status = $newStatus;
            $locked->verified_by = $newStatus === 'VERIFIED' ? $request->user()->id : null;
            $locked->verified_at = $newStatus === 'VERIFIED' ? now() : null;
            $locked->save();

            SellerPayoutDestinationHistory::query()->create([
                'seller_payout_destination_id' => $locked->id,
                'actor_id' => $request->user()->id,
                'action' => $action,
                'previous_status' => $previousStatus,
                'new_status' => $newStatus,
                'reason' => $reason,
            ]);

            $policyService = app(SellerPayoutPolicyService::class);
            if ($newStatus === 'VERIFIED') {
                SellerPayout::query()
                    ->where('seller_id', $locked->seller_id)
                    ->whereNull('payout_destination_id')
                    ->where('status', 'PENDING_SETUP')
                    ->lockForUpdate()
                    ->get()
                    ->each(fn (SellerPayout $payout) => $policyService->makePayoutEligible($payout, $locked, $request->user()));
            }

            $sellerId = $locked->seller_id;
            $status = $newStatus;
            $message = $newStatus === 'VERIFIED'
                ? 'Your payout destination was approved by Farmgate. Only masked details are shown in Farmgate.'
                : 'Your payout destination was not approved. Review the decision in Farmgate and update your details if needed.';
            DB::afterCommit(function () use ($sellerId, $status, $message): void {
                User::query()->find($sellerId)?->notify(new CodWorkflowStatusNotification(
                    'seller_payout_destination_'.$status,
                    0,
                    'Payout destination',
                    $status,
                    $message,
                ));
            });

            return $locked;
        });

        return response()->json([
            'message' => $newStatus === 'VERIFIED'
                ? 'Seller payout destination verified.'
                : 'Seller payout destination rejected.',
            'destination' => $this->maskedDestination($destination),
        ])->header('Cache-Control', 'private, no-store');
    }

    /**
     * Serialize destination data without ever returning a decrypted account identifier.
     *
     * @return array<string, mixed>
     */
    private function maskedDestination(SellerPayoutDestination $destination): array
    {
        $isBank = $destination->destination_type === 'BANK';

        return [
            'id' => $destination->id,
            'destination_type' => $destination->destination_type,
            'account_holder_masked' => $this->maskName((string) $destination->account_holder),
            'bank_name_masked' => $isBank ? $this->maskText((string) $destination->bank_name) : null,
            'account_number_masked' => $isBank ? $this->maskIdentifier((string) $destination->account_number) : null,
            'wallet_number_masked' => $isBank ? null : $this->maskIdentifier((string) $destination->wallet_number),
            'status' => $destination->status,
            'consent_version' => $destination->consent_version,
            'consent_accepted_at' => $destination->consent_accepted_at?->toISOString(),
            'verified_at' => $destination->verified_at?->toISOString(),
            'updated_at' => $destination->updated_at?->toISOString(),
        ];
    }

    private function maskName(string $value): string
    {
        return collect(preg_split('/\\s+/', trim($value)) ?: [])
            ->filter()
            ->map(fn (string $part): string => mb_substr($part, 0, 1).'***')
            ->implode(' ');
    }

    private function maskText(string $value): string
    {
        return mb_substr(trim($value), 0, 1).'***';
    }

    private function maskIdentifier(string $value): string
    {
        $normalized = preg_replace('/\\s+/', '', $value) ?? $value;
        $lastFour = mb_substr($normalized, -4);

        return '•••• '.$lastFour;
    }

    private function requireAdmin(Request $request): void
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
    }
}
