<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table): void {
            $table->string('order_reference', 35)->nullable();
        });

        DB::table('orders')
            ->select('id')
            ->whereNull('order_reference')
            ->orderBy('id')
            ->chunkById(500, function ($orders): void {
                foreach ($orders as $order) {
                    do {
                        $reference = 'FG-'.strtoupper(bin2hex(random_bytes(16)));
                    } while (DB::table('orders')->where('order_reference', $reference)->exists());

                    DB::table('orders')
                        ->where('id', $order->id)
                        ->whereNull('order_reference')
                        ->update(['order_reference' => $reference]);
                }
            });

        Schema::table('orders', function (Blueprint $table): void {
            $table->unique('order_reference');
            $table->string('order_reference', 35)->nullable(false)->change();
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table): void {
            $table->dropUnique('orders_order_reference_unique');
            $table->dropColumn('order_reference');
        });
    }
};
