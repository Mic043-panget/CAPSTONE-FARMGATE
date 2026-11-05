<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('interests', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('buyer_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('livestock_listing_id')->constrained()->cascadeOnDelete();
            $table->string('status', 20)->default('INTERESTED');
            $table->timestamps();
            $table->unique(['buyer_id', 'livestock_listing_id']);
            $table->index(['livestock_listing_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('interests');
    }
};