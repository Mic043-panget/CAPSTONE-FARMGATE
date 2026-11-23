<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class RiderEarningsSetting extends Model
{
    public const SINGLETON_ID = 1;

    public $incrementing = false;

    protected $fillable = ['percentage', 'cap_scope', 'cap_amount', 'updated_by', 'change_reason'];

    protected function casts(): array
    {
        return [
            'percentage' => 'decimal:2',
            'cap_amount' => 'decimal:2',
        ];
    }

    public function histories(): HasMany
    {
        return $this->hasMany(RiderEarningSettingHistory::class)->latest();
    }

    public function updater(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by');
    }

    public function isConfigured(): bool
    {
        return $this->percentage !== null && in_array($this->cap_scope, ['NO_CAP', 'PER_DELIVERY', 'PER_PAYOUT'], true)
            && ($this->cap_scope === 'NO_CAP'
                ? $this->cap_amount === null
                : $this->cap_amount !== null && (float) $this->cap_amount > 0);
    }
}
