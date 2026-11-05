<?php

use App\Services\ExpireSellerPromotions;
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
