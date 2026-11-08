<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RiderApplicationHistory extends Model
{
    protected $fillable = ['rider_application_id', 'actor_id', 'from_status', 'to_status', 'action', 'reason'];

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }
}
