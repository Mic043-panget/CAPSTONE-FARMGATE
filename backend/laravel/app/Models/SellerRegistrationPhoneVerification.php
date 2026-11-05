<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SellerRegistrationPhoneVerification extends Model
{
    protected $fillable = [
        'phone_number',
        'otp_hash',
        'expires_at',
        'verified_at',
        'registration_token_hash',
        'registration_token_expires_at',
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
            'verified_at' => 'datetime',
            'registration_token_expires_at' => 'datetime',
            'attempt_window_started_at' => 'datetime',
            'send_window_started_at' => 'datetime',
            'last_sent_at' => 'datetime',
            'attempts' => 'integer',
            'send_count' => 'integer',
        ];
    }
}
