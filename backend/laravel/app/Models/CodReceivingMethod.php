<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class CodReceivingMethod extends Model
{
    protected $fillable = [
        'method_type',
        'label',
        'instructions',
        'account_holder',
        'bank_name',
        'account_number',
        'qr_path',
        'qr_mime_type',
        'status',
        'configured_by',
        'verified_by',
        'verification_reason',
        'verified_at',
    ];

    protected $hidden = [
        'account_holder',
        'account_number',
        'qr_path',
        'qr_mime_type',
    ];

    protected function casts(): array
    {
        return [
            'account_holder' => 'encrypted',
            'account_number' => 'encrypted',
            'verification_reason' => 'encrypted',
            'verified_at' => 'datetime',
        ];
    }

    public function histories(): HasMany
    {
        return $this->hasMany(CodReceivingMethodHistory::class)->latest();
    }

    public function verifier(): BelongsTo
    {
        return $this->belongsTo(User::class, 'verified_by');
    }
}
