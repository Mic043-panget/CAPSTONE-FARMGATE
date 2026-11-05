<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('deliveries', function (Blueprint $table): void {
            $table->string('delivery_proof_path')->nullable();
            $table->string('delivery_proof_sha256', 64)->nullable();
            $table->string('delivery_proof_mime_type', 50)->nullable();
            $table->boolean('recipient_confirmed')->default(false);
            $table->string('delivery_recipient_name', 120)->nullable();
            $table->timestamp('proof_captured_at')->nullable();
            $table->timestamp('proof_recorded_at')->nullable();
            $table->decimal('delivery_proof_latitude', 10, 7)->nullable();
            $table->decimal('delivery_proof_longitude', 10, 7)->nullable();
            $table->index(['status', 'delivery_verified_at'], 'deliveries_status_verified_at_index');
        });

        Schema::create('delivery_proof_corrections', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('delivery_id')->constrained()->cascadeOnDelete();
            $table->foreignId('corrected_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('old_proof_path')->nullable();
            $table->string('new_proof_path')->nullable();
            $table->string('old_recipient_name', 120)->nullable();
            $table->string('new_recipient_name', 120)->nullable();
            $table->timestamp('old_proof_captured_at')->nullable();
            $table->timestamp('new_proof_captured_at')->nullable();
            $table->timestamp('old_proof_recorded_at')->nullable();
            $table->timestamp('new_proof_recorded_at')->nullable();
            $table->string('reason', 500);
            $table->timestamp('created_at')->useCurrent();

            $table->index(['delivery_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('delivery_proof_corrections');

        Schema::table('deliveries', function (Blueprint $table): void {
            $table->dropIndex('deliveries_status_verified_at_index');
            $table->dropColumn([
                'delivery_proof_path',
                'delivery_proof_sha256',
                'delivery_proof_mime_type',
                'recipient_confirmed',
                'delivery_recipient_name',
                'proof_captured_at',
                'proof_recorded_at',
                'delivery_proof_latitude',
                'delivery_proof_longitude',
            ]);
        });
    }
};
