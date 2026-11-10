<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

class CodRemittanceHistory extends Model
{
    protected $fillable = [
        'cod_remittance_id',
        'actor_id',
        'action',
        'expected_amount_cents',
        'received_amount_cents',
        'reason',
    ];

    protected function casts(): array
    {
        return [
            'expected_amount_cents' => 'integer',
            'received_amount_cents' => 'integer',
            'reason' => 'encrypted',
        ];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('COD remittance history is append-only.'));
        static::deleting(fn () => throw new LogicException('COD remittance history cannot be deleted.'));
    }

    public function remittance(): BelongsTo
    {
        return $this->belongsTo(CodRemittance::class, 'cod_remittance_id');
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }
}
