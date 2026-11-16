<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('rider_payouts', function (Blueprint $table): void {
            $table->string('receipt_path', 255)->nullable();
            $table->string('receipt_mime_type', 120)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('rider_payouts', function (Blueprint $table): void {
            $table->dropColumn(['receipt_path', 'receipt_mime_type']);
        });
    }
};
