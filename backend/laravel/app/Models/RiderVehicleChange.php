<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class RiderVehicleChange extends Model
{
    protected $fillable = [
        'user_id', 'plate_number', 'vehicle_type', 'vehicle_make_model', 'vehicle_color',
        'license_expires_on', 'vehicle_registration_expires_on', 'status', 'reviewer_id',
        'reviewed_at', 'decision_reason',
    ];

    protected function casts(): array
    {
        return ['license_expires_on' => 'date', 'vehicle_registration_expires_on' => 'date', 'reviewed_at' => 'datetime'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewer_id');
    }

    public function documents(): HasMany
    {
        return $this->hasMany(RiderDocument::class, 'rider_vehicle_change_id')->whereNull('deleted_at');
    }
}
