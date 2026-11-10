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
use App\Models\Review;
use App\Models\User;
use App\Services\OrderCaseWorkflowService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class OverviewController extends Controller
{
    public function users(Request $request): JsonResponse
    {
        $this->admin($request);
        $query = User::withTrashed()
            ->select(['id', 'name', 'email', 'role', 'email_verified_at', 'created_at', 'deleted_at'])
            ->withCount('moderationViolations')
            ->latest();
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
            $searchText = trim((string) $request->input('search'));
            $search = '%'.$searchText.'%';
            $query->where(function ($builder) use ($search): void {
                $builder->where('order_reference', 'like', $search)
                    ->orWhere('payment_reference', 'like', $search)
                    ->orWhereHas('buyer', fn ($buyer) => $buyer->where('name', 'like', $search)->orWhere('email', 'like', $search))
                    ->orWhereHas('seller', fn ($seller) => $seller->where('name', 'like', $search)->orWhere('email', 'like', $search));
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

    public function orderDetails(Request $request, Order $order, OrderCaseWorkflowService $workflow): JsonResponse
    {
        $this->admin($request);
        $order->load([
            'buyer:id,name,email,phone_number',
            'seller:id,name,email',
            'seller.sellerProfile:user_id,business_name,phone,address',
            'items.listing:id,name',
            'delivery.rider:id,name,email',
            'delivery.statusHistory.actor:id,name',
            'delivery.proofCorrections.correctedBy:id,name',
            'statusHistory.actor:id,name',
            'activities',
            'complaints.opener:id,name,email',
            'complaints.respondent:id,name,email',
            'complaints.resolver:id,name,email',
            'complaints.statusHistory.actor:id,name',
            'complaints.messages',
            'complaints.messages.media',
            'complaints.media',
        ]);
        $collection = $order->codCollection()
            ->with(['remittance.histories.actor:id,name,role'])
            ->first();
        $order->setAttribute('cod_reconciliation_evidence', $collection ? [
            'collection_status' => $collection->status,
            'expected_amount_cents' => $collection->expected_amount_cents,
            'collected_amount_cents' => $collection->collected_amount_cents,
            'collected_at' => $collection->collected_at,
            'remittance' => $collection->remittance ? [
                'reference' => $collection->remittance->reference,
                'status' => $collection->remittance->status,
                'method_type' => $collection->remittance->method_type,
                'expected_amount_cents' => $collection->remittance->expected_amount_cents,
                'received_amount_cents' => $collection->remittance->received_amount_cents,
                'submitted_at' => $collection->remittance->submitted_at,
                'reconciled_at' => $collection->remittance->reconciled_at,
                'history' => $collection->remittance->histories->map(fn ($entry): array => [
                    'action' => $entry->action,
                    'expected_amount_cents' => $entry->expected_amount_cents,
                    'received_amount_cents' => $entry->received_amount_cents,
                    'reason' => $entry->reason,
                    'created_at' => $entry->created_at,
                    'actor' => $entry->actor ? [
                        'name' => $entry->actor->name,
                        'role' => $entry->actor->role,
                    ] : null,
                ])->values(),
            ] : null,
        ] : null);
        $order->setAttribute(
            'delivery_reconciliation_required',
            $order->status === OrderStatus::COMPLETED
                && $order->delivery_method === 'STANDARD_DELIVERY'
                && ($order->delivery?->status !== DeliveryStatus::DELIVERED
                    || $order->delivery?->delivery_verified_at === null),
        );
        foreach ($order->complaints as $complaint) {
            $complaint->setAttribute('evidence_media', $workflow->mediaPayload($complaint->media));
            $workflow->attachPayoutEvidenceUrl($complaint);
            foreach ($complaint->messages as $message) {
                $message->setAttribute('media_files', $workflow->mediaPayload($message->media));
                $message->makeHidden('media');
            }
            $complaint->makeHidden(['media', 'evidence']);
        }
        $order->setAttribute('review', Review::query()
            ->where('order_id', $order->id)
            ->with(['listing:id,name', 'buyer:id,name', 'seller:id,name'])
            ->first());
        $order->setAttribute('audit_history', AuditLog::query()
            ->with('actor:id,name,email,role')
            ->whereIn('entity_type', [Order::class, class_basename(Order::class)])
            ->where('entity_id', (string) $order->id)
            ->latest()
            ->limit(50)
            ->get());
        $order->setAttribute(
            'display_status',
            $order->status === OrderStatus::FULFILLING && $order->delivery?->status === DeliveryStatus::DELIVERED
                ? 'DELIVERED'
                : ($order->status === OrderStatus::FULFILLING ? 'ON THE WAY' : $order->status->value),
        );

        return response()->json(['order' => $order]);
    }

    public function correctPrematureCompletion(Request $request, Order $order): JsonResponse
    {
        $this->admin($request);
        $data = $request->validate([
            'decision' => ['required', Rule::in(['restore_to_fulfilling'])],
            'reason' => ['required', 'string', 'min:10', 'max:2000'],
            'evidence_reviewed' => ['required', 'accepted'],
        ]);

        $corrected = DB::transaction(function () use ($data, $order, $request): Order {
            $lockedOrder = Order::query()->lockForUpdate()->findOrFail($order->id);
            abort_unless($lockedOrder->status === OrderStatus::COMPLETED, 409, 'The order is no longer marked completed.');
            abort_unless($lockedOrder->delivery_method === 'STANDARD_DELIVERY', 409, 'This reconciliation action only applies to standard deliveries.');
            $delivery = Delivery::query()->where('order_id', $lockedOrder->id)->lockForUpdate()->first();
            abort_unless(
                $delivery === null
                    || $delivery->status !== DeliveryStatus::DELIVERED
                    || $delivery->delivery_verified_at === null,
                409,
                'The delivery is QR-verified; this correction is not applicable.',
            );

            $fromStatus = $lockedOrder->status;
            $lockedOrder->forceFill(['status' => OrderStatus::FULFILLING])->save();
            $lockedOrder->statusHistory()->create([
                'from_status' => $fromStatus,
                'to_status' => OrderStatus::FULFILLING,
                'changed_by' => $request->user()->id,
                'reason' => 'ADMIN_RECONCILIATION: '.$data['reason'],
            ]);

            return $lockedOrder->fresh();
        });

        return response()->json([
            'message' => 'Order status correction recorded. Payment status was not changed.',
            'order' => $corrected,
        ]);
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
        $filters = $request->validate([
            'status' => ['nullable', Rule::in(array_map(fn (DeliveryStatus $status): string => $status->value, DeliveryStatus::cases()))],
            'sort' => ['nullable', Rule::in(['newest', 'oldest', 'reference_asc', 'reference_desc', 'rider_asc', 'status_asc', 'status_desc'])],
        ]);
        $query = Delivery::query()->with([
            'order:id,order_reference,status,total_amount',
            'rider:id,name,email',
        ])->withCount('proofCorrections');
        if ($request->filled('search')) {
            $searchText = trim((string) $request->input('search'));
            $search = '%'.$searchText.'%';
            $query->where(function ($builder) use ($search): void {
                $builder->where('delivery_reference', 'like', $search)
                    ->orWhere('status', 'like', $search)
                    ->orWhereHas('order', fn ($order) => $order->where('order_reference', 'like', $search))
                    ->orWhereHas('rider', fn ($rider) => $rider->where('name', 'like', $search)->orWhere('email', 'like', $search));
            });
        }

        $statusCounts = ['all' => (clone $query)->count()];
        foreach (DeliveryStatus::cases() as $deliveryStatus) {
            $statusCounts[$deliveryStatus->value] = (clone $query)->where('status', $deliveryStatus->value)->count();
        }
        if (! empty($filters['status'])) {
            $query->where('status', $filters['status']);
        }
        $sort = $filters['sort'] ?? 'newest';
        $direction = str_ends_with($sort, '_desc') ? 'desc' : 'asc';
        match ($sort) {
            'oldest' => $query->orderBy('deliveries.created_at')->orderBy('deliveries.id'),
            'reference_asc', 'reference_desc' => $query->orderBy('delivery_reference', $direction),
            'rider_asc' => $query->leftJoin('users as delivery_riders', 'delivery_riders.id', '=', 'deliveries.rider_id')
                ->select('deliveries.*')->orderBy('delivery_riders.name')->orderBy('deliveries.id'),
            'status_asc', 'status_desc' => $query->orderBy('deliveries.status', $direction)->orderBy('deliveries.id'),
            default => $query->orderByDesc('deliveries.created_at')->orderByDesc('deliveries.id'),
        };

        return response()->json([
            'deliveries' => $query->paginate(15)->withQueryString(),
            'status_counts' => $statusCounts,
        ]);
    }

    public function deliveryDetails(Request $request, Delivery $delivery): JsonResponse
    {
        $this->admin($request);
        $delivery->load([
            'order:id,order_reference,payment_reference,status,buyer_id,seller_id,total_amount,delivery_fee,payment_method,payment_status,shipping_address',
            'order.buyer:id,name,email',
            'order.seller:id,name,email',
            'order.items:id,order_id,listing_id,quantity,total_amount',
            'order.items.listing:id,name',
            'rider:id,name,email',
            'statusHistory.actor:id,name,role',
            'proofCorrections.correctedBy:id,name',
        ]);

        return response()->json(['delivery' => $delivery]);
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
        $query = $this->auditLogQuery($request);
        $perPage = (int) $request->input('per_page', 25);
        $perPage = in_array($perPage, [10, 25, 50, 100], true) ? $perPage : 25;

        return response()->json(['audit_logs' => $query->paginate($perPage)->withQueryString()]);
    }

    private function auditLogQuery(Request $request, bool $excludeReportActions = false): Builder
    {
        $query = AuditLog::query()->with('actor:id,name,email,role');
        if ($excludeReportActions) {
            $query->whereNotIn('action', ['admin.audit_report.generated', 'admin.report.exported']);
            $query->whereNotIn('route', ['api/admin/audit-logs/report', 'api/admin/reports/export-audit']);
        }
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

        return $query;
    }

    public function auditLog(Request $request, AuditLog $auditLog): JsonResponse
    {
        $this->admin($request);

        return response()->json(['audit_log' => $auditLog->load('actor:id,name,email,role')]);
    }

    public function recordAuditReport(Request $request): JsonResponse
    {
        $this->admin($request);
        $data = $request->validate([
            'filters' => ['required', 'array'],
            'filters.search' => ['nullable', 'string', 'max:100'],
            'filters.actor' => ['nullable', 'string', 'max:120'],
            'filters.role' => ['nullable', Rule::in(['ADMIN', 'BUYER', 'SELLER', 'RIDER'])],
            'filters.database_action' => ['nullable', Rule::in(['INSERT', 'UPDATE', 'DELETE', 'NONE'])],
            'filters.success' => ['nullable', Rule::in(['true', 'false'])],
            'filters.date_from' => ['nullable', 'date_format:Y-m-d'],
            'filters.date_to' => ['nullable', 'date_format:Y-m-d'],
            'filters.sort' => ['nullable', Rule::in(['created_at', 'action', 'database_action', 'entity_type', 'status_code', 'actor', 'role'])],
            'filters.direction' => ['nullable', Rule::in(['asc', 'desc'])],
        ]);
        abort_if(
            ! empty($data['filters']['date_from'])
                && ! empty($data['filters']['date_to'])
                && $data['filters']['date_to'] < $data['filters']['date_from'],
            422,
            'The audit report end date must be on or after the start date.',
        );
        $filters = $data['filters'];
        $snapshotRequest = Request::create('/api/admin/audit-logs', 'GET', $filters);
        $snapshotRequest->setUserResolver(fn () => $request->user());
        $reportRows = $this->auditLogQuery($snapshotRequest, excludeReportActions: true)->get();
        $recordCount = $reportRows->count();
        $generatedAt = now();
        AuditLog::create([
            'user_id' => $request->user()->id,
            'action' => 'admin.audit_report.generated',
            'method' => 'POST',
            'route' => 'api/admin/audit-logs/report',
            'request_url' => $request->url(),
            'status_code' => 200,
            'database_action' => 'INSERT',
            'entity_type' => 'AuditReport',
            'description' => 'Generated a print-ready audit report containing '.$recordCount.' matching records.',
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
            'metadata' => [
                'generated_at' => $generatedAt->toISOString(),
                'record_count' => $recordCount,
                'filters' => $filters,
                'excluded_report_actions' => true,
                'signature_verified' => false,
            ],
        ]);

        return response()->json([
            'generated_at' => $generatedAt->toISOString(),
            'record_count' => $recordCount,
            'excluded_report_actions' => true,
            'audit_logs' => $reportRows,
        ]);
    }

    public function recordAdminExport(Request $request): JsonResponse
    {
        $this->admin($request);
        $data = $request->validate([
            'report_type' => ['required', 'string', Rule::in(['analytics', 'sales', 'transactions', 'users', 'sellers', 'buyers', 'riders', 'listings', 'categories', 'deliveries', 'complaints'])],
            'record_count' => ['required', 'integer', 'min:0'],
            'filters' => ['required', 'array'],
        ]);
        $generatedAt = now();
        AuditLog::create([
            'user_id' => $request->user()->id,
            'action' => 'admin.report.exported',
            'method' => 'POST',
            'route' => 'api/admin/reports/export-audit',
            'request_url' => $request->url(),
            'status_code' => 200,
            'database_action' => 'INSERT',
            'entity_type' => 'ReportExport',
            'description' => 'Exported the '.$data['report_type'].' report containing '.$data['record_count'].' records.',
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
            'metadata' => [
                'generated_at' => $generatedAt->toISOString(),
                'report_type' => $data['report_type'],
                'record_count' => $data['record_count'],
                'filters' => $data['filters'],
            ],
        ]);

        return response()->json(['generated_at' => $generatedAt->toISOString()]);
    }

    private function admin(Request $request): void
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
    }
}
