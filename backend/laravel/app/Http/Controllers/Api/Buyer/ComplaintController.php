<?php

namespace App\Http\Controllers\Api\Buyer;

use App\Enums\ComplaintStatus;
use App\Enums\OrderStatus;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\Complaint;
use App\Models\ComplaintMedia;
use App\Models\ComplaintMessage;
use App\Models\Order;
use App\Models\OrderStatusHistory;
use App\Services\OrderCaseWorkflowService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ComplaintController extends Controller
{
    public function index(Request $request, OrderCaseWorkflowService $workflow): JsonResponse
    {
        $complaints = Complaint::query()
            ->with(['order:id,order_reference,status,total_amount', 'statusHistory', 'messages', 'media'])
            ->where('opened_by', $request->user()->id)
            ->latest()
            ->get()
            ->each(function (Complaint $case) use ($workflow): void {
                $case->setAttribute('evidence_media', $workflow->mediaPayload($case->media));
                $workflow->attachPayoutEvidenceUrl($case);
                foreach ($case->messages as $message) {
                    $message->setAttribute('media_files', $workflow->mediaPayload($message->media));
                    $message->makeHidden('media');
                }
                $case->makeHidden(['media', 'evidence']);
            });

        return response()->json(['complaints' => $complaints]);
    }

    public function store(Request $request, Order $order, OrderCaseWorkflowService $workflow): JsonResponse
    {
        return $this->openCase($request, $order, 'COMPLAINT', $workflow);
    }

    public function storeReturnRequest(Request $request, Order $order, OrderCaseWorkflowService $workflow): JsonResponse
    {
        abort_unless($request->user()?->role === Role::BUYER && $order->buyer_id === $request->user()->id, 403);
        abort_unless($order->status === OrderStatus::COMPLETED, 422, 'Only completed orders can have a return or refund request.');
        $completedAt = OrderStatusHistory::query()
            ->where('order_id', $order->id)
            ->where('to_status', OrderStatus::COMPLETED->value)
            ->latest('created_at')
            ->value('created_at') ?? $order->updated_at;
        abort_if(now()->greaterThan(Carbon::parse($completedAt)->addDays(7)), 422, 'Return and refund requests must be opened within 7 days of order completion.');

        $data = $request->validate([
            'reason' => ['required', 'string', 'max:120'],
            'other_reason' => ['nullable', 'string', 'max:500', 'required_if:reason,Other'],
            'description' => ['required', 'string', 'min:5', 'max:5000'],
            'return_method' => ['required', 'in:REFUND_ONLY,RETURN_AND_REFUND'],
            'items' => ['required', 'array', 'min:1', 'max:50'],
            'items.*.order_item_id' => ['required', 'integer', 'distinct'],
            'items.*.quantity' => ['required', 'integer', 'min:1'],
            'media' => ['nullable', 'array', 'max:5'],
            'media.*' => ['file', 'mimes:jpg,jpeg,png,webp,mp4,mov,webm', 'max:20480'],
        ]);
        $order->loadMissing('items.listing');
        $items = [];
        $requestedAmount = 0.0;
        foreach ($data['items'] as $selected) {
            $item = $order->items->firstWhere('id', (int) $selected['order_item_id']);
            if (! $item || $selected['quantity'] > $item->quantity) {
                throw ValidationException::withMessages(['items' => 'Select valid quantities from livestock included in this order.']);
            }
            $lineAmount = round((float) $item->unit_price * (int) $selected['quantity'], 2);
            $requestedAmount += $lineAmount;
            $items[] = [
                'order_item_id' => $item->id,
                'listing_id' => $item->listing_id,
                'name' => $item->listing?->name ?? 'Removed listing',
                'quantity' => (int) $selected['quantity'],
                'unit_price' => (float) $item->unit_price,
                'requested_amount' => $lineAmount,
            ];
        }

        return $this->createCase($request, $order, $workflow, $data + [
            'case_type' => 'RETURN_REFUND',
            'requested_items' => $items,
            'requested_amount' => $requestedAmount,
            'refund_status' => 'REQUESTED',
        ]);
    }

    public function sendMessage(Request $request, Complaint $complaint, OrderCaseWorkflowService $workflow): JsonResponse
    {
        $this->authorizeCase($request, $complaint);
        abort_if(in_array($complaint->status, [ComplaintStatus::RESOLVED, ComplaintStatus::REJECTED], true), 409, 'This case is closed and cannot receive new messages.');
        $data = $request->validate([
            'message' => ['required', 'string', 'min:1', 'max:5000'],
            'media' => ['nullable', 'array', 'max:5'],
            'media.*' => ['file', 'mimes:jpg,jpeg,png,webp,mp4,mov,webm', 'max:20480'],
        ]);
        $files = $data['media'] ?? [];
        $storedPaths = [];
        try {
            $message = DB::transaction(function () use ($request, $complaint, $data, $files, $workflow, &$storedPaths): ComplaintMessage {
                $case = Complaint::query()->lockForUpdate()->findOrFail($complaint->id);
                $message = $case->messages()->create(['sender_id' => $request->user()->id, 'message' => $data['message']]);
                $storedPaths = $workflow->storeMedia($case, $request->user()->id, $files, $message);
                if ($request->user()->role === Role::SELLER && $case->seller_responded_at === null) {
                    $case->seller_responded_at = now();
                    if ($case->status === ComplaintStatus::OPEN) {
                        $case->status = ComplaintStatus::UNDER_REVIEW;
                    }
                    $case->save();
                    $case->statusHistory()->create([
                        'changed_by' => $request->user()->id,
                        'from_status' => ComplaintStatus::OPEN->value,
                        'to_status' => $case->status->value,
                        'reason' => 'Seller responded to the case.',
                    ]);
                }
                $workflow->activity($case, $request->user()->id, 'CASE_MESSAGE', 'A participant added a message to case '.$case->case_reference.'.');

                return $message->load(['sender:id,name', 'media']);
            });
        } catch (\Throwable $exception) {
            Storage::disk('case_media')->delete($storedPaths);
            throw $exception;
        }

        $workflow->notifyParticipants($complaint, 'A new message was added to case '.$complaint->case_reference.'.');
        $message->setAttribute('media_files', $workflow->mediaPayload($message->media));
        $message->makeHidden('media');

        return response()->json(['message' => $message], 201);
    }

    public function media(Request $request, ComplaintMedia $media, OrderCaseWorkflowService $workflow): StreamedResponse|Response
    {
        $case = $media->complaint;
        $this->authorizeCase($request, $case);

        return $workflow->streamPath($media->path, $media->mime_type);
    }

    private function openCase(Request $request, Order $order, string $caseType, OrderCaseWorkflowService $workflow): JsonResponse
    {
        abort_unless($request->user()?->role === Role::BUYER && $order->buyer_id === $request->user()->id, 403);
        abort_unless($order->status === OrderStatus::COMPLETED, 422, 'Only completed orders can have a complaint.');
        $data = $request->validate([
            'reason' => ['required', 'string', 'max:120'],
            'other_reason' => ['nullable', 'string', 'max:500', 'required_if:reason,Other'],
            'description' => ['required', 'string', 'min:5', 'max:5000'],
            'evidence' => ['nullable', 'string', 'max:5000'],
            'media' => ['nullable', 'array', 'max:5'],
            'media.*' => ['file', 'mimes:jpg,jpeg,png,webp,mp4,mov,webm', 'max:20480'],
        ]);

        return $this->createCase($request, $order, $workflow, $data + ['case_type' => $caseType]);
    }

    private function createCase(Request $request, Order $order, OrderCaseWorkflowService $workflow, array $data): JsonResponse
    {
        $files = $data['media'] ?? [];
        unset($data['media'], $data['items']);
        $storedPaths = [];
        try {
            $case = DB::transaction(function () use ($request, $order, $workflow, $data, $files, &$storedPaths): Complaint {
                $case = Complaint::create($data + [
                    'order_id' => $order->id,
                    'opened_by' => $request->user()->id,
                    'respondent_id' => $order->seller_id,
                    'status' => ComplaintStatus::OPEN,
                    'seller_response_deadline' => now()->startOfDay()->addDays(3)->endOfDay(),
                ]);
                $storedPaths = $workflow->storeMedia($case, $request->user()->id, $files);
                $case->statusHistory()->create([
                    'changed_by' => $request->user()->id,
                    'to_status' => ComplaintStatus::OPEN->value,
                    'reason' => $case->case_type === 'RETURN_REFUND' ? 'Return/refund request opened; admin decision required.' : 'Complaint opened.',
                ]);
                $workflow->activity(
                    $case,
                    $request->user()->id,
                    $case->case_type === 'RETURN_REFUND' ? 'RETURN_REQUESTED' : 'COMPLAINT_OPENED',
                    ($case->case_type === 'RETURN_REFUND' ? 'Return/refund request' : 'Complaint').' opened as case '.$case->case_reference.'.',
                );

                return $case->load(['order:id,order_reference,status,total_amount', 'statusHistory', 'media']);
            });
        } catch (\Throwable $exception) {
            Storage::disk('case_media')->delete($storedPaths);
            throw $exception;
        }
        $case->setAttribute('evidence_media', $workflow->mediaPayload($case->media));
        $workflow->attachPayoutEvidenceUrl($case);
        $case->makeHidden(['media', 'evidence']);
        $workflow->notifyParticipants($case, ($case->case_type === 'RETURN_REFUND' ? 'A return/refund request was opened' : 'A complaint was opened').' as case '.$case->case_reference.' and requires admin review.');

        return response()->json(['complaint' => $case], 201);
    }

    private function authorizeCase(Request $request, Complaint $case): void
    {
        $user = $request->user();
        abort_unless($user && (
            $user->role === Role::ADMIN
            || $case->opened_by === $user->id
            || $case->respondent_id === $user->id && $user->role === Role::SELLER
        ), 403);
    }
}
