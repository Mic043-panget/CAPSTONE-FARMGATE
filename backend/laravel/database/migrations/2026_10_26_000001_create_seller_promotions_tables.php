<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('seller_promotions', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('seller_id')->constrained('users')->cascadeOnDelete();
            $table->string('name', 120);
            $table->text('description')->nullable();
            $table->string('discount_type', 20);
            $table->decimal('discount_value', 12, 2);
            $table->boolean('applies_to_all')->default(false);
            $table->string('status', 20)->default('DRAFT')->index();
            $table->dateTime('starts_at');
            $table->dateTime('ends_at');
            $table->timestamps();
            $table->index(['seller_id', 'status', 'starts_at', 'ends_at'], 'seller_promotions_window_idx');
        });

        Schema::create('seller_promotion_listings', function (Blueprint $table): void {
            $table->foreignId('promotion_id')->constrained('seller_promotions')->cascadeOnDelete();
            $table->foreignId('listing_id')->constrained('livestock_listings')->cascadeOnDelete();
            $table->primary(['promotion_id', 'listing_id']);
            $table->index('listing_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('seller_promotion_listings');
        Schema::dropIfExists('seller_promotions');
    }
};
