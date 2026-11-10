<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('seller_payout_destinations', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('seller_id')->unique()->constrained('users')->restrictOnDelete();
            $table->string('destination_type', 16);
            $table->text('account_holder');
            $table->text('bank_name')->nullable();
            $table->text('account_number')->nullable();
            $table->text('wallet_number')->nullable();
            $table->string('status', 24)->default('PENDING_VERIFICATION');
            $table->string('consent_version', 48);
            $table->timestamp('consent_accepted_at');
            $table->foreignId('verified_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestamp('verified_at')->nullable();
            $table->timestamps();

            $table->index(['status', 'updated_at']);
        });

        Schema::create('seller_payout_destination_histories', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('seller_payout_destination_id')
                ->constrained('seller_payout_destinations', 'id', 'seller_payout_history_destination_fk')
                ->restrictOnDelete();
            $table->foreignId('actor_id')->constrained('users')->restrictOnDelete();
            $table->string('action', 32);
            $table->string('previous_status', 24)->nullable();
            $table->string('new_status', 24);
            $table->text('reason')->nullable();
            $table->timestamps();

            $table->index(['seller_payout_destination_id', 'created_at'], 'seller_payout_destination_history_timeline');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('seller_payout_destination_histories');
        Schema::dropIfExists('seller_payout_destinations');
    }
};
