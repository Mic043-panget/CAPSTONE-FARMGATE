<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RiderProfile extends \Illuminate\Database\Eloquent\Model
{
    use HasFactory, \Illuminate\Database\Eloquent\SoftDeletes;

    protected $fillable = [
        'user_id', 'phone', 'vehicle_type', 'plate_number', 'vehicle_make_model', 'vehicle_color',
        'license_expires_on', 'vehicle_registration_expires_on', 'is_verified', 'availability',
        'latitude', 'longitude', 'last_location_at',
    ];

    protected function casts(): array
    {
        return [
            'is_verified' => 'boolean',
            'latitude' => 'float',
            'longitude' => 'float',
            'last_location_at' => 'datetime',
            'license_expires_on' => 'date',
            'vehicle_registration_expires_on' => 'date',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}