<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

class CodReceivingMethodHistory extends Model
{
    protected $fillable = [
        'cod_receiving_method_id',
        'actor_id',
        'action',
        'from_status',
        'to_status',
        'reason',
    ];

    protected function casts(): array
    {
        return ['reason' => 'encrypted'];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('COD receiving method history is append-only.'));
        static::deleting(fn () => throw new LogicException('COD receiving method history cannot be deleted.'));
    }

    public function method(): BelongsTo
    {
        return $this->belongsTo(CodReceivingMethod::class, 'cod_receiving_method_id');
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }
}
