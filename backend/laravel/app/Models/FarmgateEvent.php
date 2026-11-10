<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class FarmgateEvent extends Model
{
    protected $fillable = [
        'organizer_id',
        'category',
        'title',
        'description',
        'location',
        'online_url',
        'image_path',
        'starts_at',
        'ends_at',
        'timezone',
        'audience',
        'promotion_id',
        'status',
        'reviewed_by',
        'reviewed_at',
        'review_reason',
        'upcoming_notification_sent_at',
    ];

    protected function casts(): array
    {
        return [
            'starts_at' => 'datetime',
            'ends_at' => 'datetime',
            'reviewed_at' => 'datetime',
            'upcoming_notification_sent_at' => 'datetime',
        ];
    }

    public function organizer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'organizer_id');
    }

    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by');
    }

    public function promotion(): BelongsTo
    {
        return $this->belongsTo(SellerPromotion::class);
    }

    public function history(): HasMany
    {
        return $this->hasMany(FarmgateEventHistory::class, 'event_id')->with('actor:id,name')->latest();
    }
}
