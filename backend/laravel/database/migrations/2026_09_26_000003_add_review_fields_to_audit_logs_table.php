<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('audit_logs', function (Blueprint $table): void {
            $table->string('database_action', 10)->default('NONE')->after('status_code');
            $table->string('entity_type', 120)->nullable()->after('database_action');
            $table->string('entity_id', 120)->nullable()->after('entity_type');
            $table->text('description')->nullable()->after('entity_id');
            $table->string('reason', 255)->nullable()->after('description');
            $table->text('request_url')->nullable()->after('route');
            $table->json('before_values')->nullable()->after('metadata');
            $table->json('after_values')->nullable()->after('before_values');
            $table->json('changed_fields')->nullable()->after('after_values');

            $table->index(['database_action', 'created_at']);
            $table->index(['entity_type', 'entity_id']);
        });
    }

    public function down(): void
    {
        Schema::table('audit_logs', function (Blueprint $table): void {
            $table->dropIndex(['database_action', 'created_at']);
            $table->dropIndex(['entity_type', 'entity_id']);
            $table->dropColumn(['database_action', 'entity_type', 'entity_id', 'description', 'reason', 'request_url', 'before_values', 'after_values', 'changed_fields']);
        });
    }
};
