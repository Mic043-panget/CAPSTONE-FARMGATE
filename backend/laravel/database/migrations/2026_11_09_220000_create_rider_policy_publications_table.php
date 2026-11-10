<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rider_policy_publications', function (Blueprint $table): void {
            $table->id();
            $table->string('version', 40)->unique();
            $table->date('effective_date')->nullable();
            $table->string('privacy_contact', 255)->nullable();
            $table->longText('privacy_content')->nullable();
            $table->longText('terms_content')->nullable();
            $table->longText('safety_content')->nullable();
            $table->longText('retention_content')->nullable();
            $table->string('status', 16)->default('DRAFT')->index();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('published_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('published_at')->nullable();
            $table->timestamps();

            $table->index(['status', 'effective_date'], 'rider_policy_status_effective_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('rider_policy_publications');
    }
};
