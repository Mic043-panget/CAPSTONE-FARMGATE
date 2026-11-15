<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class RiderPayoutDestination extends Model
{
    protected $fillable = [
        'rider_id', 'destination_type', 'account_holder', 'bank_name', 'account_number',
        'wallet_number', 'status', 'verified_by', 'verified_at',
    ];

    protected $hidden = ['account_holder', 'bank_name', 'account_number', 'wallet_number'];

    protected function casts(): array
    {
        return [
            'account_holder' => 'encrypted',
            'bank_name' => 'encrypted',
            'account_number' => 'encrypted',
            'wallet_number' => 'encrypted',
            'verified_at' => 'datetime',
        ];
    }

    public function rider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'rider_id');
    }

    public function histories(): HasMany
    {
        return $this->hasMany(RiderPayoutDestinationHistory::class);
    }
}
