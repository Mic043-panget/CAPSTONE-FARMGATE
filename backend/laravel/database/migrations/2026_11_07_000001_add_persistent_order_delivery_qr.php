<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('deliveries', function (Blueprint $table): void {
            $table->text('order_qr_token_encrypted')->nullable();
            $table->string('order_qr_token_hash', 64)->nullable()->index();
            $table->foreignId('order_qr_rider_id')->nullable()->constrained('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('deliveries', function (Blueprint $table): void {
            $table->dropIndex(['order_qr_token_hash']);
            $table->dropConstrainedForeignId('order_qr_rider_id');
            $table->dropColumn(['order_qr_token_encrypted', 'order_qr_token_hash']);
        });
    }
};
