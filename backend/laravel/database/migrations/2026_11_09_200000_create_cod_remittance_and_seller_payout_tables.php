<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cod_remittances', function (Blueprint $table): void {
            $table->id();
            $table->string('reference', 40)->unique();
            $table->foreignId('rider_id')->constrained('users')->restrictOnDelete();
            $table->foreignId('submitted_by')->constrained('users')->restrictOnDelete();
            $table->foreignId('received_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->string('method_type', 24)->default('CASH_HANDOVER');
            $table->unsignedBigInteger('receiving_method_id')->nullable();
            $table->text('receiver_name')->nullable();
            $table->text('transaction_reference')->nullable();
            $table->string('evidence_path', 255)->nullable();
            $table->string('evidence_sha256', 64)->nullable();
            $table->string('evidence_mime_type', 80)->nullable();
            $table->unsignedBigInteger('expected_amount_cents');
            $table->unsignedBigInteger('received_amount_cents')->nullable();
            $table->string('status', 20)->default('SUBMITTED');
            $table->text('reconciliation_reason')->nullable();
            $table->timestamp('submitted_at');
            $table->timestamp('reconciled_at')->nullable();
            $table->timestamps();

            $table->index(['rider_id', 'status', 'submitted_at']);
        });

        Schema::create('cod_collections', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('order_id')->unique()->constrained()->restrictOnDelete();
            $table->foreignId('delivery_id')->unique()->constrained()->restrictOnDelete();
            $table->foreignId('rider_id')->constrained('users')->restrictOnDelete();
            $table->foreignId('remittance_id')->nullable()->constrained('cod_remittances')->restrictOnDelete();
            $table->unsignedBigInteger('expected_amount_cents');
            $table->string('status', 20)->default('COLLECTED');
            $table->timestamp('collected_at');
            $table->timestamps();

            $table->index(['rider_id', 'status', 'collected_at']);
        });

        Schema::create('cod_remittance_histories', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('cod_remittance_id')->constrained('cod_remittances')->restrictOnDelete();
            $table->foreignId('actor_id')->constrained('users')->restrictOnDelete();
            $table->string('action', 30);
            $table->unsignedBigInteger('expected_amount_cents');
            $table->unsignedBigInteger('received_amount_cents')->nullable();
            $table->text('reason')->nullable();
            $table->timestamps();

            $table->index(['cod_remittance_id', 'created_at']);
        });

        Schema::create('seller_payouts', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('order_id')->unique()->constrained()->restrictOnDelete();
            $table->foreignId('seller_id')->constrained('users')->restrictOnDelete();
            $table->foreignId('recorded_by')->constrained('users')->restrictOnDelete();
            $table->unsignedBigInteger('payout_destination_id')->nullable();
            $table->unsignedBigInteger('amount_cents');
            $table->string('method', 24);
            $table->text('external_reference')->nullable();
            $table->string('provider_status', 32)->nullable();
            $table->string('receipt_path', 255)->nullable();
            $table->string('status', 24)->default('PENDING_SETUP');
            $table->text('reason');
            $table->timestamp('paid_at')->nullable();
            $table->timestamps();

            $table->index(['seller_id', 'status', 'created_at']);
        });

        Schema::create('seller_payout_histories', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('seller_payout_id')->constrained('seller_payouts')->restrictOnDelete();
            $table->foreignId('actor_id')->constrained('users')->restrictOnDelete();
            $table->string('action', 32);
            $table->string('from_status', 24)->nullable();
            $table->string('to_status', 24);
            $table->text('reason')->nullable();
            $table->timestamps();

            $table->index(['seller_payout_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('seller_payout_histories');
        Schema::dropIfExists('seller_payouts');
        Schema::dropIfExists('cod_remittance_histories');
        Schema::dropIfExists('cod_collections');
        Schema::dropIfExists('cod_remittances');
    }
};
