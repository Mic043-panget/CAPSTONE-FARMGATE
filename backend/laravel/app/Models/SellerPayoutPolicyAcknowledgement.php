<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SellerPayoutPolicyAcknowledgement extends Model
{
    protected $fillable = [
        'seller_id',
        'seller_payout_policy_id',
        'acknowledged_at',
    ];

    protected function casts(): array
    {
        return ['acknowledged_at' => 'datetime'];
    }

    public function seller(): BelongsTo
    {
        return $this->belongsTo(User::class, 'seller_id');
    }

    public function policy(): BelongsTo
    {
        return $this->belongsTo(SellerPayoutPolicy::class, 'seller_payout_policy_id');
    }
}
