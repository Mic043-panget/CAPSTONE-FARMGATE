<?php

namespace App\Http\Controllers\Api\Admin;

use App\Enums\ComplaintStatus;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\Complaint;
use App\Models\Order;
use App\Services\OrderCaseWorkflowService;
use App\Services\PayMongoRefundService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ComplaintController extends Controller
{
    public function index(Request $request, OrderCaseWorkflowService $workflow): JsonResponse
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);

        $query = Complaint::query()->with([
            'order:id,order_reference,status,total_amount,delivery_fee,payment_method,payment_status',
            'order.items:id,order_id,listing_id,quantity,total_amount',
            'order.items.listing:id,name',
            'opener:id,name,email',
            'respondent:id,name,email',
            'statusHistory',
            'messages.sender:id,name,role',
            'media',
        ]);
        if ($request->filled('search')) {
            $searchText = trim((string) $request->input('search'));
            $search = '%'.$searchText.'%';
            $query->where(function ($builder) use ($search, $searchText): void {
                $builder->where('reason', 'like', $search)
                    ->orWhere('case_reference', 'like', $search)
                    ->orWhere('description', 'like', $search)
                    ->orWhere('status', 'like', $search)
                    ->orWhereHas('order', fn ($order) => $order->where('order_reference', 'like', $search))
                    ->orWhereHas('opener', fn ($opener) => $opener->where('name', 'like', $search)->orWhere('email', 'like', $search))
                    ->orWhereHas('respondent', fn ($respondent) => $respondent->where('name', 'like', $search)->orWhere('email', 'like', $search));
                if (ctype_digit($searchText)) {
                    $builder->orWhereKey((int) $searchText);
                }
            });
        }
        if ($request->filled('status')) {
            $query->where('status', $request->input('status'));
        }
        if ($request->filled('case_type')) {
            $query->where('case_type', $request->input('case_type'));
        }
        if ($request->filled('case_id')) {
            $data = $request->validate(['case_id' => ['integer', 'min:1']]);
            $query->whereKey($data['case_id']);
        }

        $sort = $request->validate(['sort' => ['nullable', 'in:newest,oldest']])['sort'] ?? 'newest';
        $direction = $sort === 'oldest' ? 'asc' : 'desc';
        $cases = $query->orderBy('created_at', $direction)->orderBy('id', $direction)->paginate(15)->withQueryString();
        $cases->getCollection()->each(function (Complaint $case) use ($workflow): void {
            $case->setAttribute('evidence_media', $workflow->mediaPayload($case->media));
            $workflow->attachPayoutEvidenceUrl($case);
            $case->setAttribute('has_provider_refund', filled($case->paymongo_refund_id));
            foreach ($case->messages as $message) {
                $message->setAttribute('media_files', $workflow->mediaPayload($message->media));
                $message->makeHidden('media');
            }
            $case->makeHidden(['media', 'evidence']);
        });

        return response()->json(['complaints' => $cases]);
    }

    public function update(Request $request, Complaint $complaint, OrderCaseWorkflowService $workflow): JsonResponse
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
        $data = $request->validate([
            'status' => ['required', 'string', 'in:OPEN,UNDER_REVIEW,RESOLVED,REJECTED'],
            'reason' => ['required', 'string', 'min:3', 'max:2000'],
        ]);
        $status = ComplaintStatus::from($data['status']);

        $updated = DB::transaction(function () use ($complaint, $request, $status, $data, $workflow): Complaint {
            $locked = Complaint::query()->lockForUpdate()->findOrFail($complaint->id);
            abort_if($locked->status === $status, 422, 'The case already has this status.');
            if ($locked->case_type === 'RETURN_REFUND') {
                abort_if($status === ComplaintStatus::RESOLVED && $locked->refund_status !== 'PAID', 409, 'A return/refund case can only be resolved after payment is confirmed.');
                abort_if($status === ComplaintStatus::REJECTED && ! in_array($locked->refund_status, ['REQUESTED', 'NOT_APPLICABLE', 'FAILED'], true), 409, 'An approved or submitted refund cannot be rejected from the case status control.');
            }

            $from = $locked->status->value;
            $locked->update([
                'status' => $status,
                'refund_status' => $status === ComplaintStatus::REJECTED && $locked->case_type === 'RETURN_REFUND' ? 'REJECTED' : $locked->refund_status,
                'resolution_reason' => in_array($status, [ComplaintStatus::RESOLVED, ComplaintStatus::REJECTED], true) ? $data['reason'] : $locked->resolution_reason,
                'resolved_by' => in_array($status, [ComplaintStatus::RESOLVED, ComplaintStatus::REJECTED], true) ? $request->user()->id : null,
                'resolved_at' => in_array($status, [ComplaintStatus::RESOLVED, ComplaintStatus::REJECTED], true) ? now() : null,
            ]);
            $locked->statusHistory()->create(['changed_by' => $request->user()->id, 'from_status' => $from, 'to_status' => $status->value, 'reason' => $data['reason']]);
            $workflow->activity($locked, $request->user()->id, 'CASE_STATUS_CHANGED', 'Admin changed case '.$locked->case_reference.' to '.$status->value.': '.$data['reason']);

            return $locked->fresh(['statusHistory', 'order']);
        });
        $workflow->notifyParticipants($updated, 'Case '.$updated->case_reference.' was updated to '.$status->value.'.');

        return response()->json(['complaint' => $updated]);
    }

    public function approveRefund(Request $request, Complaint $complaint, PayMongoRefundService $refunds, OrderCaseWorkflowService $workflow): JsonResponse
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
        $data = $request->validate(['amount' => ['required', 'numeric', 'gt:0', 'max:9999999999']]);
        $order = $complaint->order;

        if ($order->payment_method === 'COD') {
            $updated = DB::transaction(function () use ($complaint, $request, $data, $workflow): Complaint {
                $lockedOrder = Order::query()->lockForUpdate()->findOrFail($complaint->order_id);
                $locked = Complaint::query()->lockForUpdate()->findOrFail($complaint->id);
                abort_unless($locked->case_type === 'RETURN_REFUND' && $locked->refund_status === 'REQUESTED', 409, 'This refund request has already been processed.');
                abort_if((float) $data['amount'] > (float) $lockedOrder->total_amount, 422, 'The approved amount cannot exceed the order total.');
                $from = $locked->status->value;
                $locked->forceFill([
                    'approved_by' => $request->user()->id,
                    'approved_refund_amount' => number_format((float) $data['amount'], 2, '.', ''),
                    'refund_approved_at' => now(),
                    'refund_status' => $locked->return_method === 'RETURN_AND_REFUND' ? 'AWAITING_RETURN' : 'MANUAL_ACTION_REQUIRED',
                    'status' => ComplaintStatus::UNDER_REVIEW,
                ])->save();
                $locked->statusHistory()->create([
                    'changed_by' => $request->user()->id,
                    'from_status' => $from,
                    'to_status' => ComplaintStatus::UNDER_REVIEW->value,
                    'reason' => 'Admin approved the COD reimbursement for manual payout.',
                ]);
                $workflow->activity($locked, $request->user()->id, 'COD_REIMBURSEMENT_APPROVED', 'Admin approved a PHP '.number_format((float) $data['amount'], 2).' manual COD reimbursement.');

                return $locked->fresh(['order']);
            });
            $workflow->notifyParticipants($updated, $updated->refund_status === 'AWAITING_RETURN'
                ? 'Admin approved the return/refund request. The manual COD reimbursement will follow after the return is received.'
                : 'Admin approved a COD reimbursement; it will be recorded after the manual payout is made.');

            return response()->json(['complaint' => $updated]);
        }

        $updated = $refunds->approve($complaint, $request->user()->id, (float) $data['amount']);

        return response()->json(['complaint' => $updated]);
    }

    public function markReturnReceived(Request $request, Complaint $complaint, PayMongoRefundService $refunds): JsonResponse
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);

        return response()->json(['complaint' => $refunds->markReturnReceived($complaint, $request->user()->id)]);
    }

    public function recordManualPayout(Request $request, Complaint $complaint, PayMongoRefundService $refunds): JsonResponse
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
        $data = $request->validate([
            'payout_reference' => ['nullable', 'string', 'max:255', 'required_without:evidence'],
            'evidence' => ['nullable', 'file', 'mimes:jpg,jpeg,png,webp,pdf', 'max:10240', 'required_without:payout_reference'],
        ]);

        $path = null;
        if ($request->hasFile('evidence')) {
            $path = $request->file('evidence')->store("cases/{$complaint->id}/payouts", 'case_media');
            if (! is_string($path) || $path === '') {
                throw new \RuntimeException('COD payout evidence storage failed.');
            }
        }

        try {
            $updated = $refunds->recordManualPayout($complaint, $request->user()->id, (string) ($data['payout_reference'] ?? 'Evidence attached'), $path);
        } catch (\Throwable $exception) {
            if ($path !== null) {
                Storage::disk('case_media')->delete($path);
            }
            throw $exception;
        }

        return response()->json(['complaint' => $updated]);
    }

    public function syncRefund(Request $request, Complaint $complaint, PayMongoRefundService $refunds): JsonResponse
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
        $data = $request->validate(['paymongo_refund_id' => ['nullable', 'string', 'max:120']]);

        return response()->json(['complaint' => $refunds->sync($complaint, $data['paymongo_refund_id'] ?? null)]);
    }

    public function payoutEvidence(Request $request, Complaint $complaint, OrderCaseWorkflowService $workflow): StreamedResponse|Response
    {
        $user = $request->user();
        abort_unless($user && (
            $user->role === Role::ADMIN
            || $complaint->opened_by === $user->id
            || $complaint->respondent_id === $user->id && $user->role === Role::SELLER
        ), 403);
        abort_unless(filled($complaint->payout_evidence_path), 404);
        $disk = Storage::disk('case_media');
        $stream = $disk->readStream($complaint->payout_evidence_path);
        if (! is_resource($stream)) {
            throw new \RuntimeException('The saved payout evidence could not be opened.');
        }
        try {
            $mime = (new \finfo(FILEINFO_MIME_TYPE))->buffer((string) fread($stream, 8192)) ?: 'application/octet-stream';
        } finally {
            fclose($stream);
        }

        return $workflow->streamPath($complaint->payout_evidence_path, $mime);
    }
}
