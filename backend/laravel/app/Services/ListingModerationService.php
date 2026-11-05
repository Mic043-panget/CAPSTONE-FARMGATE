<?php

namespace App\Services;

use App\Enums\ListingStatus;
use App\Models\AuditLog;
use App\Models\ListingModerationAttempt;
use App\Models\LivestockListing;
use App\Models\User;
use App\Notifications\ListingModerationNeedsReviewNotification;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

class ListingModerationService
{
    public function __construct(private readonly ListingModerationProvider $provider) {}

    public function moderate(int $listingId): void
    {
        $context = DB::transaction(function () use ($listingId): ?array {
            $listing = LivestockListing::query()->lockForUpdate()->with('category')->find($listingId);
            if (! $listing || $listing->status !== ListingStatus::PENDING_REVIEW) {
                return null;
            }

            $latest = $listing->moderationAttempts()->latest('id')->lockForUpdate()->first();
            if ($latest && $latest->status !== 'FAILED') {
                return null;
            }

            $attemptNumber = ($latest?->attempt_number ?? 0) + 1;
            $attempt = $listing->moderationAttempts()->create([
                'seller_id' => $listing->seller_id,
                'attempt_number' => $attemptNumber,
                'status' => 'PROCESSING',
                'model' => mb_substr((string) config('services.gemini.model', ''), 0, 100) ?: null,
            ]);

            return ['listing' => $listing, 'attempt_id' => $attempt->id];
        });

        if ($context === null) {
            return;
        }

        /** @var LivestockListing $listing */
        $listing = $context['listing'];
        $attemptId = (int) $context['attempt_id'];
        $guardReason = $this->deterministicGuardFailure($listing);
        if ($guardReason !== null) {
            $this->finishForHumanReview($listingId, $attemptId, [
                'recommendation' => null,
                'confidence' => null,
                'predicted_category' => $listing->category?->name,
                'reasons' => [$guardReason],
                'flags' => [],
                'response_summary' => 'A deterministic listing check requires human review.',
            ]);

            return;
        }

        try {
            $result = $this->validatedResult($this->provider->review($listing));
        } catch (Throwable) {
            DB::transaction(function () use ($listingId, $attemptId): void {
                $listing = LivestockListing::query()->lockForUpdate()->find($listingId);
                $attempt = ListingModerationAttempt::query()->lockForUpdate()->find($attemptId);
                if (! $listing || ! $attempt) {
                    return;
                }

                $stillPending = $listing->status === ListingStatus::PENDING_REVIEW;
                $attempt->update([
                    'status' => $stillPending ? 'FAILED' : 'SUPERSEDED',
                    'error_code' => $stillPending ? 'provider_or_response_error' : null,
                    'final_listing_status' => $listing->status->value,
                    'response_summary' => $stillPending
                        ? 'Moderation could not produce a validated result.'
                        : 'The listing state changed before moderation completed.',
                    'completed_at' => now(),
                ]);

                if ($stillPending) {
                    AuditLog::create([
                        'action' => 'LISTING_AI_MODERATION_FAILED',
                        'method' => 'JOB',
                        'route' => 'listing-moderation',
                        'database_action' => 'NONE',
                        'entity_type' => LivestockListing::class,
                        'entity_id' => $listing->id,
                        'description' => 'AI moderation failed and the listing remains pending for administrator review.',
                        'metadata' => [
                            'attempt_id' => $attempt->id,
                            'attempt_number' => $attempt->attempt_number,
                            'error_code' => 'provider_or_response_error',
                        ],
                    ]);

                    if ($attempt->attempt_number >= 2) {
                        $this->notifySellerOfReview($listing, 'FAILED', [
                            'AI review could not be completed after an automatic retry. Your listing remains pending for administrator review.',
                        ], []);
                    }
                }
            });

            // Do not bubble provider exceptions (or their request details) into queue logs.
            throw new RuntimeException('Listing moderation failed safely.');
        }

        $thresholdValue = config('services.gemini.moderation_confidence_threshold', '0.90');
        $validThreshold = is_numeric($thresholdValue)
            && is_finite((float) $thresholdValue)
            && (float) $thresholdValue >= 0
            && (float) $thresholdValue <= 1;
        $confidenceThreshold = $validThreshold ? (float) $thresholdValue : 1.0;
        $autoApproveCandidate = $validThreshold
            && $result['recommendation'] === 'APPROVE'
            && $result['category_supported']
            && $result['flags'] === []
            && $result['confidence'] >= $confidenceThreshold;
        $autoReject = $validThreshold
            && $result['recommendation'] === 'REJECT'
            && $result['confidence'] >= $confidenceThreshold;

        DB::transaction(function () use ($listingId, $attemptId, $result, $autoApproveCandidate, $autoReject, $validThreshold, $confidenceThreshold): void {
            $listing = LivestockListing::query()->lockForUpdate()->find($listingId);
            $attempt = ListingModerationAttempt::query()->lockForUpdate()->find($attemptId);
            if (! $listing || ! $attempt) {
                return;
            }

            if ($listing->status !== ListingStatus::PENDING_REVIEW) {
                $attempt->update([
                    'status' => 'SUPERSEDED',
                    'recommendation' => $result['recommendation'],
                    'confidence' => $result['confidence'],
                    'predicted_category' => $result['category_supported'] ? $listing->category?->name : null,
                    'reasons' => $result['reasons'],
                    'flags' => $result['flags'],
                    'final_listing_status' => $listing->status->value,
                    'response_summary' => 'The listing state changed before moderation could be applied.',
                    'completed_at' => now(),
                ]);

                return;
            }

            $reasons = $result['reasons'];
            if ($autoReject) {
                if ($reasons === []) {
                    $reasons = $result['flags'] ?: ['The listing did not meet FARMGATE marketplace requirements.'];
                }
            } else {
                if (! $validThreshold) {
                    array_unshift($reasons, 'Confidence threshold configuration is invalid; automatic decisions are disabled.');
                } elseif ($result['confidence'] < $confidenceThreshold) {
                    array_unshift($reasons, 'Confidence is below the configured automatic decision threshold.');
                }
                if (! $result['category_supported']) {
                    array_unshift($reasons, 'The model did not confirm that this category is supported.');
                }
                if ($result['recommendation'] === 'REVIEW' || $result['recommendation'] === 'REJECT') {
                    array_unshift($reasons, 'The model recommends administrator review.');
                }
                if ($result['flags'] !== []) {
                    array_unshift($reasons, 'The model returned moderation flags.');
                }
            }

            $autoApprove = $autoApproveCandidate && $this->sellerHasApprovalCapacity($listing);
            $applied = $autoApprove || $autoReject;
            $finalStatus = $autoApprove
                ? ListingStatus::ACTIVE
                : ($autoReject ? ListingStatus::REJECTED : ListingStatus::PENDING_REVIEW);

            if ($autoApproveCandidate && ! $autoApprove) {
                array_unshift($reasons, 'Seller has reached the configured active-listing limit.');
            }
            if (! $applied && $reasons === []) {
                $reasons[] = 'The listing did not meet all automatic approval checks.';
            }
            $status = $autoApprove
                ? 'AUTO_APPROVED'
                : ($autoReject
                    ? 'AUTO_REJECTED'
                    : ($result['recommendation'] === 'REJECT' || $result['flags'] !== [] ? 'FLAGGED' : 'MANUAL_REVIEW'));

            $attempt->update([
                'status' => $status,
                'recommendation' => $result['recommendation'],
                'confidence' => $result['confidence'],
                'predicted_category' => $result['category_supported'] ? $listing->category?->name : null,
                'reasons' => array_slice($reasons, 0, 5),
                'flags' => $result['flags'],
                'final_listing_status' => $finalStatus->value,
                'applied_automatically' => $applied,
                'response_summary' => $autoApprove
                    ? 'Listing passed deterministic checks and met the configured confidence threshold.'
                    : ($autoReject
                        ? 'Listing was automatically rejected based on a high-confidence moderation result.'
                        : 'Listing remains pending for an administrator decision.'),
                'completed_at' => now(),
            ]);

            if ($autoApprove || $autoReject) {
                $listing->update(['status' => $finalStatus]);
            }
            $this->notifySellerOfReview($listing, $status, $reasons, $result['flags']);

            AuditLog::create([
                'action' => $autoApprove
                    ? 'LISTING_AI_AUTO_APPROVED'
                    : ($autoReject ? 'LISTING_AI_AUTO_REJECTED' : 'LISTING_AI_REQUIRES_HUMAN_REVIEW'),
                'method' => 'JOB',
                'route' => 'listing-moderation',
                'status_code' => null,
                'database_action' => $applied ? 'UPDATE' : 'NONE',
                'entity_type' => LivestockListing::class,
                'entity_id' => $listing->id,
                'description' => $autoApprove
                    ? 'AI moderation activated a listing after deterministic and confidence checks.'
                    : ($autoReject
                        ? 'AI moderation rejected a listing based on a high-confidence result.'
                        : 'AI moderation left a listing pending for administrator review.'),
                'metadata' => [
                    'attempt_id' => $attempt->id,
                    'attempt_number' => $attempt->attempt_number,
                    'moderation_status' => $status,
                    'recommendation' => $result['recommendation'],
                    'confidence' => $result['confidence'],
                ],
                'before_values' => ['status' => ListingStatus::PENDING_REVIEW->value],
                'after_values' => ['status' => $finalStatus->value],
                'changed_fields' => $applied ? ['status'] : [],
            ]);
        });
    }

    private function deterministicGuardFailure(LivestockListing $listing): ?string
    {
        if (! $listing->category || ! $listing->category->is_active) {
            return 'The listing category is inactive or unavailable.';
        }
        if (mb_strlen(trim((string) $listing->name)) < 3) {
            return 'The listing name is too short to assess reliably.';
        }
        if (blank($listing->pricing_type) || (! $listing->price_per_head && ! $listing->price_per_kilo)) {
            return 'The listing does not have a valid price for its pricing type.';
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $result
     * @return array{recommendation: string, confidence: float, category_supported: bool, reasons: array<int, string>, flags: array<int, string>}
     */
    private function validatedResult(array $result): array
    {
        $keys = ['recommendation', 'confidence', 'category_supported', 'reasons', 'flags'];
        $actualKeys = array_keys($result);
        sort($keys);
        sort($actualKeys);
        if ($keys !== $actualKeys
            || ! in_array($result['recommendation'] ?? null, ['APPROVE', 'REVIEW', 'REJECT'], true)
            || (! is_int($result['confidence'] ?? null) && ! is_float($result['confidence'] ?? null))
            || ! is_finite((float) $result['confidence'])
            || (float) $result['confidence'] < 0
            || (float) $result['confidence'] > 1
            || ! is_bool($result['category_supported'] ?? null)
            || ! $this->validTextList($result['reasons'] ?? null)
            || ! $this->validTextList($result['flags'] ?? null)) {
            throw new RuntimeException('Gemini moderation response failed strict validation.');
        }

        return [
            'recommendation' => $result['recommendation'],
            'confidence' => (float) $result['confidence'],
            'category_supported' => $result['category_supported'],
            'reasons' => array_map(fn (string $reason): string => mb_substr(trim($reason), 0, 250), $result['reasons']),
            'flags' => array_map(fn (string $flag): string => mb_substr(trim($flag), 0, 100), $result['flags']),
        ];
    }

    private function validTextList(mixed $value): bool
    {
        if (! is_array($value) || count($value) > 5 || ! array_is_list($value)) {
            return false;
        }

        foreach ($value as $item) {
            if (! is_string($item) || trim($item) === '' || mb_strlen($item) > 500) {
                return false;
            }
        }

        return true;
    }

    private function sellerHasApprovalCapacity(LivestockListing $listing): bool
    {
        $seller = User::query()->lockForUpdate()->find($listing->seller_id);
        if (! $seller) {
            return false;
        }

        $limit = max(0, app(SystemSettingsService::class)->getInt('maximum_active_listings'));
        if ($limit === 0) {
            return false;
        }

        return LivestockListing::query()
            ->where('seller_id', $listing->seller_id)
            ->where('status', ListingStatus::ACTIVE)
            ->whereKeyNot($listing->id)
            ->count() < $limit;
    }

    private function finishForHumanReview(int $listingId, int $attemptId, array $decision): void
    {
        DB::transaction(function () use ($listingId, $attemptId, $decision): void {
            $listing = LivestockListing::query()->lockForUpdate()->find($listingId);
            $attempt = ListingModerationAttempt::query()->lockForUpdate()->find($attemptId);
            if (! $listing || ! $attempt) {
                return;
            }
            $attempt->update([
                'status' => $listing->status === ListingStatus::PENDING_REVIEW ? 'MANUAL_REVIEW' : 'SUPERSEDED',
                'final_listing_status' => $listing->status->value,
                'recommendation' => $decision['recommendation'],
                'predicted_category' => $decision['predicted_category'],
                'reasons' => $decision['reasons'],
                'flags' => $decision['flags'],
                'response_summary' => $decision['response_summary'],
                'completed_at' => now(),
            ]);
            if ($listing->status === ListingStatus::PENDING_REVIEW) {
                $this->notifySellerOfReview($listing, 'MANUAL_REVIEW', $decision['reasons'], $decision['flags']);
                AuditLog::create([
                    'action' => 'LISTING_AI_DETERMINISTIC_REVIEW',
                    'method' => 'JOB',
                    'route' => 'listing-moderation',
                    'database_action' => 'NONE',
                    'entity_type' => LivestockListing::class,
                    'entity_id' => $listing->id,
                    'description' => 'A deterministic listing guard kept the listing pending for administrator review.',
                    'metadata' => [
                        'attempt_id' => $attempt->id,
                        'attempt_number' => $attempt->attempt_number,
                        'moderation_status' => 'MANUAL_REVIEW',
                    ],
                ]);
            }
        });
    }

    /**
     * @param  array<int, string>  $reasons
     * @param  array<int, string>  $flags
     */
    private function notifySellerOfReview(LivestockListing $listing, string $status, array $reasons, array $flags): void
    {
        $seller = User::query()->find($listing->seller_id);
        if (! $seller) {
            return;
        }

        $seller->notify(new ListingModerationNeedsReviewNotification(
            $listing->id,
            $listing->name,
            $status,
            array_slice($reasons, 0, 5),
            array_slice($flags, 0, 5),
        ));
    }
}
