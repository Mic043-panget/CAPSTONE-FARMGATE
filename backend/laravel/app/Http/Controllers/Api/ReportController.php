<?php

namespace App\Http\Controllers\Api;

use App\Enums\DeliveryStatus;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\Delivery;
use App\Models\Order;
use App\Services\ReportQueryService;
use App\Services\SystemSettingsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class ReportController extends Controller
{
    public function index(Request $request, string $type, ReportQueryService $reports, SystemSettingsService $settings): JsonResponse
    {
        $filters = $request->validate([
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:from'],
            'search' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', 'string', 'max:40'],
            'order_status' => ['nullable', 'string', 'in:PENDING_CONFIRMATION,CONFIRMED,PREPARING,READY_FOR_PICKUP,FULFILLING,COMPLETED,CANCELLED,REJECTED'],
            'payment_status' => ['nullable', 'string', 'in:PENDING,PAID,UNPAID,FAILED'],
            'payment_method' => ['nullable', 'string', 'in:COD,GCASH,CARD,GOOGLE_PAY'],
            'role' => ['nullable', 'string', 'in:ADMIN,SELLER,BUYER,RIDER'],
            'account_status' => ['nullable', 'string', 'in:VERIFIED,UNVERIFIED'],
            'complaint_type' => ['nullable', 'string', 'max:120'],
            'resolution_status' => ['nullable', 'string', 'in:RESOLVED,UNRESOLVED'],
            'amount_min' => ['nullable', 'numeric', 'min:0', 'max:9999999999.99'],
            'amount_max' => ['nullable', 'numeric', 'min:0', 'max:9999999999.99'],
            'sort' => ['nullable', 'string', 'max:30'],
            'direction' => ['nullable', 'in:asc,desc'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);
        if (isset($filters['amount_min'], $filters['amount_max']) && (float) $filters['amount_min'] > (float) $filters['amount_max']) {
            throw ValidationException::withMessages(['amount_max' => 'The maximum amount must be at least the minimum amount.']);
        }

        $user = $request->user();
        if ($type === 'deliveries' && $user?->role === Role::RIDER && isset($filters['status'])) {
            $deliveryStatuses = array_map(fn (DeliveryStatus $status): string => $status->value, DeliveryStatus::cases());
            if (! in_array($filters['status'], $deliveryStatuses, true)) {
                throw ValidationException::withMessages(['status' => 'Choose a valid delivery status.']);
            }
        }
        $query = $reports->queryFor($type, $user);
        $timezone = $settings->getString('timezone');
        $reports->applyFilters($query, $type, $filters, $timezone);

        $allowedSorts = $this->allowedSorts($type);
        $sort = in_array($filters['sort'] ?? '', $allowedSorts, true) ? $filters['sort'] : 'created_at';
        $direction = $filters['direction'] ?? 'desc';
        if ($type === 'deliveries' && $sort === 'order_reference') {
            $query->orderBy(
                Order::query()->select('order_reference')->whereColumn('orders.id', 'deliveries.order_id'),
                $direction,
            );
        } else {
            $query->orderBy($sort, $direction);
        }
        $proofSummary = $type === 'deliveries' ? [
            'with_proof' => (clone $query)->whereNotNull('delivery_proof_path')->count(),
            'delivered_without_proof' => (clone $query)
                ->where('status', DeliveryStatus::DELIVERED->value)
                ->whereNull('delivery_proof_path')
                ->count(),
        ] : null;
        $report = $query->paginate($filters['per_page'] ?? 15)->withQueryString();

        if ($type === 'deliveries' && $user?->role === Role::RIDER) {
            $report->getCollection()->transform(function (Delivery $delivery): array {
                $address = $delivery->order?->shipping_address ?? [];
                $dropoffArea = collect([
                    $address['barangay'] ?? null,
                    $address['city_municipality'] ?? null,
                    $address['province'] ?? null,
                ])->filter(fn ($part): bool => is_string($part) && trim($part) !== '')
                    ->implode(', ');

                return [
                    'id' => $delivery->id,
                    'delivery_reference' => $delivery->delivery_reference,
                    'order_reference' => $delivery->order?->order_reference,
                    'status' => $delivery->status->value,
                    'pickup_area' => 'Bongabong, Oriental Mindoro',
                    'dropoff_area' => $dropoffArea !== '' ? $dropoffArea : 'Area details unavailable',
                    'assigned_at' => $delivery->assigned_at?->toISOString(),
                    'pickup_verified_at' => $delivery->pickup_verified_at?->toISOString(),
                    'delivery_verified_at' => $delivery->delivery_verified_at?->toISOString(),
                    'has_delivery_proof' => $delivery->has_delivery_proof,
                    'recipient_confirmed' => $delivery->recipient_confirmed,
                    'proof_captured_at' => $delivery->proof_captured_at?->toISOString(),
                    'proof_recorded_at' => $delivery->proof_recorded_at?->toISOString(),
                    'created_at' => $delivery->created_at?->toISOString(),
                ];
            });
        }

        return response()->json([
            'report' => $type,
            'filters' => $filters,
            'timezone' => $timezone,
            'summary' => ['total' => $report->total()],
            'proof_summary' => $proofSummary,
            'data' => $report,
        ]);
    }

    private function allowedSorts(string $type): array
    {
        return match ($type) {
            'sales', 'transactions' => ['created_at', 'total_amount', 'status'],
            'listings' => ['created_at', 'name', 'status', 'quantity'],
            'users', 'sellers', 'buyers', 'riders' => ['created_at', 'name', 'email', 'role'],
            'categories' => ['created_at', 'name', 'slug'],
            'deliveries' => ['created_at', 'status', 'assigned_at', 'pickup_verified_at', 'delivery_verified_at', 'order_reference'],
            'complaints' => ['created_at', 'status', 'reason', 'resolved_at'],
            default => ['created_at'],
        };
    }
}
