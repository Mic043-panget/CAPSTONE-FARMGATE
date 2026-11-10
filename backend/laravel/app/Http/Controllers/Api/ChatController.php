<?php

namespace App\Http\Controllers\Api;

use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Http\Requests\ChatMessageRequest;
use App\Http\Requests\ChatRecipientSearchRequest;
use App\Http\Requests\DirectChatMessageRequest;
use App\Http\Requests\StartDirectChatRequest;
use App\Models\ChatConversation;
use App\Models\ChatMessage;
use App\Models\Order;
use App\Models\User;
use App\Services\Chat\ChatConversationService;
use App\Services\Chat\ChatProviderException;
use App\Services\Chat\DirectChatService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ChatController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $unreadConversationIds = $request->user()->unreadNotifications()
            ->where('data->type', 'chat_message')
            ->get(['data'])
            ->map(fn ($notification): ?int => isset($notification->data['conversation_id'])
                ? (int) $notification->data['conversation_id']
                : null)
            ->filter()
            ->unique()
            ->flip();
        $conversations = ChatConversation::query()
            ->where(function (Builder $query) use ($request): void {
                $query->where(function (Builder $ai) use ($request): void {
                    $ai->where('kind', 'ai')->where('user_id', $request->user()->id);
                })->orWhere(function (Builder $direct) use ($request): void {
                    $direct->where('kind', 'direct')
                        ->where(function (Builder $participants) use ($request): void {
                            $participants->where('user_id', $request->user()->id)
                                ->orWhere('recipient_id', $request->user()->id);
                        });
                });
            })
            ->withCount('messages')
            ->latest('updated_at')
            ->paginate(20);

        return response()->json([
            ...$conversations->toArray(),
            'data' => $conversations->getCollection()->map(fn (ChatConversation $conversation): array => $this->conversationData($conversation, $request->user()) + [
                'messages_count' => $conversation->messages_count,
                'unread' => $unreadConversationIds->has($conversation->id),
            ])->all(),
        ]);
    }

    public function show(Request $request, int $conversation): JsonResponse
    {
        $data = $request->validate(['before_id' => ['nullable', 'integer', 'min:1']]);
        $ownedConversation = ChatConversation::query()
            ->where(function (Builder $query) use ($request): void {
                $query->where(function (Builder $ai) use ($request): void {
                    $ai->where('kind', 'ai')->where('user_id', $request->user()->id);
                })->orWhere(function (Builder $direct) use ($request): void {
                    $direct->where('kind', 'direct')
                        ->where(function (Builder $participants) use ($request): void {
                            $participants->where('user_id', $request->user()->id)
                                ->orWhere('recipient_id', $request->user()->id);
                        });
                });
            })
            ->findOrFail($conversation);

        $request->user()->unreadNotifications()
            ->where('data->type', 'chat_message')
            ->where('data->conversation_id', $ownedConversation->id)
            ->update(['read_at' => now()]);

        $messagesQuery = $ownedConversation->messages();
        if (isset($data['before_id'])) {
            $messagesQuery->where('id', '<', $data['before_id']);
        }
        $messages = $messagesQuery
            ->latest('id')
            ->limit(51)
            ->get()
            ->reverse()
            ->values();
        $hasMore = $messages->count() > 50;
        if ($hasMore) {
            $messages->shift();
        }

        return response()->json([
            'conversation' => $this->conversationData($ownedConversation, $request->user()),
            'messages' => $messages->map(fn (ChatMessage $message): array => $this->messageData($message, $request->user(), $ownedConversation)),
            'messages_has_more' => $hasMore,
        ]);
    }

    public function destroy(Request $request, int $conversation): JsonResponse
    {
        $ownedConversation = ChatConversation::query()
            ->where('kind', 'ai')
            ->where('user_id', $request->user()->id)
            ->findOrFail($conversation);
        $ownedConversation->delete();

        return response()->json(['message' => 'Conversation deleted.']);
    }

    public function clearReportContext(Request $request, int $conversation): JsonResponse
    {
        $ownedConversation = ChatConversation::query()
            ->where('kind', 'ai')
            ->where('user_id', $request->user()->id)
            ->findOrFail($conversation);
        $ownedConversation->report_context = null;
        $ownedConversation->save();

        return response()->json(['message' => 'Report context cleared.']);
    }

    public function send(ChatMessageRequest $request, ChatConversationService $chat): JsonResponse
    {
        $data = $request->validated();

        try {
            $result = $chat->send(
                $request->user(),
                isset($data['conversation_id']) ? (int) $data['conversation_id'] : null,
                $data['message'],
                $data['report'] ?? null,
                (bool) ($data['clear_report_context'] ?? false),
            );
        } catch (ChatProviderException) {
            return response()->json([
                'message' => 'The assistant is temporarily unavailable. Please try again later.',
            ], 503);
        }

        return response()->json([
            'conversation' => $this->conversationData($result['conversation'], $request->user()),
            'user_message' => $this->messageData($result['user_message'], $request->user(), $result['conversation']),
            'assistant_message' => $this->messageData($result['assistant_message'], $request->user(), $result['conversation']),
        ], 201);
    }

    public function recipients(ChatRecipientSearchRequest $request, DirectChatService $direct): JsonResponse
    {
        $recipients = $direct->searchRecipients($request->user(), $request->validated('search'));

        return response()->json([
            'data' => $recipients->map(fn ($recipient): array => [
                'id' => $recipient->id,
                'name' => $recipient->name,
                'role' => $recipient->role->value,
            ])->all(),
        ]);
    }

    public function startDirect(StartDirectChatRequest $request, DirectChatService $direct): JsonResponse
    {
        $data = $request->validated();
        $recipientId = (int) $data['recipient_id'];
        abort_if($recipientId === $request->user()->id, 422, 'Choose another account to start a direct conversation.');

        $conversation = $direct->start($request->user(), $recipientId, isset($data['listing_id'])
            ? (int) $data['listing_id']
            : null);

        return response()->json([
            'conversation' => $this->conversationData($conversation, $request->user()),
        ], 200);
    }

    public function sendDirect(DirectChatMessageRequest $request, int $conversation, DirectChatService $direct): JsonResponse
    {
        $result = $direct->send(
            $request->user(),
            $conversation,
            $request->validated('message'),
            $request->validated('client_message_id'),
            $request->validated('order_id') === null ? null : (int) $request->validated('order_id'),
        );

        return response()->json([
            'conversation' => $this->conversationData($result['conversation'], $request->user()),
            'message' => $this->messageData($result['message'], $request->user(), $result['conversation']),
            'ai_message' => $result['ai_message'] === null ? null : $this->messageData($result['ai_message'], $request->user(), $result['conversation']),
            'ai_status' => $result['ai_status'],
        ], $result['created'] ? 201 : 200);
    }

    public function setProductChatAiMode(Request $request, int $conversation, DirectChatService $direct): JsonResponse
    {
        $data = $request->validate(['paused' => ['required', 'boolean']]);
        $updated = $direct->setAiPaused($request->user(), $conversation, (bool) $data['paused']);

        return response()->json(['conversation' => $this->conversationData($updated, $request->user())]);
    }

    /**
     * @return array{id: int, title: ?string, report_context: ?array, created_at: string, updated_at: string}
     */
    private function conversationData(ChatConversation $conversation, User $actor): array
    {
        $data = [
            'id' => $conversation->id,
            'kind' => $conversation->kind,
            'title' => $conversation->title,
            'report_context' => $conversation->report_context,
            'needs_human_attention' => (bool) $conversation->needs_human_attention,
            'ai_paused' => (bool) $conversation->ai_paused,
            'created_at' => $conversation->created_at->toISOString(),
            'updated_at' => $conversation->updated_at->toISOString(),
        ];

        if ($conversation->kind === 'direct') {
            $peerId = (int) ($conversation->user_id === $actor->id ? $conversation->recipient_id : $conversation->user_id);
            $peer = User::query()->find($peerId);
            $data['peer'] = $peer === null ? null : [
                'id' => $peer->id,
                'name' => $peer->name,
                'role' => $peer->role instanceof Role ? $peer->role->value : (string) $peer->role,
            ];
            $listing = $conversation->listing;
            $data['listing'] = $listing === null ? null : [
                'name' => $listing->name,
                'image_url' => $listing->images()->orderBy('sort_order')->orderBy('id')->value('url'),
                'href' => '#listing/'.$listing->id,
            ];
        }

        return $data;
    }

    /**
     * @return array{id: int, role: string, sender_id: ?int, content: string, created_at: string}
     */
    private function messageData(ChatMessage $message, User $actor, ChatConversation $conversation): array
    {
        return [
            'id' => $message->id,
            'role' => $message->role,
            'sender_id' => $message->sender_id,
            'is_mine' => $message->role === 'user' || $message->sender_id === $actor->id,
            'content' => $message->content,
            'order_previews' => $this->orderPreviews($message, $actor, $conversation),
            'created_at' => $message->created_at->toISOString(),
        ];
    }

    /**
     * Return listing-only previews for references in conversations the actor can access.
     *
     * @return list<array{order_id: int, order_reference: string, item_count: int, items: list<array{name: string, quantity: int, image_url: ?string}>}>
     */
    private function orderPreviews(ChatMessage $message, User $actor, ChatConversation $conversation): array
    {
        preg_match_all(
            '/(?<![A-Z0-9])(FG-[A-Z]{2}-S\d{5,}-P\d{5,}-[23456789A-HJ-NP-Z]{16})(?![A-Z0-9-])/i',
            $message->content,
            $matches,
        );
        $references = array_values(array_unique(array_map('strtoupper', $matches[1] ?? [])));
        if ($references === []) {
            return [];
        }

        if ($conversation->kind === 'ai' && (int) $conversation->user_id !== (int) $actor->id) {
            return [];
        }
        if ($conversation->kind === 'direct'
            && ! in_array((int) $actor->id, [(int) $conversation->user_id, (int) $conversation->recipient_id], true)) {
            return [];
        }

        $orders = Order::query()
            ->whereIn('order_reference', $references)
            ->with(['items.listing' => fn (BelongsTo $listings) => $listings
                ->withTrashed()
                ->with(['images' => fn (HasMany $images) => $images->orderBy('sort_order')->orderBy('id')])])
            ->get();
        $peer = null;
        if ($conversation->kind === 'direct') {
            $peerId = (int) ($conversation->user_id === $actor->id
                ? $conversation->recipient_id
                : $conversation->user_id);
            $peer = User::query()->find($peerId);
        }

        return $orders
            ->filter(function (Order $order) use ($actor, $conversation, $peer): bool {
                if ($actor->role === Role::ADMIN) {
                    return true;
                }

                if ((int) $actor->id !== (int) $order->buyer_id && (int) $actor->id !== (int) $order->seller_id) {
                    return false;
                }
                if ($conversation->kind !== 'direct') {
                    return true;
                }
                if ($peer?->role === Role::ADMIN) {
                    return true;
                }

                return $peer !== null
                    && (int) $peer->id !== (int) $actor->id
                    && (
                        ((int) $actor->id === (int) $order->buyer_id && (int) $peer->id === (int) $order->seller_id)
                        || ((int) $actor->id === (int) $order->seller_id && (int) $peer->id === (int) $order->buyer_id)
                    );
            })
            ->map(function (Order $order): array {
                $items = $order->items->map(fn ($item): array => [
                    'name' => $item->listing?->name ?? 'Livestock listing unavailable',
                    'quantity' => (int) $item->quantity,
                    'image_url' => $item->listing?->images->first()?->url,
                ])->values();

                return [
                    'order_id' => (int) $order->id,
                    'order_reference' => $order->order_reference,
                    'item_count' => $items->count(),
                    'items' => $items->take(4)->all(),
                ];
            })
            ->values()
            ->all();
    }
}
