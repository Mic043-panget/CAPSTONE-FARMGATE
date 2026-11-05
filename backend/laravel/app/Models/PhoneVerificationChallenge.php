<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PhoneVerificationChallenge extends Model
{
    protected $fillable = [
        'user_id',
        'phone_number',
        'otp_hash',
        'expires_at',
        'attempts',
        'send_count',
        'attempt_window_started_at',
        'send_window_started_at',
        'last_sent_at',
    ];

    protected function casts(): array
    {
        return [
            'expires_at' => 'datetime',
            'attempt_window_started_at' => 'datetime',
            'send_window_started_at' => 'datetime',
            'last_sent_at' => 'datetime',
            'attempts' => 'integer',
            'send_count' => 'integer',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
