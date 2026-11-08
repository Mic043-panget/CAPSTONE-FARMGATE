<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('rider_profiles', function (Blueprint $table): void {
            $table->string('plate_number', 16)->nullable()->unique();
            $table->string('vehicle_make_model', 120)->nullable();
            $table->string('vehicle_color', 60)->nullable();
            $table->date('license_expires_on')->nullable();
            $table->date('vehicle_registration_expires_on')->nullable();
        });

        Schema::create('rider_applications', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();
            $table->text('date_of_birth');
            $table->text('residential_address');
            $table->text('license_number')->nullable();
            $table->char('license_number_hash', 64)->nullable()->unique();
            $table->string('plate_number', 16)->nullable();
            $table->string('vehicle_type', 80)->nullable();
            $table->string('vehicle_make_model', 120)->nullable();
            $table->string('vehicle_color', 60)->nullable();
            $table->date('license_expires_on')->nullable();
            $table->date('vehicle_registration_expires_on')->nullable();
            $table->string('status', 32)->default('DRAFT')->index();
            $table->string('privacy_policy_version', 40);
            $table->timestamp('privacy_accepted_at');
            $table->string('terms_version', 40);
            $table->timestamp('terms_accepted_at');
            $table->string('safety_policy_version', 40);
            $table->timestamp('safety_policy_accepted_at');
            $table->timestamp('submitted_at')->nullable();
            $table->foreignId('reviewer_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('reviewed_at')->nullable();
            $table->text('decision_reason')->nullable();
            $table->timestamps();
        });

        Schema::create('rider_application_histories', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('rider_application_id')->constrained()->cascadeOnDelete();
            $table->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('from_status', 32)->nullable();
            $table->string('to_status', 32);
            $table->string('action', 40);
            $table->text('reason')->nullable();
            $table->timestamps();
            $table->index(['rider_application_id', 'created_at'], 'rider_app_history_app_created_idx');
        });

        Schema::create('rider_vehicle_changes', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('plate_number', 16);
            $table->string('vehicle_type', 80);
            $table->string('vehicle_make_model', 120);
            $table->string('vehicle_color', 60);
            $table->date('license_expires_on');
            $table->date('vehicle_registration_expires_on');
            $table->string('status', 24)->default('PENDING')->index();
            $table->foreignId('reviewer_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('reviewed_at')->nullable();
            $table->text('decision_reason')->nullable();
            $table->timestamps();
            $table->index(['user_id', 'created_at']);
        });

        Schema::create('rider_documents', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('rider_application_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('rider_vehicle_change_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('uploaded_by')->constrained('users')->cascadeOnDelete();
            $table->string('document_type', 32);
            $table->string('path');
            $table->string('mime_type', 120);
            $table->string('original_name', 255);
            $table->unsignedInteger('size');
            $table->timestamp('deleted_at')->nullable();
            $table->foreignId('deleted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index(['rider_application_id', 'document_type', 'deleted_at'], 'rider_docs_app_type_deleted_idx');
            $table->index(['rider_vehicle_change_id', 'document_type', 'deleted_at'], 'rider_docs_vehicle_type_deleted_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('rider_documents');
        Schema::dropIfExists('rider_vehicle_changes');
        Schema::dropIfExists('rider_application_histories');
        Schema::dropIfExists('rider_applications');

        Schema::table('rider_profiles', function (Blueprint $table): void {
            $table->dropUnique(['plate_number']);
            $table->dropColumn([
                'plate_number', 'vehicle_make_model', 'vehicle_color', 'license_expires_on',
                'vehicle_registration_expires_on',
            ]);
        });
    }
};
