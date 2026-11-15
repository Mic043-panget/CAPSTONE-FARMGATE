<?php

namespace App\Http\Controllers\Api\Admin;

use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\RiderPayout;
use App\Services\RiderPayoutService;
use App\Services\SystemSettingsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class RiderPayoutController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $this->admin($request);
        $data = $request->validate([
            'group' => ['nullable', Rule::in(['queue', 'recorded'])],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:50'],
        ]);
        $status = ($data['group'] ?? 'queue') === 'recorded' ? 'PAID' : 'PENDING';
        $payouts = RiderPayout::query()
            ->where('status', $status)
            ->with([
                'rider:id,name',
                'recorder:id,name',
                'earning.delivery:id,delivery_reference,order_id',
                'earning.order:id,order_reference,delivery_fee',
                'histories.actor:id,name',
            ])
            ->latest()
            ->paginate((int) ($data['per_page'] ?? 20))
            ->withQueryString();

        return response()->json(['payouts' => $payouts]);
    }

    public function confirmManual(
        Request $request,
        RiderPayout $payout,
        RiderPayoutService $service,
        SystemSettingsService $settings,
    ): JsonResponse {
        $this->admin($request);
        $data = $request->validate([
            'external_reference' => ['required', 'string', 'min:4', 'max:100', 'regex:/^[A-Za-z0-9._:-]+$/'],
            'method' => ['required', 'string', 'max:24'],
            'amount_cents' => ['required', 'integer', 'min:1', 'max:999999999999'],
            'paid_at' => ['required', 'date', 'after_or_equal:'.$payout->created_at->toDateString(), 'before_or_equal:today'],
            'reason' => ['required', 'string', 'min:8', 'max:500'],
            'externally_completed_confirmed' => ['required', 'accepted'],
        ]);
        $reason = $settings->sanitizeFinancialReason($data['reason']);
        abort_if(mb_strlen((string) $reason) < 8, 422, 'The sanitized payout reason must contain at least eight characters.');

        return response()->json([
            'message' => 'Externally completed rider payout recorded. Farmgate did not initiate a transfer.',
            'payout' => $service->confirmManualPayout(
                $payout,
                $request->user(),
                $data['external_reference'],
                $data['method'],
                $reason,
                $data['paid_at'],
                (int) $data['amount_cents'],
            ),
        ], 201);
    }

    private function admin(Request $request): void
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
    }
}
