<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('rider_policy_publications', function (Blueprint $table): void {
            $table->string('version', 40)->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('rider_policy_publications', function (Blueprint $table): void {
            $table->string('version', 40)->nullable(false)->change();
        });
    }
};
