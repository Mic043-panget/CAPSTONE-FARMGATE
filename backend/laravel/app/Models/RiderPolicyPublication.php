<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

class RiderPolicyPublication extends Model
{
    public const REQUIRED_DOCUMENTS = [
        'privacy_content' => 'Privacy notice',
        'terms_content' => 'Rider terms',
        'safety_content' => 'Safety policy',
        'retention_content' => 'Retention and secure disposal schedule',
    ];

    protected $fillable = [
        'version',
        'effective_date',
        'privacy_contact',
        'privacy_content',
        'terms_content',
        'safety_content',
        'retention_content',
        'package_appendix',
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
        static::updating(function (RiderPolicyPublication $policy): void {
            if ($policy->getOriginal('status') === 'PUBLISHED') {
                throw new LogicException('A published rider policy is immutable. Create a new draft version.');
            }
        });

        static::deleting(function (RiderPolicyPublication $policy): void {
            if ($policy->status === 'PUBLISHED') {
                throw new LogicException('A published rider policy cannot be deleted.');
            }
        });
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function publisher(): BelongsTo
    {
        return $this->belongsTo(User::class, 'published_by');
    }

    public function approver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by');
    }
}
