<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('system_settings', function (Blueprint $table): void {
            $table->string('category', 40)->default('system')->after('type');
            $table->string('label')->nullable()->after('category');
            $table->boolean('is_active')->default(true)->after('description');
            $table->boolean('is_public')->default(false)->after('is_active');
            $table->foreignId('created_by')->nullable()->after('is_public')->constrained('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('system_settings', function (Blueprint $table): void {
            $table->dropForeign(['created_by']);
            $table->dropColumn(['category', 'label', 'is_active', 'is_public', 'created_by']);
        });
    }
};