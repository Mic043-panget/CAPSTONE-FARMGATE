<?php

namespace Database\Seeders;

use App\Models\LivestockListing;
use App\Models\Order;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use LogicException;

class ResetFarmgateDemoDataSeeder extends Seeder
{
    public function run(): void
    {
        $this->guardEnvironment();

        DB::transaction(function (): void {
            $users = User::withTrashed()
                ->where(function ($query): void {
                    $query->where('email', 'like', 'farmgate-demo-seller-%@farmgate.test')
                        ->orWhere('email', 'like', 'farmgate-demo-buyer-%@farmgate.test');
                })
                ->get(['id', 'email', 'role']);

            if ($users->isEmpty()) {
                return;
            }

            $userIds = $users->pluck('id');
            $sellerIds = $users->where('role', 'SELLER')->pluck('id');

            Order::withTrashed()
                ->where(fn ($query) => $query->whereIn('buyer_id', $userIds)->orWhereIn('seller_id', $userIds))
                ->forceDelete();

            if ($sellerIds->isNotEmpty()) {
                LivestockListing::withTrashed()->whereIn('seller_id', $sellerIds)->forceDelete();
            }

            User::withTrashed()->whereIn('id', $userIds)->forceDelete();
        });

        $this->command?->info('FarmGate demo data reset to zero.');
    }

    private function guardEnvironment(): void
    {
        if (! app()->environment(['local', 'testing'])) {
            throw new LogicException('FarmGate demo data can only be changed in local or testing environments.');
        }
    }
}