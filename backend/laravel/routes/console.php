<?php

use App\Enums\Role;
use App\Models\Complaint;
use App\Models\FarmgateEvent;
use App\Models\User;
use App\Notifications\CalendarEventNotification;
use App\Services\EscalateOrderCases;
use App\Services\ExpireSellerPromotions;
use App\Services\PayMongoRefundService;
use App\Services\PromotionNotificationService;
use App\Services\RiderAssignmentService;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('riders:process-deliveries', function (RiderAssignmentService $assignment): void {
    $assignment->processPendingDeliveries();
    $this->info('Pending standard-delivery rider offers processed.');
})->purpose('Assign available riders and escalate unanswered standard-delivery offers');

Artisan::command('promotions:expire', function (ExpireSellerPromotions $expiry, PromotionNotificationService $notifications): void {
    $this->info($expiry->run($notifications).' seller promotion(s) expired.');
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

Artisan::command('calendar:send-reminders', function (): void {
    $events = FarmgateEvent::query()
        ->where('status', 'APPROVED')
        ->whereBetween('starts_at', [now(), now()->addDay()])
        ->whereNull('upcoming_notification_sent_at')
        ->orderBy('id')
        ->get(['id']);
    $sent = 0;

    foreach ($events as $event) {
        $didSend = DB::transaction(function () use ($event): bool {
            $locked = FarmgateEvent::query()->lockForUpdate()->find($event->id);
            if ($locked === null
                || $locked->status !== 'APPROVED'
                || $locked->upcoming_notification_sent_at !== null
                || $locked->starts_at->lt(now())
                || $locked->starts_at->gt(now()->addDay())) {
                return false;
            }

            $locked->update(['upcoming_notification_sent_at' => now()]);
            $roles = match ($locked->audience) {
                'PUBLIC' => [Role::BUYER->value, Role::SELLER->value, Role::RIDER->value],
                'BUYERS' => [Role::BUYER->value],
                'SELLERS' => [Role::SELLER->value],
                'RIDERS' => [Role::RIDER->value],
                'ADMINS' => [Role::ADMIN->value],
                default => [],
            };
            $recipients = User::query()->whereIn('role', $roles)->whereKeyNot($locked->organizer_id)->get();
            $organizer = User::query()->find($locked->organizer_id);
            if ($organizer !== null) {
                $recipients->push($organizer);
            }
            $recipients->unique('id')->each(fn (User $recipient) => $recipient->notify(new CalendarEventNotification(
                $locked->id,
                $locked->title,
                $locked->status,
                'upcoming',
                $locked->starts_at->toIso8601String(),
            )));

            return true;
        });
        $sent += $didSend ? 1 : 0;
    }

    $this->info($sent.' upcoming event reminder(s) sent.');
})->purpose('Send one-time notifications for approved events starting within 24 hours');
