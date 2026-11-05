<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table): void {
            $table->decimal('order_processing_fee', 12, 2)->default(0)->after('platform_fee');
            $table->decimal('transaction_fee', 12, 2)->default(0)->after('order_processing_fee');
            $table->decimal('payment_processing_fee', 12, 2)->default(0)->after('transaction_fee');
            $table->decimal('buyer_service_fee', 12, 2)->default(0)->after('payment_processing_fee');
            $table->decimal('seller_fee', 12, 2)->default(0)->after('buyer_service_fee');
            $table->decimal('discount_amount', 12, 2)->default(0)->after('seller_fee');
            $table->decimal('delivery_base_fee_snapshot', 12, 2)->default(0)->after('delivery_distance_km');
            $table->decimal('delivery_rate_per_km_snapshot', 12, 2)->default(0)->after('delivery_base_fee_snapshot');
            $table->decimal('platform_fee_rate_snapshot', 8, 4)->default(0)->after('delivery_rate_per_km_snapshot');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table): void {
            $table->dropColumn(['order_processing_fee', 'transaction_fee', 'payment_processing_fee', 'buyer_service_fee', 'seller_fee', 'discount_amount', 'delivery_base_fee_snapshot', 'delivery_rate_per_km_snapshot', 'platform_fee_rate_snapshot']);
        });
    }
};