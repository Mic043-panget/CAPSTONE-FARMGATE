<?php

namespace App\Http\Controllers\Api\Admin;

use App\Enums\ComplaintStatus;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\Complaint;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ComplaintController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);

        $query = Complaint::query()->with(['order:id,status,total_amount', 'opener:id,name,email', 'respondent:id,name,email', 'statusHistory']);
        if ($request->filled('search')) {
            $search = '%'.trim((string) $request->input('search')).'%';
            $query->where(function ($builder) use ($search): void {
                $builder->where('reason', 'like', $search)->orWhere('description', 'like', $search)->orWhere('status', 'like', $search);
            });
        }

        if ($request->filled('status')) {
            $query->where('status', $request->input('status'));
        }

        return response()->json(['complaints' => $query->latest()->paginate(15)->withQueryString()]);
    }

    public function update(Request $request, Complaint $complaint): JsonResponse
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
        $data = $request->validate([
            'status' => ['required', 'string', 'in:OPEN,UNDER_REVIEW,RESOLVED,REJECTED'],
            'reason' => ['required', 'string', 'min:3', 'max:2000'],
        ]);
        $status = ComplaintStatus::from($data['status']);
        abort_if($complaint->status === $status, 422, 'The complaint already has this status.');

        $updated = DB::transaction(function () use ($complaint, $request, $status, $data): Complaint {
            $from = $complaint->status?->value;
            $complaint->update([
                'status' => $status,
                'resolution_reason' => in_array($status, [ComplaintStatus::RESOLVED, ComplaintStatus::REJECTED], true) ? $data['reason'] : $complaint->resolution_reason,
                'resolved_by' => in_array($status, [ComplaintStatus::RESOLVED, ComplaintStatus::REJECTED], true) ? $request->user()->id : null,
                'resolved_at' => in_array($status, [ComplaintStatus::RESOLVED, ComplaintStatus::REJECTED], true) ? now() : null,
            ]);
            $complaint->statusHistory()->create(['changed_by' => $request->user()->id, 'from_status' => $from, 'to_status' => $status->value, 'reason' => $data['reason']]);

            return $complaint->fresh(['statusHistory']);
        });

        return response()->json(['complaint' => $updated]);
    }
}
