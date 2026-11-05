<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

class LoginHistory extends \Illuminate\Database\Eloquent\Model
{
    protected $table = 'login_history';

    protected $fillable = ['user_id', 'attempted_identifier', 'was_successful', 'ip_address', 'user_agent'];

    protected function casts(): array
    {
        return ['was_successful' => 'boolean'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}