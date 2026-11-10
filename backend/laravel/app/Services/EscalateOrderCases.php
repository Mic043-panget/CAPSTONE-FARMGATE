<?php

namespace App\Services;

use App\Enums\ComplaintStatus;
use App\Models\Complaint;
use Illuminate\Support\Facades\DB;

class EscalateOrderCases
{
    public function __construct(private readonly OrderCaseWorkflowService $workflow) {}

    public function run(): int
    {
        $escalated = 0;
        Complaint::query()
            ->where('status', ComplaintStatus::OPEN)
            ->whereNotNull('seller_response_deadline')
            ->whereNull('seller_responded_at')
            ->whereNull('escalated_at')
            ->where('seller_response_deadline', '<=', now())
            ->orderBy('id')
            ->chunkById(100, function ($cases) use (&$escalated): void {
                foreach ($cases as $case) {
                    $changed = DB::transaction(function () use ($case): ?Complaint {
                        $locked = Complaint::query()->lockForUpdate()->find($case->id);
                        if (! $locked
                            || $locked->status !== ComplaintStatus::OPEN
                            || $locked->seller_responded_at !== null
                            || $locked->escalated_at !== null
                            || $locked->seller_response_deadline?->isFuture()) {
                            return null;
                        }
                        $locked->forceFill(['escalated_at' => now()])->save();
                        $this->workflow->activity($locked, null, 'CASE_ESCALATED', 'Case '.$locked->case_reference.' was escalated to admin because the seller did not respond within three calendar days.');

                        return $locked->fresh('order');
                    });
                    if ($changed) {
                        $this->workflow->notifyParticipants($changed, 'Case '.$changed->case_reference.' was escalated to admin because the seller response window expired.');
                        $escalated++;
                    }
                }
            });

        return $escalated;
    }
}
