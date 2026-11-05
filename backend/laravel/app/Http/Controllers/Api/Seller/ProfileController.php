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

        $profile = $request->user()->sellerProfile()->firstOrCreate([], [
            'latitude' => 12.7321,
            'longitude' => 121.3654,
        ]);

        if ($profile->latitude === null || $profile->longitude === null) {
            $profile->fill([
                'latitude' => $profile->latitude ?? 12.7321,
                'longitude' => $profile->longitude ?? 121.3654,
            ])->save();
        }

        return response()->json(['profile' => $profile->refresh()]);
    }

    public function update(Request $request): JsonResponse
    {
        abort_unless($request->user()?->role === Role::SELLER, 403);

        $data = $request->validate([
            'latitude' => ['required', 'numeric', 'between:-90,90'],
            'longitude' => ['required', 'numeric', 'between:-180,180'],
        ]);

        $profile = $request->user()->sellerProfile()->firstOrCreate([]);
        $profile->fill($data)->save();

        return response()->json(['profile' => $profile->refresh()]);
    }
}
