<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('chat_messages', function (Blueprint $table): void {
            $table->uuid('client_message_id')->nullable()->after('sender_id');
            $table->unique(
                ['conversation_id', 'sender_id', 'client_message_id'],
                'chat_message_idempotency_unique',
            );
        });
    }

    public function down(): void
    {
        Schema::table('chat_messages', function (Blueprint $table): void {
            $table->dropUnique('chat_message_idempotency_unique');
            $table->dropColumn('client_message_id');
        });
    }
};
