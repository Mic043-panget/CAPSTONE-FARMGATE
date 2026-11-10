<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cod_receiving_methods', function (Blueprint $table): void {
            $table->id();
            $table->string('method_type', 24);
            $table->string('label', 100);
            $table->text('instructions');
            $table->text('account_holder')->nullable();
            $table->text('bank_name')->nullable();
            $table->text('account_number')->nullable();
            $table->string('qr_path', 255)->nullable();
            $table->string('qr_mime_type', 80)->nullable();
            $table->string('status', 24)->default('PENDING_VERIFICATION');
            $table->foreignId('configured_by')->constrained('users')->restrictOnDelete();
            $table->foreignId('verified_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->text('verification_reason')->nullable();
            $table->timestamp('verified_at')->nullable();
            $table->timestamps();

            $table->index(['status', 'method_type']);
        });

        Schema::create('cod_receiving_method_histories', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('cod_receiving_method_id')->constrained('cod_receiving_methods')->restrictOnDelete();
            $table->foreignId('actor_id')->constrained('users')->restrictOnDelete();
            $table->string('action', 32);
            $table->string('from_status', 24)->nullable();
            $table->string('to_status', 24);
            $table->text('reason')->nullable();
            $table->timestamps();

            $table->index(['cod_receiving_method_id', 'created_at'], 'cod_receiving_method_history_timeline');
        });

        Schema::table('cod_remittances', function (Blueprint $table): void {
            $table->foreign('receiving_method_id')
                ->references('id')
                ->on('cod_receiving_methods')
                ->nullOnDelete();
        });

        Schema::table('seller_payouts', function (Blueprint $table): void {
            $table->foreign('payout_destination_id')
                ->references('id')
                ->on('seller_payout_destinations')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('seller_payouts', function (Blueprint $table): void {
            $table->dropForeign(['payout_destination_id']);
        });
        Schema::table('cod_remittances', function (Blueprint $table): void {
            $table->dropForeign(['receiving_method_id']);
        });
        Schema::dropIfExists('cod_receiving_method_histories');
        Schema::dropIfExists('cod_receiving_methods');
    }
};
