<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('listing_moderation_attempts', function (Blueprint $table): void {
            if (! Schema::hasColumn('listing_moderation_attempts', 'seller_id')) {
                $table->foreignId('seller_id')->nullable()->after('listing_id')->constrained('users')->nullOnDelete();
            }
            if (! Schema::hasColumn('listing_moderation_attempts', 'final_listing_status')) {
                $table->string('final_listing_status', 30)->nullable()->after('response_summary');
            }
            if (! Schema::hasColumn('listing_moderation_attempts', 'applied_automatically')) {
                $table->boolean('applied_automatically')->default(false)->after('final_listing_status');
            }
            if (! Schema::hasColumn('listing_moderation_attempts', 'admin_override_by')) {
                $table->foreignId('admin_override_by')->nullable()->after('applied_automatically')->constrained('users')->nullOnDelete();
            }
            if (! Schema::hasColumn('listing_moderation_attempts', 'admin_override_reason')) {
                $table->text('admin_override_reason')->nullable()->after('admin_override_by');
            }
        });
    }

    public function down(): void
    {
        Schema::table('listing_moderation_attempts', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('seller_id');
            $table->dropConstrainedForeignId('admin_override_by');
            $table->dropColumn(['final_listing_status', 'applied_automatically', 'admin_override_reason']);
        });
    }
};
