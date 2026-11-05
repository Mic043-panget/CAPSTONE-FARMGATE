<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Model;

class SystemSettingHistory extends Model
{
    protected $table = 'system_setting_history';
    protected $fillable = ['system_setting_id', 'key', 'old_value', 'new_value', 'changed_by', 'change_reason'];
    public function actor(): BelongsTo { return $this->belongsTo(User::class, 'changed_by'); }
}