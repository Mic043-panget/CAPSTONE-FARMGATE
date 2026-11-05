<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class DeliveryRateTier extends Model
{
    protected $fillable = ['name', 'min_km', 'max_km', 'base_fee', 'fee_per_km', 'priority', 'is_active'];
    protected function casts(): array
    {
        return ['min_km' => 'decimal:2', 'max_km' => 'decimal:2', 'base_fee' => 'decimal:2', 'fee_per_km' => 'decimal:2', 'is_active' => 'boolean'];
    }
}