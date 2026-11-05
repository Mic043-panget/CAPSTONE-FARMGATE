<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('listing_moderation_attempts', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('listing_id')->constrained('livestock_listings')->cascadeOnDelete();
            $table->unsignedSmallInteger('attempt_number');
            $table->string('status', 24)->index();
            $table->string('recommendation', 16)->nullable();
            $table->decimal('confidence', 5, 4)->nullable();
            $table->string('predicted_category', 100)->nullable();
            $table->json('reasons')->nullable();
            $table->json('flags')->nullable();
            $table->string('model', 100)->nullable();
            $table->string('error_code', 64)->nullable();
            $table->string('response_summary', 500)->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();

            $table->unique(['listing_id', 'attempt_number']);
            $table->index(['status', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('listing_moderation_attempts');
    }
};
