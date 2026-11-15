<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RiderEarningSettingHistory extends Model
{
    protected $fillable = [
        'rider_earnings_setting_id',
        'actor_id',
        'old_percentage',
        'new_percentage',
        'old_cap_scope',
        'new_cap_scope',
        'old_cap_amount',
        'new_cap_amount',
        'reason',
    ];

    protected function casts(): array
    {
        return [
            'old_percentage' => 'decimal:2',
            'new_percentage' => 'decimal:2',
            'old_cap_amount' => 'decimal:2',
            'new_cap_amount' => 'decimal:2',
        ];
    }

    public function setting(): BelongsTo
    {
        return $this->belongsTo(RiderEarningsSetting::class, 'rider_earnings_setting_id');
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }
}
