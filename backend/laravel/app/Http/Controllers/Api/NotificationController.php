<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\NotificationDelivery;
use App\Models\OrderStatusEmailDelivery;
use App\Models\User;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Notifications\DatabaseNotification;

class NotificationController extends Controller
{
    private const CRITICAL_NOTIFICATION_TYPES = [
        'order_status_changed',
        'order_rider_assigned',
        'order_delivery_status_changed',
        'order_update_requested',
        'order_case_updated',
        'rider_offer_available',
        'rider_assignment_waiting',
        'rider_assignment_confirmed',
        'delivery_proof_recorded',
    ];

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $notifications = $request->user()
            ->notifications()
            ->latest()
            ->limit(100)
            ->get(['id', 'type', 'data', 'read_at', 'created_at']);
        $deliveryStatuses = NotificationDelivery::query()
            ->where('notifiable_type', $user->getMorphClass())
            ->where('notifiable_id', $user->getKey())
            ->whereIn('notification_id', $notifications->pluck('id'))
            ->get(['notification_id', 'channel', 'status', 'attempts', 'delivered_at'])
            ->groupBy('notification_id');
        $notifications->each(function (DatabaseNotification $notification) use ($deliveryStatuses): void {
            $statuses = $deliveryStatuses->get($notification->id, collect())
                ->map(fn (NotificationDelivery $delivery): array => [
                    'channel' => $delivery->channel,
                    'status' => $delivery->status,
                    'attempts' => $delivery->attempts,
                    'delivered_at' => $delivery->delivered_at?->toISOString(),
                ]);
            $data = $notification->data;
            if (($data['type'] ?? null) === 'order_status_changed') {
                $managedEmail = $statuses->first(fn (array $status): bool => $status['channel'] === 'email' && $status['status'] === 'managed');
                if ($managedEmail !== null && isset($data['order_id'], $data['status'])) {
                    $emailDelivery = OrderStatusEmailDelivery::query()
                        ->where('order_id', $data['order_id'])
                        ->where('recipient_id', $notification->notifiable_id)
                        ->where('order_status', $data['status'])
                        ->latest('id')
                        ->first(['delivery_status', 'attempts', 'sent_at']);
                    if ($emailDelivery !== null) {
                        $managedEmail['status'] = match ($emailDelivery->delivery_status) {
                            'SENT' => 'delivered',
                            'QUEUED' => 'queued',
                            'FAILED' => 'failed',
                            default => 'managed',
                        };
                        $managedEmail['attempts'] = $emailDelivery->attempts;
                        $managedEmail['delivered_at'] = $emailDelivery->sent_at?->toISOString();
                        $statuses = $statuses->map(fn (array $status): array => $status['channel'] === 'email' ? $managedEmail : $status);
                    }
                }
            }
            $notification->setAttribute(
                'delivery_statuses',
                $statuses->values(),
            );
            $notification->setAttribute('is_critical', $this->isCritical($notification->data));
        });
        return response()->json([
            'notifications' => $notifications,
            'preferences' => [
                'order_notifications' => $user->accountPreferenceEnabled('order_notifications'),
                'chat_notifications' => $user->accountPreferenceEnabled('chat_notifications'),
                'event_notifications' => $user->accountPreferenceEnabled('event_notifications'),
            ],
            ...$this->unreadCounts($user),
        ]);
    }

    public function markAllAsRead(Request $request): JsonResponse
    {
        $user = $request->user();
        $informational = $this->informationalNotifications(
            $user->unreadNotifications()
                ->where(fn ($query) => $query->whereNull('data->type')->orWhere('data->type', '!=', 'chat_message')),
        );
        $markedIds = (clone $informational)->pluck('id')->all();
        $markedCount = $informational->update(['read_at' => now()]);

        return response()->json([
            'message' => $markedCount > 0 ? 'Informational notifications marked as read.' : 'There are no unread informational notifications to mark as read.',
            'marked_count' => $markedCount,
            'marked_ids' => $markedIds,
            ...$this->unreadCounts($user),
        ]);
    }

    public function markAsRead(Request $request, string $notificationId): JsonResponse
    {
        $data = $request->validate([
            'target_available' => ['nullable', 'boolean'],
            'target_type' => ['nullable', 'string', 'in:order,case,review,listing,application,vehicle_change,delivery,event,promotion,conversation,audit'],
            'target_id' => ['nullable', 'string', 'max:100'],
        ]);
        $notification = $request->user()->notifications()->whereKey($notificationId)->first();
        if (! $notification instanceof DatabaseNotification) {
            throw (new ModelNotFoundException)->setModel(DatabaseNotification::class, [$notificationId]);
        }

        if ($notification->read_at === null && ($notification->data['type'] ?? null) !== 'chat_message') {
            $notification->markAsRead();
        }
        if (($data['target_available'] ?? true) === false) {
            AuditLog::create([
                'user_id' => $request->user()->id,
                'action' => 'notification.target.unavailable',
                'method' => 'POST',
                'route' => 'api/notifications/{notificationId}/read',
                'request_url' => $request->url(),
                'status_code' => 404,
                'database_action' => 'NONE',
                'entity_type' => $data['target_type'] ?? 'NotificationTarget',
                'entity_id' => $data['target_id'] ?? $notificationId,
                'description' => 'The related item link was unavailable from the current notification view.',
                'ip_address' => $request->ip(),
                'user_agent' => $request->userAgent(),
                'metadata' => ['notification_id' => $notificationId, 'target_available' => false],
            ]);
        }

        return response()->json([
            'notification' => $notification->fresh(),
            ...$this->unreadCounts($request->user()),
        ]);
    }

    /**
     * @return array{unread_count: int, bulk_read_count: int, critical_unread_count: int, unread_chat_count: int}
     */
    private function unreadCounts(User $user): array
    {
        $unreadNotifications = $user->unreadNotifications();
        $unreadNonChat = fn () => (clone $unreadNotifications)
            ->where(fn ($query) => $query->whereNull('data->type')->orWhere('data->type', '!=', 'chat_message'));

        return [
            'unread_count' => $unreadNonChat()->count(),
            'bulk_read_count' => $this->informationalNotifications(clone $unreadNonChat())->count(),
            'critical_unread_count' => $this->criticalNotifications(clone $unreadNonChat())->count(),
            'unread_chat_count' => (clone $unreadNotifications)->where('data->type', 'chat_message')->count(),
        ];
    }

    private function isCritical(array $data): bool
    {
        $type = strtolower((string) ($data['type'] ?? ''));

        return ($data['critical'] ?? false) === true
            || ($data['attention_required'] ?? false) === true
            || in_array($type, self::CRITICAL_NOTIFICATION_TYPES, true)
            || str_contains($type, 'payment')
            || str_contains($type, 'security')
            || str_contains($type, 'safety');
    }

    private function criticalNotifications($query)
    {
        return $query->where(function ($critical) {
            $critical->where('data->critical', true)
                ->orWhere('data->attention_required', true)
                ->orWhereIn('data->type', self::CRITICAL_NOTIFICATION_TYPES)
                ->orWhere('data->type', 'like', '%payment%')
                ->orWhere('data->type', 'like', '%security%')
                ->orWhere('data->type', 'like', '%safety%');
        });
    }

    private function informationalNotifications($query)
    {
        return $query->where(function ($informational) {
            $informational->where(function ($flags) {
                $flags->whereNull('data->critical')->orWhere('data->critical', false);
            })->where(function ($attention) {
                $attention->whereNull('data->attention_required')->orWhere('data->attention_required', false);
            })->where(function ($types) {
                $types->whereNull('data->type')
                    ->orWhere(function ($nonCriticalType) {
                        $nonCriticalType->whereNotIn('data->type', self::CRITICAL_NOTIFICATION_TYPES)
                            ->where('data->type', 'not like', '%payment%')
                            ->where('data->type', 'not like', '%security%')
                            ->where('data->type', 'not like', '%safety%');
                    });
            });
        });
    }
}
