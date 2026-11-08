<?php

namespace App\Http\Controllers\Api\Seller;

use App\Enums\Role;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ProfileController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        abort_unless($request->user()?->role === Role::SELLER, 403);

        $profile = $request->user()->sellerProfile()->firstOrCreate([]);

        return response()->json(['profile' => $profile->refresh()]);
    }

    public function update(Request $request): JsonResponse
    {
        abort_unless($request->user()?->role === Role::SELLER, 403);

        $data = $request->validate([
            'latitude' => ['required', 'numeric', 'between:-90,90'],
            'longitude' => ['required', 'numeric', 'between:-180,180'],
            'pickup_barangay' => ['nullable', 'string', 'max:120'],
            'pickup_city_municipality' => ['nullable', 'string', 'max:120'],
            'pickup_province' => ['nullable', 'string', 'max:120'],
        ]);

        $profile = $request->user()->sellerProfile()->firstOrCreate([]);
        $profile->fill($data + ['pickup_location_confirmed' => true])->save();

        return response()->json(['profile' => $profile->refresh()]);
    }
}
