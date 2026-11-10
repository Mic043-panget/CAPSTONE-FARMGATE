<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

class SellerPayoutDestinationHistory extends Model
{
    protected $fillable = [
        'seller_payout_destination_id',
        'actor_id',
        'action',
        'previous_status',
        'new_status',
        'reason',
    ];

    protected $hidden = ['reason'];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('A payout destination history entry cannot be changed.'));
        static::deleting(fn () => throw new LogicException('A payout destination history entry cannot be deleted.'));
    }

    public function destination(): BelongsTo
    {
        return $this->belongsTo(SellerPayoutDestination::class, 'seller_payout_destination_id');
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }
}
