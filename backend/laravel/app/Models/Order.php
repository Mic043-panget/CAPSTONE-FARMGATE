<?php

namespace App\Models;

use App\Enums\OrderStatus;
use App\Services\OrderReferenceGenerator;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use LogicException;

class Order extends Model
{
    use HasFactory, \Illuminate\Database\Eloquent\SoftDeletes;

    protected $fillable = ['buyer_id', 'seller_id', 'status', 'stock_reserved_at', 'delivery_method', 'payment_method', 'payment_status', 'paymongo_checkout_session_id', 'paid_at', 'shipping_address', 'seller_location_snapshot', 'delivery_distance_method', 'subtotal_amount', 'delivery_fee', 'platform_fee', 'order_processing_fee', 'transaction_fee', 'payment_processing_fee', 'buyer_service_fee', 'seller_fee', 'discount_amount', 'delivery_distance_km', 'delivery_base_fee_snapshot', 'delivery_rate_per_km_snapshot', 'platform_fee_rate_snapshot', 'total_amount'];

    protected static function booted(): void
    {
        static::creating(function (Order $order): void {
            if (blank($order->order_reference)) {
                $order->order_reference = app(OrderReferenceGenerator::class)->generate((int) $order->seller_id);
            }
        });

        static::updating(function (Order $order): void {
            if ($order->isDirty('order_reference')) {
                throw new LogicException('An order reference cannot be changed after creation.');
            }
        });
    }

    protected function casts(): array
    {
        return [
            'status' => OrderStatus::class,
            'stock_reserved_at' => 'datetime',
            'paid_at' => 'datetime',
            'shipping_address' => 'array',
            'seller_location_snapshot' => 'array',
            'total_amount' => 'decimal:2',
            'subtotal_amount' => 'decimal:2',
            'delivery_fee' => 'decimal:2',
            'platform_fee' => 'decimal:2',
            'delivery_distance_km' => 'decimal:2',
            'order_processing_fee' => 'decimal:2',
            'transaction_fee' => 'decimal:2',
            'payment_processing_fee' => 'decimal:2',
            'buyer_service_fee' => 'decimal:2',
            'seller_fee' => 'decimal:2',
            'discount_amount' => 'decimal:2',
            'delivery_base_fee_snapshot' => 'decimal:2',
            'delivery_rate_per_km_snapshot' => 'decimal:2',
            'platform_fee_rate_snapshot' => 'decimal:4',
        ];
    }

    public function buyer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'buyer_id');
    }

    public function seller(): BelongsTo
    {
        return $this->belongsTo(User::class, 'seller_id');
    }

    public function items(): HasMany
    {
        return $this->hasMany(OrderItem::class);
    }

    public function delivery(): HasOne
    {
        return $this->hasOne(Delivery::class);
    }

    public function statusHistory(): HasMany
    {
        return $this->hasMany(OrderStatusHistory::class)->latest();
    }

    public function activities(): HasMany
    {
        return $this->hasMany(OrderActivity::class)->with('actor:id,name')->latest();
    }

    public function emailDeliveries(): HasMany
    {
        return $this->hasMany(OrderStatusEmailDelivery::class);
    }
}
