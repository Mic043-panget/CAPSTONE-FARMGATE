<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('order_status_email_deliveries', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('order_id')->constrained()->cascadeOnDelete();
            $table->foreignId('recipient_id')->constrained('users')->cascadeOnDelete();
            $table->string('order_status', 30);
            $table->string('reason', 500)->nullable();
            $table->string('delivery_status', 20)->default('QUEUED');
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->string('error_code', 100)->nullable();
            $table->timestamp('sent_at')->nullable();
            $table->timestamps();

            $table->index(['delivery_status', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('order_status_email_deliveries');
    }
};
