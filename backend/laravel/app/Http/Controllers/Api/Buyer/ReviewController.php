<?php

namespace App\Http\Controllers\Api\Buyer;

use App\Enums\OrderStatus;
use App\Enums\ReviewStatus;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\Review;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ReviewController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $reviews = Review::query()
            ->with(['seller:id,name', 'order:id,order_reference'])
            ->where('buyer_id', $request->user()->id)
            ->latest()
            ->get();

        return response()->json(['reviews' => $reviews]);
    }

    public function store(Request $request, Order $order): JsonResponse
    {
        abort_unless($request->user()?->role === Role::BUYER && $order->buyer_id === $request->user()->id, 403);
        abort_unless($order->status === OrderStatus::COMPLETED, 422, 'Only completed orders can be reviewed.');
        abort_if(Review::query()->where('order_id', $order->id)->where('buyer_id', $request->user()->id)->exists(), 422, 'This order has already been reviewed.');

        $data = $request->validate([
            'rating' => ['required', 'integer', 'min:1', 'max:5'],
            'comment' => ['nullable', 'string', 'max:2000'],
        ]);
        $data['order_id'] = $order->id;
        $data['buyer_id'] = $request->user()->id;
        $data['seller_id'] = $order->seller_id;
        $data['status'] = ReviewStatus::PUBLISHED;

        return response()->json(['review' => Review::create($data)], 201);
    }
}
