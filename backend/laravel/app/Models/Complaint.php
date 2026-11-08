<?php

namespace App\Models;

use App\Enums\ComplaintStatus;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Complaint extends Model
{
    use SoftDeletes;

    protected $hidden = ['paymongo_payment_id', 'paymongo_refund_id', 'refund_error', 'payout_evidence_path'];

    protected $fillable = [
        'order_id', 'opened_by', 'respondent_id', 'case_type', 'reason', 'other_reason', 'description', 'evidence',
        'status', 'resolution_reason', 'resolved_by', 'resolved_at', 'seller_response_deadline', 'seller_responded_at',
        'escalated_at', 'requested_items', 'return_method', 'requested_amount', 'approved_refund_amount', 'refund_status',
        'paymongo_payment_id', 'paymongo_refund_id', 'refund_error', 'payout_reference', 'payout_evidence_path',
        'approved_by', 'refund_approved_at', 'return_received_at', 'refund_completed_at',
    ];

    protected function casts(): array
    {
        return [
            'status' => ComplaintStatus::class,
            'resolved_at' => 'datetime',
            'seller_response_deadline' => 'datetime',
            'seller_responded_at' => 'datetime',
            'escalated_at' => 'datetime',
            'requested_items' => 'array',
            'requested_amount' => 'decimal:2',
            'approved_refund_amount' => 'decimal:2',
            'refund_approved_at' => 'datetime',
            'return_received_at' => 'datetime',
            'refund_completed_at' => 'datetime',
        ];
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function opener(): BelongsTo
    {
        return $this->belongsTo(User::class, 'opened_by');
    }

    public function respondent(): BelongsTo
    {
        return $this->belongsTo(User::class, 'respondent_id');
    }

    public function resolver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'resolved_by');
    }

    public function statusHistory(): HasMany
    {
        return $this->hasMany(ComplaintStatusHistory::class)->latest();
    }

    public function messages(): HasMany
    {
        return $this->hasMany(ComplaintMessage::class)->with(['sender:id,name', 'media'])->oldest();
    }

    public function media(): HasMany
    {
        return $this->hasMany(ComplaintMedia::class)->whereNull('complaint_message_id');
    }
}
