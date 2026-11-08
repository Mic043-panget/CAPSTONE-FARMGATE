<?php

use App\Models\Complaint;
use App\Services\EscalateOrderCases;
use App\Services\ExpireSellerPromotions;
use App\Services\PayMongoRefundService;
use App\Services\RiderAssignmentService;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('riders:process-deliveries', function (RiderAssignmentService $assignment): void {
    $assignment->processPendingDeliveries();
    $this->info('Pending standard-delivery rider offers processed.');
})->purpose('Assign available riders and escalate unanswered standard-delivery offers');

Artisan::command('promotions:expire', function (ExpireSellerPromotions $expiry): void {
    $this->info($expiry->run().' seller promotion(s) expired.');
})->purpose('End seller promotions whose scheduled date has passed');

Artisan::command('cases:escalate', function (EscalateOrderCases $escalation): void {
    $this->info($escalation->run().' unanswered order case(s) escalated to admin.');
})->purpose('Escalate order cases without a seller response after three calendar days');

Artisan::command('refunds:sync', function (PayMongoRefundService $refunds): void {
    $pending = Complaint::query()->where('refund_status', 'PENDING_PROVIDER')->whereNotNull('paymongo_refund_id')->get();
    $synced = 0;
    foreach ($pending as $case) {
        try {
            $refunds->sync($case);
            $synced++;
        } catch (Throwable $exception) {
            report($exception);
        }
    }
    $stale = 0;
    Complaint::query()->where('refund_status', 'PROCESSING')->where('updated_at', '<=', now()->subMinutes(20))->orderBy('id')->chunkById(100, function ($cases) use ($refunds, &$stale): void {
        foreach ($cases as $case) {
            try {
                $stale += $refunds->markStaleSubmission($case) ? 1 : 0;
            } catch (Throwable $exception) {
                report($exception);
            }
        }
    });
    $this->info($synced.' pending PayMongo refund(s) checked; '.$stale.' stale submission(s) flagged for admin reconciliation.');
})->purpose('Reconcile pending PayMongo refund states');
