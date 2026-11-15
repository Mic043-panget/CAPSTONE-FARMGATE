<?php

namespace App\Http\Controllers\Api;

use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\RiderEarning;
use App\Models\RiderEarningsSetting;
use App\Models\RiderPayout;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RiderEarningsController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        abort_unless($request->user()?->role === Role::RIDER, 403);
        $filters = $request->validate([
            'page' => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:50'],
        ]);
        $riderId = $request->user()->id;
        $setting = RiderEarningsSetting::query()->find(RiderEarningsSetting::SINGLETON_ID);
        $earnings = RiderEarning::query()
            ->where('rider_id', $riderId)
            ->with([
                'delivery:id,delivery_reference,status,delivery_verified_at',
                'order:id,order_reference,delivery_fee',
                'payout:id,rider_earning_id,amount_cents,status,paid_at',
            ])
            ->latest('calculated_at')
            ->paginate((int) ($filters['per_page'] ?? 10))
            ->withQueryString();

        return response()->json([
            'configuration_status' => $setting?->isConfigured() ? 'CONFIGURED' : 'NOT_CONFIGURED',
            'earnings' => $earnings,
            'summary' => [
                'earned_cents' => RiderEarning::query()->where('rider_id', $riderId)->sum('amount_cents'),
                'pending_payout_cents' => RiderPayout::query()->where('rider_id', $riderId)->where('status', 'PENDING')->sum('amount_cents'),
                'paid_payout_cents' => RiderPayout::query()->where('rider_id', $riderId)->where('status', 'PAID')->sum('amount_cents'),
            ],
        ]);
    }
}
