<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table): void {
            $table->decimal('subtotal_amount', 12, 2)->default(0)->after('status');
            $table->decimal('delivery_fee', 12, 2)->default(0)->after('subtotal_amount');
            $table->decimal('platform_fee', 12, 2)->default(0)->after('delivery_fee');
            $table->decimal('delivery_distance_km', 8, 2)->nullable()->after('platform_fee');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table): void {
            $table->dropColumn(['subtotal_amount', 'delivery_fee', 'platform_fee', 'delivery_distance_km']);
        });
    }
};