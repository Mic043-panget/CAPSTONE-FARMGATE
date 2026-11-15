<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

class RiderPayout extends Model
{
    protected $fillable = [
        'rider_earning_id',
        'rider_id',
        'amount_cents',
        'status',
        'recorded_by',
        'method',
        'external_reference',
        'external_reference_hash',
        'reason',
        'paid_at',
    ];

    protected $hidden = ['external_reference', 'external_reference_hash', 'reason'];

    protected function casts(): array
    {
        return [
            'amount_cents' => 'integer',
            'external_reference' => 'encrypted',
            'reason' => 'encrypted',
            'paid_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::deleting(fn () => throw new LogicException('A recorded rider payout cannot be deleted.'));
    }

    public function earning(): BelongsTo
    {
        return $this->belongsTo(RiderEarning::class, 'rider_earning_id');
    }

    public function rider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'rider_id');
    }

    public function recorder(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recorded_by');
    }

    public function histories(): HasMany
    {
        return $this->hasMany(RiderPayoutHistory::class)->latest();
    }
}
