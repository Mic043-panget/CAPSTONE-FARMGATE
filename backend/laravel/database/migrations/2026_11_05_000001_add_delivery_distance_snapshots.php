<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('seller_profiles', function (Blueprint $table): void {
            $table->boolean('pickup_location_confirmed')->default(false);
            $table->string('pickup_barangay', 120)->nullable();
            $table->string('pickup_city_municipality', 120)->nullable();
            $table->string('pickup_province', 120)->nullable();
        });

        Schema::table('orders', function (Blueprint $table): void {
            $table->json('seller_location_snapshot')->nullable();
            $table->string('delivery_distance_method', 32)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table): void {
            $table->dropColumn(['seller_location_snapshot', 'delivery_distance_method']);
        });

        Schema::table('seller_profiles', function (Blueprint $table): void {
            $table->dropColumn([
                'pickup_location_confirmed',
                'pickup_barangay',
                'pickup_city_municipality',
                'pickup_province',
            ]);
        });
    }
};
