<?php

namespace App\Http\Controllers\Api;

use App\Enums\DeliveryStatus;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\Complaint;
use App\Models\Delivery;
use App\Models\RiderEarning;
use App\Models\RiderEarningHistory;
use App\Models\RiderPayout;
use App\Models\RiderPayoutDestination;
use App\Models\RiderPayoutDestinationHistory;
use App\Models\RiderPayoutHistory;
use App\Models\RiderPayoutMethod;
use App\Models\RiderPayoutMethodHistory;
use App\Models\RiderProfile;
use App\Models\User;
use App\Notifications\RiderPayoutStatusNotification;
use App\Rules\ValidFarmgateImage;
use App\Services\ImageUploadService;
use App\Support\FarmgateImage;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Throwable;

class RiderPayoutController extends Controller
{
    private const DESTINATION_CONSENT_VERSION = 'rider-payout-ops-v1';

    private const DESTINATION_OPERATIONAL_NOTICE = 'Provide a bank or GCash destination you control. Farmgate stores it for rider payout operations; submitting it does not initiate a payout or guarantee a transfer. An administrator must verify it before it can be used.';

    public function earnings(Request $request): JsonResponse
    {
        $rider = $request->user();
        abort_unless($rider?->role === Role::RIDER, 403);
        $query = RiderEarning::query()->where('rider_id', $rider->id)->with([
            'payout:id,reference,status,amount_cents,paid_at,destination_id',
            'payout.destination',
            'payouts:id,reference,status,amount_cents,paid_at,transfer_date,destination_id,receipt_path,created_at',
            'payouts.destination',
        ]);
        $earnings = $query->latest('completed_at')->paginate(20)->withQueryString();

        return response()->json([
            'earnings' => $earnings->through(fn (RiderEarning $earning): array => $this->earningPayload($earning)),
            'summary' => [
                'available_cents' => (int) RiderEarning::query()->where('rider_id', $rider->id)->where('eligibility_status', 'READY')->where('payout_status', 'AVAILABLE')->sum('net_amount_cents'),
                'pending_cents' => (int) RiderEarning::query()->where('rider_id', $rider->id)->whereIn('eligibility_status', ['PENDING_ELIGIBILITY', 'NEEDS_REVIEW'])->sum('net_amount_cents'),
                'paid_cents' => (int) RiderEarning::query()->where('rider_id', $rider->id)->where('payout_status', 'PAID')->sum('net_amount_cents'),
            ],
        ])->header('Cache-Control', 'private, no-store');
    }

    public function showDestination(Request $request): JsonResponse
    {
        $rider = $request->user();
        abort_unless($rider?->role === Role::RIDER, 403);
        $destination = RiderPayoutDestination::query()
            ->where('rider_id', $rider->id)
            ->where('is_current', true)
            ->first();

        return response()->json([
            'destination' => $destination ? $this->destinationPayload($destination) : null,
            'methods' => RiderPayoutMethod::query()->where('status', 'ACTIVE')->orderBy('method_type')->get(['method_type', 'status']),
            'consent' => [
                'version' => self::DESTINATION_CONSENT_VERSION,
                'notice' => self::DESTINATION_OPERATIONAL_NOTICE,
            ],
            'provider' => ['enabled' => false, 'status' => 'DISABLED_NOT_CONFIGURED'],
        ])->header('Cache-Control', 'private, no-store');
    }

    public function saveDestination(Request $request): JsonResponse
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
            'consent_version' => ['required', Rule::in([self::DESTINATION_CONSENT_VERSION])],
        ]);
        abort_unless(
            RiderPayoutMethod::query()->where('method_type', $data['destination_type'])->where('status', 'ACTIVE')->exists(),
            409,
            'This payout method is not enabled and verified by Farmgate administrators.',
        );

        $destination = DB::transaction(function () use ($rider, $data): RiderPayoutDestination {
            $lockedRider = User::query()->whereKey($rider->id)->lockForUpdate()->firstOrFail();
            abort_unless($lockedRider->role === Role::RIDER, 403);
            abort_unless(
                RiderProfile::query()->where('user_id', $rider->id)->where('is_verified', true)->exists(),
                403,
                'An approved rider account is required to set up a payout destination.',
            );
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
            $fieldsChanged = $isNew || collect($fields)->contains(fn (mixed $value, string $key): bool => $destination->{$key} !== $value);
            $previousStatus = $destination?->status;
            $detailsChanged = $fieldsChanged || $destination?->status === 'REJECTED';
            if ($destination && $detailsChanged) {
                abort_if(
                    RiderPayout::query()
                        ->where('rider_id', $rider->id)
                        ->where('destination_id', $destination->id)
                        ->whereIn('status', ['PENDING', 'PROCESSING'])
                        ->lockForUpdate()
                        ->exists(),
                    409,
                    'Resolve pending or processing payouts before changing the destination.',
                );
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
                        'from_status' => $previousStatus,
                        'to_status' => 'REPLACED',
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
            $destination->consent_version = self::DESTINATION_CONSENT_VERSION;
            $destination->consent_accepted_at = now();
            $destination->save();
            RiderPayoutDestinationHistory::query()->create([
                'rider_payout_destination_id' => $destination->id,
                'actor_id' => $rider->id,
                'action' => $isNew ? 'SUBMITTED' : ($detailsChanged ? 'UPDATED' : 'CONSENT_RENEWED'),
                'from_status' => $previousStatus,
                'to_status' => $destination->status,
                'previous_status' => $previousStatus,
                'new_status' => $destination->status,
                'reason' => 'Rider acknowledged the payout operations notice and submitted or renewed the destination details.',
            ]);

            return $destination;
        });

        return response()->json([
            'message' => 'Payout destination saved for administrator verification.',
            'destination' => $this->destinationPayload($destination),
            'consent' => [
                'version' => self::DESTINATION_CONSENT_VERSION,
                'accepted_at' => $destination->consent_accepted_at?->toISOString(),
                'notice' => self::DESTINATION_OPERATIONAL_NOTICE,
            ],
        ])->header('Cache-Control', 'private, no-store');
    }

    public function adminMethods(Request $request): JsonResponse
    {
        $this->requireAdmin($request);

        return response()->json([
            'methods' => RiderPayoutMethod::query()->with('histories')->orderBy('method_type')->get()->map(fn (RiderPayoutMethod $method): array => [
                'id' => $method->id,
                'method_type' => $method->method_type,
                'status' => $method->status,
                'configured_by' => $method->configured_by,
                'verified_by' => $method->verified_by,
                'verified_at' => $method->verified_at?->toISOString(),
                'history' => $method->histories->map(fn (RiderPayoutMethodHistory $history): array => [
                    'action' => $history->action,
                    'actor_id' => $history->actor_id,
                    'reason' => $history->reason,
                    'created_at' => $history->created_at?->toISOString(),
                ]),
            ]),
            'provider' => ['enabled' => false, 'status' => 'DISABLED_NOT_CONFIGURED'],
        ])->header('Cache-Control', 'private, no-store');
    }

    public function configureMethod(Request $request): JsonResponse
    {
        $admin = $this->requireAdmin($request);
        $data = $request->validate([
            'method_type' => ['required', Rule::in(['BANK', 'GCASH'])],
            'reason' => ['required', 'string', 'min:8', 'max:500'],
        ]);
        $reason = $this->safeReason($data['reason']);
        $request->merge(['reason' => $reason]);

        $method = DB::transaction(function () use ($admin, $data, $reason): RiderPayoutMethod {
            $method = RiderPayoutMethod::query()->where('method_type', $data['method_type'])->lockForUpdate()->first();
            $from = $method?->status;
            $method ??= new RiderPayoutMethod([
                'method_type' => $data['method_type'],
            ]);
            $method->configured_by = $admin->id;
            $method->status = 'PENDING_VERIFICATION';
            $method->verified_by = null;
            $method->verified_at = null;
            $method->save();
            RiderPayoutMethodHistory::query()->create([
                'rider_payout_method_id' => $method->id,
                'actor_id' => $admin->id,
                'action' => 'CONFIGURED',
                'from_status' => $from,
                'to_status' => $method->status,
                'reason' => $reason,
            ]);

            return $method;
        });

        return response()->json(['method' => ['id' => $method->id, 'method_type' => $method->method_type, 'status' => $method->status]], 201);
    }

    public function verifyMethod(Request $request, RiderPayoutMethod $method): JsonResponse
    {
        $admin = $this->requireAdmin($request);
        $data = $request->validate(['reason' => ['required', 'string', 'min:8', 'max:500']]);
        $reason = $this->safeReason($data['reason']);
        $request->merge(['reason' => $reason]);
        $method = DB::transaction(function () use ($admin, $method, $reason): RiderPayoutMethod {
            $locked = RiderPayoutMethod::query()->whereKey($method->id)->lockForUpdate()->firstOrFail();
            abort_unless($locked->status === 'PENDING_VERIFICATION', 409, 'Only a pending payout method can be verified.');
            abort_if($locked->configured_by === $admin->id, 403, 'A different administrator must verify this payout method.');
            $locked->status = 'ACTIVE';
            $locked->verified_by = $admin->id;
            $locked->verified_at = now();
            $locked->save();
            RiderPayoutMethodHistory::query()->create([
                'rider_payout_method_id' => $locked->id,
                'actor_id' => $admin->id,
                'action' => 'VERIFIED',
                'from_status' => 'PENDING_VERIFICATION',
                'to_status' => 'ACTIVE',
                'reason' => $reason,
            ]);

            return $locked;
        });

        return response()->json(['method' => ['id' => $method->id, 'method_type' => $method->method_type, 'status' => $method->status]]);
    }

    public function adminDestinations(Request $request): JsonResponse
    {
        $this->requireAdmin($request);
        $destinations = RiderPayoutDestination::query()
            ->with('rider:id,name')
            ->latest('updated_at')
            ->paginate(20)
            ->through(fn (RiderPayoutDestination $destination): array => [
                ...$this->destinationPayload($destination),
                'rider' => ['id' => $destination->rider_id, 'name' => $destination->rider?->name],
            ]);

        return response()->json(['destinations' => $destinations])->header('Cache-Control', 'private, no-store');
    }

    public function verifyDestination(Request $request, RiderPayoutDestination $destination): JsonResponse
    {
        $admin = $this->requireAdmin($request);
        $data = $request->validate([
            'decision' => ['required', Rule::in(['VERIFIED', 'REJECTED'])],
            'reason' => ['required', 'string', 'min:8', 'max:500'],
        ]);
        $reason = $this->safeReason($data['reason'], $destination);
        $request->merge(['reason' => $reason]);
        $destination = DB::transaction(function () use ($admin, $destination, $data, $reason): RiderPayoutDestination {
            $locked = RiderPayoutDestination::query()->whereKey($destination->id)->lockForUpdate()->firstOrFail();
            abort_unless($locked->status === 'PENDING_VERIFICATION', 409, 'Only a pending destination can be verified or rejected.');
            $previous = $locked->status;
            $locked->status = $data['decision'];
            $locked->verified_by = $data['decision'] === 'VERIFIED' ? $admin->id : null;
            $locked->verified_at = $data['decision'] === 'VERIFIED' ? now() : null;
            $locked->save();
            RiderPayoutDestinationHistory::query()->create([
                'rider_payout_destination_id' => $locked->id,
                'actor_id' => $admin->id,
                'action' => $data['decision'],
                'from_status' => $previous,
                'to_status' => $locked->status,
                'previous_status' => $previous,
                'new_status' => $locked->status,
                'reason' => $reason,
            ]);
            $message = $data['decision'] === 'VERIFIED'
                ? 'Your payout destination was approved. Only masked details are displayed in Farmgate.'
                : 'Your payout destination needs attention. Review the administrator note in Farmgate.';
            $rider = User::query()->findOrFail($locked->rider_id);
            DB::afterCommit(fn () => $rider->notify(new RiderPayoutStatusNotification(
                'DESTINATION',
                $data['decision'],
                0,
                $message,
            )));

            return $locked;
        });

        return response()->json(['destination' => $this->destinationPayload($destination)])->header('Cache-Control', 'private, no-store');
    }

    public function adminEarnings(Request $request): JsonResponse
    {
        $this->requireAdmin($request);
        $data = $request->validate([
            'status' => ['nullable', Rule::in(['PENDING_ELIGIBILITY', 'READY', 'IN_PAYOUT', 'PAID', 'NEEDS_REVIEW', 'NOT_ELIGIBLE'])],
            'search' => ['nullable', 'string', 'max:100'],
            'sort' => ['nullable', Rule::in(['newest', 'oldest', 'amount_desc', 'amount_asc', 'reference_asc'])],
            'per_page' => ['nullable', 'integer', 'min:5', 'max:50'],
        ]);
        $query = RiderEarning::query()->with(['rider:id,name', 'payout:id,reference,status']);
        if (filled($data['status'] ?? null)) {
            if (in_array($data['status'], ['IN_PAYOUT', 'PAID'], true)) {
                $query->where('payout_status', $data['status']);
            } elseif ($data['status'] === 'READY') {
                $query->where('eligibility_status', 'READY')->where('payout_status', 'AVAILABLE');
            } else {
                $query->where('eligibility_status', $data['status']);
            }
        }
        if (filled($data['search'] ?? null)) {
            $term = trim($data['search']);
            $query->where(fn (Builder $builder) => $builder
                ->where('reference', 'like', '%'.$term.'%')
                ->orWhere('delivery_reference', 'like', '%'.$term.'%')
                ->orWhere('order_reference', 'like', '%'.$term.'%')
                ->orWhereHas('rider', fn (Builder $rider) => $rider->where('name', 'like', '%'.$term.'%')));
        }
        $query = match ($data['sort'] ?? 'newest') {
            'oldest' => $query->orderBy('completed_at')->orderBy('id'),
            'amount_desc' => $query->orderByDesc('net_amount_cents')->orderByDesc('id'),
            'amount_asc' => $query->orderBy('net_amount_cents')->orderBy('id'),
            'reference_asc' => $query->orderBy('reference')->orderBy('id'),
            default => $query->orderByDesc('completed_at')->orderByDesc('id'),
        };
        $earnings = $query->with('histories.actor:id,name')->paginate((int) ($data['per_page'] ?? 20))->withQueryString();

        return response()->json(['earnings' => $earnings->through(fn (RiderEarning $earning): array => [
            ...$this->earningPayload($earning),
            'rider' => ['id' => $earning->rider_id, 'name' => $earning->rider?->name],
            'calculation_snapshot' => $earning->calculation_snapshot,
            'history' => $earning->histories->map(fn (RiderEarningHistory $history): array => [
                'action' => $history->action,
                'actor' => $history->actor?->name ?? 'System',
                'reason' => $history->reason,
                'snapshot' => $history->snapshot,
                'created_at' => $history->created_at?->toISOString(),
            ])->all(),
        ])])->header('Cache-Control', 'private, no-store');
    }

    public function adminPayouts(Request $request): JsonResponse
    {
        $this->requireAdmin($request);
        $data = $request->validate([
            'status' => ['nullable', Rule::in(['PENDING', 'PROCESSING', 'PAID', 'FAILED', 'NEEDS_REVIEW'])],
            'search' => ['nullable', 'string', 'max:100'],
            'sort' => ['nullable', Rule::in(['newest', 'oldest', 'amount_desc', 'amount_asc', 'reference_asc'])],
            'per_page' => ['nullable', 'integer', 'min:5', 'max:50'],
        ]);
        $query = RiderPayout::query()->with(['rider:id,name', 'destination', 'earnings', 'histories.actor:id,name']);
        if (filled($data['status'] ?? null)) {
            $query->where('status', $data['status']);
        }
        if (filled($data['search'] ?? null)) {
            $term = trim($data['search']);
            $query->where(fn (Builder $builder) => $builder
                ->where('reference', 'like', '%'.$term.'%')
                ->orWhereHas('rider', fn (Builder $rider) => $rider->where('name', 'like', '%'.$term.'%'))
                ->orWhereHas('earnings', fn (Builder $earning) => $earning
                    ->where('delivery_reference', 'like', '%'.$term.'%')
                    ->orWhere('order_reference', 'like', '%'.$term.'%')));
        }
        $query = match ($data['sort'] ?? 'newest') {
            'oldest' => $query->orderBy('created_at')->orderBy('id'),
            'amount_desc' => $query->orderByDesc('amount_cents')->orderByDesc('id'),
            'amount_asc' => $query->orderBy('amount_cents')->orderBy('id'),
            'reference_asc' => $query->orderBy('reference')->orderBy('id'),
            default => $query->orderByDesc('created_at')->orderByDesc('id'),
        };
        $payouts = $query->paginate((int) ($data['per_page'] ?? 20))->withQueryString();

        return response()->json(['payouts' => $payouts->through(fn (RiderPayout $payout): array => $this->payoutPayload($payout, true))])
            ->header('Cache-Control', 'private, no-store');
    }

    public function createPayout(Request $request): JsonResponse
    {
        $admin = $this->requireAdmin($request);
        $data = $request->validate([
            'earning_id' => ['required', 'integer', 'exists:rider_earnings,id'],
            'reason' => ['required', 'string', 'min:8', 'max:500'],
            'idempotency_key' => ['required', 'string', 'min:16', 'max:100', 'regex:/^[A-Za-z0-9._:-]+$/'],
        ]);
        $reason = $this->safeReason($data['reason']);
        $request->merge(['reason' => $reason]);

        $payout = DB::transaction(function () use ($admin, $data, $reason): RiderPayout {
            $existing = RiderPayout::query()->with('earnings')->where('idempotency_key', $data['idempotency_key'])->lockForUpdate()->first();
            if ($existing) {
                abort_unless($existing->earnings->contains('id', (int) $data['earning_id']), 409, 'This idempotency key belongs to a different delivery payout.');

                return $existing;
            }
            $earning = RiderEarning::query()->whereKey($data['earning_id'])->lockForUpdate()->firstOrFail();
            abort_unless($earning->eligibility_status === 'READY' && $earning->payout_status === 'AVAILABLE', 409, 'Only ready, unpaid delivery earnings can be paid.');
            $rider = User::query()->whereKey($earning->rider_id)->lockForUpdate()->firstOrFail();
            abort_unless($rider->role === Role::RIDER, 422, 'The payout recipient must be a rider.');
            $destination = RiderPayoutDestination::query()->where('rider_id', $rider->id)->where('status', 'VERIFIED')->lockForUpdate()->first();
            abort_unless($destination, 409, 'The rider needs an administrator-verified payout destination.');
            abort_unless(RiderPayoutMethod::query()->where('method_type', $destination->destination_type)->where('status', 'ACTIVE')->exists(), 409, 'The rider payout method is not configured and verified.');
            $amountCents = (int) $earning->net_amount_cents;
            abort_if($amountCents < 1, 409, 'The ready rider earnings total is zero.');

            $payout = RiderPayout::query()->create([
                'reference' => $this->newReference('FG-RP'),
                'rider_id' => $rider->id,
                'destination_id' => $destination->id,
                'created_by' => $admin->id,
                'method' => 'MANUAL_EXTERNAL',
                'status' => 'PENDING',
                'amount_cents' => $amountCents,
                'idempotency_key' => $data['idempotency_key'],
                'creation_reason' => $reason,
            ]);
            $earning->forceFill(['payout_id' => $payout->id, 'payout_status' => 'IN_PAYOUT'])->save();
            $payout->earnings()->attach($earning->id);
            RiderEarningHistory::query()->create([
                'rider_earning_id' => $earning->id,
                'actor_id' => $admin->id,
                'action' => 'PAYOUT_CREATED',
                'from_status' => $earning->eligibility_status,
                'to_status' => 'IN_PAYOUT',
                'reason' => 'Payout '.$payout->reference.' created for delivery '.$earning->delivery_reference.'. '.$reason,
                'snapshot' => ['payout_reference' => $payout->reference, 'amount_cents' => $earning->net_amount_cents],
            ]);
            RiderPayoutHistory::query()->create([
                'rider_payout_id' => $payout->id,
                'actor_id' => $admin->id,
                'action' => 'CREATED',
                'to_status' => 'PENDING',
                'reason' => $reason,
                'snapshot' => [
                    'amount_cents' => $amountCents,
                    'earning_id' => $earning->id,
                    'delivery_reference' => $earning->delivery_reference,
                ],
            ]);
            DB::afterCommit(fn () => $rider->notify(new RiderPayoutStatusNotification(
                $payout->reference,
                'APPROVED',
                $amountCents,
                'Your rider payout was approved for manual external transfer. Farmgate has not sent money; payment is recorded only after a separate transfer confirmation.',
            )));

            return $payout->load(['rider:id,name', 'destination', 'earnings']);
        });

        return response()->json(['payout' => $this->payoutPayload($payout, true)], 201)
            ->header('Cache-Control', 'private, no-store');
    }

    public function updatePayoutStatus(Request $request, RiderPayout $payout): JsonResponse
    {
        $admin = $this->requireAdmin($request);
        $data = $request->validate([
            'status' => ['required', Rule::in(['PROCESSING', 'FAILED', 'NEEDS_REVIEW'])],
            'reason' => ['required', 'string', 'min:8', 'max:500'],
        ]);
        $reason = $this->safeReason($data['reason'], $payout->destination);
        $request->merge(['reason' => $reason]);
        $payout = DB::transaction(function () use ($admin, $payout, $data, $reason): RiderPayout {
            $locked = RiderPayout::query()->whereKey($payout->id)->lockForUpdate()->firstOrFail();
            $allowed = match ($locked->status) {
                'PENDING' => ['PROCESSING', 'NEEDS_REVIEW'],
                'PROCESSING' => ['FAILED', 'NEEDS_REVIEW'],
                'NEEDS_REVIEW' => ['PROCESSING', 'FAILED'],
                default => [],
            };
            abort_unless(in_array($data['status'], $allowed, true), 409, 'This payout cannot be moved from its current state.');
            $from = $locked->status;
            $locked->status = $data['status'];
            $locked->save();
            if ($data['status'] === 'FAILED') {
                $locked->earnings()
                    ->where('rider_earnings.payout_id', $locked->id)
                    ->where('rider_earnings.payout_status', 'IN_PAYOUT')
                    ->lockForUpdate()
                    ->get()
                    ->each(function (RiderEarning $earning) use ($admin, $reason): void {
                        $earning->forceFill(['payout_id' => null, 'payout_status' => 'AVAILABLE'])->save();
                        RiderEarningHistory::query()->create([
                            'rider_earning_id' => $earning->id,
                            'actor_id' => $admin->id,
                            'action' => 'PAYOUT_FAILED',
                            'from_status' => 'IN_PAYOUT',
                            'to_status' => 'AVAILABLE',
                            'reason' => $reason,
                        ]);
                    });
            }
            RiderPayoutHistory::query()->create([
                'rider_payout_id' => $locked->id,
                'actor_id' => $admin->id,
                'action' => $data['status'],
                'from_status' => $from,
                'to_status' => $locked->status,
                'reason' => $reason,
            ]);
            if (in_array($data['status'], ['PROCESSING', 'FAILED', 'NEEDS_REVIEW'], true)) {
                $rider = User::query()->findOrFail($locked->rider_id);
                $message = match ($data['status']) {
                    'PROCESSING' => 'An administrator recorded that your payout is being processed through an external transfer. Farmgate did not send money; the payout is not paid until independently confirmed.',
                    'FAILED' => 'Your rider payout needs attention. The external transfer has not been confirmed as paid.',
                    default => 'Your rider payout needs administrator review. Check your payout history for updates.',
                };
                DB::afterCommit(fn () => $rider->notify(new RiderPayoutStatusNotification($locked->reference, $data['status'], $locked->amount_cents, $message)));
            }

            return $locked->load(['rider:id,name', 'destination', 'earnings']);
        });

        return response()->json(['payout' => $this->payoutPayload($payout, true)])->header('Cache-Control', 'private, no-store');
    }

    public function confirmManualTransfer(Request $request, RiderPayout $payout): JsonResponse
    {
        $admin = $this->requireAdmin($request);
        if ($payout->status === 'PAID') {
            return response()->json(['payout' => $this->payoutPayload($payout->load(['rider:id,name', 'destination', 'earnings']), true), 'idempotent' => true])
                ->header('Cache-Control', 'private, no-store');
        }
        $data = $request->validate([
            'transfer_reference' => ['required', 'string', 'min:4', 'max:120', 'regex:/^[A-Za-z0-9._:-]+$/'],
            'amount_cents' => ['required', 'integer', 'min:1', 'max:99999999999'],
            'transfer_date' => ['required', 'date', 'before_or_equal:today'],
            'reason' => ['required', 'string', 'min:8', 'max:500'],
            'receipt' => ['required', 'file', 'mimes:jpg,jpeg,png,webp,pdf', 'max:10240', new ValidFarmgateImage(['application/pdf'])],
        ]);
        abort_unless((int) $data['amount_cents'] === (int) $payout->amount_cents, 422, 'The externally transferred amount must match the payout amount exactly.');
        $file = $request->file('receipt');
        $extension = $file->guessExtension();
        abort_if(! $extension, 422, 'The private transfer receipt type could not be identified.');
        $path = 'rider-payout-receipts/'.Str::random(40).'.'.$extension;
        $mime = $file->getMimeType() ?? 'application/octet-stream';
        try {
            if (FarmgateImage::isImage($file)) {
                $stored = app(ImageUploadService::class)->storeEvidence($file, 'rider-payout-receipts', 'delivery_proofs');
                $path = $stored['path'];
                $sha256 = $stored['sha256'];
                $mime = $stored['mime_type'];
            } else {
                $storedPath = $file->storeAs('rider-payout-receipts', basename($path), 'delivery_proofs');
                $sha256 = hash_file('sha256', $file->getRealPath());
                abort_unless($storedPath === $path && Storage::disk('delivery_proofs')->exists($path) && is_string($sha256), 503, 'The private transfer receipt could not be securely stored. Please retry.');
            }
            $reason = $this->safeReason($data['reason'], $payout->destination);
            $request->merge(['reason' => $reason]);
            $payout = DB::transaction(function () use ($admin, $payout, $data, $path, $sha256, $mime, $reason): RiderPayout {
                $locked = RiderPayout::query()->whereKey($payout->id)->lockForUpdate()->firstOrFail();
                if ($locked->status === 'PAID') {
                    return $locked;
                }
                abort_unless($locked->status === 'PROCESSING', 409, 'Only a processing payout can be confirmed as paid.');
                abort_unless($locked->created_by !== $admin->id, 403, 'A different administrator must independently confirm the completed external transfer.');
                abort_unless((int) $data['amount_cents'] === (int) $locked->amount_cents, 422, 'The transfer amount does not match the payout amount.');
                $referenceHash = hash_hmac('sha256', 'RIDER_PAYOUT:'.mb_strtolower(trim($data['transfer_reference'])), (string) config('app.key'));
                abort_if(RiderPayout::query()->where('external_reference_hash', $referenceHash)->exists(), 409, 'This external transfer reference has already been recorded.');
                $from = $locked->status;
                $locked->external_reference = trim($data['transfer_reference']);
                $locked->external_reference_hash = $referenceHash;
                $locked->transfer_date = $data['transfer_date'];
                $locked->receipt_path = $path;
                $locked->receipt_sha256 = $sha256;
                $locked->receipt_mime_type = $mime;
                $locked->confirmed_by = $admin->id;
                $locked->confirmation_reason = $reason;
                $locked->status = 'PAID';
                $locked->paid_at = now();
                $locked->save();
                $locked->earnings()
                    ->where('rider_earnings.payout_id', $locked->id)
                    ->where('rider_earnings.payout_status', 'IN_PAYOUT')
                    ->lockForUpdate()
                    ->get()
                    ->each(function (RiderEarning $earning) use ($admin, $locked, $reason): void {
                        $earning->forceFill(['payout_status' => 'PAID'])->save();
                        RiderEarningHistory::query()->create([
                            'rider_earning_id' => $earning->id,
                            'actor_id' => $admin->id,
                            'action' => 'PAID',
                            'from_status' => 'IN_PAYOUT',
                            'to_status' => 'PAID',
                            'reason' => 'Independently confirmed external transfer for '.$locked->reference.'. '.$reason,
                        ]);
                    });
                RiderPayoutHistory::query()->create([
                    'rider_payout_id' => $locked->id,
                    'actor_id' => $admin->id,
                    'action' => 'MANUAL_TRANSFER_CONFIRMED',
                    'from_status' => $from,
                    'to_status' => 'PAID',
                    'reason' => $reason,
                    'snapshot' => [
                        'amount_cents' => $locked->amount_cents,
                        'transfer_date' => $data['transfer_date'],
                        'transfer_reference_hash' => $referenceHash,
                        'receipt_sha256' => $sha256,
                        'confirmed_by' => $admin->id,
                    ],
                ]);
                $rider = User::query()->findOrFail($locked->rider_id);
                DB::afterCommit(fn () => $rider->notify(new RiderPayoutStatusNotification(
                    $locked->reference,
                    'PAID',
                    $locked->amount_cents,
                    'An administrator independently confirmed your external payout as completed. Farmgate recorded the transfer; Farmgate did not send the money.',
                )));

                return $locked->load(['rider:id,name', 'destination', 'earnings']);
            });
        } catch (Throwable $exception) {
            app(ImageUploadService::class)->deleteEvidence($path, 'delivery_proofs');
            throw $exception;
        }

        return response()->json(['payout' => $this->payoutPayload($payout, true)])->header('Cache-Control', 'private, no-store');
    }

    public function adjustEarning(Request $request, RiderEarning $earning): JsonResponse
    {
        $admin = $this->requireAdmin($request);
        $data = $request->validate([
            'adjustment_cents' => ['required', 'integer', 'between:-99999999999,99999999999', 'not_in:0'],
            'reason' => ['required', 'string', 'min:8', 'max:500'],
        ]);
        $reason = $this->safeReason($data['reason']);
        $request->merge(['reason' => $reason]);
        $earning = DB::transaction(function () use ($admin, $earning, $data, $reason): RiderEarning {
            $locked = RiderEarning::query()->whereKey($earning->id)->lockForUpdate()->firstOrFail();
            abort_unless($locked->payout_status === 'AVAILABLE' && in_array($locked->eligibility_status, ['READY', 'NEEDS_REVIEW', 'PENDING_ELIGIBILITY'], true), 409, 'Only unpaid earnings not assigned to a payout can be adjusted.');
            $delivery = Delivery::query()->with('order')->findOrFail($locked->delivery_id);
            $validEvidence = $delivery->status === DeliveryStatus::DELIVERED
                && $delivery->pickup_verified_at !== null
                && $delivery->delivery_verified_at !== null
                && $delivery->has_delivery_proof
                && $delivery->recipient_confirmed
                && filled($delivery->delivery_recipient_name);
            abort_unless($validEvidence, 409, 'A manual amount correction requires verified delivery and recipient evidence.');
            $newAdjustment = (int) $locked->adjustment_cents + (int) $data['adjustment_cents'];
            $newNet = (int) $locked->gross_amount_cents - (int) $locked->deductions_cents + $newAdjustment;
            abort_if($newNet < 0, 422, 'The adjustment cannot make net earnings negative.');
            $locked->adjustment_cents = $newAdjustment;
            $locked->net_amount_cents = $newNet;
            if (in_array($locked->eligibility_status, ['NEEDS_REVIEW', 'PENDING_ELIGIBILITY'], true)) {
                $activeDispute = Complaint::query()->where('order_id', $locked->order_id)->whereIn('status', ['OPEN', 'UNDER_REVIEW'])->exists();
                if ($activeDispute) {
                    $locked->eligibility_status = 'NEEDS_REVIEW';
                } elseif ($newNet > 0) {
                    $locked->eligibility_status = 'READY';
                    $locked->eligibility_reason = 'Administrator reviewed delivery evidence and the adjustment; earning is payable.';
                }
            }
            $locked->save();
            RiderEarningHistory::query()->create([
                'rider_earning_id' => $locked->id,
                'actor_id' => $admin->id,
                'action' => 'ADJUSTED',
                'from_status' => 'READY',
                'to_status' => $locked->eligibility_status,
                'adjustment_cents' => (int) $data['adjustment_cents'],
                'reason' => $reason,
                'snapshot' => ['gross_amount_cents' => $locked->gross_amount_cents, 'net_amount_cents' => $newNet],
            ]);

            return $locked->load('payout:id,reference,status');
        });

        return response()->json(['earning' => $this->earningPayload($earning)])->header('Cache-Control', 'private, no-store');
    }

    public function reviewEarning(Request $request, RiderEarning $earning): JsonResponse
    {
        $admin = $this->requireAdmin($request);
        $data = $request->validate([
            'decision' => ['required', Rule::in(['APPROVE', 'REJECT'])],
            'reason' => ['required', 'string', 'min:8', 'max:500'],
        ]);
        $reason = $this->safeReason($data['reason']);
        $request->merge(['reason' => $reason]);
        $earning = DB::transaction(function () use ($admin, $earning, $data, $reason): RiderEarning {
            $locked = RiderEarning::query()->whereKey($earning->id)->lockForUpdate()->firstOrFail();
            abort_unless(in_array($locked->eligibility_status, ['PENDING_ELIGIBILITY', 'NEEDS_REVIEW'], true), 409, 'Only pending or review-required earnings can be decided.');
            abort_unless($locked->payout_status === 'AVAILABLE', 409, 'An earning already assigned to a payout cannot be reviewed.');
            $from = $locked->eligibility_status;
            if ($data['decision'] === 'APPROVE') {
                $delivery = Delivery::query()->with('order')->findOrFail($locked->delivery_id);
                $validEvidence = $delivery->status === DeliveryStatus::DELIVERED
                    && $delivery->pickup_verified_at !== null
                    && $delivery->delivery_verified_at !== null
                    && $delivery->has_delivery_proof
                    && $delivery->recipient_confirmed
                    && filled($delivery->delivery_recipient_name);
                abort_unless($validEvidence, 409, 'The delivery is not verified and completed with required evidence.');
                abort_if(Complaint::query()->where('order_id', $locked->order_id)->whereIn('status', ['OPEN', 'UNDER_REVIEW'])->exists(), 409, 'Resolve the open order dispute before approving this earning.');
                abort_unless($locked->net_amount_cents > 0, 409, 'Configure an earning amount before approving this record.');
                $locked->eligibility_status = 'READY';
                $locked->eligibility_reason = 'Approved by an administrator after reviewing delivery evidence and dispute status.';
            } else {
                $locked->eligibility_status = 'NOT_ELIGIBLE';
                $locked->eligibility_reason = 'Marked not eligible by an administrator after review.';
            }
            $locked->save();
            RiderEarningHistory::query()->create([
                'rider_earning_id' => $locked->id,
                'actor_id' => $admin->id,
                'action' => 'REVIEWED',
                'from_status' => $from,
                'to_status' => $locked->eligibility_status,
                'reason' => $reason,
                'snapshot' => ['decision' => $data['decision']],
            ]);

            return $locked->load('payout:id,reference,status');
        });

        return response()->json(['earning' => $this->earningPayload($earning)])->header('Cache-Control', 'private, no-store');
    }

    public function receipt(Request $request, RiderPayout $payout): StreamedResponse
    {
        $user = $request->user();
        abort_unless($user?->role === Role::ADMIN || $user?->role === Role::RIDER && $payout->rider_id === $user->id, 403);
        abort_unless($payout->status === 'PAID' && filled($payout->receipt_path), 404, 'Private payout receipt is unavailable.');
        $disk = Storage::disk('delivery_proofs');
        $previewPath = app(ImageUploadService::class)->previewPath($payout->receipt_path);
        $usePreview = $disk->exists($previewPath);
        $path = $usePreview ? $previewPath : $payout->receipt_path;
        abort_unless($disk->exists($path), 404, 'Private payout receipt could not be found.');

        return response()->stream(function () use ($disk, $path): void {
            $stream = $disk->readStream($path);
            if (! is_resource($stream)) {
                throw new \RuntimeException('Private payout receipt could not be opened.');
            }
            try {
                fpassthru($stream);
            } finally {
                fclose($stream);
            }
        }, 200, [
            'Content-Type' => $usePreview ? 'image/webp' : ($payout->receipt_mime_type ?? 'application/octet-stream'),
            'Content-Disposition' => 'attachment; filename="rider-payout-receipt"',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
            'X-Frame-Options' => 'DENY',
        ]);
    }

    private function earningPayload(RiderEarning $earning): array
    {
        $payout = $earning->payout;

        return [
            'id' => $earning->id,
            'reference' => $earning->reference,
            'delivery_reference' => $earning->delivery_reference,
            'order_reference' => $earning->order_reference,
            'completed_at' => $earning->completed_at?->toISOString(),
            'delivery_fee_cents' => $earning->delivery_fee_cents,
            'gross_amount_cents' => $earning->gross_amount_cents,
            'deductions_cents' => $earning->deductions_cents,
            'adjustment_cents' => $earning->adjustment_cents,
            'net_amount_cents' => $earning->net_amount_cents,
            'eligibility_status' => $earning->eligibility_status,
            'eligibility_reason' => $earning->eligibility_reason,
            'payout_status' => $earning->payout_status,
            'payout_reference' => $payout?->reference,
            'payout' => $payout ? [
                'reference' => $payout->reference,
                'status' => $payout->status,
                'amount_cents' => $payout->amount_cents,
                'date' => $payout->paid_at?->toISOString(),
                'destination' => $payout->destination ? $this->destinationPayload($payout->destination) : null,
                'receipt_url' => $payout->status === 'PAID' && $payout->receipt_path ? route('rider-payouts.receipt', $payout) : null,
            ] : null,
            'payout_history' => $earning->relationLoaded('payouts') ? $earning->payouts->map(fn (RiderPayout $attempt): array => [
                'reference' => $attempt->reference,
                'status' => $attempt->status,
                'amount_cents' => $attempt->amount_cents,
                'date' => $attempt->transfer_date?->toDateString() ?? $attempt->paid_at?->toDateString() ?? $attempt->created_at?->toDateString(),
                'destination' => $attempt->destination ? $this->destinationPayload($attempt->destination) : null,
                'receipt_url' => $attempt->status === 'PAID' && $attempt->receipt_path ? route('rider-payouts.receipt', $attempt) : null,
            ])->all() : [],
        ];
    }

    private function payoutPayload(RiderPayout $payout, bool $includeHistory = false): array
    {
        $payload = [
            'id' => $payout->id,
            'reference' => $payout->reference,
            'rider' => $payout->relationLoaded('rider') ? ['id' => $payout->rider_id, 'name' => $payout->rider?->name] : null,
            'amount_cents' => $payout->amount_cents,
            'method' => $payout->method,
            'status' => $payout->status,
            'destination' => $payout->destination ? $this->destinationPayload($payout->destination) : null,
            'transfer_reference_masked' => $payout->external_reference ? '•••• '.mb_substr($payout->external_reference, -4) : null,
            'transfer_date' => $payout->transfer_date?->toDateString(),
            'paid_at' => $payout->paid_at?->toISOString(),
            'receipt_url' => $payout->status === 'PAID' && $payout->receipt_path ? route('rider-payouts.receipt', $payout) : null,
            'earnings' => $payout->relationLoaded('earnings') ? $payout->earnings->map(fn (RiderEarning $earning): array => [
                'reference' => $earning->reference,
                'delivery_reference' => $earning->delivery_reference,
                'order_reference' => $earning->order_reference,
                'amount_cents' => $earning->net_amount_cents,
            ])->all() : [],
            'created_at' => $payout->created_at?->toISOString(),
        ];
        if ($includeHistory && $payout->relationLoaded('histories')) {
            $payload['history'] = $payout->histories->map(fn (RiderPayoutHistory $history): array => [
                'action' => $history->action,
                'from_status' => $history->from_status,
                'to_status' => $history->to_status,
                'reason' => $history->reason,
                'actor' => $history->actor?->name,
                'created_at' => $history->created_at?->toISOString(),
            ])->all();
        }

        return $payload;
    }

    private function destinationPayload(RiderPayoutDestination $destination): array
    {
        $bank = $destination->destination_type === 'BANK';
        $account = $bank ? (string) $destination->account_number : (string) $destination->wallet_number;
        $normalized = preg_replace('/\\s+/', '', $account) ?? $account;

        return [
            'id' => $destination->id,
            'destination_type' => $destination->destination_type,
            'account_holder_masked' => collect(preg_split('/\\s+/', trim((string) $destination->account_holder)) ?: [])
                ->filter()->map(fn (string $part): string => mb_substr($part, 0, 1).'***')->implode(' '),
            'bank_name_masked' => $bank ? mb_substr(trim((string) $destination->bank_name), 0, 1).'***' : null,
            'account_number_masked' => $bank ? '•••• '.mb_substr($normalized, -4) : null,
            'wallet_number_masked' => $bank ? null : '•••• '.mb_substr($normalized, -4),
            'status' => $destination->status,
            'consent_version' => $destination->consent_version,
            'is_current' => $destination->is_current,
            'verified_at' => $destination->verified_at?->toISOString(),
            'updated_at' => $destination->updated_at?->toISOString(),
        ];
    }

    private function safeReason(string $reason, ?RiderPayoutDestination $destination = null): string
    {
        $reason = trim(preg_replace('/(?<!\\d)(?:\\d[ -]?){7,}\\d(?!\\d)/u', '[masked digits]', $reason) ?? $reason);
        if ($destination) {
            foreach ([$destination->account_holder, $destination->bank_name, $destination->account_number, $destination->wallet_number] as $privateValue) {
                if (filled($privateValue)) {
                    $reason = str_ireplace((string) $privateValue, '[destination detail redacted]', $reason);
                }
            }
        }

        return $reason;
    }

    private function requireAdmin(Request $request): User
    {
        $admin = $request->user();
        abort_unless($admin?->role === Role::ADMIN, 403);

        return $admin;
    }

    private function newReference(string $prefix): string
    {
        do {
            $reference = $prefix.'-'.now()->format('Y').'-'.Str::upper(Str::random(10));
        } while (RiderPayout::query()->where('reference', $reference)->exists());

        return $reference;
    }
}
