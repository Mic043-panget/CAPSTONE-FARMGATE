<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('chat_conversations', function (Blueprint $table): void {
            $table->foreignId('listing_id')->nullable()->after('recipient_id')->constrained('livestock_listings')->nullOnDelete();
            $table->boolean('needs_human_attention')->default(false)->after('report_context');
            $table->timestamp('attention_notified_at')->nullable()->after('needs_human_attention');
        });
    }

    public function down(): void
    {
        Schema::table('chat_conversations', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('listing_id');
            $table->dropColumn(['needs_human_attention', 'attention_notified_at']);
        });
    }
};
