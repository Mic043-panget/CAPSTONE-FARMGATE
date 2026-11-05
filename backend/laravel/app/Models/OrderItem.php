<?php

namespace App\Models;

use App\Enums\PricingType;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class OrderItem extends \Illuminate\Database\Eloquent\Model
{
    use HasFactory, \Illuminate\Database\Eloquent\SoftDeletes;

    protected $fillable = ['order_id', 'listing_id', 'quantity', 'unit_price', 'total_amount', 'pricing_type'];

    protected function casts(): array
    {
        return [
            'pricing_type' => PricingType::class,
            'quantity' => 'integer',
            'unit_price' => 'decimal:2',
            'total_amount' => 'decimal:2',
        ];
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function listing(): BelongsTo
    {
        return $this->belongsTo(LivestockListing::class, 'listing_id');
    }
}
