<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

class SellerPayoutHistory extends Model
{
    protected $fillable = [
        'seller_payout_id',
        'actor_id',
        'action',
        'from_status',
        'to_status',
        'reason',
    ];

    protected function casts(): array
    {
        return ['reason' => 'encrypted'];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Seller payout history is append-only.'));
        static::deleting(fn () => throw new LogicException('Seller payout history cannot be deleted.'));
    }

    public function payout(): BelongsTo
    {
        return $this->belongsTo(SellerPayout::class, 'seller_payout_id');
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }
}
