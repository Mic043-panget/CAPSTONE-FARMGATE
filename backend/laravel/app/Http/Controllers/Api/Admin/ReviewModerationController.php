<?php

namespace App\Http\Controllers\Api\Admin;

use App\Enums\ReviewStatus;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\OrderActivity;
use App\Models\Review;
use App\Models\ReviewReport;
use App\Models\ReviewReportMedia;
use App\Notifications\ReviewModerationNotification;
use App\Notifications\SellerReviewReportNotification;
use App\Services\ImageUploadService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ReviewModerationController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
        $filters = $request->validate([
            'review_id' => ['nullable', 'integer', 'min:1'],
        ]);
        $query = Review::query()
            ->with(['buyer:id,name', 'seller:id,name', 'listing:id,name', 'order:id,order_reference', 'reports.reporter:id,name', 'reports.media', 'media'])
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
        $reportIdsByReview = $reviews->getCollection()->mapWithKeys(
            fn (Review $review) => [(string) $review->id => $review->reports->pluck('id')],
        );
        $reportIds = $reportIdsByReview->flatten();
        $reportHistory = AuditLog::query()
            ->where('entity_type', 'ReviewReport')
            ->whereIn('entity_id', $reportIds->map(fn ($id): string => (string) $id))
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
        $reviews->getCollection()->each(function (Review $review) use ($moderationHistory, $reportHistory, $reportIdsByReview): void {
            $reportEvents = $reportIdsByReview->get((string) $review->id, collect())
                ->flatMap(fn ($reportId) => $reportHistory->get((string) $reportId, collect()));
            $history = $moderationHistory->get((string) $review->id, collect())
                ->concat($reportEvents)
                ->sortByDesc('created_at')
                ->values();
            $review->setAttribute('moderation_history', $history);
        });
        $reviews->setCollection($reviews->getCollection()->map(function (Review $review): array {
            $payload = $review->toArray();
            $payload['reports'] = $review->reports->map(fn (ReviewReport $report): array => [
                'id' => $report->id,
                'reporter_role' => $report->reporter_role,
                'reason' => $report->reason,
                'explanation' => $report->explanation,
                'status' => $report->status,
                'reporter' => $report->reporter ? ['name' => $report->reporter->name] : null,
                'media_files' => $report->media->map(fn (ReviewReportMedia $media): array => [
                    'id' => $media->id,
                    'mime_type' => $media->mime_type,
                    'original_name' => $media->original_name,
                    'url' => route('admin.review-report-media', ['report' => $report->id, 'media' => $media->id]),
                ])->all(),
            ])->all();

            return $payload;
        }));

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
            $openReports = $locked->reports()->where('status', 'OPEN')->lockForUpdate()->get();
            $sellerReports = $openReports->where('reporter_role', 'SELLER')->values();
            $openReports->each(fn (ReviewReport $report) => $report->update(['status' => 'REVIEWED']));
            OrderActivity::create([
                'order_id' => $locked->order_id,
                'actor_id' => $request->user()->id,
                'activity_key' => 'REVIEW_MODERATED',
                'details' => 'Admin '.strtolower($status->value).' review '.$locked->review_reference.': '.$data['reason'],
            ]);
            DB::afterCommit(function () use ($locked, $status, $sellerReports): void {
                $notification = new ReviewModerationNotification($locked->id, $locked->order_id, $locked->review_reference, strtolower($status->value));
                $locked->buyer?->notify($notification);
                $locked->seller?->notify($notification);
                foreach ($sellerReports as $report) {
                    $report->reporter?->notify(new SellerReviewReportNotification(
                        $locked->review_reference,
                        'resolved',
                        strtolower($status->value),
                    ));
                }
            });
        });

        return response()->json(['review' => $review->fresh(['buyer:id,name', 'seller:id,name', 'listing:id,name', 'reports'])]);
    }

    public function privateReportMedia(Request $request, ReviewReport $report, ReviewReportMedia $media): StreamedResponse|Response
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
        abort_unless($media->review_report_id === $report->id, 404);
        $disk = Storage::disk('case_media');
        $previewPath = app(ImageUploadService::class)->previewPath($media->path);
        $usePreview = $disk->exists($previewPath);
        $streamPath = $usePreview ? $previewPath : $media->path;
        abort_unless($disk->exists($streamPath), 404, 'The saved report evidence could not be found.');

        return response()->stream(function () use ($disk, $streamPath): void {
            $stream = $disk->readStream($streamPath);
            if (! is_resource($stream)) {
                throw new \RuntimeException('The saved report evidence could not be opened.');
            }
            try {
                fpassthru($stream);
            } finally {
                fclose($stream);
            }
        }, 200, [
            'Content-Type' => $usePreview ? 'image/webp' : $media->mime_type,
            'Content-Disposition' => 'inline; filename="review-report-evidence"',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
            'X-Frame-Options' => 'DENY',
        ]);
    }
}
