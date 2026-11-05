<?php

namespace App\Jobs;

use App\Services\ListingModerationService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Illuminate\Queue\SerializesModels;
use Throwable;

class ModerateListing implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 2;

    public int $timeout = 45;

    public function __construct(public readonly int $listingId) {}

    public function backoff(): array
    {
        return [15];
    }

    public function middleware(): array
    {
        return [(new WithoutOverlapping('listing-moderation:'.$this->listingId))->releaseAfter(10)->expireAfter(90)];
    }

    public function handle(ListingModerationService $moderation): void
    {
        $moderation->moderate($this->listingId);
    }

    public function failed(Throwable $exception): void
    {
        // The service persists a fail-closed attempt before an exception reaches the queue.
    }
}
