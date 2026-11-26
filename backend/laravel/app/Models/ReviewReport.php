<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ReviewReport extends Model
{
    public const SELLER_REASONS = [
        'HARASSMENT',
        'SPAM',
        'FAKE_OR_UNRELATED',
        'PERSONAL_INFORMATION',
        'OTHER_POLICY_CONCERN',
    ];

    protected $fillable = ['review_id', 'reporter_id', 'reporter_role', 'reason', 'explanation', 'status'];

    public function review(): BelongsTo
    {
        return $this->belongsTo(Review::class);
    }

    public function reporter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reporter_id');
    }

    public function media(): HasMany
    {
        return $this->hasMany(ReviewReportMedia::class);
    }
}
