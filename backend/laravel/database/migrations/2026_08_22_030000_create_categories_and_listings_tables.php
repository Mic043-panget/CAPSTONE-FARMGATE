<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('categories', function (Blueprint $table): void {
            $table->id();
            $table->string('name')->unique();
            $table->string('slug')->unique();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('livestock_listings', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('seller_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('category_id')->constrained()->restrictOnDelete();
            $table->string('name');
            $table->string('breed')->nullable();
            $table->string('sex', 20)->nullable();
            $table->unsignedSmallInteger('age_months')->nullable();
            $table->decimal('estimated_weight_kg', 10, 2)->nullable();
            $table->unsignedInteger('quantity')->default(1);
            $table->text('description')->nullable();
            $table->text('pickup_location')->nullable();
            $table->text('health_information')->nullable();
            $table->text('vaccination_information')->nullable();
            $table->string('pricing_type', 20);
            $table->decimal('price_per_kilo', 12, 2)->nullable();
            $table->decimal('price_per_head', 12, 2)->nullable();
            $table->string('status', 30)->default('DRAFT')->index();
            $table->timestamps();
            $table->index(['category_id', 'status']);
            $table->index(['seller_id', 'status']);
        });

        Schema::create('product_images', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('listing_id')->constrained('livestock_listings')->cascadeOnDelete();
            $table->string('url', 2048);
            $table->string('alt_text')->nullable();
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('product_images');
        Schema::dropIfExists('livestock_listings');
        Schema::dropIfExists('categories');
    }
};