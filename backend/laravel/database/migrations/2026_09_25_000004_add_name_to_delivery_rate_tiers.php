<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('delivery_rate_tiers', function (Blueprint $table): void {
            $table->string('name')->nullable()->after('id');
        });
    }

    public function down(): void
    {
        Schema::table('delivery_rate_tiers', function (Blueprint $table): void {
            $table->dropColumn('name');
        });
    }
};