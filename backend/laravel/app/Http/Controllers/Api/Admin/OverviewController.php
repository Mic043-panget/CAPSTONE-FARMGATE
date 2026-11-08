<?php

namespace App\Http\Controllers\Api\Admin;

use App\Enums\DeliveryStatus;
use App\Enums\OrderStatus;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Category;
use App\Models\Delivery;
use App\Models\LoginHistory;
use App\Models\Order;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class OverviewController extends Controller
{
    public function users(Request $request): JsonResponse
    {
        $this->admin($request);
        $query = User::query()->select(['id', 'name', 'email', 'role', 'email_verified_at', 'created_at'])->latest();
        if ($request->filled('role')) {
            $query->where('role', $request->input('role'));
        }
        if ($request->boolean('verified')) {
            $query->whereNotNull('email_verified_at');
        }
        if ($request->filled('search')) {
            $query->where(fn ($builder) => $builder->where('name', 'like', '%'.$request->input('search').'%')->orWhere('email', 'like', '%'.$request->input('search').'%'));
        }

        return response()->json(['users' => $query->paginate(15)->withQueryString()]);
    }

    public function orders(Request $request): JsonResponse
    {
        $this->admin($request);
        $data = $request->validate([
            'status' => ['nullable', Rule::in([...array_map(fn (OrderStatus $status): string => $status->value, OrderStatus::cases()), 'DELIVERED'])],
            'sort' => ['nullable', Rule::in([
                'newest',
                'oldest',
                'reference_asc',
                'reference_desc',
                'buyer_asc',
                'buyer_desc',
                'seller_asc',
                'seller_desc',
                'status_asc',
                'status_desc',
                'total_asc',
                'total_desc',
            ])],
        ]);
        $query = Order::query()->with([
            'buyer:id,name,email',
            'seller:id,name,email',
            'delivery:id,order_id,status',
        ]);
        if ($request->filled('search')) {
            $search = '%'.trim((string) $request->input('search')).'%';
            $query->where(function ($builder) use ($search): void {
                $builder->where('order_reference', 'like', $search)->orWhereHas('buyer', fn ($buyer) => $buyer->where('name', 'like', $search)->orWhere('email', 'like', $search))->orWhereHas('seller', fn ($seller) => $seller->where('name', 'like', $search)->orWhere('email', 'like', $search));
            });
        }

        $statusCounts = ['all' => (clone $query)->count()];
        foreach ([
            ...array_map(fn (OrderStatus $status): string => $status->value, OrderStatus::cases()),
            'DELIVERED',
        ] as $status) {
            $statusQuery = clone $query;
            $this->applyOrderStatusFilter($statusQuery, $status);
            $statusCounts[$status] = $statusQuery->count();
        }

        if (! empty($data['status'])) {
            $this->applyOrderStatusFilter($query, $data['status']);
        }

        $sort = $data['sort'] ?? 'newest';
        $direction = str_ends_with($sort, '_desc') ? 'desc' : 'asc';
        match ($sort) {
            'oldest' => $query->orderBy('orders.created_at')->orderBy('orders.id'),
            'reference_asc', 'reference_desc' => $query->orderBy('orders.order_reference', $direction)->orderBy('orders.id'),
            'buyer_asc', 'buyer_desc' => $query->leftJoin('users as order_buyers', 'order_buyers.id', '=', 'orders.buyer_id')
                ->select('orders.*')->orderBy('order_buyers.name', $direction)->orderBy('orders.id'),
            'seller_asc', 'seller_desc' => $query->leftJoin('users as order_sellers', 'order_sellers.id', '=', 'orders.seller_id')
                ->select('orders.*')->orderBy('order_sellers.name', $direction)->orderBy('orders.id'),
            'status_asc', 'status_desc' => $query->orderBy('orders.status', $direction)->orderBy('orders.id'),
            'total_asc', 'total_desc' => $query->orderBy('orders.total_amount', $direction)->orderBy('orders.id'),
            default => $query->orderByDesc('orders.created_at')->orderByDesc('orders.id'),
        };

        $orders = $query->paginate(15)->withQueryString();
        $orders->getCollection()->each(function (Order $order): void {
            $displayStatus = $order->status === OrderStatus::FULFILLING
                && $order->delivery?->status === DeliveryStatus::DELIVERED
                ? 'DELIVERED'
                : ($order->status === OrderStatus::FULFILLING ? 'ON THE WAY' : $order->status->value);
            $order->setAttribute('display_status', $displayStatus);
        });

        return response()->json([
            'orders' => $orders,
            'status_counts' => $statusCounts,
        ]);
    }

    public function orderDetails(Request $request, Order $order): JsonResponse
    {
        $this->admin($request);
        $order->load([
            'buyer:id,name,email,phone_number',
            'seller:id,name,email',
            'seller.sellerProfile:user_id,business_name,phone,address',
            'items.listing:id,name',
            'delivery:id,order_id,status,rider_id,delivery_verified_at',
            'delivery.rider:id,name',
            'statusHistory.actor:id,name',
            'activities',
        ]);
        $order->setAttribute(
            'display_status',
            $order->status === OrderStatus::FULFILLING && $order->delivery?->status === DeliveryStatus::DELIVERED
                ? 'DELIVERED'
                : ($order->status === OrderStatus::FULFILLING ? 'ON THE WAY' : $order->status->value),
        );

        return response()->json(['order' => $order]);
    }

    private function applyOrderStatusFilter(Builder $query, string $status): void
    {
        if ($status === 'DELIVERED') {
            $query->where('orders.status', OrderStatus::FULFILLING->value)
                ->whereHas('delivery', fn ($delivery) => $delivery->where('status', DeliveryStatus::DELIVERED->value));

            return;
        }

        $query->where('orders.status', $status);
        if ($status === 'FULFILLING') {
            $query->whereDoesntHave('delivery', fn ($delivery) => $delivery->where('status', 'DELIVERED'));
        }
    }

    public function deliveries(Request $request): JsonResponse
    {
        $this->admin($request);
        $query = Delivery::query()->with([
            'order:id,order_reference,status,total_amount',
            'rider:id,name,email',
            'proofCorrections.correctedBy:id,name',
        ]);
        if ($request->filled('search')) {
            $search = '%'.trim((string) $request->input('search')).'%';
            $query->where(function ($builder) use ($search): void {
                $builder->where('id', 'like', $search)->orWhere('status', 'like', $search)->orWhereHas('rider', fn ($rider) => $rider->where('name', 'like', $search)->orWhere('email', 'like', $search));
            });
        }

        return response()->json(['deliveries' => $query->latest()->paginate(15)->withQueryString()]);
    }

    public function categories(Request $request): JsonResponse
    {
        $this->admin($request);
        $query = Category::query()->withCount('listings')->orderBy('name');
        if ($request->filled('search')) {
            $search = '%'.trim((string) $request->input('search')).'%';
            $query->where(fn ($builder) => $builder->where('name', 'like', $search)->orWhere('slug', 'like', $search));
        }

        return response()->json(['categories' => $query->paginate(15)->withQueryString()]);
    }

    public function loginHistory(Request $request): JsonResponse
    {
        $this->admin($request);
        $query = LoginHistory::query()->with('user:id,name,email');
        if ($request->filled('search')) {
            $search = '%'.trim((string) $request->input('search')).'%';
            $query->where(function ($builder) use ($search): void {
                $builder->where('attempted_identifier', 'like', $search)->orWhereHas('user', fn ($user) => $user->where('email', 'like', $search)->orWhere('name', 'like', $search));
            });
        }

        return response()->json(['history' => $query->latest()->paginate(15)->withQueryString()]);
    }

    public function auditLogs(Request $request): JsonResponse
    {
        $this->admin($request);
        $query = AuditLog::query()->with('actor:id,name,email,role');
        if ($request->filled('search')) {
            $search = '%'.trim((string) $request->input('search')).'%';
            $query->where(function ($builder) use ($search): void {
                $builder->where('audit_logs.action', 'like', $search)
                    ->orWhere('audit_logs.route', 'like', $search)
                    ->orWhere('audit_logs.description', 'like', $search)
                    ->orWhere('audit_logs.entity_type', 'like', $search)
                    ->orWhere('audit_logs.entity_id', 'like', $search)
                    ->orWhereHas('actor', fn ($actor) => $actor->where('name', 'like', $search)->orWhere('email', 'like', $search));
            });
        }
        if ($request->filled('actor')) {
            $query->whereHas('actor', fn ($actor) => $actor->where('name', 'like', '%'.$request->input('actor').'%')->orWhere('email', 'like', '%'.$request->input('actor').'%'));
        }
        if ($request->filled('role')) {
            $query->whereHas('actor', fn ($actor) => $actor->where('role', $request->input('role')));
        }
        if ($request->filled('action')) {
            $query->where('action', 'like', '%'.$request->input('action').'%');
        }
        if ($request->filled('database_action')) {
            $query->where('database_action', $request->input('database_action'));
        }
        if ($request->filled('entity_type')) {
            $query->where('entity_type', $request->input('entity_type'));
        }
        if ($request->filled('entity_id')) {
            $query->where('entity_id', (string) $request->input('entity_id'));
        }
        if ($request->filled('success')) {
            $query->where($request->boolean('success') ? 'status_code' : 'status_code', $request->boolean('success') ? '<' : '>=', 400);
        }
        if ($request->filled('date_from')) {
            $query->whereDate('created_at', '>=', $request->input('date_from'));
        }
        if ($request->filled('date_to')) {
            $query->whereDate('created_at', '<=', $request->input('date_to'));
        }

        $sort = (string) $request->input('sort', 'created_at');
        $direction = strtolower((string) $request->input('direction', 'desc')) === 'asc' ? 'asc' : 'desc';
        if (in_array($sort, ['actor', 'role'], true)) {
            $query->leftJoin('users as audit_actors', 'audit_actors.id', '=', 'audit_logs.user_id')->select('audit_logs.*')->orderBy('audit_actors.'.($sort === 'actor' ? 'name' : 'role'), $direction);
        } else {
            $query->orderBy(in_array($sort, ['created_at', 'action', 'database_action', 'entity_type', 'status_code'], true) ? $sort : 'created_at', $direction);
        }

        $perPage = (int) $request->input('per_page', 25);
        $perPage = in_array($perPage, [10, 25, 50, 100], true) ? $perPage : 25;

        return response()->json(['audit_logs' => $query->paginate($perPage)->withQueryString()]);
    }

    public function auditLog(Request $request, AuditLog $auditLog): JsonResponse
    {
        $this->admin($request);

        return response()->json(['audit_log' => $auditLog->load('actor:id,name,email,role')]);
    }

    private function admin(Request $request): void
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
    }
}
