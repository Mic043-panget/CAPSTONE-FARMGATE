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
use App\Models\User;
use App\Services\Chat\ChatConversationService;
use App\Services\Chat\ChatProviderException;
use App\Services\Chat\DirectChatService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ChatController extends Controller
{
    public function index(Request $request): JsonResponse
    {
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
            ])->all(),
        ]);
    }

    public function show(Request $request, int $conversation): JsonResponse
    {
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

        $messages = $ownedConversation->messages()
            ->latest('id')
            ->limit(20)
            ->get()
            ->reverse()
            ->values();

        return response()->json([
            'conversation' => $this->conversationData($ownedConversation, $request->user()),
            'messages' => $messages->map(fn (ChatMessage $message): array => $this->messageData($message, $request->user())),
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
            'user_message' => $this->messageData($result['user_message'], $request->user()),
            'assistant_message' => $this->messageData($result['assistant_message'], $request->user()),
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
        $recipientId = (int) $request->validated('recipient_id');
        abort_if($recipientId === $request->user()->id, 422, 'Choose another account to start a direct conversation.');

        $conversation = $direct->start($request->user(), $recipientId);

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
        );

        return response()->json([
            'conversation' => $this->conversationData($result['conversation'], $request->user()),
            'message' => $this->messageData($result['message'], $request->user()),
        ], $result['created'] ? 201 : 200);
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
        }

        return $data;
    }

    /**
     * @return array{id: int, role: string, sender_id: ?int, content: string, created_at: string}
     */
    private function messageData(ChatMessage $message, User $actor): array
    {
        return [
            'id' => $message->id,
            'role' => $message->role,
            'sender_id' => $message->sender_id,
            'is_mine' => $message->role === 'user' || $message->sender_id === $actor->id,
            'content' => $message->content,
            'created_at' => $message->created_at->toISOString(),
        ];
    }
}
