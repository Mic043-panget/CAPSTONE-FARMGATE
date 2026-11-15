<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rider_earnings_settings', function (Blueprint $table): void {
            $table->unsignedTinyInteger('id')->primary();
            $table->decimal('percentage', 5, 2)->nullable();
            $table->string('cap_scope', 20)->nullable();
            $table->decimal('cap_amount', 12, 2)->nullable();
            $table->foreignId('updated_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->string('change_reason', 255)->nullable();
            $table->timestamps();
        });

        Schema::create('rider_earning_setting_histories', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('rider_earnings_setting_id')->constrained('rider_earnings_settings')->restrictOnDelete();
            $table->foreignId('actor_id')->constrained('users')->restrictOnDelete();
            $table->decimal('old_percentage', 5, 2)->nullable();
            $table->decimal('new_percentage', 5, 2);
            $table->string('old_cap_scope', 20)->nullable();
            $table->string('new_cap_scope', 20);
            $table->decimal('old_cap_amount', 12, 2)->nullable();
            $table->decimal('new_cap_amount', 12, 2)->nullable();
            $table->string('reason', 255);
            $table->timestamps();

            $table->index(['rider_earnings_setting_id', 'created_at'], 'rider_earning_setting_history_created');
        });

        Schema::create('rider_earnings', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('delivery_id')->unique()->constrained('deliveries')->restrictOnDelete();
            $table->foreignId('order_id')->constrained('orders')->restrictOnDelete();
            $table->foreignId('rider_id')->constrained('users')->restrictOnDelete();
            $table->unsignedBigInteger('delivery_fee_cents');
            $table->decimal('percentage_snapshot', 5, 2);
            $table->string('cap_scope_snapshot', 20);
            $table->decimal('cap_amount_snapshot', 12, 2)->nullable();
            $table->unsignedBigInteger('amount_cents');
            $table->timestamp('calculated_at');
            $table->timestamps();

            $table->index(['rider_id', 'created_at'], 'rider_earnings_rider_created');
            $table->index(['order_id', 'rider_id'], 'rider_earnings_order_rider');
        });

        Schema::create('rider_payouts', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('rider_earning_id')->unique()->constrained('rider_earnings')->restrictOnDelete();
            $table->foreignId('rider_id')->constrained('users')->restrictOnDelete();
            $table->unsignedBigInteger('amount_cents');
            $table->string('status', 24)->default('PENDING');
            $table->foreignId('recorded_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->string('method', 24)->nullable();
            $table->text('external_reference')->nullable();
            $table->string('external_reference_hash', 64)->nullable()->unique();
            $table->text('reason')->nullable();
            $table->timestamp('paid_at')->nullable();
            $table->timestamps();

            $table->index(['rider_id', 'status', 'created_at'], 'rider_payouts_rider_status_created');
        });

        Schema::create('rider_payout_histories', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('rider_payout_id')->constrained('rider_payouts')->restrictOnDelete();
            $table->foreignId('actor_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->string('action', 32);
            $table->string('from_status', 24)->nullable();
            $table->string('to_status', 24);
            $table->text('reason')->nullable();
            $table->timestamps();

            $table->index(['rider_payout_id', 'created_at'], 'rider_payout_history_created');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('rider_payout_histories');
        Schema::dropIfExists('rider_payouts');
        Schema::dropIfExists('rider_earnings');
        Schema::dropIfExists('rider_earning_setting_histories');
        Schema::dropIfExists('rider_earnings_settings');
    }
};
