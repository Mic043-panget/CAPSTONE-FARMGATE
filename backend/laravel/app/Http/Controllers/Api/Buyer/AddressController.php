<?php

namespace App\Http\Controllers\Api\Buyer;

use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\BuyerAddress;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AddressController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $this->authorizeBuyer($request);

        return response()->json(['addresses' => $request->user()->buyerAddresses()->get()]);
    }

    public function store(Request $request): JsonResponse
    {
        $this->authorizeBuyer($request);
        $data = $this->validated($request);
        $user = $request->user();

        $address = DB::transaction(function () use ($user, $data): BuyerAddress {
            $makeDefault = $data['is_default'] || ! $user->buyerAddresses()->exists();
            if ($makeDefault) {
                $user->buyerAddresses()->update(['is_default' => false]);
            }

            $data['is_default'] = $makeDefault;

            return $user->buyerAddresses()->create($data);
        });

        return response()->json(['address' => $address], 201);
    }

    public function update(Request $request, int $address): JsonResponse
    {
        $this->authorizeBuyer($request);
        $user = $request->user();
        $buyerAddress = $user->buyerAddresses()->whereKey($address)->firstOrFail();
        $data = $this->validated($request);

        DB::transaction(function () use ($user, $buyerAddress, $data): void {
            if ($data['is_default']) {
                $user->buyerAddresses()->whereKeyNot($buyerAddress->id)->update(['is_default' => false]);
            } elseif ($buyerAddress->is_default && $user->buyerAddresses()->whereKeyNot($buyerAddress->id)->exists()) {
                $replacement = $user->buyerAddresses()->whereKeyNot($buyerAddress->id)->latest()->first();
                $replacement?->update(['is_default' => true]);
            } else {
                $data['is_default'] = true;
            }

            $buyerAddress->update($data);
        });

        return response()->json(['address' => $buyerAddress->fresh()]);
    }

    public function destroy(Request $request, int $address): JsonResponse
    {
        $this->authorizeBuyer($request);
        $user = $request->user();
        $buyerAddress = $user->buyerAddresses()->whereKey($address)->firstOrFail();

        DB::transaction(function () use ($user, $buyerAddress): void {
            $wasDefault = $buyerAddress->is_default;
            $buyerAddress->delete();

            if ($wasDefault) {
                $replacement = $user->buyerAddresses()->latest()->first();
                $replacement?->update(['is_default' => true]);
            }
        });

        return response()->json(['message' => 'Address deleted.']);
    }

    private function authorizeBuyer(Request $request): void
    {
        abort_unless($request->user()?->role === Role::BUYER, 403);
    }

    private function validated(Request $request): array
    {
        return $request->validate([
            'label' => ['required', 'string', 'max:80'],
            'recipient_name' => ['required', 'string', 'max:120'],
            'phone_number' => ['required', 'string', 'max:30', 'regex:/^[0-9+(). -]{7,30}$/'],
            'province' => ['required', 'string', 'max:100'],
            'city_municipality' => ['required', 'string', 'max:120'],
            'barangay' => ['nullable', 'string', 'max:120'],
            'postal_code' => ['required', 'string', 'max:12'],
            'street_address' => ['required', 'string', 'max:255'],
            'address_line2' => ['nullable', 'string', 'max:255'],
            'delivery_notes' => ['nullable', 'string', 'max:1000'],
            'latitude' => ['required', 'numeric', 'between:-90,90'],
            'longitude' => ['required', 'numeric', 'between:-180,180'],
            'is_default' => ['sometimes', 'boolean'],
        ]) + ['is_default' => $request->boolean('is_default')];
    }
}