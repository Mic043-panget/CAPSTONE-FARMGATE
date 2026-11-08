<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('reviews', function (Blueprint $table): void {
            $table->foreignId('listing_id')->nullable()->after('order_id')->constrained('livestock_listings')->nullOnDelete();
            $table->unique(['order_id', 'buyer_id', 'listing_id']);
            $table->dropUnique('reviews_order_id_buyer_id_unique');
        });

        Schema::table('complaints', function (Blueprint $table): void {
            $table->string('case_type', 24)->default('COMPLAINT')->after('respondent_id');
            $table->string('other_reason', 500)->nullable();
            $table->timestamp('seller_response_deadline')->nullable();
            $table->timestamp('seller_responded_at')->nullable();
            $table->timestamp('escalated_at')->nullable();
            $table->json('requested_items')->nullable();
            $table->string('return_method', 24)->nullable();
            $table->decimal('requested_amount', 12, 2)->nullable();
            $table->decimal('approved_refund_amount', 12, 2)->nullable();
            $table->string('refund_status', 32)->default('NOT_APPLICABLE');
            $table->string('paymongo_payment_id')->nullable()->index();
            $table->string('paymongo_refund_id')->nullable()->unique();
            $table->text('refund_error')->nullable();
            $table->string('payout_reference')->nullable();
            $table->string('payout_evidence_path')->nullable();
            $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('refund_approved_at')->nullable();
            $table->timestamp('return_received_at')->nullable();
            $table->timestamp('refund_completed_at')->nullable();
            $table->index(['case_type', 'refund_status', 'created_at']);
        });

        Schema::create('review_media', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('review_id')->constrained()->cascadeOnDelete();
            $table->string('path');
            $table->string('mime_type', 120);
            $table->string('original_name', 255);
            $table->unsignedInteger('size');
            $table->timestamps();
        });

        Schema::create('review_reports', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('review_id')->constrained()->cascadeOnDelete();
            $table->foreignId('reporter_id')->constrained('users')->cascadeOnDelete();
            $table->string('reason', 120);
            $table->string('status', 20)->default('OPEN');
            $table->timestamps();
            $table->unique(['review_id', 'reporter_id']);
            $table->index(['status', 'created_at']);
        });

        Schema::create('complaint_messages', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('complaint_id')->constrained()->cascadeOnDelete();
            $table->foreignId('sender_id')->constrained('users')->cascadeOnDelete();
            $table->text('message');
            $table->timestamps();
            $table->index(['complaint_id', 'created_at']);
        });

        Schema::create('complaint_media', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('complaint_id')->constrained()->cascadeOnDelete();
            $table->foreignId('complaint_message_id')->nullable()->constrained('complaint_messages')->nullOnDelete();
            $table->foreignId('uploaded_by')->constrained('users')->cascadeOnDelete();
            $table->string('path');
            $table->string('mime_type', 120);
            $table->string('original_name', 255);
            $table->unsignedInteger('size');
            $table->timestamps();
        });

        Schema::create('order_activities', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('order_id')->constrained()->cascadeOnDelete();
            $table->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('activity_key', 80);
            $table->text('details');
            $table->timestamps();
            $table->index(['order_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('order_activities');
        Schema::dropIfExists('complaint_media');
        Schema::dropIfExists('complaint_messages');
        Schema::dropIfExists('review_reports');
        Schema::dropIfExists('review_media');

        Schema::table('complaints', function (Blueprint $table): void {
            $table->dropIndex(['case_type', 'refund_status', 'created_at']);
            $table->dropUnique(['paymongo_refund_id']);
            $table->dropIndex(['paymongo_payment_id']);
            $table->dropConstrainedForeignId('approved_by');
            $table->dropColumn([
                'case_type', 'other_reason', 'seller_response_deadline', 'seller_responded_at', 'escalated_at',
                'requested_items', 'return_method', 'requested_amount', 'approved_refund_amount', 'refund_status',
                'paymongo_payment_id', 'paymongo_refund_id', 'refund_error', 'payout_reference', 'payout_evidence_path',
                'refund_approved_at', 'return_received_at', 'refund_completed_at',
            ]);
        });

        Schema::table('reviews', function (Blueprint $table): void {
            $table->unique(['order_id', 'buyer_id']);
            $table->dropUnique(['order_id', 'buyer_id', 'listing_id']);
            $table->dropConstrainedForeignId('listing_id');
        });
    }
};
