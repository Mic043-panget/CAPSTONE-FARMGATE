<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ReviewReportMedia extends Model
{
    protected $hidden = ['path'];

    protected $fillable = ['review_report_id', 'uploaded_by', 'path', 'mime_type', 'original_name', 'size'];

    public function report(): BelongsTo
    {
        return $this->belongsTo(ReviewReport::class, 'review_report_id');
    }
}
