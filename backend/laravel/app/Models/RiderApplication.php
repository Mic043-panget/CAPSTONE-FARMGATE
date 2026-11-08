<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class RiderApplication extends Model
{
    protected $fillable = [
        'user_id', 'date_of_birth', 'residential_address', 'license_number', 'license_number_hash',
        'plate_number', 'vehicle_type', 'vehicle_make_model', 'vehicle_color', 'license_expires_on',
        'vehicle_registration_expires_on', 'status', 'privacy_policy_version', 'privacy_accepted_at',
        'terms_version', 'terms_accepted_at', 'safety_policy_version', 'safety_policy_accepted_at',
        'submitted_at', 'reviewer_id', 'reviewed_at', 'decision_reason',
    ];

    protected $hidden = ['date_of_birth', 'residential_address', 'license_number', 'license_number_hash'];

    protected function casts(): array
    {
        return [
            'date_of_birth' => 'encrypted',
            'residential_address' => 'encrypted',
            'license_number' => 'encrypted',
            'privacy_accepted_at' => 'datetime',
            'terms_accepted_at' => 'datetime',
            'safety_policy_accepted_at' => 'datetime',
            'submitted_at' => 'datetime',
            'reviewed_at' => 'datetime',
            'license_expires_on' => 'date',
            'vehicle_registration_expires_on' => 'date',
        ];
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
        return $this->hasMany(RiderDocument::class)->whereNull('deleted_at');
    }

    public function history(): HasMany
    {
        return $this->hasMany(RiderApplicationHistory::class)->latest();
    }

    public function vehicleChanges(): HasMany
    {
        return $this->hasMany(RiderVehicleChange::class, 'user_id', 'user_id')->latest();
    }
}
