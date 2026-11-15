<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class RiderPayoutMethod extends Model
{
    protected $fillable = ['method_type', 'status', 'configured_by', 'verified_by', 'verified_at'];

    protected function casts(): array
    {
        return ['verified_at' => 'datetime'];
    }

    public function histories(): HasMany
    {
        return $this->hasMany(RiderPayoutMethodHistory::class);
    }
}
