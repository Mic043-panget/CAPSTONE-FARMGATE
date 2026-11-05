<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ListingModerationAttempt extends Model
{
    protected $fillable = [
        'listing_id',
        'seller_id',
        'attempt_number',
        'status',
        'recommendation',
        'confidence',
        'predicted_category',
        'reasons',
        'flags',
        'model',
        'error_code',
        'response_summary',
        'final_listing_status',
        'applied_automatically',
        'admin_override_by',
        'admin_override_reason',
        'completed_at',
    ];

    protected function casts(): array
    {
        return [
            'confidence' => 'decimal:4',
            'reasons' => 'array',
            'flags' => 'array',
            'applied_automatically' => 'boolean',
            'completed_at' => 'datetime',
        ];
    }

    public function listing(): BelongsTo
    {
        return $this->belongsTo(LivestockListing::class, 'listing_id');
    }
}
