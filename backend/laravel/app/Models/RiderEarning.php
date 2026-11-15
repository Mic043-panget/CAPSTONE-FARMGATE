<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;
use LogicException;

class RiderEarning extends Model
{
    protected $fillable = [
        'delivery_id',
        'order_id',
        'rider_id',
        'delivery_fee_cents',
        'percentage_snapshot',
        'cap_scope_snapshot',
        'cap_amount_snapshot',
        'amount_cents',
        'calculated_at',
    ];

    protected function casts(): array
    {
        return [
            'delivery_fee_cents' => 'integer',
            'percentage_snapshot' => 'decimal:2',
            'cap_amount_snapshot' => 'decimal:2',
            'amount_cents' => 'integer',
            'calculated_at' => 'datetime',
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

    public function payout(): HasOne
    {
        return $this->hasOne(RiderPayout::class);
    }
}
