<?php

namespace App\Http\Controllers\Api;

use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\RiderPayout;
use App\Models\RiderPayoutDestination;
use App\Models\RiderPayoutDestinationHistory;
use App\Models\User;
use App\Notifications\CodWorkflowStatusNotification;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class RiderPayoutDestinationController extends Controller
{
    private const CONSENT_VERSION = 'rider-payout-ops-v1';

    private const OPERATIONAL_NOTICE = 'Provide a bank or GCash destination you control. Farmgate stores it for rider payout operations; submitting it does not initiate a payout or guarantee a transfer. An administrator must verify it before it can be used.';

    public function show(Request $request): JsonResponse
    {
        $rider = $request->user();
        abort_unless($rider?->role === Role::RIDER, 403);
        $destination = RiderPayoutDestination::query()
            ->where('rider_id', $rider->id)
            ->where('is_current', true)
            ->first();

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
        $rider = $request->user();
        abort_unless($rider?->role === Role::RIDER, 403);

        $data = $request->validate([
            'current_password' => ['required', 'current_password:web'],
            'destination_type' => ['required', Rule::in(['BANK', 'GCASH'])],
            'account_holder' => ['required', 'string', 'min:2', 'max:120', 'regex:/\\S/'],
            'bank_name' => ['required_if:destination_type,BANK', 'prohibited_unless:destination_type,BANK', 'string', 'min:2', 'max:100', 'regex:/\\S/'],
            'account_number' => ['required_if:destination_type,BANK', 'prohibited_unless:destination_type,BANK', 'string', 'min:4', 'max:40', 'regex:/^(?=.*[A-Za-z0-9])[A-Za-z0-9 -]+$/'],
            'wallet_number' => ['required_if:destination_type,GCASH', 'prohibited_unless:destination_type,GCASH', 'string', 'regex:/^\\+?[0-9][0-9 -]{6,19}$/'],
            'consent_accepted' => ['required', 'accepted'],
            'consent_version' => ['required', Rule::in([self::CONSENT_VERSION])],
        ]);

        $destination = DB::transaction(function () use ($rider, $data): RiderPayoutDestination {
            $lockedRider = User::query()->whereKey($rider->id)->lockForUpdate()->firstOrFail();
            abort_unless($lockedRider->role === Role::RIDER, 403);
            abort_unless($lockedRider->riderProfile()->where('is_verified', true)->exists(), 403, 'An approved rider account is required to set up a payout destination.');

            $destination = RiderPayoutDestination::query()
                ->where('rider_id', $rider->id)
                ->where('is_current', true)
                ->lockForUpdate()
                ->first();
            $fields = [
                'destination_type' => $data['destination_type'],
                'account_holder' => trim($data['account_holder']),
                'bank_name' => $data['destination_type'] === 'BANK' ? trim($data['bank_name']) : null,
                'account_number' => $data['destination_type'] === 'BANK' ? trim($data['account_number']) : null,
                'wallet_number' => $data['destination_type'] === 'GCASH' ? trim($data['wallet_number']) : null,
            ];
            $isNew = ! $destination;
            $fieldsChanged = $isNew || collect($fields)->contains(
                fn (mixed $value, string $key): bool => $destination->{$key} !== $value,
            );
            $previousStatus = $destination?->status;
            $detailsChanged = $fieldsChanged || $destination?->status === 'REJECTED';

            if ($destination && $detailsChanged) {
                $hasLinkedPendingPayout = RiderPayout::query()
                    ->where('rider_id', $rider->id)
                    ->where('destination_id', $destination->id)
                    ->whereIn('status', ['PENDING', 'PROCESSING'])
                    ->lockForUpdate()
                    ->exists();
                abort_if($hasLinkedPendingPayout, 409, 'Resolve pending payouts linked to this destination before changing it.');
            }

            if ($detailsChanged) {
                if ($destination) {
                    $previousDestination = $destination;
                    $destination->status = 'REPLACED';
                    $destination->is_current = false;
                    $destination->save();
                    RiderPayoutDestinationHistory::query()->create([
                        'rider_payout_destination_id' => $previousDestination->id,
                        'actor_id' => $rider->id,
                        'action' => 'SUPERSEDED',
                        'previous_status' => $previousStatus,
                        'new_status' => 'REPLACED',
                    ]);
                }
                $destination = new RiderPayoutDestination(['rider_id' => $rider->id, 'is_current' => true]);
                $destination->fill($fields);
                $destination->status = 'PENDING_VERIFICATION';
                $destination->verified_by = null;
                $destination->verified_at = null;
            }
            $destination->consent_version = self::CONSENT_VERSION;
            $destination->consent_accepted_at = now();
            $destination->save();

            RiderPayoutDestinationHistory::query()->create([
                'rider_payout_destination_id' => $destination->id,
                'actor_id' => $rider->id,
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

    public function adminIndex(Request $request): JsonResponse
    {
        $this->requireAdmin($request);
        $destinations = RiderPayoutDestination::query()
            ->with(['rider:id,name', 'verifier:id,name', 'histories.actor:id,name'])
            ->latest('updated_at')
            ->paginate(20);

        $destinations->getCollection()->transform(fn (RiderPayoutDestination $destination): array => [
            ...$this->maskedDestination($destination),
            'rider' => [
                'id' => $destination->rider_id,
                'name' => $destination->rider?->name,
            ],
            'verified_by_name' => $destination->verifier?->name,
            'verification_history' => $destination->histories->map(fn (RiderPayoutDestinationHistory $history): array => [
                'action' => $history->action,
                'actor' => $history->actor?->name,
                'reason' => $history->reason,
                'created_at' => $history->created_at?->toISOString(),
            ])->all(),
        ]);

        return response()->json(['destinations' => $destinations])
            ->header('Cache-Control', 'private, no-store');
    }

    public function verify(Request $request, RiderPayoutDestination $destination): JsonResponse
    {
        $this->requireAdmin($request);
        $data = $request->validate(['reason' => ['required', 'string', 'min:8', 'max:500']]);

        return $this->decide($request, $destination, 'VERIFIED', 'VERIFIED', $data['reason']);
    }

    public function reject(Request $request, RiderPayoutDestination $destination): JsonResponse
    {
        $this->requireAdmin($request);
        $data = $request->validate(['reason' => ['required', 'string', 'min:8', 'max:500']]);

        return $this->decide($request, $destination, 'REJECTED', 'REJECTED', $data['reason']);
    }

    private function decide(
        Request $request,
        RiderPayoutDestination $destination,
        string $newStatus,
        string $action,
        string $reason,
    ): JsonResponse {
        $destination = DB::transaction(function () use ($request, $destination, $newStatus, $action, &$reason): RiderPayoutDestination {
            $unassignedPendingPayoutIds = $newStatus === 'VERIFIED'
                ? RiderPayout::query()
                    ->where('rider_id', $destination->rider_id)
                    ->whereNull('destination_id')
                    ->where('status', 'PENDING')
                    ->orderBy('id')
                    ->lockForUpdate()
                    ->pluck('id')
                : collect();
            $locked = RiderPayoutDestination::query()->whereKey($destination->id)->lockForUpdate()->firstOrFail();
            foreach ([$locked->account_holder, $locked->bank_name, $locked->account_number, $locked->wallet_number] as $privateValue) {
                if (filled($privateValue)) {
                    $reason = str_ireplace((string) $privateValue, '[destination detail redacted]', $reason);
                    $normalizedPrivateValue = preg_replace('/\\s+/', '', (string) $privateValue) ?? (string) $privateValue;
                    if ($normalizedPrivateValue !== $privateValue) {
                        $reason = str_ireplace($normalizedPrivateValue, '[destination detail redacted]', $reason);
                    }
                }
            }
            $reason = trim(preg_replace('/(?<!\\d)(?:\\d[ -]?){3,}\\d(?!\\d)/u', '[masked digits]', $reason) ?? $reason);
            abort_if(mb_strlen($reason) < 8, 422, 'The sanitized decision reason must contain at least eight characters.');
            $request->merge(['reason' => $reason]);
            abort_unless(
                $locked->is_current && $locked->status === 'PENDING_VERIFICATION',
                409,
                'Only a current pending destination can be verified or rejected.',
            );

            $previousStatus = $locked->status;
            $locked->status = $newStatus;
            $locked->verified_by = $newStatus === 'VERIFIED' ? $request->user()->id : null;
            $locked->verified_at = $newStatus === 'VERIFIED' ? now() : null;
            $locked->save();

            RiderPayoutDestinationHistory::query()->create([
                'rider_payout_destination_id' => $locked->id,
                'actor_id' => $request->user()->id,
                'action' => $action,
                'previous_status' => $previousStatus,
                'new_status' => $newStatus,
                'reason' => $reason,
            ]);

            if ($newStatus === 'VERIFIED' && $unassignedPendingPayoutIds->isNotEmpty()) {
                RiderPayout::query()
                    ->whereIn('id', $unassignedPendingPayoutIds)
                    ->update(['destination_id' => $locked->id]);
            }

            $riderId = $locked->rider_id;
            $message = $newStatus === 'VERIFIED'
                ? 'Your rider payout destination was verified. Only masked details are shown in Farmgate.'
                : 'Your rider payout destination was not approved. Review the decision and update your details if needed.';
            DB::afterCommit(function () use ($riderId, $newStatus, $message): void {
                User::query()->find($riderId)?->notify(new CodWorkflowStatusNotification(
                    'rider_payout_destination_'.$newStatus,
                    0,
                    'Rider payout destination',
                    $newStatus,
                    $message,
                ));
            });

            return $locked;
        });

        return response()->json([
            'message' => $newStatus === 'VERIFIED'
                ? 'Rider payout destination verified.'
                : 'Rider payout destination rejected.',
            'destination' => $this->maskedDestination($destination),
        ])->header('Cache-Control', 'private, no-store');
    }

    /**
     * @return array<string, mixed>
     */
    private function maskedDestination(RiderPayoutDestination $destination): array
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
            'is_current' => $destination->is_current,
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

        return '•••• '.mb_substr($normalized, -4);
    }

    private function requireAdmin(Request $request): void
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
    }
}
