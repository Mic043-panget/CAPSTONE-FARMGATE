<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class RiderPayoutDestination extends Model
{
    protected $fillable = [
        'rider_id',
        'destination_type',
        'account_holder',
        'bank_name',
        'account_number',
        'wallet_number',
        'status',
        'is_current',
        'consent_version',
        'consent_accepted_at',
        'verified_by',
        'verified_at',
    ];

    protected $hidden = [
        'account_holder',
        'bank_name',
        'account_number',
        'wallet_number',
    ];

    protected function casts(): array
    {
        return [
            'account_holder' => 'encrypted',
            'bank_name' => 'encrypted',
            'account_number' => 'encrypted',
            'wallet_number' => 'encrypted',
            'consent_accepted_at' => 'datetime',
            'verified_at' => 'datetime',
            'is_current' => 'boolean',
        ];
    }

    public function rider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'rider_id');
    }

    public function verifier(): BelongsTo
    {
        return $this->belongsTo(User::class, 'verified_by');
    }

    public function histories(): HasMany
    {
        return $this->hasMany(RiderPayoutDestinationHistory::class);
    }
}
