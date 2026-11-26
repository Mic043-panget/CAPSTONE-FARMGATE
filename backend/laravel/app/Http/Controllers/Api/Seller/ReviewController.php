<?php

namespace App\Http\Controllers\Api\Seller;

use App\Enums\Role;
use App\Enums\ReviewStatus;
use App\Http\Controllers\Controller;
use App\Models\Review;
use App\Models\ReviewReport;
use App\Models\User;
use App\Notifications\ReviewModerationNotification;
use App\Notifications\SellerReviewReportNotification;
use App\Rules\ValidFarmgateImage;
use App\Services\ImageUploadService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

class ReviewController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        abort_unless($request->user()?->role === Role::SELLER, 403);

        $reviews = Review::query()
            ->with([
                'buyer:id,name',
                'listing:id,name',
                'media:id,review_id,mime_type,original_name',
                'reports' => fn ($query) => $query
                    ->select('id', 'review_id', 'reporter_id', 'status')
                    ->where('reporter_id', $request->user()->id),
            ])
            ->where('seller_id', $request->user()->id)
            ->where(function (Builder $query) use ($request): void {
                $query->where('status', ReviewStatus::PUBLISHED)
                    ->orWhere(function (Builder $hidden) use ($request): void {
                        $hidden->where('status', ReviewStatus::HIDDEN)
                            ->whereHas('reports', fn (Builder $reports) => $reports
                            ->where('reporter_id', $request->user()->id));
                    });
            })
            ->latest()
            ->paginate(15);
        $reviews->getCollection()->each(function (Review $review): void {
            $review->setAttribute('seller_report_status', $review->reports->first()?->status);
            $review->makeHidden('reports');
        });

        return response()->json(['reviews' => $reviews]);
    }

    public function report(Request $request, Review $review): JsonResponse
    {
        abort_unless($request->user()?->role === Role::SELLER, 403);
        $review->loadMissing('listing');
        $this->ensureSellerOwnsReviewListing($review, $request->user()->id);

        $data = $request->validate([
            'reason' => ['required', 'string', Rule::in(ReviewReport::SELLER_REASONS)],
            'explanation' => ['nullable', 'string', 'max:500'],
            'evidence' => ['nullable', 'array', 'max:3'],
            'evidence.*' => ['file', 'image', 'mimes:jpg,jpeg,png,webp', 'max:5120', new ValidFarmgateImage],
        ]);
        $files = $data['evidence'] ?? [];
        unset($data['evidence']);
        $storedPaths = [];

        try {
            $report = DB::transaction(function () use ($request, $review, $data, $files, &$storedPaths): ReviewReport {
                $lockedReview = Review::query()->with('listing')->lockForUpdate()->findOrFail($review->id);
                $this->ensureSellerOwnsReviewListing($lockedReview, $request->user()->id);
                $report = ReviewReport::query()->firstOrCreate(
                    ['review_id' => $lockedReview->id, 'reporter_id' => $request->user()->id],
                    [
                        'reporter_role' => Role::SELLER->value,
                        'reason' => $data['reason'],
                        'explanation' => $data['explanation'] ?? null,
                        'status' => 'OPEN',
                    ],
                );

                if (! $report->wasRecentlyCreated) {
                    return $report;
                }

                foreach ($files as $file) {
                    $stored = app(ImageUploadService::class)->storeEvidence($file, "review-reports/{$report->getKey()}", 'case_media');
                    $storedPaths[] = $stored['path'];
                    $report->media()->create([
                        'uploaded_by' => $request->user()->id,
                        'path' => $stored['path'],
                        'mime_type' => $stored['mime_type'],
                        'original_name' => mb_substr($file->getClientOriginalName(), 0, 255),
                        'size' => $stored['size'],
                    ]);
                }

                DB::afterCommit(function () use ($request, $lockedReview): void {
                    $request->user()->notify(new SellerReviewReportNotification($lockedReview->review_reference, 'received'));
                    User::query()->where('role', Role::ADMIN)->get()->each(
                        fn (User $admin) => $admin->notify(new ReviewModerationNotification(
                            $lockedReview->id,
                            $lockedReview->order_id,
                            $lockedReview->review_reference,
                            'reported',
                        )),
                    );
                });

                return $report;
            });
        } catch (\Throwable $exception) {
            Storage::disk('case_media')->delete($storedPaths);
            throw $exception;
        }

        if (! $report->wasRecentlyCreated) {
            return response()->json([
                'message' => 'You have already reported this review.',
                'report' => ['status' => $report->status],
            ], 409);
        }

        return response()->json([
            'message' => 'Your report was received and sent to Farmgate moderators.',
            'report' => ['status' => $report->status],
        ], 201);
    }

    private function ensureSellerOwnsReviewListing(Review $review, int $sellerId): void
    {
        abort_unless(
            $review->status === ReviewStatus::PUBLISHED
            && (int) $review->seller_id === $sellerId
            && $review->listing !== null
            && (int) $review->listing->seller_id === $sellerId,
            404,
        );
    }
}
