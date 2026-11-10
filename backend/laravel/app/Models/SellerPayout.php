<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

class SellerPayout extends Model
{
    protected $fillable = [
        'order_id',
        'seller_id',
        'recorded_by',
        'payout_destination_id',
        'amount_cents',
        'method',
        'external_reference',
        'provider_status',
        'receipt_path',
        'status',
        'reason',
        'paid_at',
    ];

    protected $hidden = ['recorded_by', 'reason', 'receipt_path', 'external_reference_hash'];

    protected function casts(): array
    {
        return [
            'amount_cents' => 'integer',
            'paid_at' => 'datetime',
            'reason' => 'encrypted',
            'external_reference' => 'encrypted',
        ];
    }

    protected static function booted(): void
    {
        static::deleting(fn () => throw new LogicException('A recorded seller payout cannot be deleted.'));
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function seller(): BelongsTo
    {
        return $this->belongsTo(User::class, 'seller_id');
    }

    public function recorder(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recorded_by');
    }

    public function destination(): BelongsTo
    {
        return $this->belongsTo(SellerPayoutDestination::class, 'payout_destination_id');
    }

    public function histories(): HasMany
    {
        return $this->hasMany(SellerPayoutHistory::class)->latest();
    }
}
