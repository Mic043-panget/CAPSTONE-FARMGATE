<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rider_payout_methods', function (Blueprint $table): void {
            $table->id();
            $table->string('method_type', 20)->unique();
            $table->string('status', 24)->default('PENDING_VERIFICATION');
            $table->foreignId('configured_by')->constrained('users')->restrictOnDelete();
            $table->foreignId('verified_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestamp('verified_at')->nullable();
            $table->timestamps();
        });

        Schema::create('rider_payout_method_histories', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('rider_payout_method_id')->constrained()->restrictOnDelete();
            $table->foreignId('actor_id')->constrained('users')->restrictOnDelete();
            $table->string('action', 30);
            $table->string('from_status', 24)->nullable();
            $table->string('to_status', 24);
            $table->text('reason');
            $table->timestamps();
            $table->index(['rider_payout_method_id', 'created_at']);
        });

        Schema::create('rider_payout_destinations', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('rider_id')->unique()->constrained('users')->restrictOnDelete();
            $table->string('destination_type', 20);
            $table->text('account_holder');
            $table->text('bank_name')->nullable();
            $table->text('account_number')->nullable();
            $table->text('wallet_number')->nullable();
            $table->string('status', 24)->default('PENDING_VERIFICATION');
            $table->foreignId('verified_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestamp('verified_at')->nullable();
            $table->timestamps();
            $table->index(['destination_type', 'status']);
        });

        Schema::create('rider_payout_destination_histories', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('rider_payout_destination_id')->constrained(indexName: 'rider_dest_hist_destination_fk')->restrictOnDelete();
            $table->foreignId('actor_id')->constrained('users')->restrictOnDelete();
            $table->string('action', 30);
            $table->string('from_status', 24)->nullable();
            $table->string('to_status', 24);
            $table->text('reason')->nullable();
            $table->timestamps();
            $table->index(['rider_payout_destination_id', 'created_at']);
        });

        Schema::create('rider_payouts', function (Blueprint $table): void {
            $table->id();
            $table->string('reference', 40)->unique();
            $table->foreignId('rider_id')->constrained('users')->restrictOnDelete();
            $table->foreignId('destination_id')->nullable()->constrained('rider_payout_destinations')->restrictOnDelete();
            $table->foreignId('created_by')->constrained('users')->restrictOnDelete();
            $table->foreignId('confirmed_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->string('method', 24)->default('MANUAL_EXTERNAL');
            $table->string('status', 24)->default('PENDING');
            $table->unsignedBigInteger('amount_cents');
            $table->string('idempotency_key', 100)->unique();
            $table->text('external_reference')->nullable();
            $table->string('external_reference_hash', 64)->nullable()->unique();
            $table->timestamp('transfer_date')->nullable();
            $table->string('receipt_path', 255)->nullable();
            $table->string('receipt_sha256', 64)->nullable();
            $table->string('receipt_mime_type', 80)->nullable();
            $table->text('creation_reason');
            $table->text('confirmation_reason')->nullable();
            $table->timestamp('paid_at')->nullable();
            $table->timestamps();
            $table->index(['rider_id', 'status', 'created_at']);
            $table->index(['status', 'created_at']);
        });

        Schema::create('rider_earnings', function (Blueprint $table): void {
            $table->id();
            $table->string('reference', 40)->unique();
            $table->foreignId('delivery_id')->unique()->constrained()->restrictOnDelete();
            $table->foreignId('order_id')->constrained()->restrictOnDelete();
            $table->foreignId('rider_id')->constrained('users')->restrictOnDelete();
            $table->foreignId('payout_id')->nullable()->unique()->constrained('rider_payouts')->restrictOnDelete();
            $table->string('delivery_reference', 40);
            $table->string('order_reference', 40);
            $table->timestamp('completed_at')->nullable();
            $table->unsignedBigInteger('delivery_fee_cents')->default(0);
            $table->unsignedBigInteger('gross_amount_cents')->default(0);
            $table->unsignedBigInteger('deductions_cents')->default(0);
            $table->bigInteger('adjustment_cents')->default(0);
            $table->unsignedBigInteger('net_amount_cents')->default(0);
            $table->string('eligibility_status', 24)->default('PENDING_ELIGIBILITY');
            $table->string('eligibility_reason', 500);
            $table->string('payout_status', 24)->default('AVAILABLE');
            $table->json('calculation_snapshot');
            $table->timestamps();
            $table->index(['rider_id', 'eligibility_status', 'payout_status']);
            $table->index(['payout_id', 'payout_status']);
        });

        Schema::create('rider_payout_earnings', function (Blueprint $table): void {
            $table->foreignId('payout_id')->primary()->constrained('rider_payouts')->restrictOnDelete();
            $table->foreignId('earning_id')->constrained('rider_earnings')->restrictOnDelete();
            $table->timestamps();
            $table->index('earning_id');
        });

        Schema::create('rider_earning_histories', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('rider_earning_id')->constrained()->restrictOnDelete();
            $table->foreignId('actor_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->string('action', 32);
            $table->string('from_status', 24)->nullable();
            $table->string('to_status', 24);
            $table->bigInteger('adjustment_cents')->default(0);
            $table->text('reason');
            $table->json('snapshot')->nullable();
            $table->timestamps();
            $table->index(['rider_earning_id', 'created_at']);
        });

        Schema::create('rider_payout_histories', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('rider_payout_id')->constrained()->restrictOnDelete();
            $table->foreignId('actor_id')->constrained('users')->restrictOnDelete();
            $table->string('action', 32);
            $table->string('from_status', 24)->nullable();
            $table->string('to_status', 24);
            $table->text('reason');
            $table->json('snapshot')->nullable();
            $table->timestamps();
            $table->index(['rider_payout_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('rider_payout_histories');
        Schema::dropIfExists('rider_earning_histories');
        Schema::dropIfExists('rider_payout_earnings');
        Schema::dropIfExists('rider_earnings');
        Schema::dropIfExists('rider_payouts');
        Schema::dropIfExists('rider_payout_destination_histories');
        Schema::dropIfExists('rider_payout_destinations');
        Schema::dropIfExists('rider_payout_method_histories');
        Schema::dropIfExists('rider_payout_methods');
    }
};
