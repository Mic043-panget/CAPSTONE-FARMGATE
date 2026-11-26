<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('review_reports', function (Blueprint $table): void {
            $table->string('reporter_role', 16)->default('BUYER')->after('reporter_id');
            $table->text('explanation')->nullable()->after('reason');
        });

        Schema::create('review_report_media', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('review_report_id')->constrained('review_reports')->cascadeOnDelete();
            $table->foreignId('uploaded_by')->constrained('users')->cascadeOnDelete();
            $table->string('path');
            $table->string('mime_type', 120);
            $table->string('original_name', 255);
            $table->unsignedInteger('size');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('review_report_media');

        Schema::table('review_reports', function (Blueprint $table): void {
            $table->dropColumn(['reporter_role', 'explanation']);
        });
    }
};
