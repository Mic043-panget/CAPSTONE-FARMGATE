<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('deliveries', function (Blueprint $table): void {
            $table->string('pickup_qr_token_hash', 64)->nullable()->unique();
            $table->string('delivery_qr_token_hash', 64)->nullable()->unique();
            $table->timestamp('pickup_qr_expires_at')->nullable();
            $table->timestamp('delivery_qr_expires_at')->nullable();
            $table->timestamp('pickup_verified_at')->nullable();
            $table->decimal('pickup_verification_latitude', 10, 7)->nullable();
            $table->decimal('pickup_verification_longitude', 10, 7)->nullable();
            $table->timestamp('delivery_verified_at')->nullable();
            $table->decimal('delivery_verification_latitude', 10, 7)->nullable();
            $table->decimal('delivery_verification_longitude', 10, 7)->nullable();
        });

        Schema::create('delivery_status_histories', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('delivery_id')->constrained()->cascadeOnDelete();
            $table->foreignId('changed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('from_status', 30);
            $table->string('to_status', 30);
            $table->string('reason', 60);
            $table->timestamp('created_at')->useCurrent();

            $table->index(['delivery_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('delivery_status_histories');

        Schema::table('deliveries', function (Blueprint $table): void {
            $table->dropUnique(['pickup_qr_token_hash']);
            $table->dropUnique(['delivery_qr_token_hash']);
            $table->dropColumn([
                'pickup_qr_token_hash',
                'delivery_qr_token_hash',
                'pickup_qr_expires_at',
                'delivery_qr_expires_at',
                'pickup_verified_at',
                'pickup_verification_latitude',
                'pickup_verification_longitude',
                'delivery_verified_at',
                'delivery_verification_latitude',
                'delivery_verification_longitude',
            ]);
        });
    }
};
