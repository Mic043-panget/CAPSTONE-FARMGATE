<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cod_remittances', function (Blueprint $table): void {
            $table->string('transaction_reference_hash', 64)->nullable();
        });

        $seenHashes = [];
        DB::table('cod_remittances')
            ->whereNotNull('transaction_reference')
            ->orderBy('id')
            ->chunkById(100, function ($remittances) use (&$seenHashes): void {
                foreach ($remittances as $remittance) {
                    $reference = mb_strtolower(trim(Crypt::decryptString($remittance->transaction_reference)));
                    $hash = hash_hmac(
                        'sha256',
                        strtoupper($remittance->method_type).':'.$remittance->receiving_method_id.':'.$reference,
                        (string) config('app.key'),
                    );

                    // Keep the first legacy occurrence indexed; it is enough to reject future replays.
                    if (isset($seenHashes[$hash])) {
                        continue;
                    }

                    $seenHashes[$hash] = true;
                    DB::table('cod_remittances')
                        ->where('id', $remittance->id)
                        ->update(['transaction_reference_hash' => $hash]);
                }
            });

        Schema::table('cod_remittances', function (Blueprint $table): void {
            $table->unique('transaction_reference_hash', 'cod_remittances_transaction_ref_hash_unique');
        });
    }

    public function down(): void
    {
        Schema::table('cod_remittances', function (Blueprint $table): void {
            $table->dropUnique('cod_remittances_transaction_ref_hash_unique');
            $table->dropColumn('transaction_reference_hash');
        });
    }
};
