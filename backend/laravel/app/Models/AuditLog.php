<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Model;

class AuditLog extends Model
{
    protected $fillable = [
        'user_id',
        'action',
        'method',
        'route',
        'status_code',
        'database_action',
        'entity_type',
        'entity_id',
        'description',
        'reason',
        'request_url',
        'ip_address',
        'user_agent',
        'metadata',
        'before_values',
        'after_values',
        'changed_fields',
    ];

    protected function casts(): array
    {
        return [
            'metadata' => 'array',
            'before_values' => 'array',
            'after_values' => 'array',
            'changed_fields' => 'array',
        ];
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }
}
