<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('rider_offers', function (Blueprint $table): void {
            $table->index(['status', 'expires_at']);
        });
    }

    public function down(): void
    {
        Schema::table('rider_offers', function (Blueprint $table): void {
            $table->dropIndex(['status', 'expires_at']);
        });
    }
};
