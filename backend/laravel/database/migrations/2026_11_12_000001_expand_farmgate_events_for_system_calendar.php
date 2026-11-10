<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('farmgate_events', function (Blueprint $table): void {
            $table->string('location', 255)->nullable()->change();
            $table->string('category', 40)->default('SELLER_EVENT')->after('organizer_id')->index();
            $table->string('timezone', 64)->default('Asia/Manila')->after('ends_at');
            $table->string('online_url', 2048)->nullable()->after('location');
            $table->string('image_path')->nullable()->after('online_url');
            $table->string('audience', 20)->default('PUBLIC')->after('timezone')->index();
            $table->foreignId('promotion_id')->nullable()->after('audience')->constrained('seller_promotions')->nullOnDelete();
            $table->timestamp('upcoming_notification_sent_at')->nullable()->after('review_reason');
        });

        Schema::create('farmgate_event_history', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('event_id')->constrained('farmgate_events')->cascadeOnDelete();
            $table->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('action', 40);
            $table->json('before_values')->nullable();
            $table->json('after_values')->nullable();
            $table->string('reason', 500)->nullable();
            $table->timestamps();
            $table->index(['event_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('farmgate_event_history');
        DB::table('farmgate_events')->whereNull('location')->update(['location' => 'Online']);

        Schema::table('farmgate_events', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('promotion_id');
            $table->dropColumn([
                'category',
                'timezone',
                'online_url',
                'image_path',
                'audience',
                'upcoming_notification_sent_at',
            ]);
            $table->string('location', 255)->nullable(false)->change();
        });
    }
};
