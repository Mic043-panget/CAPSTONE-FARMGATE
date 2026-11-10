<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class CodRemittance extends Model
{
    protected $fillable = [
        'reference',
        'rider_id',
        'submitted_by',
        'received_by',
        'method_type',
        'receiving_method_id',
        'receiver_name',
        'transaction_reference',
        'transaction_reference_hash',
        'evidence_path',
        'evidence_sha256',
        'evidence_mime_type',
        'expected_amount_cents',
        'received_amount_cents',
        'status',
        'reconciliation_reason',
        'submitted_at',
        'reconciled_at',
    ];

    protected function casts(): array
    {
        return [
            'receiver_name' => 'encrypted',
            'transaction_reference' => 'encrypted',
            'expected_amount_cents' => 'integer',
            'received_amount_cents' => 'integer',
            'submitted_at' => 'datetime',
            'reconciled_at' => 'datetime',
            'reconciliation_reason' => 'encrypted',
        ];
    }

    protected $hidden = ['evidence_path', 'evidence_sha256', 'evidence_mime_type', 'transaction_reference_hash'];

    public function rider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'rider_id');
    }

    public function submitter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'submitted_by');
    }

    public function receiver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'received_by');
    }

    public function collections(): HasMany
    {
        return $this->hasMany(CodCollection::class, 'remittance_id');
    }

    public function histories(): HasMany
    {
        return $this->hasMany(CodRemittanceHistory::class)->latest();
    }

    public function receivingMethod(): BelongsTo
    {
        return $this->belongsTo(CodReceivingMethod::class, 'receiving_method_id');
    }
}
