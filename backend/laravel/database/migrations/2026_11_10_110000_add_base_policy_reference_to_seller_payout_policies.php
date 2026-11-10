<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('seller_payout_policies', function (Blueprint $table): void {
            $table->foreignId('based_on_policy_id')
                ->nullable()
                ->constrained('seller_payout_policies', 'id', 'seller_payout_policy_base_fk')
                ->restrictOnDelete();
            $table->text('amendment_reason')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('seller_payout_policies', function (Blueprint $table): void {
            $table->dropForeign('seller_payout_policy_base_fk');
            $table->dropColumn(['based_on_policy_id', 'amendment_reason']);
        });
    }
};
