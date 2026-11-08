<?php

namespace App\Models;

use App\Enums\DeliveryStatus;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Delivery extends Model
{
    use SoftDeletes;

    protected $hidden = [
        'qr_token',
        'pickup_qr_token_hash',
        'delivery_qr_token_hash',
        'order_qr_token_encrypted',
        'order_qr_token_hash',
        'order_qr_rider_id',
        'delivery_proof_path',
        'delivery_proof_sha256',
        'delivery_proof_mime_type',
        'delivery_proof_latitude',
        'delivery_proof_longitude',
    ];

    protected $appends = ['has_delivery_proof'];

    protected $fillable = [
        'order_id',
        'rider_id',
        'status',
        'pickup_latitude',
        'pickup_longitude',
        'pickup_address',
        'rider_location_latitude',
        'rider_location_longitude',
        'rider_location_updated_at',
        'rider_location_captured_at',
        'qr_token',
        'pickup_qr_token_hash',
        'delivery_qr_token_hash',
        'order_qr_token_encrypted',
        'order_qr_token_hash',
        'order_qr_rider_id',
        'pickup_qr_expires_at',
        'delivery_qr_expires_at',
        'pickup_verified_at',
        'pickup_verification_latitude',
        'pickup_verification_longitude',
        'delivery_verified_at',
        'delivery_verification_latitude',
        'delivery_verification_longitude',
        'assigned_at',
    ];

    protected function casts(): array
    {
        return [
            'status' => DeliveryStatus::class,
            'pickup_latitude' => 'float',
            'pickup_longitude' => 'float',
            'rider_location_latitude' => 'float',
            'rider_location_longitude' => 'float',
            'rider_location_updated_at' => 'datetime',
            'rider_location_captured_at' => 'datetime',
            'pickup_qr_expires_at' => 'datetime',
            'delivery_qr_expires_at' => 'datetime',
            'pickup_verified_at' => 'datetime',
            'pickup_verification_latitude' => 'float',
            'pickup_verification_longitude' => 'float',
            'delivery_verified_at' => 'datetime',
            'delivery_verification_latitude' => 'float',
            'delivery_verification_longitude' => 'float',
            'assigned_at' => 'datetime',
            'recipient_confirmed' => 'boolean',
            'proof_captured_at' => 'datetime',
            'proof_recorded_at' => 'datetime',
            'delivery_proof_latitude' => 'float',
            'delivery_proof_longitude' => 'float',
            'order_qr_rider_id' => 'integer',
        ];
    }

    public function getHasDeliveryProofAttribute(): bool
    {
        return filled($this->delivery_proof_path);
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function rider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'rider_id');
    }

    public function offers(): HasMany
    {
        return $this->hasMany(RiderOffer::class);
    }

    public function statusHistory(): HasMany
    {
        return $this->hasMany(DeliveryStatusHistory::class)->latest('created_at');
    }

    public function proofCorrections(): HasMany
    {
        return $this->hasMany(DeliveryProofCorrection::class)->latest('created_at');
    }
}
