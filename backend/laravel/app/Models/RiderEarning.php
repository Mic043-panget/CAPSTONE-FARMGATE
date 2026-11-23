<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use LogicException;

class RiderEarning extends Model
{
    protected $fillable = [
        'reference', 'delivery_id', 'order_id', 'rider_id', 'payout_id', 'delivery_reference',
        'order_reference', 'completed_at', 'delivery_fee_cents', 'gross_amount_cents',
        'deductions_cents', 'adjustment_cents', 'net_amount_cents', 'eligibility_status',
        'eligibility_reason', 'payout_status', 'calculation_snapshot',
        'percentage_snapshot', 'cap_scope_snapshot', 'cap_amount_snapshot', 'amount_cents', 'calculated_at',
    ];

    protected function casts(): array
    {
        return [
            'delivery_fee_cents' => 'integer',
            'percentage_snapshot' => 'decimal:2',
            'cap_amount_snapshot' => 'decimal:2',
            'amount_cents' => 'integer',
            'calculated_at' => 'datetime',
            'completed_at' => 'datetime',
            'calculation_snapshot' => 'array',
        ];
    }

    protected static function booted(): void
    {
        static::deleting(fn () => throw new LogicException('A recorded rider earning cannot be deleted.'));
    }

    public function delivery(): BelongsTo
    {
        return $this->belongsTo(Delivery::class);
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function rider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'rider_id');
    }

    public function payout(): BelongsTo
    {
        return $this->belongsTo(RiderPayout::class, 'payout_id');
    }

    public function payouts(): BelongsToMany
    {
        return $this->belongsToMany(RiderPayout::class, 'rider_payout_earnings', 'earning_id', 'payout_id')->withTimestamps();
    }

    public function histories(): HasMany
    {
        return $this->hasMany(RiderEarningHistory::class);
    }

    public function legacyPayout(): HasOne
    {
        return $this->hasOne(RiderPayout::class);
    }
}
