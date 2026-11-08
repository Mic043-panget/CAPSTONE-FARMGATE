<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RiderDocument extends Model
{
    protected $fillable = [
        'rider_application_id', 'rider_vehicle_change_id', 'uploaded_by', 'document_type',
        'path', 'mime_type', 'original_name', 'size', 'deleted_at', 'deleted_by',
    ];

    protected $hidden = ['path'];

    protected function casts(): array
    {
        return ['deleted_at' => 'datetime'];
    }

    public function application(): BelongsTo
    {
        return $this->belongsTo(RiderApplication::class, 'rider_application_id');
    }

    public function vehicleChange(): BelongsTo
    {
        return $this->belongsTo(RiderVehicleChange::class, 'rider_vehicle_change_id');
    }
}
