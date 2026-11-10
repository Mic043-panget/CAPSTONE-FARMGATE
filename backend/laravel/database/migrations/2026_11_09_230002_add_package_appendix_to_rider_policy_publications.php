<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('rider_policy_publications', function (Blueprint $table): void {
            $table->longText('package_appendix')->nullable()->after('retention_content');
        });
    }

    public function down(): void
    {
        Schema::table('rider_policy_publications', function (Blueprint $table): void {
            $table->dropColumn('package_appendix');
        });
    }
};
