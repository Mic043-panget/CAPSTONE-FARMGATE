<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FarmgateEventHistory extends Model
{
    protected $table = 'farmgate_event_history';

    protected $fillable = [
        'event_id',
        'actor_id',
        'action',
        'before_values',
        'after_values',
        'reason',
    ];

    protected function casts(): array
    {
        return [
            'before_values' => 'array',
            'after_values' => 'array',
        ];
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }
}
