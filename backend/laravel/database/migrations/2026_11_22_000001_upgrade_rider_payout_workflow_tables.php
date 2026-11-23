<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('rider_earnings', function (Blueprint $table): void {
            $table->string('reference', 40)->nullable()->unique('rider_earnings_reference_unique');
            $table->foreignId('payout_id')
                ->nullable()
                ->constrained('rider_payouts', 'id', 'rider_earnings_payout_fk')
                ->restrictOnDelete();
            $table->string('delivery_reference', 40)->nullable();
            $table->string('order_reference', 40)->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->unsignedBigInteger('gross_amount_cents')->nullable();
            $table->unsignedBigInteger('deductions_cents')->nullable();
            $table->bigInteger('adjustment_cents')->nullable();
            $table->unsignedBigInteger('net_amount_cents')->nullable();
            $table->string('eligibility_status', 24)->nullable();
            $table->string('eligibility_reason', 500)->nullable();
            $table->string('payout_status', 24)->nullable();
            $table->json('calculation_snapshot')->nullable();
        });

        Schema::table('rider_earnings', function (Blueprint $table): void {
            $table->decimal('percentage_snapshot', 5, 2)->nullable()->change();
            $table->string('cap_scope_snapshot', 20)->nullable()->change();
        });

        Schema::table('rider_payouts', function (Blueprint $table): void {
            $table->dropForeign('rider_payouts_rider_earning_id_foreign');
        });

        Schema::table('rider_payouts', function (Blueprint $table): void {
            $table->unsignedBigInteger('rider_earning_id')->nullable()->change();
            $table->foreign('rider_earning_id', 'rider_payouts_rider_earning_id_foreign')
                ->references('id')
                ->on('rider_earnings')
                ->restrictOnDelete();
            $table->string('reference', 40)->nullable()->unique('rider_payouts_reference_unique');
            $table->foreignId('created_by')
                ->nullable()
                ->constrained('users', 'id', 'rider_payouts_created_by_fk')
                ->restrictOnDelete();
            $table->foreignId('confirmed_by')
                ->nullable()
                ->constrained('users', 'id', 'rider_payouts_confirmed_by_fk')
                ->restrictOnDelete();
            $table->string('idempotency_key', 100)->nullable()->unique('rider_payouts_idempotency_key_unique');
            $table->date('transfer_date')->nullable();
            $table->string('receipt_sha256', 64)->nullable();
            $table->text('creation_reason')->nullable();
            $table->text('confirmation_reason')->nullable();
        });

        Schema::table('rider_payout_destination_histories', function (Blueprint $table): void {
            $table->string('from_status', 24)->nullable();
            $table->string('to_status', 24)->nullable();
        });

        Schema::table('rider_payout_histories', function (Blueprint $table): void {
            $table->json('snapshot')->nullable();
        });

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

        Schema::create('rider_payout_earnings', function (Blueprint $table): void {
            $table->foreignId('payout_id')->constrained('rider_payouts')->restrictOnDelete();
            $table->foreignId('earning_id')->constrained('rider_earnings')->restrictOnDelete();
            $table->timestamps();
            $table->primary(['payout_id', 'earning_id']);
            $table->index('earning_id');
        });

        Schema::create('rider_earning_histories', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('rider_earning_id')->constrained()->restrictOnDelete();
            $table->foreignId('actor_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->string('action', 32);
            $table->string('from_status', 24)->nullable();
            $table->string('to_status', 24)->nullable();
            $table->bigInteger('adjustment_cents')->default(0);
            $table->text('reason');
            $table->json('snapshot')->nullable();
            $table->timestamps();
            $table->index(['rider_earning_id', 'created_at']);
        });

        DB::table('rider_payouts')->orderBy('id')->chunkById(100, function ($payouts): void {
            foreach ($payouts as $payout) {
                DB::table('rider_payouts')->where('id', $payout->id)->update([
                    'reference' => $payout->reference ?? 'FG-RP-LEGACY-'.$payout->id,
                    'created_by' => $payout->recorded_by,
                    'idempotency_key' => 'legacy-rider-payout-'.$payout->id,
                    'transfer_date' => $payout->paid_at ? substr($payout->paid_at, 0, 10) : null,
                    'creation_reason' => 'Migrated from an existing rider payout record.',
                ]);
            }
        });

        DB::table('rider_earnings')->orderBy('id')->chunkById(100, function ($earnings): void {
            foreach ($earnings as $earning) {
                $payout = DB::table('rider_payouts')
                    ->where('rider_earning_id', $earning->id)
                    ->first(['id', 'status']);
                $amountCents = (int) $earning->amount_cents;
                $payoutStatus = match ($payout?->status) {
                    'PAID' => 'PAID',
                    'PENDING', 'PROCESSING', 'NEEDS_REVIEW' => 'IN_PAYOUT',
                    default => 'AVAILABLE',
                };
                $eligibilityStatus = $amountCents > 0 ? 'READY' : 'PENDING_ELIGIBILITY';
                $deliveryReference = DB::table('deliveries')->where('id', $earning->delivery_id)->value('delivery_reference');
                $orderReference = DB::table('orders')->where('id', $earning->order_id)->value('order_reference');

                DB::table('rider_earnings')->where('id', $earning->id)->update([
                    'reference' => 'FG-REN-LEGACY-'.$earning->id,
                    'payout_id' => in_array($payoutStatus, ['IN_PAYOUT', 'PAID'], true) ? $payout?->id : null,
                    'delivery_reference' => $deliveryReference,
                    'order_reference' => $orderReference,
                    'completed_at' => $earning->calculated_at,
                    'gross_amount_cents' => $amountCents,
                    'deductions_cents' => 0,
                    'adjustment_cents' => 0,
                    'net_amount_cents' => $amountCents,
                    'eligibility_status' => $eligibilityStatus,
                    'eligibility_reason' => 'Migrated from an existing rider earning record.',
                    'payout_status' => $payoutStatus,
                    'calculation_snapshot' => json_encode([
                        'version' => 1,
                        'source' => 'legacy_rider_earning',
                        'percentage_snapshot' => $earning->percentage_snapshot,
                        'cap_scope_snapshot' => $earning->cap_scope_snapshot,
                        'cap_amount_snapshot' => $earning->cap_amount_snapshot,
                    ], JSON_THROW_ON_ERROR),
                ]);

                if ($payout) {
                    DB::table('rider_payout_earnings')->insertOrIgnore([
                        'payout_id' => $payout->id,
                        'earning_id' => $earning->id,
                        'created_at' => now(),
                        'updated_at' => now(),
                    ]);
                }
            }
        });

        DB::table('rider_payout_destination_histories')->orderBy('id')->chunkById(100, function ($histories): void {
            foreach ($histories as $history) {
                DB::table('rider_payout_destination_histories')->where('id', $history->id)->update([
                    'from_status' => $history->previous_status,
                    'to_status' => $history->new_status,
                ]);
            }
        });
    }

    public function down(): void
    {
        if (DB::table('rider_earnings')->exists() || DB::table('rider_payouts')->exists()) {
            throw new RuntimeException('The payout workflow migration cannot be rolled back while earning or payout records exist.');
        }

        Schema::table('rider_payouts', function (Blueprint $table): void {
            $table->dropForeign('rider_payouts_rider_earning_id_foreign');
        });

        Schema::table('rider_payouts', function (Blueprint $table): void {
            $table->unsignedBigInteger('rider_earning_id')->nullable(false)->change();
            $table->foreign('rider_earning_id', 'rider_payouts_rider_earning_id_foreign')
                ->references('id')
                ->on('rider_earnings')
                ->restrictOnDelete();
        });

        Schema::dropIfExists('rider_earning_histories');
        Schema::dropIfExists('rider_payout_earnings');
        Schema::dropIfExists('rider_payout_method_histories');
        Schema::dropIfExists('rider_payout_methods');

        Schema::table('rider_payout_histories', function (Blueprint $table): void {
            $table->dropColumn('snapshot');
        });

        Schema::table('rider_payout_destination_histories', function (Blueprint $table): void {
            $table->dropColumn(['from_status', 'to_status']);
        });

        Schema::table('rider_payouts', function (Blueprint $table): void {
            $table->dropForeign('rider_payouts_created_by_fk');
            $table->dropForeign('rider_payouts_confirmed_by_fk');
            $table->dropUnique('rider_payouts_reference_unique');
            $table->dropUnique('rider_payouts_idempotency_key_unique');
            $table->dropColumn([
                'reference',
                'created_by',
                'confirmed_by',
                'idempotency_key',
                'transfer_date',
                'receipt_sha256',
                'creation_reason',
                'confirmation_reason',
            ]);
        });

        Schema::table('rider_earnings', function (Blueprint $table): void {
            $table->decimal('percentage_snapshot', 5, 2)->nullable(false)->change();
            $table->string('cap_scope_snapshot', 20)->nullable(false)->change();
            $table->dropForeign('rider_earnings_payout_fk');
            $table->dropUnique('rider_earnings_reference_unique');
            $table->dropColumn([
                'reference',
                'payout_id',
                'delivery_reference',
                'order_reference',
                'completed_at',
                'gross_amount_cents',
                'deductions_cents',
                'adjustment_cents',
                'net_amount_cents',
                'eligibility_status',
                'eligibility_reason',
                'payout_status',
                'calculation_snapshot',
            ]);
        });
    }
};
