<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use LogicException;

class RiderPayoutDestinationHistory extends Model
{
    protected $fillable = ['rider_payout_destination_id', 'actor_id', 'action', 'from_status', 'to_status', 'reason'];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Rider payout destination history is append-only.'));
        static::deleting(fn () => throw new LogicException('Rider payout destination history cannot be deleted.'));
    }
}
