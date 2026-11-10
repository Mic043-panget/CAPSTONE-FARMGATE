<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class MailTestDelivery extends Model
{
    protected $fillable = [
        'user_id',
        'status',
        'attempts',
        'last_error',
        'sent_at',
    ];

    protected function casts(): array
    {
        return [
            'attempts' => 'integer',
            'sent_at' => 'datetime',
        ];
    }
}
