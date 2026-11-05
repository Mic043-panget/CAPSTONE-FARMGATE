<?php

namespace App\Services;

use App\Models\AuditLog;
use App\Models\SellerPromotion;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class ExpireSellerPromotions
{
    public function run(): int
    {
        $expiredCount = 0;

        SellerPromotion::query()
            ->where('status', 'ACTIVE')
            ->where('ends_at', '<=', now())
            ->select(['id', 'seller_id'])
            ->chunkById(100, function ($promotions) use (&$expiredCount): void {
                foreach ($promotions as $candidate) {
                    $expired = DB::transaction(function () use ($candidate): bool {
                        User::query()->whereKey($candidate->seller_id)->lockForUpdate()->first();
                        $promotion = SellerPromotion::query()
                            ->where('seller_id', $candidate->seller_id)
                            ->where('status', 'ACTIVE')
                            ->where('ends_at', '<=', now())
                            ->lockForUpdate()
                            ->find($candidate->id);
                        if (! $promotion) {
                            return false;
                        }

                        $promotion->update(['status' => 'ENDED']);
                        AuditLog::create([
                            'action' => 'seller.promotion.expired',
                            'method' => 'SCHEDULE',
                            'route' => 'scheduler:promotions:expire',
                            'status_code' => 200,
                            'database_action' => 'UPDATE',
                            'entity_type' => SellerPromotion::class,
                            'entity_id' => (string) $promotion->id,
                            'description' => 'Seller promotion expired at its scheduled end date.',
                            'metadata' => ['seller_id' => $promotion->seller_id],
                            'before_values' => ['status' => 'ACTIVE'],
                            'after_values' => ['status' => 'ENDED'],
                            'changed_fields' => ['status'],
                        ]);

                        return true;
                    });

                    if ($expired) {
                        $expiredCount++;
                    }
                }
            });

        return $expiredCount;
    }
}
