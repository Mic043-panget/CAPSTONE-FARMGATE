<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

class RiderPayoutDestinationHistory extends Model
{
    protected $fillable = [
        'rider_payout_destination_id',
        'actor_id',
        'action',
        'previous_status',
        'new_status',
        'reason',
    ];

    protected $hidden = ['reason'];

    protected function casts(): array
    {
        return ['reason' => 'encrypted'];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('A rider payout destination history entry cannot be changed.'));
        static::deleting(fn () => throw new LogicException('A rider payout destination history entry cannot be deleted.'));
    }

    public function destination(): BelongsTo
    {
        return $this->belongsTo(RiderPayoutDestination::class, 'rider_payout_destination_id');
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }
}
