<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('deliveries', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('order_id')->unique()->constrained()->cascadeOnDelete();
            $table->foreignId('rider_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('status', 30)->default('PENDING_ASSIGNMENT');
            $table->decimal('pickup_latitude', 10, 6)->nullable();
            $table->decimal('pickup_longitude', 10, 6)->nullable();
            $table->text('pickup_address')->nullable();
            $table->decimal('rider_location_latitude', 10, 6)->nullable();
            $table->decimal('rider_location_longitude', 10, 6)->nullable();
            $table->timestamp('rider_location_updated_at')->nullable();
            $table->string('qr_token', 64)->nullable()->unique();
            $table->timestamp('assigned_at')->nullable();
            $table->timestamps();
        });

        Schema::create('rider_offers', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('delivery_id')->constrained()->cascadeOnDelete();
            $table->foreignId('rider_id')->constrained('users')->cascadeOnDelete();
            $table->string('status', 20)->default('OPEN');
            $table->decimal('distance_km', 8, 2)->default(0);
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();

            $table->index(['delivery_id', 'status']);
            $table->index(['rider_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('rider_offers');
        Schema::dropIfExists('deliveries');
    }
};
