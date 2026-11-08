<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ReviewMedia extends Model
{
    protected $hidden = ['path'];

    protected $fillable = ['review_id', 'path', 'mime_type', 'original_name', 'size'];

    public function review(): BelongsTo
    {
        return $this->belongsTo(Review::class);
    }
}
