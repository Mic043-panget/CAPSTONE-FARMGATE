<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RiderPayoutHistory extends Model
{
    protected $fillable = [
        'rider_payout_id',
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

    public function payout(): BelongsTo
    {
        return $this->belongsTo(RiderPayout::class, 'rider_payout_id');
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }
}
