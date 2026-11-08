<?php

namespace App\Http\Controllers\Api\Seller;

use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\Review;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ReviewController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        abort_unless($request->user()?->role === Role::SELLER, 403);

        return response()->json(['reviews' => Review::query()->with(['buyer:id,name', 'listing:id,name', 'media:id,review_id,mime_type,original_name'])->where('seller_id', $request->user()->id)->where('status', 'PUBLISHED')->latest()->paginate(15)]);
    }
}
