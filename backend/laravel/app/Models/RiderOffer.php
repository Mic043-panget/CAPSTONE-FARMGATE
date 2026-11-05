<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RiderOffer extends Model
{
    use \Illuminate\Database\Eloquent\SoftDeletes;

    protected $fillable = ['delivery_id', 'rider_id', 'status', 'distance_km', 'expires_at'];

    protected function casts(): array
    {
        return [
            'distance_km' => 'decimal:2',
            'expires_at' => 'datetime',
        ];
    }

    public function delivery(): BelongsTo
    {
        return $this->belongsTo(Delivery::class);
    }

    public function rider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'rider_id');
    }
}
