<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('notification_deliveries', function (Blueprint $table): void {
            $table->id();
            $table->uuid('notification_id');
            $table->string('notifiable_type');
            $table->unsignedBigInteger('notifiable_id');
            $table->string('channel', 20);
            $table->string('status', 20);
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->string('last_error', 120)->nullable();
            $table->timestamp('delivered_at')->nullable();
            $table->timestamps();

            $table->unique(['notification_id', 'channel'], 'notification_channel_unique');
            $table->foreign('notification_id', 'notification_delivery_notification_fk')
                ->references('id')
                ->on('notifications')
                ->cascadeOnDelete();
            $table->index(['notifiable_type', 'notifiable_id', 'created_at'], 'notification_owner_created');
            $table->index(['status', 'created_at'], 'delivery_status_created');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('notification_deliveries');
    }
};
