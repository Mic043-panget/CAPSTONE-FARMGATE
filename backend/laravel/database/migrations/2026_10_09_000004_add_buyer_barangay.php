<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('buyer_addresses', function (Blueprint $table): void {
            $table->string('barangay', 120)->default('')->after('city_municipality');
        });
    }

    public function down(): void
    {
        Schema::table('buyer_addresses', function (Blueprint $table): void {
            $table->dropColumn('barangay');
        });
    }
};
