<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('system_settings', function (Blueprint $table): void {
            $table->id();
            $table->string('key')->unique();
            $table->text('value');
            $table->string('type', 20)->default('decimal');
            $table->text('description')->nullable();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('delivery_rate_tiers', function (Blueprint $table): void {
            $table->id();
            $table->decimal('min_km', 8, 2)->default(0);
            $table->decimal('max_km', 8, 2)->nullable();
            $table->decimal('base_fee', 12, 2)->default(0);
            $table->decimal('fee_per_km', 12, 2)->default(0);
            $table->unsignedInteger('priority')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->index(['is_active', 'priority']);
        });

        Schema::create('system_setting_history', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('system_setting_id')->nullable()->constrained()->nullOnDelete();
            $table->string('key');
            $table->text('old_value')->nullable();
            $table->text('new_value');
            $table->foreignId('changed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('change_reason')->nullable();
            $table->timestamps();
            $table->index(['key', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('system_setting_history');
        Schema::dropIfExists('delivery_rate_tiers');
        Schema::dropIfExists('system_settings');
    }
};