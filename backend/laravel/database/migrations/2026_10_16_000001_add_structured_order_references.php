<?php

use App\Services\OrderReferenceGenerator;
use App\Support\CategoryReferenceCode;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('categories', function (Blueprint $table): void {
            $table->string('reference_code', 2)->nullable();
        });

        DB::table('categories')
            ->select(['id', 'slug', 'name'])
            ->orderBy('id')
            ->chunkById(500, function ($categories): void {
                foreach ($categories as $category) {
                    DB::table('categories')
                        ->where('id', $category->id)
                        ->update([
                            'reference_code' => CategoryReferenceCode::forSlugAndName($category->slug, $category->name),
                        ]);
                }
            });

        Schema::table('categories', function (Blueprint $table): void {
            $table->string('reference_code', 2)->nullable(false)->change();
            $table->index('reference_code');
        });

        Schema::table('orders', function (Blueprint $table): void {
            $table->string('order_reference', 80)->change();
        });

        Schema::create('order_reference_aliases', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('order_id')->constrained()->cascadeOnDelete();
            $table->string('legacy_reference', 35)->unique();
            $table->timestamps();
        });

        $generator = app(OrderReferenceGenerator::class);

        DB::table('orders')
            ->select(['id', 'seller_id', 'order_reference'])
            ->orderBy('id')
            ->chunkById(500, function ($orders) use ($generator): void {
                foreach ($orders as $order) {
                    $listingIds = DB::table('order_items')
                        ->where('order_id', $order->id)
                        ->orderBy('id')
                        ->pluck('listing_id')
                        ->map(fn ($id): int => (int) $id)
                        ->all();

                    DB::table('order_reference_aliases')->insertOrIgnore([
                        'order_id' => $order->id,
                        'legacy_reference' => $order->order_reference,
                        'created_at' => now(),
                        'updated_at' => now(),
                    ]);

                    DB::table('orders')
                        ->where('id', $order->id)
                        ->update([
                            'order_reference' => $generator->generate((int) $order->seller_id, $listingIds),
                        ]);
                }
            });
    }

    public function down(): void
    {
        throw new RuntimeException(
            'Structured order references are public transaction identifiers and cannot be safely rolled back.',
        );
    }
};
