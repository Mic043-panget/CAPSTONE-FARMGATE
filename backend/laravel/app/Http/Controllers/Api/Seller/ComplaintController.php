<?php

namespace App\Http\Controllers\Api\Seller;

use App\Enums\ComplaintStatus;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\Complaint;
use App\Services\OrderCaseWorkflowService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ComplaintController extends Controller
{
    public function index(Request $request, OrderCaseWorkflowService $workflow): JsonResponse
    {
        abort_unless($request->user()?->role === Role::SELLER, 403);

        $validated = $request->validate([
            'search' => ['sometimes', 'nullable', 'string', 'max:120'],
        ]);
        $query = Complaint::query()->with([
            'order:id,order_reference,status,total_amount',
            'opener:id,name,email',
            'statusHistory',
            'messages.sender:id,name,role',
            'messages.media',
            'media',
        ])->where('respondent_id', $request->user()->id);
        $actionRequiredTotal = (clone $query)->where('status', ComplaintStatus::OPEN->value)->count();
        if (filled($validated['search'] ?? null)) {
            $search = '%'.trim($validated['search']).'%';
            $typeSearch = mb_strtolower(preg_replace('/[^a-z]/i', '', trim($validated['search'])));
            $query->where(function ($builder) use ($search, $typeSearch): void {
                $builder->where('case_reference', 'like', $search)
                    ->orWhere('case_type', 'like', $search)
                    ->orWhere('reason', 'like', $search)
                    ->orWhere('other_reason', 'like', $search)
                    ->orWhere('description', 'like', $search)
                    ->orWhereHas('order', fn ($order) => $order->where('order_reference', 'like', $search))
                    ->orWhereHas('opener', fn ($buyer) => $buyer->where('name', 'like', $search));
                if ($typeSearch === 'returnrefund') {
                    $builder->orWhere('case_type', 'RETURN_REFUND');
                }
            });
        }

        $complaints = $query->latest()->paginate(15)->withQueryString();
        $complaints->getCollection()->each(function (Complaint $case) use ($workflow): void {
            $case->setAttribute('evidence_media', $workflow->mediaPayload($case->media));
            $workflow->attachPayoutEvidenceUrl($case);
            foreach ($case->messages as $message) {
                $message->setAttribute('media_files', $workflow->mediaPayload($message->media));
                $message->makeHidden('media');
            }
            $case->makeHidden(['media', 'evidence']);
        });

        return response()->json([
            'action_required_total' => $actionRequiredTotal,
            'complaints' => $complaints,
        ]);
    }
}
