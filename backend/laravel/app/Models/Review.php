<?php

namespace App\Models;

use App\Enums\ReviewStatus;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Str;
use LogicException;

class Review extends Model
{
    use SoftDeletes;

    protected static function booted(): void
    {
        static::creating(function (Review $review): void {
            if (blank($review->review_reference)) {
                do {
                    $reference = sprintf('FG-REV-%d-%s', now()->year, Str::upper(Str::random(6)));
                } while (static::query()->where('review_reference', $reference)->exists());
                $review->review_reference = $reference;
            }
        });

        static::updating(function (Review $review): void {
            if ($review->isDirty('review_reference')) {
                throw new LogicException('A review reference cannot be changed after creation.');
            }
        });
    }

    protected $fillable = ['order_id', 'listing_id', 'buyer_id', 'seller_id', 'rating', 'comment', 'status'];

    protected function casts(): array
    {
        return ['status' => ReviewStatus::class, 'rating' => 'integer'];
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function buyer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'buyer_id');
    }

    public function seller(): BelongsTo
    {
        return $this->belongsTo(User::class, 'seller_id');
    }

    public function listing(): BelongsTo
    {
        return $this->belongsTo(LivestockListing::class, 'listing_id');
    }

    public function media(): HasMany
    {
        return $this->hasMany(ReviewMedia::class);
    }

    public function reports(): HasMany
    {
        return $this->hasMany(ReviewReport::class);
    }
}
