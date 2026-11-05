<?php

namespace App\Models;

use App\Enums\ComplaintStatus;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Complaint extends \Illuminate\Database\Eloquent\Model
{
    use \Illuminate\Database\Eloquent\SoftDeletes;

    protected $fillable = ['order_id', 'opened_by', 'respondent_id', 'reason', 'description', 'evidence', 'status', 'resolution_reason', 'resolved_by', 'resolved_at'];

    protected function casts(): array
    {
        return ['status' => ComplaintStatus::class, 'resolved_at' => 'datetime'];
    }

    public function order(): BelongsTo { return $this->belongsTo(Order::class); }
    public function opener(): BelongsTo { return $this->belongsTo(User::class, 'opened_by'); }
    public function respondent(): BelongsTo { return $this->belongsTo(User::class, 'respondent_id'); }
    public function resolver(): BelongsTo { return $this->belongsTo(User::class, 'resolved_by'); }
    public function statusHistory(): HasMany { return $this->hasMany(ComplaintStatusHistory::class)->latest(); }
}
