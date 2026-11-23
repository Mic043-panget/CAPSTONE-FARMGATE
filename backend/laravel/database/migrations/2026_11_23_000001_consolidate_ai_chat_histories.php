<?php

use App\Services\Chat\ChatConversationHistoryConsolidator;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('chat_conversations', function (Blueprint $table): void {
            $table->foreignId('ai_owner_id')
                ->nullable()
                ->after('user_id')
                ->constrained('users')
                ->cascadeOnDelete();
        });

        app(ChatConversationHistoryConsolidator::class)->consolidate();

        Schema::table('chat_conversations', function (Blueprint $table): void {
            $table->unique('ai_owner_id', 'chat_conversations_single_ai_owner_unique');
        });
    }

    public function down(): void
    {
        Schema::table('chat_conversations', function (Blueprint $table): void {
            $table->dropUnique('chat_conversations_single_ai_owner_unique');
            $table->dropConstrainedForeignId('ai_owner_id');
        });
    }
};
