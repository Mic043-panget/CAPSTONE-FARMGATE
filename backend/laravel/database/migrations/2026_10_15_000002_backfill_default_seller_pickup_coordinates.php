<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::table('seller_profiles')
            ->where(function ($query): void {
                $query->whereNull('latitude')->orWhereNull('longitude');
            })
            ->update([
                'latitude' => DB::raw('COALESCE(latitude, 12.7321)'),
                'longitude' => DB::raw('COALESCE(longitude, 121.3654)'),
            ]);
    }

    public function down(): void
    {
        // Default coordinates cannot be distinguished from intentionally saved pins.
    }
};
