<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('seller_registration_phone_verifications', function (Blueprint $table): void {
            $table->id();
            $table->string('phone_number', 16)->unique();
            $table->char('otp_hash', 64)->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->timestamp('verified_at')->nullable();
            $table->char('registration_token_hash', 64)->nullable();
            $table->timestamp('registration_token_expires_at')->nullable();
            $table->unsignedTinyInteger('attempts')->default(0);
            $table->unsignedTinyInteger('send_count')->default(0);
            $table->timestamp('attempt_window_started_at')->nullable();
            $table->timestamp('send_window_started_at')->nullable();
            $table->timestamp('last_sent_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('seller_registration_phone_verifications');
    }
};
