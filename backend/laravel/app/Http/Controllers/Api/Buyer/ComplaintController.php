<?php

namespace App\Http\Controllers\Api\Buyer;

use App\Enums\ComplaintStatus;
use App\Enums\OrderStatus;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\Complaint;
use App\Models\Order;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ComplaintController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $complaints = Complaint::query()->with(['order:id,status,total_amount', 'statusHistory'])->where('opened_by', $request->user()->id)->latest()->get();

        return response()->json(['complaints' => $complaints]);
    }

    public function store(Request $request, Order $order): JsonResponse
    {
        abort_unless($request->user()?->role === Role::BUYER && $order->buyer_id === $request->user()->id, 403);
        abort_unless($order->status === OrderStatus::COMPLETED, 422, 'Only completed orders can have a complaint.');

        $data = $request->validate([
            'reason' => ['required', 'string', 'max:120'],
            'description' => ['required', 'string', 'max:5000'],
            'evidence' => ['nullable', 'string', 'max:5000'],
        ]);
        $data += [
            'order_id' => $order->id,
            'opened_by' => $request->user()->id,
            'respondent_id' => $order->seller_id,
            'status' => ComplaintStatus::OPEN,
        ];

        $complaint = Complaint::create($data);
        $complaint->statusHistory()->create([
            'changed_by' => $request->user()->id,
            'to_status' => ComplaintStatus::OPEN->value,
            'reason' => 'Complaint opened.',
        ]);

        return response()->json(['complaint' => $complaint->load('statusHistory')], 201);
    }
}
