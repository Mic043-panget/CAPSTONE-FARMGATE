<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CodCollection extends Model
{
    protected $fillable = [
        'order_id',
        'delivery_id',
        'rider_id',
        'remittance_id',
        'expected_amount_cents',
        'collected_amount_cents',
        'proof_path',
        'proof_sha256',
        'proof_mime_type',
        'status',
        'collected_at',
    ];

    protected function casts(): array
    {
        return [
            'expected_amount_cents' => 'integer',
            'collected_amount_cents' => 'integer',
            'collected_at' => 'datetime',
        ];
    }

    protected $hidden = ['proof_path', 'proof_sha256', 'proof_mime_type'];

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function delivery(): BelongsTo
    {
        return $this->belongsTo(Delivery::class);
    }

    public function rider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'rider_id');
    }

    public function remittance(): BelongsTo
    {
        return $this->belongsTo(CodRemittance::class);
    }
}
