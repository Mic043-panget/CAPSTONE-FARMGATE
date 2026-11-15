<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class RiderPayout extends Model
{
    protected $fillable = [
        'reference', 'rider_id', 'destination_id', 'created_by', 'confirmed_by', 'method',
        'status', 'amount_cents', 'idempotency_key', 'external_reference',
        'external_reference_hash', 'transfer_date', 'receipt_path', 'receipt_sha256',
        'receipt_mime_type', 'creation_reason', 'confirmation_reason', 'paid_at',
    ];

    protected $hidden = ['external_reference', 'external_reference_hash', 'receipt_path', 'receipt_sha256'];

    protected function casts(): array
    {
        return [
            'external_reference' => 'encrypted',
            'transfer_date' => 'date',
            'paid_at' => 'datetime',
        ];
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

    public function histories(): HasMany
    {
        return $this->hasMany(RiderPayoutHistory::class);
    }
}
