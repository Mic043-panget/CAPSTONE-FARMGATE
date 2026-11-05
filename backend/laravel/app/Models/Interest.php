<?php

namespace App\Models;

use App\Enums\InterestStatus;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Interest extends \Illuminate\Database\Eloquent\Model
{
    use HasFactory, \Illuminate\Database\Eloquent\SoftDeletes;

    protected $fillable = ['buyer_id', 'livestock_listing_id', 'status'];

    protected function casts(): array
    {
        return ['status' => InterestStatus::class];
    }

    public function buyer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'buyer_id');
    }

    public function listing(): BelongsTo
    {
        return $this->belongsTo(LivestockListing::class, 'livestock_listing_id');
    }
}