<?php

namespace App\Http\Controllers\Api\Admin;

use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\RiderEarningSettingHistory;
use App\Models\RiderEarningsSetting;
use App\Services\SystemSettingsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class RiderEarningsSettingsController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        $this->admin($request);
        $setting = RiderEarningsSetting::query()
            ->with('updater:id,name')
            ->find(RiderEarningsSetting::SINGLETON_ID);
        $history = RiderEarningSettingHistory::query()
            ->with('actor:id,name')
            ->latest()
            ->limit(25)
            ->get();

        return response()->json([
            'setting' => $setting,
            'configured' => $setting?->isConfigured() ?? false,
            'history' => $history,
        ]);
    }

    public function update(Request $request, SystemSettingsService $settings): JsonResponse
    {
        $this->admin($request);
        $data = $request->validate([
            'percentage' => ['required', 'numeric', 'between:0,100', 'decimal:0,2'],
            'cap_scope' => ['required', Rule::in(['NO_CAP', 'PER_DELIVERY', 'PER_PAYOUT'])],
            'cap_amount' => ['sometimes', 'nullable', 'numeric', 'gt:0', 'max:9999999999.99', 'decimal:0,2'],
            'reason' => ['required', 'string', 'min:8', 'max:255'],
        ]);

        if ($data['cap_scope'] === 'NO_CAP') {
            abort_if(
                filled($data['cap_amount'] ?? null),
                422,
                'A cap amount must be blank when the explicit no-cap option is selected.',
            );
            $data['cap_amount'] = null;
        } else {
            validator($data, ['cap_amount' => ['required', 'numeric', 'gt:0', 'max:9999999999.99', 'decimal:0,2']])->validate();
        }

        $reason = $settings->sanitizeFinancialReason($data['reason']);
        abort_if(mb_strlen((string) $reason) < 8, 422, 'The sanitized audit reason must contain at least eight characters.');
        $percentage = number_format((float) $data['percentage'], 2, '.', '');
        $capAmount = isset($data['cap_amount']) ? number_format((float) $data['cap_amount'], 2, '.', '') : null;

        DB::transaction(function () use ($request, $percentage, $data, $capAmount, $reason): void {
            $setting = RiderEarningsSetting::query()
                ->lockForUpdate()
                ->find(RiderEarningsSetting::SINGLETON_ID);
            $oldPercentage = $setting?->percentage;
            $oldCapScope = $setting?->cap_scope;
            $oldCapAmount = $setting?->cap_amount;

            if ($setting
                && $oldPercentage === $percentage
                && $oldCapScope === $data['cap_scope']
                && $oldCapAmount === $capAmount) {
                return;
            }

            if (! $setting) {
                $setting = new RiderEarningsSetting;
                $setting->id = RiderEarningsSetting::SINGLETON_ID;
            }
            $setting->fill([
                'percentage' => $percentage,
                'cap_scope' => $data['cap_scope'],
                'cap_amount' => $capAmount,
                'updated_by' => $request->user()->id,
                'change_reason' => $reason,
            ])->save();

            RiderEarningSettingHistory::query()->create([
                'rider_earnings_setting_id' => $setting->id,
                'actor_id' => $request->user()->id,
                'old_percentage' => $oldPercentage,
                'new_percentage' => $percentage,
                'old_cap_scope' => $oldCapScope,
                'new_cap_scope' => $data['cap_scope'],
                'old_cap_amount' => $oldCapAmount,
                'new_cap_amount' => $capAmount,
                'reason' => $reason,
            ]);
        });

        return $this->show($request);
    }

    private function admin(Request $request): void
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
    }
}
