<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('chat_conversations', function (Blueprint $table): void {
            $table->string('kind', 20)->default('ai')->after('user_id');
            $table->foreignId('recipient_id')->nullable()->after('kind')->constrained('users')->cascadeOnDelete();
            $table->string('direct_key', 50)->nullable()->unique()->after('recipient_id');
            $table->index(['recipient_id', 'updated_at']);
        });

        Schema::table('chat_messages', function (Blueprint $table): void {
            $table->foreignId('sender_id')->nullable()->after('conversation_id')->constrained('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('chat_messages', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('sender_id');
        });

        Schema::table('chat_conversations', function (Blueprint $table): void {
            $table->dropIndex(['recipient_id', 'updated_at']);
            $table->dropUnique(['direct_key']);
            $table->dropConstrainedForeignId('recipient_id');
            $table->dropColumn(['kind', 'direct_key']);
        });
    }
};
