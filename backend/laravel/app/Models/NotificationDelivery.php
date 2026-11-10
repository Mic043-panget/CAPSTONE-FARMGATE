<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class NotificationDelivery extends Model
{
    protected $fillable = [
        'notification_id',
        'notifiable_type',
        'notifiable_id',
        'channel',
        'status',
        'attempts',
        'last_error',
        'delivered_at',
    ];

    protected function casts(): array
    {
        return [
            'attempts' => 'integer',
            'delivered_at' => 'datetime',
        ];
    }
}
