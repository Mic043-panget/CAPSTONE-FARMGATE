<?php

namespace App\Services;

use App\Enums\Role;
use App\Models\Complaint;
use App\Models\ComplaintMedia;
use App\Models\ComplaintMessage;
use App\Models\OrderActivity;
use App\Models\User;
use App\Notifications\OrderCaseUpdatedNotification;
use Illuminate\Http\Response;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class OrderCaseWorkflowService
{
    public function activity(Complaint $case, ?int $actorId, string $key, string $details): void
    {
        OrderActivity::create([
            'order_id' => $case->order_id,
            'actor_id' => $actorId,
            'activity_key' => $key,
            'details' => $details,
        ]);
    }

    public function notifyParticipants(Complaint $case, string $message): void
    {
        $recipients = User::query()
            ->whereIn('id', [$case->opened_by, $case->respondent_id])
            ->orWhere('role', Role::ADMIN->value)
            ->get()
            ->unique('id');
        $order = $case->order;
        $notification = new OrderCaseUpdatedNotification(
            $case->id,
            $case->case_reference,
            $case->order_id,
            $order->order_reference,
            $case->case_type,
            $message,
        );

        foreach ($recipients as $recipient) {
            $recipient->notify($notification);
        }
    }

    /**
     * @param  array<int, UploadedFile>  $files
     * @return array<int, string>
     */
    public function storeMedia(Complaint $case, int $userId, array $files, ?ComplaintMessage $message = null): array
    {
        $storedPaths = [];
        foreach ($files as $file) {
            $path = $file->store("cases/{$case->id}", 'case_media');
            if (! is_string($path) || $path === '') {
                throw new \RuntimeException('Case evidence storage failed.');
            }
            $storedPaths[] = $path;
            ComplaintMedia::create([
                'complaint_id' => $case->id,
                'complaint_message_id' => $message?->id,
                'uploaded_by' => $userId,
                'path' => $path,
                'mime_type' => $file->getMimeType() ?: 'application/octet-stream',
                'original_name' => mb_substr($file->getClientOriginalName(), 0, 255),
                'size' => $file->getSize(),
            ]);
        }

        return $storedPaths;
    }

    /**
     * @param  Collection<int, ComplaintMedia>  $media
     * @return array<int, array<string, int|string>>
     */
    public function mediaPayload(Collection $media): array
    {
        return $media->map(fn (ComplaintMedia $item): array => [
            'id' => $item->id,
            'mime_type' => $item->mime_type,
            'original_name' => $item->original_name,
            'url' => route('case-media.show', ['media' => $item->id]),
        ])->all();
    }

    public function attachPayoutEvidenceUrl(Complaint $case): void
    {
        if (filled($case->payout_evidence_path)) {
            $case->setAttribute('payout_evidence_url', route('case-payout-evidence.show', ['complaint' => $case->id]));
        }
    }

    public function streamPath(string $path, string $mimeType): StreamedResponse|Response
    {
        $disk = Storage::disk('case_media');
        abort_unless($disk->exists($path), 404, 'The saved case evidence could not be found.');

        return response()->stream(function () use ($disk, $path): void {
            $stream = $disk->readStream($path);
            if (! is_resource($stream)) {
                throw new \RuntimeException('The saved case evidence could not be opened.');
            }
            try {
                fpassthru($stream);
            } finally {
                fclose($stream);
            }
        }, 200, [
            'Content-Type' => $mimeType,
            'Content-Disposition' => 'inline; filename="case-evidence"',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
            'X-Frame-Options' => 'DENY',
        ]);
    }
}
