<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('seller_profiles', function (Blueprint $table): void {
            $table->string('shop_name', 120)->nullable();
            $table->string('shop_image_path')->nullable();
            $table->string('verification_status', 24)->default('NOT_SUBMITTED')->index();
            $table->text('verification_rejection_reason')->nullable();
            $table->timestamp('verification_submitted_at')->nullable();
            $table->timestamp('verification_reviewed_at')->nullable();
            $table->foreignId('verification_reviewer_id')->nullable()->constrained('users')->nullOnDelete();
        });

        Schema::create('seller_identity_documents', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('seller_profile_id')->unique()->constrained()->cascadeOnDelete();
            $table->text('encrypted_path');
            $table->string('mime_type', 120);
            $table->unsignedBigInteger('size');
            $table->timestamp('uploaded_at');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('seller_identity_documents');

        Schema::table('seller_profiles', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('verification_reviewer_id');
            $table->dropIndex(['verification_status']);
            $table->dropColumn([
                'shop_name',
                'shop_image_path',
                'verification_status',
                'verification_rejection_reason',
                'verification_submitted_at',
                'verification_reviewed_at',
            ]);
        });
    }
};
