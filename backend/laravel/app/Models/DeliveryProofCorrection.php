<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DeliveryProofCorrection extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'delivery_id',
        'corrected_by',
        'old_proof_path',
        'new_proof_path',
        'old_recipient_name',
        'new_recipient_name',
        'old_proof_captured_at',
        'new_proof_captured_at',
        'old_proof_recorded_at',
        'new_proof_recorded_at',
        'reason',
        'created_at',
    ];

    protected $hidden = ['old_proof_path', 'new_proof_path'];

    protected function casts(): array
    {
        return [
            'created_at' => 'datetime',
            'old_proof_captured_at' => 'datetime',
            'new_proof_captured_at' => 'datetime',
            'old_proof_recorded_at' => 'datetime',
            'new_proof_recorded_at' => 'datetime',
        ];
    }

    public function delivery(): BelongsTo
    {
        return $this->belongsTo(Delivery::class);
    }

    public function correctedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'corrected_by');
    }
}
