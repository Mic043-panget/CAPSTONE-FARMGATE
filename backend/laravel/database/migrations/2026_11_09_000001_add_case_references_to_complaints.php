<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('complaints', function (Blueprint $table): void {
            $table->string('case_reference', 24)->nullable()->unique()->after('id');
        });

        DB::table('complaints')->select(['id', 'created_at'])->orderBy('id')->chunkById(100, function ($cases): void {
            foreach ($cases as $case) {
                $year = $case->created_at ? (int) date('Y', strtotime($case->created_at)) : (int) date('Y');
                do {
                    $reference = sprintf('FG-CASE-%d-%s', $year, Str::upper(Str::random(5)));
                } while (DB::table('complaints')->where('case_reference', $reference)->exists());

                DB::table('complaints')->where('id', $case->id)->update(['case_reference' => $reference]);
            }
        });

        Schema::table('complaints', function (Blueprint $table): void {
            $table->string('case_reference', 24)->nullable(false)->change();
        });
    }

    public function down(): void
    {
        Schema::table('complaints', function (Blueprint $table): void {
            $table->dropUnique(['case_reference']);
            $table->dropColumn('case_reference');
        });
    }
};
