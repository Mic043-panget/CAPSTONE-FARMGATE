<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class SellerPayoutDestination extends Model
{
    protected $fillable = [
        'seller_id',
        'destination_type',
        'account_holder',
        'bank_name',
        'account_number',
        'wallet_number',
        'status',
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
        ];
    }

    public function seller(): BelongsTo
    {
        return $this->belongsTo(User::class, 'seller_id');
    }

    public function verifier(): BelongsTo
    {
        return $this->belongsTo(User::class, 'verified_by');
    }

    public function histories(): HasMany
    {
        return $this->hasMany(SellerPayoutDestinationHistory::class);
    }
}
