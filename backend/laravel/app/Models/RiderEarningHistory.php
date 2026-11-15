<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use LogicException;

class RiderEarningHistory extends Model
{
    protected $fillable = [
        'rider_earning_id', 'actor_id', 'action', 'from_status', 'to_status',
        'adjustment_cents', 'reason', 'snapshot',
    ];

    protected function casts(): array
    {
        return ['snapshot' => 'array'];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Rider earning history is append-only.'));
        static::deleting(fn () => throw new LogicException('Rider earning history cannot be deleted.'));
    }
}
