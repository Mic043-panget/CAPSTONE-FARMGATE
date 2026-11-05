<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ComplaintStatusHistory extends \Illuminate\Database\Eloquent\Model
{
    protected $fillable = ['complaint_id', 'changed_by', 'from_status', 'to_status', 'reason'];

    public function complaint(): BelongsTo { return $this->belongsTo(Complaint::class); }
    public function changer(): BelongsTo { return $this->belongsTo(User::class, 'changed_by'); }
}
