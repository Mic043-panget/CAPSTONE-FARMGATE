<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('rider_applications', function (Blueprint $table): void {
            $table->string('retention_policy_version', 40)->nullable();
            $table->timestamp('retention_policy_accepted_at')->nullable();
            $table->boolean('optional_updates_consent')->default(false);
            $table->timestamp('optional_updates_consented_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('rider_applications', function (Blueprint $table): void {
            $table->dropColumn([
                'retention_policy_version',
                'retention_policy_accepted_at',
                'optional_updates_consent',
                'optional_updates_consented_at',
            ]);
        });
    }
};
