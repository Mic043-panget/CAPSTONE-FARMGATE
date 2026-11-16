<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;

class SellerProfile extends Model
{
    use HasFactory, \Illuminate\Database\Eloquent\SoftDeletes;

    protected $fillable = [
        'business_name',
        'shop_name',
        'shop_image_path',
        'phone',
        'address',
        'latitude',
        'longitude',
        'pickup_location_confirmed',
        'pickup_barangay',
        'pickup_city_municipality',
        'pickup_province',
        'is_verified',
        'verification_status',
        'verification_rejection_reason',
        'verification_submitted_at',
        'verification_reviewed_at',
        'verification_reviewer_id',
    ];

    protected function casts(): array
    {
        return [
            'is_verified' => 'boolean',
            'latitude' => 'float',
            'longitude' => 'float',
            'pickup_location_confirmed' => 'boolean',
            'verification_submitted_at' => 'datetime',
            'verification_reviewed_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function identityDocument(): HasOne
    {
        return $this->hasOne(SellerIdentityDocument::class);
    }
}
