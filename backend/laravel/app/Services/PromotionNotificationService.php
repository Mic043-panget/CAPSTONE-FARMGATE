<?php

namespace App\Services;

use App\Enums\Role;
use App\Models\SellerPromotion;
use App\Models\User;
use App\Notifications\PromotionChangedNotification;

class PromotionNotificationService
{
    public function notifyBuyers(SellerPromotion $promotion, string $action): void
    {
        $notification = new PromotionChangedNotification(
            $promotion->id,
            $promotion->name,
            $action,
            $promotion->status,
            $promotion->updated_at->toIso8601String(),
        );

        User::query()
            ->where('role', Role::BUYER->value)
            ->select(['id', 'name', 'email', 'role', 'account_preferences'])
            ->chunkById(100, function ($buyers) use ($notification): void {
                $buyers->each(fn (User $buyer) => $buyer->notify($notification));
            });
    }
}
