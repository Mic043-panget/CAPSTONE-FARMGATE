<?php

namespace App\Http\Controllers\Api\Admin;

use App\Enums\ListingStatus;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Jobs\ModerateListing;
use App\Models\LivestockListing;
use App\Models\User;
use App\Notifications\ListingModerationNeedsReviewNotification;
use App\Services\SystemSettingsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Validation\Rule;

class ListingController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
        $sort = $request->validate([
            'sort' => ['nullable', Rule::in(['created_at', 'name', 'status', 'quantity'])],
            'direction' => ['nullable', Rule::in(['asc', 'desc'])],
        ]);
        $status = $request->input('status');
        $query = LivestockListing::query()
            ->with(['category:id,name', 'seller:id,name,email', 'images', 'latestModerationAttempt'])
            ->when($request->filled('status') && $status !== 'ALL', function ($query) use ($status): void {
                abort_unless(in_array($status, array_map(fn (ListingStatus $item): string => $item->value, ListingStatus::cases()), true), 422);
                $query->where('status', $status);
            })
            ->when(! $request->filled('status') && ! $request->filled('moderation_status'), fn ($query) => $query->where('status', ListingStatus::PENDING_REVIEW));

        if ($request->filled('moderation_status')) {
            $moderationStatus = $request->input('moderation_status');
            abort_unless(in_array($moderationStatus, ['PROCESSING', 'AUTO_APPROVED', 'AUTO_REJECTED', 'MANUAL_REVIEW', 'FLAGGED', 'FAILED', 'SUPERSEDED'], true), 422);
            $query->whereHas('latestModerationAttempt', fn ($attempt) => $attempt->where('status', $moderationStatus));
        }

        if ($request->filled('search')) {
            $search = '%'.trim((string) $request->input('search')).'%';
            $query->where(function ($builder) use ($search): void {
                $builder->where('name', 'like', $search)
                    ->orWhere('breed', 'like', $search)
                    ->orWhereHas('seller', fn ($seller) => $seller->where('name', 'like', $search)->orWhere('email', 'like', $search));
            });
        }

        if ($request->filled('category_id')) {
            $query->where('category_id', (int) $request->input('category_id'));
        }

        $query->orderBy($sort['sort'] ?? 'created_at', $sort['direction'] ?? 'desc')->orderBy('id');

        return response()->json(['listings' => $query->paginate(15)->withQueryString()]);
    }

    public function show(Request $request, LivestockListing $listing): JsonResponse
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);

        return response()->json([
            'listing' => $listing->load([
                'category:id,name',
                'seller:id,name,email,phone_number',
                'images',
                'moderationAttempts' => fn ($query) => $query->latest('id'),
            ]),
        ]);
    }

    public function retryModeration(Request $request, LivestockListing $listing): JsonResponse
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
        abort_unless($listing->status === ListingStatus::PENDING_REVIEW, 409);
        abort_unless($listing->latestModerationAttempt?->status === 'FAILED', 409, 'Only failed moderation can be retried.');

        $dispatched = RateLimiter::attempt(
            'listing-moderation-retry:'.$listing->id,
            1,
            function () use ($listing): bool {
                ModerateListing::dispatch($listing->id)->onConnection('database')->afterCommit();

                return true;
            },
            60,
        );
        abort_if($dispatched === false, 429, 'Please wait before retrying moderation for this listing.');

        return response()->json(['message' => 'AI moderation retry queued.']);
    }

    public function review(Request $request, LivestockListing $listing, SystemSettingsService $settings): JsonResponse
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
        $data = $request->validate(['status' => ['required', Rule::in([
            ListingStatus::ACTIVE->value,
            ListingStatus::REJECTED->value,
            ListingStatus::DISABLED->value,
        ])], 'reason' => ['nullable', 'string', 'max:500']]);
        DB::transaction(function () use ($request, $listing, $data, $settings): void {
            $locked = LivestockListing::query()->lockForUpdate()->findOrFail($listing->id);
            abort_unless($locked->status === ListingStatus::PENDING_REVIEW, 409);

            if ($data['status'] === ListingStatus::ACTIVE->value) {
                User::query()->lockForUpdate()->findOrFail($locked->seller_id);
                $limit = max(0, $settings->getInt('maximum_active_listings'));
                $activeCount = LivestockListing::query()
                    ->where('seller_id', $locked->seller_id)
                    ->where('status', ListingStatus::ACTIVE)
                    ->whereKeyNot($locked->id)
                    ->count();
                abort_if($limit === 0 || $activeCount >= $limit, 422, 'Maximum active listings reached.');
            }
            $locked->update(['status' => $data['status']]);
            $attempt = $locked->moderationAttempts()->latest('id')->lockForUpdate()->first();
            $override = [
                'final_listing_status' => $locked->fresh()->status->value,
                'applied_automatically' => false,
                'admin_override_by' => $request->user()->id,
                'admin_override_reason' => $data['reason'] ?? null,
                'completed_at' => now(),
            ];
            if ($attempt) {
                $attempt->update($override);
            } else {
                $locked->moderationAttempts()->create($override + [
                    'seller_id' => $locked->seller_id,
                    'attempt_number' => 1,
                    'status' => 'ADMIN_OVERRIDE',
                    'response_summary' => 'Administrator reviewed the listing without a completed AI decision.',
                ]);
            }
        });

        $listing = $listing->fresh();
        $listing->seller?->notify(new ListingModerationNeedsReviewNotification(
            $listing->id,
            $listing->name,
            match ($listing->status) {
                ListingStatus::ACTIVE => 'ADMIN_APPROVED',
                ListingStatus::REJECTED => 'ADMIN_REJECTED',
                default => 'ADMIN_DISABLED',
            },
            filled($data['reason'] ?? null) ? [$data['reason']] : [],
            [],
        ));

        return response()->json(['listing' => $listing->load(['category', 'seller:id,name,email', 'images', 'latestModerationAttempt'])]);
    }
}
