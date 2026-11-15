<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rider_payout_destinations', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('rider_id')->constrained('users')->restrictOnDelete();
            $table->string('destination_type', 16);
            $table->text('account_holder');
            $table->text('bank_name')->nullable();
            $table->text('account_number')->nullable();
            $table->text('wallet_number')->nullable();
            $table->string('status', 24)->default('PENDING_VERIFICATION');
            $table->boolean('is_current')->default(true);
            $table->string('consent_version', 48);
            $table->timestamp('consent_accepted_at');
            $table->foreignId('verified_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestamp('verified_at')->nullable();
            $table->timestamps();

            $table->index(['rider_id', 'is_current']);
            $table->index(['status', 'updated_at']);
        });

        Schema::create('rider_payout_destination_histories', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('rider_payout_destination_id')
                ->constrained('rider_payout_destinations', 'id', 'rider_dest_history_dest_fk')
                ->restrictOnDelete();
            $table->foreignId('actor_id')->constrained('users')->restrictOnDelete();
            $table->string('action', 32);
            $table->string('previous_status', 24)->nullable();
            $table->string('new_status', 24);
            $table->text('reason')->nullable();
            $table->timestamps();

            $table->index(['rider_payout_destination_id', 'created_at'], 'rider_dest_history_timeline');
        });

        Schema::table('rider_payouts', function (Blueprint $table): void {
            $table->foreignId('destination_id')
                ->nullable()
                ->constrained('rider_payout_destinations', 'id', 'rider_payout_dest_payout_fk')
                ->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('rider_payouts', function (Blueprint $table): void {
            $table->dropForeign('rider_payout_dest_payout_fk');
            $table->dropColumn('destination_id');
        });
        Schema::dropIfExists('rider_payout_destination_histories');
        Schema::dropIfExists('rider_payout_destinations');
    }
};
