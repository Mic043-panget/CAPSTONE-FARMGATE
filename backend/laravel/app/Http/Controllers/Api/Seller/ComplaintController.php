<?php

namespace App\Http\Controllers\Api\Seller;

use App\Enums\ComplaintStatus;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\Complaint;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ComplaintController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        abort_unless($request->user()?->role === Role::SELLER, 403);

        $query = Complaint::query()->with(['order:id,status,total_amount', 'opener:id,name,email', 'statusHistory'])->where('respondent_id', $request->user()->id);
        $actionRequiredTotal = (clone $query)->where('status', ComplaintStatus::OPEN->value)->count();
        if ($request->filled('search')) {
            $search = '%'.trim((string) $request->input('search')).'%';
            $query->where(function ($builder) use ($search): void {
                $builder->where('reason', 'like', $search)->orWhere('description', 'like', $search)->orWhere('status', 'like', $search);
            });
        }

        return response()->json([
            'action_required_total' => $actionRequiredTotal,
            'complaints' => $query->latest()->paginate(15)->withQueryString(),
        ]);
    }
}
