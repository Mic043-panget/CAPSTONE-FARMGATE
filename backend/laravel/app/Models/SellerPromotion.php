<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Support\Facades\Storage;

class SellerPromotion extends Model
{
    protected $fillable = [
        'seller_id', 'name', 'description', 'discount_type', 'discount_value', 'applies_to_all',
        'status', 'starts_at', 'ends_at', 'image_path',
    ];

    protected $appends = ['image_url'];

    protected function casts(): array
    {
        return [
            'discount_value' => 'decimal:2',
            'applies_to_all' => 'boolean',
            'starts_at' => 'datetime',
            'ends_at' => 'datetime',
        ];
    }

    public function seller(): BelongsTo
    {
        return $this->belongsTo(User::class, 'seller_id');
    }

    public function listings(): BelongsToMany
    {
        return $this->belongsToMany(LivestockListing::class, 'seller_promotion_listings', 'promotion_id', 'listing_id');
    }

    public function calendarEvent(): HasOne
    {
        return $this->hasOne(FarmgateEvent::class, 'promotion_id');
    }

    public function getImageUrlAttribute(): ?string
    {
        if (! $this->image_path) {
            return null;
        }

        /** @var FilesystemAdapter $publicDisk */
        $publicDisk = Storage::disk('public');

        return $publicDisk->url($this->image_path);
    }
}
