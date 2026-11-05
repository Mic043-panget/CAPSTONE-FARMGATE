<?php

namespace App\Http\Controllers\Api\Admin;

use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\DeliveryRateTier;
use App\Models\SystemSettingHistory;
use App\Services\SystemSettingsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class SettingsController extends Controller
{
    public function show(Request $request, SystemSettingsService $settings): JsonResponse
    {
        $this->admin($request);
        return response()->json($this->payload($settings));
    }

    public function key(Request $request, string $key, SystemSettingsService $settings): JsonResponse
    {
        $this->admin($request);
        abort_unless(array_key_exists($key, $settings->definitions()), 404);
        return response()->json(['key' => $key, 'value' => $settings->get($key), 'definition' => $settings->definitions()[$key]]);
    }

    public function categories(Request $request, SystemSettingsService $settings): JsonResponse
    {
        $this->admin($request);
        return response()->json(['categories' => collect($settings->definitions())->groupBy('category')]);
    }

    public function history(Request $request): JsonResponse
    {
        $this->admin($request);
        return response()->json(['history' => SystemSettingHistory::query()->with('actor:id,name,email')->latest()->paginate(15)]);
    }

    public function update(Request $request, SystemSettingsService $settings): JsonResponse
    {
        $this->admin($request);
        $data = $request->validate(['settings' => ['required', 'array'], 'reason' => ['nullable', 'string', 'max:255']]);
        $settings->update($data['settings'], $request->user()->id, $data['reason'] ?? null);
        return $this->show($request, $settings);
    }

    public function updateKey(Request $request, string $key, SystemSettingsService $settings): JsonResponse
    {
        $this->admin($request);
        abort_unless(array_key_exists($key, $settings->definitions()), 404);
        $data = $request->validate(['value' => ['present'], 'reason' => ['nullable', 'string', 'max:255']]);
        $settings->update([$key => $data['value']], $request->user()->id, $data['reason'] ?? null);
        return response()->json(['key' => $key, 'value' => $settings->get($key)]);
    }

    public function tiers(Request $request): JsonResponse
    {
        $this->admin($request);
        return response()->json(['tiers' => DeliveryRateTier::query()->orderBy('min_km')->get()]);
    }

    public function storeTier(Request $request): JsonResponse
    {
        $this->admin($request);
        $data = $this->validatedTier($request);
        $this->assertNoOverlap($data);
        $tier = DeliveryRateTier::create($data);
        return response()->json(['tier' => $tier], 201);
    }

    public function updateTier(Request $request, DeliveryRateTier $tier): JsonResponse
    {
        $this->admin($request);
        $data = $this->validatedTier($request);
        $this->assertNoOverlap($data, $tier->id);
        $tier->update($data);
        return response()->json(['tier' => $tier]);
    }

    public function destroyTier(Request $request, DeliveryRateTier $tier): JsonResponse
    {
        $this->admin($request);
        $tier->delete();
        return response()->json(['message' => 'Delivery tier deleted.']);
    }

    private function payload(SystemSettingsService $settings): array
    {
        return ['settings' => $settings->values(), 'definitions' => $settings->definitions(), 'tiers' => DeliveryRateTier::query()->orderBy('min_km')->get(), 'history' => SystemSettingHistory::query()->with('actor:id,name,email')->latest()->paginate(15)];
    }

    private function validatedTier(Request $request): array
    {
        return $request->validate([
            'name' => ['nullable', 'string', 'max:120'],
            'min_km' => ['required', 'numeric', 'min:0'],
            'max_km' => ['nullable', 'numeric', 'gt:min_km'],
            'base_fee' => ['required', 'numeric', 'min:0'],
            'fee_per_km' => ['required', 'numeric', 'min:0'],
            'priority' => ['nullable', 'integer', 'min:0'],
            'is_active' => ['sometimes', 'boolean'],
        ]);
    }

    private function assertNoOverlap(array $candidate, ?int $ignoreId = null): void
    {
        if (($candidate['is_active'] ?? true) !== true) return;
        $tiers = DeliveryRateTier::query()->where('is_active', true)->when($ignoreId, fn ($query) => $query->whereKeyNot($ignoreId))->get();
        foreach ($tiers as $other) {
            $thisStartsBeforeOtherEnds = $other->max_km === null || (float) $candidate['min_km'] < (float) $other->max_km;
            $otherStartsBeforeThisEnds = ($candidate['max_km'] ?? null) === null || (float) $other->min_km < (float) $candidate['max_km'];
            if ($thisStartsBeforeOtherEnds && $otherStartsBeforeThisEnds) {
                abort(422, 'Delivery distance tiers cannot overlap.');
            }
        }
    }

    private function admin(Request $request): void
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
    }
}
