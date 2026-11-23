<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

class RiderPayout extends Model
{
    protected $fillable = [
        'reference', 'rider_earning_id', 'rider_id', 'destination_id', 'created_by', 'confirmed_by', 'recorded_by', 'method',
        'status', 'amount_cents', 'idempotency_key', 'external_reference',
        'external_reference_hash', 'transfer_date', 'receipt_path', 'receipt_sha256',
        'receipt_mime_type', 'creation_reason', 'confirmation_reason', 'reason', 'paid_at',
    ];

    protected $hidden = ['external_reference', 'external_reference_hash', 'reason', 'receipt_path', 'receipt_sha256', 'receipt_mime_type'];

    protected function casts(): array
    {
        return [
            'external_reference' => 'encrypted',
            'transfer_date' => 'date',
            'amount_cents' => 'integer',
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

    public function destination(): BelongsTo
    {
        return $this->belongsTo(RiderPayoutDestination::class, 'destination_id');
    }

    public function earnings(): BelongsToMany
    {
        return $this->belongsToMany(RiderEarning::class, 'rider_payout_earnings', 'payout_id', 'earning_id')->withTimestamps();
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
