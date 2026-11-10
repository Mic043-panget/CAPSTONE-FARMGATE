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
        foreach ([
            'orders' => 'payment_reference',
            'reviews' => 'review_reference',
            'rider_applications' => 'application_reference',
            'rider_vehicle_changes' => 'vehicle_reference',
        ] as $tableName => $column) {
            Schema::table($tableName, function (Blueprint $table) use ($column): void {
                $table->string($column, 24)->nullable()->unique();
            });

            DB::table($tableName)->select(['id', 'created_at'])->orderBy('id')->chunkById(100, function ($records) use ($tableName, $column): void {
                $prefix = match ($column) {
                    'payment_reference' => 'PAY',
                    'review_reference' => 'REV',
                    'application_reference' => 'APP',
                    default => 'VEH',
                };
                foreach ($records as $record) {
                    $year = $record->created_at ? (int) date('Y', strtotime($record->created_at)) : (int) date('Y');
                    do {
                        $reference = sprintf('FG-%s-%d-%s', $prefix, $year, Str::upper(Str::random(6)));
                    } while (DB::table($tableName)->where($column, $reference)->exists());

                    DB::table($tableName)->where('id', $record->id)->update([$column => $reference]);
                }
            });

            Schema::table($tableName, function (Blueprint $table) use ($column): void {
                $table->string($column, 24)->nullable(false)->change();
            });
        }
    }

    public function down(): void
    {
        foreach ([
            'rider_vehicle_changes' => 'vehicle_reference',
            'rider_applications' => 'application_reference',
            'reviews' => 'review_reference',
            'orders' => 'payment_reference',
        ] as $tableName => $column) {
            Schema::table($tableName, function (Blueprint $table) use ($column): void {
                $table->dropUnique([$column]);
                $table->dropColumn($column);
            });
        }
    }
};
