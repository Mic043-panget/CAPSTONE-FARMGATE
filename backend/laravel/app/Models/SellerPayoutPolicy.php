<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

class SellerPayoutPolicy extends Model
{
    protected $fillable = [
        'version',
        'based_on_policy_id',
        'amendment_reason',
        'effective_date',
        'policy_text',
        'supporting_document_path',
        'supporting_document_mime_type',
        'status',
        'created_by',
        'approved_by',
        'published_by',
        'approved_at',
        'published_at',
        'approval_reason',
        'publication_reason',
    ];

    protected $hidden = [
        'supporting_document_path',
        'approval_reason',
        'publication_reason',
    ];

    protected function casts(): array
    {
        return [
            'effective_date' => 'date',
            'approved_at' => 'datetime',
            'published_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(function (SellerPayoutPolicy $policy): void {
            $contentFields = [
                'version',
                'based_on_policy_id',
                'amendment_reason',
                'effective_date',
                'policy_text',
                'supporting_document_path',
                'supporting_document_mime_type',
            ];
            if ($policy->getOriginal('status') !== 'DRAFT' && $policy->isDirty($contentFields)) {
                throw new LogicException('An approved or published seller payout policy is immutable.');
            }
        });

        static::deleting(function (SellerPayoutPolicy $policy): void {
            if ($policy->status !== 'DRAFT') {
                throw new LogicException('An approved or published seller payout policy cannot be deleted.');
            }
        });
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function approver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by');
    }

    public function publisher(): BelongsTo
    {
        return $this->belongsTo(User::class, 'published_by');
    }

    public function basedOn(): BelongsTo
    {
        return $this->belongsTo(self::class, 'based_on_policy_id');
    }
}
