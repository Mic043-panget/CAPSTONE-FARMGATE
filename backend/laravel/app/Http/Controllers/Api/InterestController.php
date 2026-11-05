<?php

namespace App\Http\Controllers\Api;

use App\Enums\InterestStatus;
use App\Enums\ListingStatus;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\Interest;
use App\Models\LivestockListing;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class InterestController extends Controller
{
    public function toggle(Request $request, LivestockListing $listing): JsonResponse
    {
        abort_unless($request->user()?->role === Role::BUYER, 403);
        abort_unless($listing->status === ListingStatus::ACTIVE, 409);

        $interest = DB::transaction(function () use ($request, $listing): ?Interest {
            $interest = Interest::withTrashed()->where([
                'buyer_id' => $request->user()->id,
                'livestock_listing_id' => $listing->id,
            ])->first();

            if ($interest) {
                if ($interest->trashed()) {
                    $interest->restore();

                    return $interest;
                }

                $interest->delete();

                return null;
            }

            $newInterest = new Interest(['status' => InterestStatus::INTERESTED]);
            $newInterest->buyer_id = $request->user()->id;
            $newInterest->livestock_listing_id = $listing->id;
            $newInterest->save();

            return $newInterest;
        });

        return response()->json([
            'interested' => $interest !== null,
            'interest' => $interest,
        ]);
    }

    public function mine(Request $request): JsonResponse
    {
        abort_unless($request->user()?->role === Role::BUYER, 403);

        return response()->json(['interests' => $request->user()->interests()->with(['listing.category', 'listing.images'])->latest()->get()]);
    }

    public function sellerAnalytics(Request $request): JsonResponse
    {
        abort_unless($request->user()?->role === Role::SELLER, 403);

        $interests = Interest::query()
            ->whereHas('listing', fn ($query) => $query->where('seller_id', $request->user()->id))
            ->with(['listing:id,name', 'buyer:id,name']);
        $pendingTotal = (clone $interests)->where('status', InterestStatus::INTERESTED->value)->count();
        $paginatedInterests = $interests->latest()->paginate(15);

        return response()->json([
            'total' => $paginatedInterests->total(),
            'pending_total' => $pendingTotal,
            'interests' => $paginatedInterests,
        ]);
    }

    public function updateStatus(Request $request, Interest $interest): JsonResponse
    {
        abort_unless($request->user()?->role === Role::SELLER, 403);
        abort_unless($interest->listing()->where('seller_id', $request->user()->id)->exists(), 403);

        $data = $request->validate(['status' => ['required', Rule::enum(InterestStatus::class)]]);
        $interest->update(['status' => $data['status']]);

        return response()->json(['interest' => $interest]);
    }
}
