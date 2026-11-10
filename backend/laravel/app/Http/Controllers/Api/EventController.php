<?php

namespace App\Http\Controllers\Api;

use App\Enums\DeliveryStatus;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Delivery;
use App\Models\FarmgateEvent;
use App\Models\FarmgateEventHistory;
use App\Models\SellerPromotion;
use App\Models\User;
use App\Notifications\CalendarEventNotification;
use App\Services\SystemSettingsService;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class EventController extends Controller
{
    private const CATEGORIES = ['FARMGATE_EVENT', 'PROMOTION_CAMPAIGN', 'SELLER_EVENT', 'ADMIN_ACTIVITY'];

    private const AUDIENCES = ['PUBLIC', 'BUYERS', 'SELLERS', 'RIDERS', 'ADMINS'];

    public function calendar(Request $request, SystemSettingsService $settings): JsonResponse
    {
        $user = $request->user();
        abort_unless($user !== null, 401);
        $filters = $request->validate([
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:from'],
            'timezone' => ['nullable', 'timezone'],
            'category' => ['nullable', Rule::in([...self::CATEGORIES, 'SELLER_PROMOTION', 'RIDER_DELIVERY'])],
            'status' => ['nullable', 'string', 'max:20'],
            'audience' => ['nullable', Rule::in(self::AUDIENCES)],
            'creator_id' => ['nullable', 'integer', 'min:1'],
            'search' => ['nullable', 'string', 'max:120'],
            'page' => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $timezone = (string) ($filters['timezone'] ?? config('app.timezone', 'Asia/Manila'));
        $from = isset($filters['from']) ? CarbonImmutable::parse($filters['from'], $timezone)->startOfDay()->utc() : now()->startOfMonth()->utc()->toImmutable();
        $to = isset($filters['to']) ? CarbonImmutable::parse($filters['to'], $timezone)->endOfDay()->utc() : now()->endOfMonth()->utc()->toImmutable();
        abort_if($from->diffInDays($to) > 400, 422, 'Choose a calendar date range of 400 days or less.');

        $entries = $this->calendarEvents($user, $from, $to, $filters, $timezone)
            ->concat($this->calendarPromotions($user, $from, $to, $filters, $timezone, max(0, $settings->getInt('listing_expiration_days'))));

        if ($user->role === Role::RIDER && (! isset($filters['category']) || $filters['category'] === 'RIDER_DELIVERY')) {
            $entries = $entries->concat($this->riderSchedule($user->id, $from, $to, $filters, $timezone));
        }

        if (! empty($filters['status'])) {
            $entries = $entries->filter(fn (array $entry): bool => $entry['status'] === $filters['status']
                || ($entry['workflow_status'] ?? null) === $filters['status']);
        }
        $entries = $entries->sortBy(fn (array $entry): string => $entry['starts_at'].'|'.$entry['title'])->values();
        $page = (int) ($filters['page'] ?? 1);
        $perPage = (int) ($filters['per_page'] ?? 25);

        return response()->json([
            'data' => $entries->forPage($page, $perPage)->values(),
            'current_page' => $page,
            'last_page' => max(1, (int) ceil($entries->count() / $perPage)),
            'total' => $entries->count(),
            'timezone' => $timezone,
        ]);
    }

    public function publicIndex(): JsonResponse
    {
        $events = FarmgateEvent::query()
            ->where('status', 'APPROVED')
            ->where('audience', 'PUBLIC')
            ->where('ends_at', '>=', now())
            ->with('organizer:id,name')
            ->orderBy('starts_at')
            ->paginate(12);
        $events->getCollection()->transform(fn (FarmgateEvent $event): array => $this->eventPayload($event));

        return response()->json([
            'events' => $events,
        ]);
    }

    public function show(Request $request, FarmgateEvent $event): JsonResponse
    {
        $user = $request->user();
        $audience = match ($user?->role) {
            Role::BUYER => 'BUYERS',
            Role::SELLER => 'SELLERS',
            Role::RIDER => 'RIDERS',
            default => 'NONE',
        };
        $isOrganizer = $user?->role === Role::SELLER && $event->organizer_id === $user->id;
        $isVisible = $event->status === 'APPROVED'
            && ($user?->role === Role::BUYER
                ? $event->audience === 'PUBLIC'
                : in_array($event->audience, ['PUBLIC', $audience], true));
        abort_unless($user?->role === Role::ADMIN || $isOrganizer || $isVisible, 404);

        return response()->json(['event' => [
            'id' => $event->id,
            'title' => $event->title,
            'starts_at' => $event->starts_at->toIso8601String(),
            'ends_at' => $event->ends_at->toIso8601String(),
            'promotion_id' => $event->promotion_id,
            'image_url' => $this->eventImageUrl($event->image_path),
        ]]);
    }

    public function showPromotion(Request $request, SellerPromotion $promotion, SystemSettingsService $settings): JsonResponse
    {
        $user = $request->user();
        $isOwner = $user?->role === Role::SELLER && $promotion->seller_id === $user->id;
        abort_unless($user?->role === Role::ADMIN || $isOwner || $this->promotionIsVisibleToBuyer($promotion, max(0, $settings->getInt('listing_expiration_days'))), 404);

        return response()->json(['promotion' => [
            'id' => $promotion->id,
            'name' => $promotion->name,
            'starts_at' => $promotion->starts_at->toIso8601String(),
            'ends_at' => $promotion->ends_at->toIso8601String(),
        ]]);
    }

    public function sellerIndex(Request $request): JsonResponse
    {
        abort_unless($request->user()?->role === Role::SELLER, 403);

        $events = FarmgateEvent::query()
            ->where('organizer_id', $request->user()->id)
            ->latest()
            ->paginate(12);
        $events->getCollection()->transform(fn (FarmgateEvent $event): array => $this->eventPayload($event));

        return response()->json([
            'events' => $events,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless(in_array($user?->role, [Role::ADMIN, Role::SELLER], true), 403);
        $data = $this->validated($request, $user->role === Role::ADMIN);
        $image = $data['image'] ?? null;
        unset($data['image']);
        $imagePath = $image?->storePublicly('calendar-events', 'public');
        if ($image && (! is_string($imagePath) || $imagePath === '')) {
            throw new \RuntimeException('Calendar event image storage failed.');
        }

        try {
            $event = DB::transaction(function () use ($user, $data, $imagePath): FarmgateEvent {
                $this->assertNoOverlap($data, $user->id);
                $status = $user->role === Role::ADMIN ? 'APPROVED' : 'SUBMITTED';
                $event = FarmgateEvent::create([
                    ...$data,
                    'image_path' => $imagePath,
                    'organizer_id' => $user->id,
                    'status' => $status,
                    'reviewed_by' => $user->role === Role::ADMIN ? $user->id : null,
                    'reviewed_at' => $user->role === Role::ADMIN ? now() : null,
                ]);
                $this->recordHistory($event, $user, $user->role === Role::ADMIN ? 'created' : 'submitted', null, $this->historyValues($event));
                $this->audit($user->id, 'calendar.event.'.strtolower($status), $event, $this->historyValues($event));

                return $event;
            });
        } catch (\Throwable $exception) {
            if ($imagePath) {
                Storage::disk('public')->delete($imagePath);
            }
            throw $exception;
        }

        $this->notifyEvent($event, $event->status === 'SUBMITTED' ? 'submitted' : 'created');

        return response()->json(['event' => $this->eventPayload($event->load('organizer:id,name'))], 201);
    }

    public function update(Request $request, FarmgateEvent $event): JsonResponse
    {
        $user = $request->user();
        abort_unless($user?->role === Role::ADMIN || ($user?->role === Role::SELLER && $event->organizer_id === $user->id), 403);
        abort_unless(in_array($event->status, ['SUBMITTED', 'APPROVED'], true), 409, 'This event can no longer be edited.');
        $data = $this->validated($request, $user->role === Role::ADMIN, updating: true);
        $image = $data['image'] ?? null;
        $removeImage = (bool) ($data['remove_image'] ?? false);
        unset($data['image'], $data['remove_image']);
        $newImagePath = $image?->storePublicly('calendar-events', 'public');
        if ($image && (! is_string($newImagePath) || $newImagePath === '')) {
            throw new \RuntimeException('Calendar event image storage failed.');
        }
        $oldImagePath = null;
        try {
            $updated = DB::transaction(function () use ($user, $event, $data, $newImagePath, $removeImage, &$oldImagePath): FarmgateEvent {
                $locked = FarmgateEvent::query()->lockForUpdate()->findOrFail($event->id);
                abort_unless(in_array($locked->status, ['SUBMITTED', 'APPROVED'], true), 409);
                $before = $this->historyValues($locked);
                $this->assertNoOverlap($data, $user->id, $locked->id);
                if ($newImagePath !== null || $removeImage) {
                    $oldImagePath = $locked->image_path;
                    $data['image_path'] = $newImagePath;
                }
                if ($user->role === Role::SELLER && $locked->status === 'APPROVED') {
                    $data['status'] = 'SUBMITTED';
                    $data['reviewed_by'] = null;
                    $data['reviewed_at'] = null;
                    $data['review_reason'] = null;
                }
                $locked->update($data);
                $this->recordHistory($locked, $user, 'updated', $before, $this->historyValues($locked));
                $this->audit($user->id, 'calendar.event.updated', $locked, $this->historyValues($locked), $before);

                return $locked->fresh()->load('organizer:id,name');
            });
        } catch (\Throwable $exception) {
            if ($newImagePath) {
                Storage::disk('public')->delete($newImagePath);
            }
            throw $exception;
        }
        if ($oldImagePath && $oldImagePath !== $newImagePath) {
            Storage::disk('public')->delete($oldImagePath);
        }
        $this->notifyEvent($updated, $updated->status === 'SUBMITTED' ? 'submitted' : 'updated');

        return response()->json(['event' => $this->eventPayload($updated)]);
    }

    public function cancel(Request $request, FarmgateEvent $event): JsonResponse
    {
        $user = $request->user();
        abort_unless($user?->role === Role::ADMIN || ($user?->role === Role::SELLER && $event->organizer_id === $user->id), 403);
        abort_unless(in_array($event->status, ['SUBMITTED', 'APPROVED'], true), 409, 'This event is already cancelled or closed.');
        $data = $request->validate(['reason' => ['nullable', 'string', 'max:500']]);
        $updated = DB::transaction(function () use ($event, $user, $data): FarmgateEvent {
            $locked = FarmgateEvent::query()->lockForUpdate()->findOrFail($event->id);
            abort_unless(in_array($locked->status, ['SUBMITTED', 'APPROVED'], true), 409);
            $before = $this->historyValues($locked);
            $locked->update(['status' => 'CANCELLED', 'review_reason' => $data['reason'] ?? null]);
            $this->recordHistory($locked, $user, 'cancelled', $before, $this->historyValues($locked), $data['reason'] ?? null);
            $this->audit($user->id, 'calendar.event.cancelled', $locked, $this->historyValues($locked), $before);

            return $locked->fresh()->load('organizer:id,name');
        });
        $this->notifyEvent($updated, 'cancelled');

        return response()->json(['event' => $updated]);
    }

    public function adminIndex(Request $request): JsonResponse
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
        $filters = $request->validate([
            'status' => ['nullable', Rule::in(['SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED'])],
            'search' => ['nullable', 'string', 'max:120'],
            'sort' => ['nullable', Rule::in(['submitted_desc', 'submitted_asc', 'title_asc', 'title_desc', 'organizer_asc', 'event_date_asc', 'event_date_desc', 'status_asc'])],
        ]);
        $query = FarmgateEvent::query()->with(['organizer:id,name', 'reviewer:id,name']);
        if (! empty($filters['status'])) {
            $query->where('status', $filters['status']);
        }
        if (! empty($filters['search'])) {
            $search = trim($filters['search']);
            $query->where(function (Builder $searchQuery) use ($search): void {
                $searchQuery->where('title', 'like', '%'.$search.'%')
                    ->orWhere('category', 'like', '%'.$search.'%')
                    ->orWhereHas('organizer', fn (Builder $organizer) => $organizer->where('name', 'like', '%'.$search.'%'));
            });
        }

        $sort = $filters['sort'] ?? 'submitted_desc';
        match ($sort) {
            'submitted_asc' => $query->orderBy('created_at'),
            'title_asc' => $query->orderBy('title'),
            'title_desc' => $query->orderByDesc('title'),
            'organizer_asc' => $query->join('users as event_organizers', 'event_organizers.id', '=', 'farmgate_events.organizer_id')
                ->orderBy('event_organizers.name')
                ->select('farmgate_events.*'),
            'event_date_asc' => $query->orderBy('starts_at'),
            'event_date_desc' => $query->orderByDesc('starts_at'),
            'status_asc' => $query->orderBy('status'),
            default => $query->latest(),
        };
        $events = $query->paginate(15)->withQueryString();
        $events->getCollection()->transform(fn (FarmgateEvent $event): array => [
            ...$event->toArray(),
            'image_url' => $this->eventImageUrl($event->image_path),
        ]);

        return response()->json([
            'events' => $events,
            'submitted_count' => FarmgateEvent::query()->where('status', 'SUBMITTED')->count(),
        ]);
    }

    public function adminShow(Request $request, FarmgateEvent $event): JsonResponse
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);

        $event->load(['organizer:id,name', 'reviewer:id,name', 'promotion:id,name,status,starts_at,ends_at', 'history.actor:id,name']);

        return response()->json(['event' => [
            ...$event->toArray(),
            'image_url' => $this->eventImageUrl($event->image_path),
        ]]);
    }

    public function decide(Request $request, FarmgateEvent $event): JsonResponse
    {
        $admin = $request->user();
        abort_unless($admin?->role === Role::ADMIN, 403);
        $data = $request->validate([
            'status' => ['required', Rule::in(['APPROVED', 'REJECTED'])],
            'reason' => ['required_if:status,REJECTED', 'nullable', 'string', 'max:500'],
        ]);

        $updated = DB::transaction(function () use ($admin, $data, $event): FarmgateEvent {
            $locked = FarmgateEvent::query()->lockForUpdate()->findOrFail($event->id);
            abort_unless($locked->status === 'SUBMITTED', 409, 'This event has already been reviewed.');
            $before = $this->historyValues($locked);
            $locked->update([
                'status' => $data['status'],
                'reviewed_by' => $admin->id,
                'reviewed_at' => now(),
                'review_reason' => $data['reason'] ?? null,
            ]);
            $this->recordHistory($locked, $admin, strtolower($data['status']), $before, $this->historyValues($locked), $data['reason'] ?? null);
            $this->audit($admin->id, 'admin.event.'.strtolower($data['status']), $locked, $this->historyValues($locked), $before);

            return $locked->fresh()->load(['organizer:id,name', 'reviewer:id,name']);
        });
        $this->notifyEvent($updated, strtolower($data['status']));

        return response()->json(['event' => $updated]);
    }

    public function history(Request $request, FarmgateEvent $event): JsonResponse
    {
        $user = $request->user();
        abort_unless($user?->role === Role::ADMIN || ($user?->role === Role::SELLER && $event->organizer_id === $user->id), 403);

        return response()->json(['history' => $event->history()->get()]);
    }

    private function calendarEvents(User $user, CarbonImmutable $from, CarbonImmutable $to, array $filters, string $timezone): Collection
    {
        if (isset($filters['category']) && ! in_array($filters['category'], self::CATEGORIES, true)) {
            return collect();
        }
        $query = FarmgateEvent::query()->with('organizer:id,name')
            ->where('starts_at', '<=', $to)
            ->where('ends_at', '>=', $from)
            ->whereNull('promotion_id');
        if ($user->role === Role::ADMIN) {
            if (! empty($filters['audience'])) {
                $query->where('audience', $filters['audience']);
            }
            if (! empty($filters['creator_id'])) {
                $query->where('organizer_id', $filters['creator_id']);
            }
            if (! empty($filters['status']) && in_array($filters['status'], ['SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED'], true)) {
                $query->where('status', $filters['status']);
            }
        } else {
            $audience = match ($user->role) {
                Role::BUYER => 'PUBLIC',
                Role::SELLER => 'SELLERS',
                Role::RIDER => 'RIDERS',
                default => 'NONE',
            };
            $query->where(function (Builder $visible) use ($user, $audience): void {
                $visible->where(fn (Builder $public) => $public->where('status', 'APPROVED')->where('audience', 'PUBLIC'))
                    ->orWhere(fn (Builder $targeted) => $targeted->where('status', 'APPROVED')->where('audience', $audience));
                if ($user->role === Role::SELLER) {
                    $visible->orWhere('organizer_id', $user->id);
                }
            });
        }
        if (! empty($filters['category'])) {
            $query->where('category', $filters['category']);
        }
        if (! empty($filters['search'])) {
            $query->where(fn (Builder $search) => $search
                ->where('title', 'like', '%'.$filters['search'].'%')
                ->orWhere('description', 'like', '%'.$filters['search'].'%')
                ->orWhere('location', 'like', '%'.$filters['search'].'%'));
        }

        return $query->get()->map(fn (FarmgateEvent $event): array => [
            'id' => 'event-'.$event->id,
            'record_id' => $event->id,
            'source_type' => 'EVENT',
            'title' => $event->title,
            'description' => $event->description,
            'category' => $event->category,
            'starts_at' => $event->starts_at->toIso8601String(),
            'ends_at' => $event->ends_at->toIso8601String(),
            'timezone' => $event->timezone,
            'location' => $event->location,
            'online_url' => $event->online_url,
            'image_url' => $this->eventImageUrl($event->image_path),
            'audience' => $event->audience,
            'status' => $event->status === 'APPROVED'
                ? ($event->starts_at->gt(now()) ? 'UPCOMING' : ($event->ends_at->lt(now()) ? 'ENDED' : 'ACTIVE'))
                : $event->status,
            'workflow_status' => $event->status,
            'creator' => $event->organizer?->name,
            'creator_id' => $event->organizer_id,
            'promotion_id' => $event->promotion_id,
            'can_manage' => $user->role === Role::ADMIN || ($user->role === Role::SELLER && $event->organizer_id === $user->id),
            'href' => null,
        ]);
    }

    private function calendarPromotions(User $user, CarbonImmutable $from, CarbonImmutable $to, array $filters, string $timezone, int $expirationDays): Collection
    {
        if ($user->role === Role::RIDER || (isset($filters['category']) && ! in_array($filters['category'], ['SELLER_PROMOTION', 'PROMOTION_CAMPAIGN'], true))) {
            return collect();
        }
        if ($user->role === Role::ADMIN && isset($filters['audience']) && $filters['audience'] !== 'PUBLIC') {
            return collect();
        }
        $query = SellerPromotion::query()->with('seller:id,name')
            ->where('starts_at', '<=', $to)
            ->where('ends_at', '>=', $from);
        if ($user->role === Role::SELLER) {
            $query->where('seller_id', $user->id);
        } elseif ($user->role !== Role::ADMIN) {
            $query->where('status', 'ACTIVE')->where('ends_at', '>=', now());
            $this->wherePromotionHasEligibleListings($query, $expirationDays);
        }
        if (! empty($filters['creator_id']) && $user->role === Role::ADMIN) {
            $query->where('seller_id', $filters['creator_id']);
        }
        if (! empty($filters['search'])) {
            $query->where('name', 'like', '%'.$filters['search'].'%');
        }

        $promotions = $query->with('calendarEvent')->get()->map(fn (SellerPromotion $promotion): array => [
            'id' => 'promotion-'.$promotion->id,
            'record_id' => $promotion->calendarEvent?->id ?? $promotion->id,
            'calendar_event_id' => $promotion->calendarEvent?->id,
            'source_type' => 'PROMOTION',
            'title' => $promotion->name,
            'description' => $promotion->description,
            'discount_type' => $promotion->discount_type,
            'discount_value' => $promotion->discount_value,
            'category' => 'SELLER_PROMOTION',
            'starts_at' => $promotion->starts_at->toIso8601String(),
            'ends_at' => $promotion->ends_at->toIso8601String(),
            'timezone' => $promotion->calendarEvent?->timezone ?? (string) config('app.timezone', 'Asia/Manila'),
            'location' => null,
            'online_url' => null,
            'image_url' => $promotion->image_url,
            'audience' => 'PUBLIC',
            'status' => $this->promotionStatus($promotion),
            'workflow_status' => $promotion->calendarEvent?->status ?? $promotion->status,
            'creator' => $promotion->seller?->name,
            'creator_id' => $promotion->seller_id,
            'promotion_id' => $promotion->id,
            'can_manage' => $promotion->calendarEvent !== null
                && ($user->role === Role::ADMIN || ($user->role === Role::SELLER && $promotion->calendarEvent->organizer_id === $user->id)),
            'href' => '#promotions',
        ]);

        return ! empty($filters['status'])
            ? $promotions->filter(fn (array $promotion): bool => $promotion['status'] === $filters['status'])
            : $promotions;
    }

    private function promotionIsVisibleToBuyer(SellerPromotion $promotion, int $expirationDays): bool
    {
        if ($promotion->status !== 'ACTIVE' || $promotion->ends_at->lt(now())) {
            return false;
        }

        $query = SellerPromotion::query()->whereKey($promotion->id);
        $this->wherePromotionHasEligibleListings($query, $expirationDays);

        return $query->exists();
    }

    private function wherePromotionHasEligibleListings(Builder $query, int $expirationDays): void
    {
        $query->where(function (Builder $scope) use ($expirationDays): void {
            $scope->where(function (Builder $all) use ($expirationDays): void {
                $all->where('applies_to_all', true)
                    ->whereExists(function ($listing) use ($expirationDays): void {
                        $listing->selectRaw('1')
                            ->from('livestock_listings')
                            ->whereColumn('livestock_listings.seller_id', 'seller_promotions.seller_id')
                            ->where('livestock_listings.status', 'ACTIVE')
                            ->whereNull('livestock_listings.deleted_at')
                            ->when($expirationDays > 0, fn ($active) => $active->where('livestock_listings.created_at', '>=', now()->subDays($expirationDays)));
                    });
            })->orWhere(function (Builder $selected) use ($expirationDays): void {
                $selected->where('applies_to_all', false)
                    ->whereExists(function ($pivot) use ($expirationDays): void {
                        $pivot->selectRaw('1')
                            ->from('seller_promotion_listings')
                            ->join('livestock_listings', 'livestock_listings.id', '=', 'seller_promotion_listings.listing_id')
                            ->whereColumn('seller_promotion_listings.promotion_id', 'seller_promotions.id')
                            ->whereColumn('livestock_listings.seller_id', 'seller_promotions.seller_id')
                            ->where('livestock_listings.status', 'ACTIVE')
                            ->whereNull('livestock_listings.deleted_at')
                            ->when($expirationDays > 0, fn ($active) => $active->where('livestock_listings.created_at', '>=', now()->subDays($expirationDays)));
                    });
            });
        });
    }

    private function riderSchedule(int $riderId, CarbonImmutable $from, CarbonImmutable $to, array $filters, string $timezone): Collection
    {
        $query = Delivery::query()->with('order:id,order_reference,status')
            ->where('rider_id', $riderId)
            ->whereNotIn('status', [
                DeliveryStatus::PENDING_ASSIGNMENT,
                DeliveryStatus::WAITING_FOR_RIDER,
                DeliveryStatus::RIDER_OFFERED,
                DeliveryStatus::SEARCHING_FOR_RIDER,
                DeliveryStatus::CANCELLED,
            ])
            ->whereBetween('assigned_at', [$from->utc(), $to->utc()]);
        if (! empty($filters['status'])) {
            $query->where('status', $filters['status']);
        }
        if (! empty($filters['search'])) {
            $query->whereHas('order', fn (Builder $order) => $order->where('order_reference', 'like', '%'.$filters['search'].'%'));
        }

        return $query->get()->map(fn (Delivery $delivery): array => [
            'id' => 'delivery-'.$delivery->id,
            'record_id' => $delivery->id,
            'source_type' => 'DELIVERY',
            'title' => 'Delivery · '.$delivery->order?->order_reference,
            'description' => 'Assigned delivery schedule. Buyer address is available only in the delivery workflow.',
            'category' => 'RIDER_DELIVERY',
            'starts_at' => $delivery->assigned_at?->toIso8601String() ?? $delivery->created_at->toIso8601String(),
            'ends_at' => $delivery->updated_at->toIso8601String(),
            'timezone' => $timezone,
            'location' => null,
            'online_url' => null,
            'image_url' => null,
            'audience' => 'RIDERS',
            'status' => $delivery->status->value,
            'creator' => null,
            'creator_id' => null,
            'promotion_id' => null,
            'can_manage' => false,
            'href' => null,
            'order_reference' => $delivery->order?->order_reference,
        ]);
    }

    private function validated(Request $request, bool $admin, bool $updating = false): array
    {
        if (! $admin) {
            $request->merge([
                'category' => $request->input('category', 'SELLER_EVENT'),
                'timezone' => $request->input('timezone', 'Asia/Manila'),
                'audience' => $request->input('audience', 'PUBLIC'),
            ]);
        }
        $data = $request->validate([
            'title' => ['required', 'string', 'max:160'],
            'description' => ['required', 'string', 'max:5000'],
            'category' => ['required', Rule::in($admin ? self::CATEGORIES : ['SELLER_EVENT'])],
            'starts_at' => ['required', 'date'],
            'ends_at' => ['required', 'date'],
            'timezone' => ['required', 'timezone'],
            'location' => ['nullable', 'string', 'max:255', 'required_without:online_url'],
            'online_url' => ['nullable', 'url', 'max:2048', 'required_without:location'],
            'image' => ['nullable', 'image', 'mimes:jpg,jpeg,png,webp', 'max:5120'],
            'remove_image' => ['sometimes', 'boolean'],
            'audience' => ['required', Rule::in($admin ? self::AUDIENCES : ['PUBLIC'])],
            'promotion_id' => ['nullable', 'integer', Rule::exists('seller_promotions', 'id')],
        ]);
        if (isset($data['promotion_id']) && $data['category'] !== 'PROMOTION_CAMPAIGN') {
            throw ValidationException::withMessages(['promotion_id' => 'Link a promotion only to a promotion campaign calendar entry.']);
        }
        if (isset($data['promotion_id'])) {
            $promotion = SellerPromotion::query()->findOrFail($data['promotion_id']);
            $user = $request->user();
            if ($user?->role === Role::SELLER && $promotion->seller_id !== $user->id) {
                throw ValidationException::withMessages(['promotion_id' => 'You may only link your own promotion.']);
            }
            $data['starts_at'] = $promotion->starts_at->toIso8601String();
            $data['ends_at'] = $promotion->ends_at->toIso8601String();
        }
        $data['starts_at'] = CarbonImmutable::parse($data['starts_at'], $data['timezone'])->utc()->format('Y-m-d H:i:s');
        $data['ends_at'] = CarbonImmutable::parse($data['ends_at'], $data['timezone'])->utc()->format('Y-m-d H:i:s');
        if ($data['ends_at'] <= $data['starts_at']) {
            throw ValidationException::withMessages(['ends_at' => 'The event must end after it starts.']);
        }

        return $data;
    }

    private function assertNoOverlap(array $data, int $creatorId, ?int $ignoreEventId = null): void
    {
        $query = FarmgateEvent::query()
            ->where('status', '!=', 'CANCELLED')
            ->where('organizer_id', $creatorId)
            ->where('category', $data['category'])
            ->where('starts_at', '<', $data['ends_at'])
            ->where('ends_at', '>', $data['starts_at']);
        if ($ignoreEventId !== null) {
            $query->whereKeyNot($ignoreEventId);
        }
        if ($query->exists()) {
            throw ValidationException::withMessages(['starts_at' => 'This event overlaps another scheduled event in the same category created by you.']);
        }
    }

    private function promotionStatus(SellerPromotion $promotion): string
    {
        if ($promotion->status === 'PAUSED') {
            return 'PAUSED';
        }
        if ($promotion->status === 'ENDED' || $promotion->ends_at->lt(now())) {
            return 'ENDED';
        }
        if ($promotion->status === 'DRAFT') {
            return 'DRAFT';
        }
        if ($promotion->starts_at->gt(now())) {
            return 'SCHEDULED';
        }

        return $promotion->status;
    }

    private function historyValues(FarmgateEvent $event): array
    {
        return [
            'title' => $event->title,
            'category' => $event->category,
            'starts_at' => $event->starts_at?->toIso8601String(),
            'ends_at' => $event->ends_at?->toIso8601String(),
            'timezone' => $event->timezone,
            'location' => $event->location,
            'audience' => $event->audience,
            'status' => $event->status,
            'promotion_id' => $event->promotion_id,
        ];
    }

    private function eventImageUrl(?string $imagePath): ?string
    {
        if ($imagePath === null || $imagePath === '') {
            return null;
        }

        /** @var FilesystemAdapter $publicDisk */
        $publicDisk = Storage::disk('public');

        return $publicDisk->url($imagePath);
    }

    private function eventPayload(FarmgateEvent $event): array
    {
        return [
            ...$event->toArray(),
            'image_url' => $this->eventImageUrl($event->image_path),
        ];
    }

    private function recordHistory(FarmgateEvent $event, ?User $actor, string $action, ?array $before, ?array $after, ?string $reason = null): void
    {
        FarmgateEventHistory::create([
            'event_id' => $event->id,
            'actor_id' => $actor?->id,
            'action' => $action,
            'before_values' => $before,
            'after_values' => $after,
            'reason' => $reason,
        ]);
    }

    private function notifyEvent(FarmgateEvent $event, string $action): void
    {
        $event->loadMissing('organizer:id,name');
        $recipients = in_array($event->status, ['SUBMITTED', 'REJECTED'], true)
            ? collect()
            : User::query()->whereIn('role', match ($event->audience) {
                'PUBLIC' => [Role::BUYER->value, Role::SELLER->value, Role::RIDER->value],
                'BUYERS' => [Role::BUYER->value],
                'SELLERS' => [Role::SELLER->value],
                'RIDERS' => [Role::RIDER->value],
                'ADMINS' => [Role::ADMIN->value],
                default => [],
            })->whereKeyNot($event->organizer_id)->get();
        if ($event->organizer) {
            $recipients->push($event->organizer);
        }
        if (in_array($action, ['submitted', 'rejected'], true)) {
            $recipients = $recipients->merge(User::query()->where('role', Role::ADMIN->value)->get());
        }
        $recipients->unique('id')->each(fn (User $recipient) => $recipient->notify(new CalendarEventNotification(
            $event->id,
            $event->title,
            $event->status,
            $action,
            $event->starts_at->toIso8601String(),
        )));
    }

    private function audit(int $actorId, string $action, FarmgateEvent $event, array $after, ?array $before = null): void
    {
        AuditLog::create([
            'user_id' => $actorId,
            'action' => $action,
            'method' => request()->method(),
            'route' => request()->path(),
            'status_code' => 200,
            'database_action' => $before === null ? 'INSERT' : 'UPDATE',
            'entity_type' => FarmgateEvent::class,
            'entity_id' => (string) $event->id,
            'description' => 'Farmgate calendar event changed.',
            'before_values' => $before,
            'after_values' => $after,
        ]);
    }
}
