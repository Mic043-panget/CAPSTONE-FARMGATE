<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->timestamp('password_set_at')->nullable();
            $table->timestamp('account_preferences_reviewed_at')->nullable();
        });

        DB::table('users')
            ->whereNull('google_id')
            ->whereNotNull('password')
            ->update(['password_set_at' => DB::raw('created_at')]);
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->dropColumn(['password_set_at', 'account_preferences_reviewed_at']);
        });
    }
};
