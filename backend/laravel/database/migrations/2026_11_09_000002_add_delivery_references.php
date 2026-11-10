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
        Schema::table('deliveries', function (Blueprint $table): void {
            $table->string('delivery_reference', 24)->nullable()->unique()->after('id');
        });

        DB::table('deliveries')->select(['id', 'created_at'])->orderBy('id')->chunkById(100, function ($deliveries): void {
            foreach ($deliveries as $delivery) {
                $year = $delivery->created_at ? (int) date('Y', strtotime($delivery->created_at)) : (int) date('Y');
                do {
                    $reference = sprintf('FG-DEL-%d-%s', $year, Str::upper(Str::random(6)));
                } while (DB::table('deliveries')->where('delivery_reference', $reference)->exists());

                DB::table('deliveries')->where('id', $delivery->id)->update(['delivery_reference' => $reference]);
            }
        });

        Schema::table('deliveries', function (Blueprint $table): void {
            $table->string('delivery_reference', 24)->nullable(false)->change();
        });
    }

    public function down(): void
    {
        Schema::table('deliveries', function (Blueprint $table): void {
            $table->dropUnique(['delivery_reference']);
            $table->dropColumn('delivery_reference');
        });
    }
};
