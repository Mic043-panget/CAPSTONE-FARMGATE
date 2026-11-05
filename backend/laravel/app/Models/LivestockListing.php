<?php

namespace App\Models;

use App\Enums\ListingStatus;
use App\Enums\PricingType;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class LivestockListing extends Model
{
    use HasFactory, \Illuminate\Database\Eloquent\SoftDeletes;

    protected $fillable = [
        'seller_id', 'category_id', 'name', 'breed', 'sex', 'age_months', 'estimated_weight_kg',
        'quantity', 'description', 'pickup_location', 'health_information',
        'vaccination_information', 'pricing_type', 'price_per_kilo', 'price_per_head',
        'status',
    ];

    protected function casts(): array
    {
        return [
            'pricing_type' => PricingType::class,
            'status' => ListingStatus::class,
            'estimated_weight_kg' => 'decimal:2',
            'price_per_kilo' => 'decimal:2',
            'price_per_head' => 'decimal:2',
        ];
    }

    public function seller(): BelongsTo
    {
        return $this->belongsTo(User::class, 'seller_id');
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class);
    }

    public function images(): HasMany
    {
        return $this->hasMany(ProductImage::class, 'listing_id');
    }

    public function moderationAttempts(): HasMany
    {
        return $this->hasMany(ListingModerationAttempt::class, 'listing_id');
    }

    public function latestModerationAttempt(): HasOne
    {
        return $this->hasOne(ListingModerationAttempt::class, 'listing_id')->latestOfMany('id');
    }

    public function interests(): HasMany
    {
        return $this->hasMany(Interest::class);
    }
}
