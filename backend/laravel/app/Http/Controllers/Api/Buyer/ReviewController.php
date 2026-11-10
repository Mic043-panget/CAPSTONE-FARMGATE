<?php

namespace App\Http\Controllers\Api\Buyer;

use App\Enums\OrderStatus;
use App\Enums\ReviewStatus;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\OrderActivity;
use App\Models\Review;
use App\Models\ReviewMedia;
use App\Models\ReviewReport;
use App\Models\User;
use App\Notifications\ReviewModerationNotification;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ReviewController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $reviews = Review::query()
            ->with(['seller:id,name', 'listing:id,name', 'order:id,order_reference', 'media:id,review_id,mime_type,original_name'])
            ->where('buyer_id', $request->user()->id)
            ->latest()
            ->get();

        return response()->json(['reviews' => $reviews->map(fn (Review $review): array => $this->reviewPayload($review, true))]);
    }

    public function store(Request $request, Order $order): JsonResponse
    {
        abort_unless($request->user()?->role === Role::BUYER && $order->buyer_id === $request->user()->id, 403);
        abort_unless($order->status === OrderStatus::COMPLETED, 422, 'Only completed orders can be reviewed.');

        $data = $request->validate([
            'rating' => ['required', 'integer', 'min:1', 'max:5'],
            'comment' => ['nullable', 'string', 'max:2000'],
            'listing_id' => ['nullable', 'integer'],
            'media' => ['nullable', 'array', 'max:5'],
            'media.*' => ['file', 'mimes:jpg,jpeg,png,webp,mp4,mov,webm', 'max:20480'],
        ]);
        $order->loadMissing('items');
        $listingId = $data['listing_id'] ?? ($order->items->count() === 1 ? $order->items->first()->listing_id : null);
        if ($order->items->isNotEmpty()) {
            if ($listingId === null || ! $order->items->contains(fn ($item): bool => (int) $item->listing_id === (int) $listingId)) {
                throw ValidationException::withMessages(['listing_id' => 'Choose a livestock listing included in this order.']);
            }
        }
        $duplicateQuery = Review::query()->where('order_id', $order->id)->where('buyer_id', $request->user()->id);
        $listingId === null ? $duplicateQuery->whereNull('listing_id') : $duplicateQuery->where('listing_id', $listingId);
        abort_if($duplicateQuery->exists(), 422, 'This livestock listing in the order has already been reviewed.');

        $data['order_id'] = $order->id;
        $data['listing_id'] = $listingId;
        $data['buyer_id'] = $request->user()->id;
        $data['seller_id'] = $order->seller_id;
        $data['status'] = ReviewStatus::PUBLISHED;
        $files = $data['media'] ?? [];
        unset($data['media']);
        $storedPaths = [];

        try {
            $review = DB::transaction(function () use ($data, $files, &$storedPaths): Review {
                $review = Review::create($data);
                OrderActivity::create([
                    'order_id' => $review->order_id,
                    'actor_id' => $review->buyer_id,
                    'activity_key' => 'REVIEW_SUBMITTED',
                    'details' => 'Buyer submitted a review for '.($review->listing?->name ?? 'livestock listing').' with '.$review->rating.' star(s).',
                ]);
                foreach ($files as $file) {
                    $path = $file->store("reviews/{$review->id}", 'case_media');
                    if (! is_string($path) || $path === '') {
                        throw new \RuntimeException('Review media storage failed.');
                    }
                    $storedPaths[] = $path;
                    $review->media()->create([
                        'path' => $path,
                        'mime_type' => $file->getMimeType() ?: 'application/octet-stream',
                        'original_name' => mb_substr($file->getClientOriginalName(), 0, 255),
                        'size' => $file->getSize(),
                    ]);
                }

                return $review->load(['seller:id,name', 'listing:id,name', 'order:id,order_reference', 'media']);
            });
        } catch (\Throwable $exception) {
            Storage::disk('case_media')->delete($storedPaths);
            throw $exception;
        }

        return response()->json(['review' => $this->reviewPayload($review, true)], 201);
    }

    public function report(Request $request, Review $review): JsonResponse
    {
        abort_unless($request->user()?->role === Role::BUYER, 403);
        abort_unless($review->status === ReviewStatus::PUBLISHED, 404);
        abort_if($review->buyer_id === $request->user()->id, 422, 'You cannot report your own review.');
        $data = $request->validate(['reason' => ['required', 'string', 'min:5', 'max:1200']]);

        $report = ReviewReport::query()->firstOrCreate(
            ['review_id' => $review->id, 'reporter_id' => $request->user()->id],
            ['reason' => $data['reason'], 'status' => 'OPEN'],
        );
        if ($report->wasRecentlyCreated) {
            OrderActivity::create([
                'order_id' => $review->order_id,
                'actor_id' => $request->user()->id,
                'activity_key' => 'REVIEW_REPORTED',
                'details' => 'A buyer reported review '.$review->review_reference.' for admin moderation.',
            ]);
            User::query()->where('role', Role::ADMIN)->get()->each(fn (User $admin) => $admin->notify(new ReviewModerationNotification($review->id, $review->order_id, $review->review_reference, 'reported')));
        }

        return response()->json(['message' => 'The review was reported for admin moderation.'], 201);
    }

    public function publicMedia(ReviewMedia $media): StreamedResponse|Response
    {
        $media->loadMissing('review');
        abort_unless($media->review?->status === ReviewStatus::PUBLISHED, 404);

        return $this->streamMedia($media->path, $media->mime_type);
    }

    public function privateMedia(Request $request, Review $review, ReviewMedia $media): StreamedResponse|Response
    {
        abort_unless($media->review_id === $review->id, 404);
        $user = $request->user();
        abort_unless($user && (
            $review->status === ReviewStatus::PUBLISHED
            || $user->role === Role::ADMIN
            || $review->buyer_id === $user->id
        ), 403);

        return $this->streamMedia($media->path, $media->mime_type);
    }

    private function reviewPayload(Review $review, bool $ownerView = false): array
    {
        $payload = $review->toArray();
        $payload['media'] = $review->media->map(fn (ReviewMedia $media): array => [
            'id' => $media->id,
            'mime_type' => $media->mime_type,
            'original_name' => $media->original_name,
            'url' => $ownerView
                ? route('buyer.review-media', ['review' => $review->id, 'media' => $media->id])
                : route('review-media.public', ['media' => $media->id]),
        ])->all();

        return $payload;
    }

    private function streamMedia(string $path, string $mimeType): StreamedResponse|Response
    {
        $disk = Storage::disk('case_media');
        abort_unless($disk->exists($path), 404, 'The saved review media could not be found.');

        return response()->stream(function () use ($disk, $path): void {
            $stream = $disk->readStream($path);
            if (! is_resource($stream)) {
                throw new \RuntimeException('The saved review media could not be opened.');
            }
            try {
                fpassthru($stream);
            } finally {
                fclose($stream);
            }
        }, 200, [
            'Content-Type' => $mimeType,
            'Content-Disposition' => 'inline; filename="review-media"',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
            'X-Frame-Options' => 'DENY',
        ]);
    }
}
