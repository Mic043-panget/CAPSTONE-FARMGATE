<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Model;

class SystemSetting extends Model
{
    protected $fillable = ['key', 'value', 'type', 'category', 'label', 'description', 'is_active', 'is_public', 'created_by', 'updated_by'];

    protected function casts(): array
    {
        return ['is_active' => 'boolean', 'is_public' => 'boolean'];
    }

    public function updater(): BelongsTo { return $this->belongsTo(User::class, 'updated_by'); }
    public function history(): HasMany { return $this->hasMany(SystemSettingHistory::class); }
}