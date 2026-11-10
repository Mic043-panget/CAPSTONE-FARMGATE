<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('chat_conversations', function (Blueprint $table): void {
            $table->string('direct_key', 64)->nullable()->change();
            $table->boolean('ai_paused')->default(false)->after('needs_human_attention');
        });

        Schema::table('chat_messages', function (Blueprint $table): void {
            $table->foreignId('reply_to_message_id')
                ->nullable()
                ->after('sender_id')
                ->unique()
                ->constrained('chat_messages')
                ->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('chat_messages', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('reply_to_message_id');
        });

        Schema::table('chat_conversations', function (Blueprint $table): void {
            $table->dropColumn('ai_paused');
            $table->string('direct_key', 50)->nullable()->change();
        });
    }
};
