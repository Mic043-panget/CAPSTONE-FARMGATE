<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ComplaintMedia extends Model
{
    protected $hidden = ['path'];

    protected $fillable = ['complaint_id', 'complaint_message_id', 'uploaded_by', 'path', 'mime_type', 'original_name', 'size'];

    public function complaint(): BelongsTo
    {
        return $this->belongsTo(Complaint::class);
    }

    public function message(): BelongsTo
    {
        return $this->belongsTo(ComplaintMessage::class, 'complaint_message_id');
    }
}
