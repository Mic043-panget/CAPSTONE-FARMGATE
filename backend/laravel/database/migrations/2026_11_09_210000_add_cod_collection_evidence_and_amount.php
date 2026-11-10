<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cod_collections', function (Blueprint $table): void {
            $table->unsignedBigInteger('collected_amount_cents')->nullable()->after('expected_amount_cents');
            $table->string('proof_path', 255)->nullable()->after('collected_amount_cents');
            $table->string('proof_sha256', 64)->nullable()->after('proof_path');
            $table->string('proof_mime_type', 80)->nullable()->after('proof_sha256');
        });
    }

    public function down(): void
    {
        Schema::table('cod_collections', function (Blueprint $table): void {
            $table->dropColumn([
                'collected_amount_cents',
                'proof_path',
                'proof_sha256',
                'proof_mime_type',
            ]);
        });
    }
};
