<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SellerIdentityDocument extends Model
{
    protected $fillable = [
        'seller_profile_id',
        'encrypted_path',
        'mime_type',
        'size',
        'uploaded_at',
    ];

    protected $hidden = ['encrypted_path'];

    protected function casts(): array
    {
        return [
            'size' => 'integer',
            'uploaded_at' => 'datetime',
        ];
    }

    public function sellerProfile(): BelongsTo
    {
        return $this->belongsTo(SellerProfile::class);
    }
}
