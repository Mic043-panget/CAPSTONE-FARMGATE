<?php

namespace App\Http\Controllers\Api\Admin;

use App\Enums\ReviewStatus;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\OrderActivity;
use App\Models\Review;
use App\Notifications\ReviewModerationNotification;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ReviewModerationController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
        $filters = $request->validate([
            'review_id' => ['nullable', 'integer', 'min:1'],
        ]);
        $query = Review::query()
            ->with(['buyer:id,name', 'seller:id,name', 'listing:id,name', 'order:id,order_reference', 'reports.reporter:id,name', 'media'])
            ->withCount(['reports as open_reports_count' => fn ($builder) => $builder->where('status', 'OPEN')])
            ->where(function ($builder): void {
                $builder->whereHas('reports', fn ($reports) => $reports->where('status', 'OPEN'))
                    ->orWhere('status', ReviewStatus::HIDDEN);
            });
        if (isset($filters['review_id'])) {
            $query->whereKey($filters['review_id']);
        }

        if ($request->filled('search')) {
            $term = '%'.trim((string) $request->input('search')).'%';
            $query->where(fn ($builder) => $builder
                ->where('review_reference', 'like', $term)
                ->orWhere('comment', 'like', $term)
                ->orWhereHas('buyer', fn ($users) => $users->where('name', 'like', $term))
                ->orWhereHas('seller', fn ($users) => $users->where('name', 'like', $term))
                ->orWhereHas('order', fn ($orders) => $orders->where('order_reference', 'like', $term)));
        }

        $reviews = $query->latest()->paginate(15)->withQueryString();
        $moderationHistory = AuditLog::query()
            ->where('entity_type', 'Review')
            ->whereIn('entity_id', $reviews->getCollection()->pluck('id')->map(fn ($id): string => (string) $id))
            ->with('actor:id,name,role')
            ->latest()
            ->get()
            ->groupBy('entity_id');
        $reviews->getCollection()->each(function (Review $review): void {
            $review->setAttribute('media_files', $review->media->map(fn ($media): array => [
                'id' => $media->id,
                'mime_type' => $media->mime_type,
                'original_name' => $media->original_name,
                'url' => route('review-media.public', ['media' => $media->id]),
            ])->all());
            $review->makeHidden('media');
        });
        $reviews->getCollection()->each(fn (Review $review) => $review->setAttribute('moderation_history', $moderationHistory->get((string) $review->id, collect())->values()));

        return response()->json(['reviews' => $reviews]);
    }

    public function moderate(Request $request, Review $review): JsonResponse
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
        $data = $request->validate([
            'status' => ['required', 'in:PUBLISHED,HIDDEN'],
            'reason' => ['required', 'string', 'min:3', 'max:1200'],
        ]);
        $status = ReviewStatus::from($data['status']);

        DB::transaction(function () use ($review, $status, $request, $data): void {
            $locked = Review::query()->lockForUpdate()->findOrFail($review->id);
            $locked->update(['status' => $status]);
            $locked->reports()->where('status', 'OPEN')->update(['status' => 'REVIEWED']);
            OrderActivity::create([
                'order_id' => $locked->order_id,
                'actor_id' => $request->user()->id,
                'activity_key' => 'REVIEW_MODERATED',
                'details' => 'Admin '.strtolower($status->value).' review '.$locked->review_reference.': '.$data['reason'],
            ]);
            DB::afterCommit(function () use ($locked, $status): void {
                $notification = new ReviewModerationNotification($locked->id, $locked->order_id, $locked->review_reference, strtolower($status->value));
                $locked->buyer?->notify($notification);
                $locked->seller?->notify($notification);
            });
        });

        return response()->json(['review' => $review->fresh(['buyer:id,name', 'seller:id,name', 'listing:id,name', 'reports'])]);
    }
}
