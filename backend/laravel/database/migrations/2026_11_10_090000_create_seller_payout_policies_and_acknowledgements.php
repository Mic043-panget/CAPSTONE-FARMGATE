<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('seller_payout_policies', function (Blueprint $table): void {
            $table->id();
            $table->string('version', 40)->unique();
            $table->date('effective_date');
            $table->longText('policy_text');
            $table->string('supporting_document_path', 255)->nullable();
            $table->string('supporting_document_mime_type', 80)->nullable();
            $table->string('status', 20)->default('DRAFT');
            $table->foreignId('created_by')->constrained('users')->restrictOnDelete();
            $table->foreignId('approved_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->foreignId('published_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestamp('approved_at')->nullable();
            $table->timestamp('published_at')->nullable();
            $table->text('approval_reason')->nullable();
            $table->text('publication_reason')->nullable();
            $table->timestamps();

            $table->index(['status', 'effective_date']);
        });

        Schema::create('seller_payout_policy_acknowledgements', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('seller_id')->constrained('users')->restrictOnDelete();
            $table->foreignId('seller_payout_policy_id')
                ->constrained('seller_payout_policies', 'id', 'seller_payout_ack_policy_fk')
                ->restrictOnDelete();
            $table->timestamp('acknowledged_at');
            $table->timestamps();

            $table->unique(['seller_id', 'seller_payout_policy_id'], 'seller_policy_ack_unique');
        });

        Schema::table('seller_payouts', function (Blueprint $table): void {
            $table->string('external_reference_hash', 64)->nullable()->unique();
            $table->string('receipt_mime_type', 80)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('seller_payouts', function (Blueprint $table): void {
            $table->dropUnique(['external_reference_hash']);
            $table->dropColumn(['external_reference_hash', 'receipt_mime_type']);
        });
        Schema::dropIfExists('seller_payout_policy_acknowledgements');
        Schema::dropIfExists('seller_payout_policies');
    }
};
