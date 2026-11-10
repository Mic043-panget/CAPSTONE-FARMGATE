<?php

namespace App\Services;

use App\Enums\DeliveryStatus;
use App\Enums\OrderStatus;
use App\Enums\Role;
use App\Models\Category;
use App\Models\Complaint;
use App\Models\Delivery;
use App\Models\LivestockListing;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\User;
use BackedEnum;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

class ReportQueryService
{
    public function queryFor(string $type, User $user): Builder
    {
        return match ($type) {
            'sales' => $this->orderQuery($user)->where('status', OrderStatus::COMPLETED->value),
            'transactions' => $this->orderQuery($user),
            'listings' => $this->listingQuery($user),
            'users' => $this->userQuery($user),
            'sellers' => $this->userQuery($user, Role::SELLER),
            'buyers' => $this->userQuery($user, Role::BUYER),
            'riders' => $this->userQuery($user, Role::RIDER),
            'categories' => $this->categoryQuery($user),
            'deliveries' => $this->deliveryQuery($user),
            'complaints' => $this->complaintQuery($user),
            default => abort(404, 'Unknown report type.'),
        };
    }

    /**
     * Keep the reporting endpoint and chatbot on exactly the same filters.
     *
     * @param  array<string, mixed>  $filters
     */
    public function applyFilters(Builder $query, string $type, array $filters, ?string $timezone = null): void
    {
        $timezone ??= app(SystemSettingsService::class)->getString('timezone');
        if (! empty($filters['from'])) {
            $query->where('created_at', '>=', CarbonImmutable::parse($filters['from'], $timezone)->startOfDay()->utc());
        }

        if (! empty($filters['to'])) {
            $query->where('created_at', '<', CarbonImmutable::parse($filters['to'], $timezone)->addDay()->startOfDay()->utc());
        }

        if (! empty($filters['status']) && in_array($type, ['sales', 'transactions', 'listings', 'deliveries', 'complaints'], true)) {
            $query->where('status', $filters['status']);
        } elseif (! empty($filters['status']) && in_array($type, ['users', 'sellers', 'buyers', 'riders'], true)) {
            match ($filters['status']) {
                'VERIFIED' => $query->whereNotNull('email_verified_at'),
                'UNVERIFIED' => $query->whereNull('email_verified_at'),
                default => abort(422, 'Unsupported account verification filter.'),
            };
        }

        if (! empty($filters['role']) && in_array($type, ['users', 'sellers', 'buyers', 'riders'], true)) {
            $query->where('role', $filters['role']);
        }
        if (! empty($filters['order_status']) && in_array($type, ['sales', 'transactions'], true)) {
            $query->where('status', $filters['order_status']);
        }
        if (! empty($filters['payment_status']) && in_array($type, ['sales', 'transactions'], true)) {
            $query->where('payment_status', $filters['payment_status']);
        }
        if (! empty($filters['payment_method']) && $type === 'transactions') {
            $query->where('payment_method', $filters['payment_method']);
        }
        if (! empty($filters['listing_id']) && in_array($type, ['sales', 'transactions'], true)) {
            $query->whereHas('items', fn (Builder $items) => $items->where('listing_id', $filters['listing_id']));
        }
        if (! empty($filters['category_id']) && in_array($type, ['sales', 'transactions'], true)) {
            $query->whereHas('items.listing', fn (Builder $listing) => $listing->where('category_id', $filters['category_id']));
        }
        if (! empty($filters['seller_id']) && in_array($type, ['sales', 'transactions'], true)) {
            $query->where('seller_id', $filters['seller_id']);
        }
        if (! empty($filters['account_status']) && $type === 'users') {
            match ($filters['account_status']) {
                'VERIFIED' => $query->whereNotNull('email_verified_at'),
                'UNVERIFIED' => $query->whereNull('email_verified_at'),
            };
        }
        if (! empty($filters['complaint_type']) && $type === 'complaints') {
            $query->whereRaw('LOWER(reason) LIKE ?', ['%'.mb_strtolower($filters['complaint_type']).'%']);
        }
        if (! empty($filters['resolution_status']) && $type === 'complaints') {
            $filters['resolution_status'] === 'RESOLVED'
                ? $query->whereNotNull('resolved_at')
                : $query->whereNull('resolved_at');
        }
        if (isset($filters['amount_min']) && in_array($type, ['sales', 'transactions'], true)) {
            $query->where('total_amount', '>=', $filters['amount_min']);
        }
        if (isset($filters['amount_max']) && in_array($type, ['sales', 'transactions'], true)) {
            $query->where('total_amount', '<=', $filters['amount_max']);
        }

        if (empty($filters['search'])) {
            return;
        }

        $search = '%'.mb_strtolower($filters['search']).'%';
        $query->where(function (Builder $builder) use ($type, $search): void {
            if (in_array($type, ['sales', 'transactions'], true)) {
                $builder->whereRaw('LOWER(order_reference) LIKE ?', [$search])
                    ->orWhereRaw('LOWER(payment_reference) LIKE ?', [$search])
                    ->orWhereHas('buyer', fn (Builder $user) => $user->whereRaw('LOWER(name) LIKE ?', [$search]))
                    ->orWhereHas('seller', fn (Builder $user) => $user->whereRaw('LOWER(name) LIKE ?', [$search]));
                if (in_array($type, ['sales', 'transactions'], true)) {
                    $builder->orWhereRaw('LOWER(COALESCE(paymongo_checkout_session_id, \'\')) LIKE ?', [$search])
                        ->orWhereRaw('LOWER(COALESCE(payment_method, \'\')) LIKE ?', [$search]);
                }
            } elseif ($type === 'listings') {
                $builder->whereRaw('LOWER(name) LIKE ?', [$search])
                    ->orWhereRaw('LOWER(breed) LIKE ?', [$search]);
            } elseif (in_array($type, ['users', 'sellers', 'buyers', 'riders'], true)) {
                $builder->whereRaw('LOWER(name) LIKE ?', [$search])
                    ->orWhereRaw('LOWER(email) LIKE ?', [$search])
                    ->orWhereRaw('LOWER(COALESCE(phone_number, \'\')) LIKE ?', [$search])
                    ->orWhereRaw('LOWER(CAST(role AS CHAR)) LIKE ?', [$search]);
            } elseif ($type === 'categories') {
                $builder->whereRaw('LOWER(name) LIKE ?', [$search])
                    ->orWhereRaw('LOWER(slug) LIKE ?', [$search]);
            } elseif ($type === 'complaints') {
                $builder->whereRaw('LOWER(case_reference) LIKE ?', [$search])
                    ->orWhereRaw('LOWER(reason) LIKE ?', [$search])
                    ->orWhereRaw('LOWER(description) LIKE ?', [$search])
                    ->orWhereRaw('LOWER(status) LIKE ?', [$search])
                    ->orWhereHas('order', fn (Builder $order) => $order->whereRaw('LOWER(order_reference) LIKE ?', [$search]))
                    ->orWhereHas('opener', fn (Builder $user) => $user->whereRaw('LOWER(name) LIKE ?', [$search]))
                    ->orWhereHas('respondent', fn (Builder $user) => $user->whereRaw('LOWER(name) LIKE ?', [$search]));
            } else {
                $builder->where('delivery_reference', 'like', $search)
                    ->orWhereHas('rider', fn (Builder $user) => $user->whereRaw('LOWER(name) LIKE ?', [$search]))
                    ->orWhereHas('order', fn (Builder $order) => $order->whereRaw('LOWER(order_reference) LIKE ?', [$search]));
            }
        });
    }

    /**
     * Return a small, non-identifying context object for the AI provider.
     *
     * @param  array<string, mixed>  $filters
     * @return array<string, mixed>
     */
    public function aggregateContext(string $type, User $user, array $filters): array
    {
        $query = $this->queryFor($type, $user);
        $this->applyFilters($query, $type, $filters);

        $context = [
            'report' => $type,
            'record_count' => (int) (clone $query)->count(),
            'filters' => array_filter(
                array_intersect_key($filters, array_flip([
                    'from', 'to', 'status', 'order_status', 'payment_status', 'payment_method',
                    'role', 'account_status', 'complaint_type', 'resolution_status', 'amount_min', 'amount_max',
                    'category_id', 'listing_id', 'seller_id',
                ])),
                static fn (mixed $value): bool => $value !== null && $value !== '',
            ),
        ];

        if (in_array($type, ['sales', 'transactions'], true)) {
            $context['total_amount'] = ! empty($filters['listing_id']) || ! empty($filters['category_id'])
                ? (string) OrderItem::query()
                    ->whereIn('order_id', (clone $query)->select('orders.id'))
                    ->when($filters['listing_id'] ?? null, fn ($items, $listingId) => $items->where('listing_id', $listingId))
                    ->when($filters['category_id'] ?? null, fn ($items, $categoryId) => $items->whereHas('listing', fn (Builder $listing) => $listing->where('category_id', $categoryId)))
                    ->sum('total_amount')
                : (string) ((clone $query)->sum('total_amount') ?? '0.00');
            $context['status_distribution'] = $this->groupedCount($query, 'status', 'status');
            if (! empty($filters['listing_id']) || ! empty($filters['category_id'])) {
                $context['monthly_trend_unavailable'] = 'Monthly totals by individual livestock listing or category are not aggregated for this report.';
            } else {
                $context['monthly_totals'] = $this->monthlyTotals($query);
            }
        } elseif ($type === 'listings') {
            $context['listed_quantity'] = (int) (clone $query)->sum('quantity');
            $context['status_distribution'] = $this->groupedCount($query, 'status', 'status');
            $context['quantity_by_status'] = (clone $query)
                ->selectRaw('status, SUM(quantity) as quantity')
                ->groupBy('status')
                ->get()
                ->map(fn (LivestockListing $listing): array => [
                    'status' => $this->enumValue($listing->status),
                    'quantity' => (int) $listing->quantity,
                ])
                ->all();
        } elseif ($type === 'deliveries') {
            $context['status_distribution'] = $this->groupedCount($query, 'status', 'status');
            $context['monthly_delivery_counts'] = $this->monthlyCounts($query);
        } elseif (in_array($type, ['users', 'sellers', 'buyers', 'riders'], true)) {
            $context['role_distribution'] = $this->groupedCount($query, 'role', 'role');
        }

        return $context;
    }

    /**
     * @return list<array{status: string, count: int}>
     */
    private function groupedCount(Builder $query, string $column, string $label): array
    {
        return (clone $query)
            ->select($column)
            ->selectRaw('COUNT(*) as aggregate_count')
            ->groupBy($column)
            ->get()
            ->map(fn ($row): array => [
                $label => $this->enumValue($row->{$column}),
                'count' => (int) $row->aggregate_count,
            ])
            ->all();
    }

    /**
     * @return list<array{period: string, record_count: int, total_amount: string}>
     */
    private function monthlyTotals(Builder $query): array
    {
        $period = $this->monthExpression();

        return (clone $query)
            ->selectRaw($period.' as period, COUNT(*) as record_count, SUM(total_amount) as total_amount')
            ->groupBy('period')
            ->orderBy('period')
            ->limit(24)
            ->get()
            ->map(fn ($row): array => [
                'period' => (string) $row->period,
                'record_count' => (int) $row->record_count,
                'total_amount' => (string) ($row->total_amount ?? '0.00'),
            ])
            ->all();
    }

    /**
     * @return list<array{period: string, record_count: int}>
     */
    private function monthlyCounts(Builder $query): array
    {
        $period = $this->monthExpression();

        return (clone $query)
            ->selectRaw($period.' as period, COUNT(*) as record_count')
            ->groupBy('period')
            ->orderBy('period')
            ->limit(24)
            ->get()
            ->map(fn ($row): array => [
                'period' => (string) $row->period,
                'record_count' => (int) $row->record_count,
            ])
            ->all();
    }

    private function monthExpression(): string
    {
        return match (DB::connection()->getDriverName()) {
            'sqlite' => "strftime('%Y-%m', created_at)",
            'pgsql' => "TO_CHAR(created_at, 'YYYY-MM')",
            default => "DATE_FORMAT(created_at, '%Y-%m')",
        };
    }

    private function enumValue(mixed $value): string
    {
        return $value instanceof BackedEnum ? (string) $value->value : (string) $value;
    }

    private function orderQuery(User $user): Builder
    {
        $query = Order::query()->with(['buyer:id,name,email', 'seller:id,name,email']);

        return match ($user->role) {
            Role::ADMIN => $query,
            Role::SELLER => $query->where('seller_id', $user->id),
            Role::BUYER => $query->where('buyer_id', $user->id),
            default => abort(403),
        };
    }

    private function listingQuery(User $user): Builder
    {
        $query = LivestockListing::query()->with(['seller:id,name,email', 'category:id,name']);

        return match ($user->role) {
            Role::ADMIN => $query,
            Role::SELLER => $query->where('seller_id', $user->id),
            default => abort(403),
        };
    }

    private function userQuery(User $user, ?Role $filterRole = null): Builder
    {
        abort_unless($user->role === Role::ADMIN, 403);

        $query = User::query()->select(['id', 'name', 'email', 'phone_number', 'role', 'email_verified_at', 'created_at']);

        return $filterRole ? $query->where('role', $filterRole->value) : $query;
    }

    private function categoryQuery(User $user): Builder
    {
        abort_unless($user->role === Role::ADMIN, 403);

        return Category::query()->withCount('listings');
    }

    private function deliveryQuery(User $user): Builder
    {
        if ($user->role === Role::RIDER) {
            return Delivery::query()
                ->with('order:id,order_reference,shipping_address')
                ->where('rider_id', $user->id)
                ->whereNotIn('status', [
                    DeliveryStatus::PENDING_ASSIGNMENT->value,
                    DeliveryStatus::WAITING_FOR_RIDER->value,
                    DeliveryStatus::RIDER_OFFERED->value,
                    DeliveryStatus::SEARCHING_FOR_RIDER->value,
                ]);
        }

        $query = Delivery::query()->with(['order:id,order_reference,buyer_id,seller_id,status,total_amount', 'rider:id,name,email']);

        return match ($user->role) {
            Role::ADMIN => $query,
            Role::SELLER => $query->whereHas('order', fn (Builder $order) => $order->where('seller_id', $user->id)),
            Role::BUYER => $query->whereHas('order', fn (Builder $order) => $order->where('buyer_id', $user->id)),
            default => abort(403),
        };
    }

    private function complaintQuery(User $user): Builder
    {
        abort_unless($user->role === Role::ADMIN, 403);

        return Complaint::query()->with([
            'order:id,order_reference',
            'opener:id,name',
            'respondent:id,name',
            'resolver:id,name',
        ]);
    }
}
