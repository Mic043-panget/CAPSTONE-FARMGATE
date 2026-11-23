<?php

namespace App\Services\Chat;

use App\Notifications\ChatAttentionNotification;
use Illuminate\Support\Facades\DB;

class ChatConversationHistoryConsolidator
{
    public function consolidate(): void
    {
        $groups = DB::table('chat_conversations')
            ->where('kind', 'ai')
            ->orderBy('user_id')
            ->orderBy('id')
            ->get()
            ->groupBy('user_id');

        $redirects = [];

        foreach ($groups as $userId => $conversations) {
            $canonical = $conversations->first();
            $latest = $canonical;
            foreach ($conversations->skip(1) as $candidate) {
                if ($candidate->updated_at > $latest->updated_at
                    || ($candidate->updated_at === $latest->updated_at && $candidate->id > $latest->id)) {
                    $latest = $candidate;
                }
            }
            $duplicateIds = $conversations->skip(1)->pluck('id')->all();
            $redirects += array_fill_keys($duplicateIds, (int) $canonical->id);

            DB::transaction(function () use ($canonical, $conversations, $duplicateIds, $latest, $userId): void {
                if ($duplicateIds !== []) {
                    DB::table('chat_messages')
                        ->whereIn('conversation_id', $duplicateIds)
                        ->update(['conversation_id' => $canonical->id]);
                    DB::table('chat_conversations')->whereIn('id', $duplicateIds)->delete();
                }

                DB::table('chat_conversations')
                    ->where('id', $canonical->id)
                    ->update([
                        'ai_owner_id' => $userId,
                        'title' => null,
                        'report_context' => $latest->report_context,
                        'needs_human_attention' => (int) $conversations->max('needs_human_attention'),
                        'attention_notified_at' => $conversations->pluck('attention_notified_at')->filter()->max(),
                        'created_at' => $conversations->pluck('created_at')->filter()->min(),
                        'updated_at' => $conversations->pluck('updated_at')->filter()->max(),
                    ]);
            });
        }

        if ($redirects === []) {
            return;
        }

        DB::table('notifications')
            ->where('type', ChatAttentionNotification::class)
            ->select(['id', 'data'])
            ->chunkById(500, function ($notifications) use ($redirects): void {
                foreach ($notifications as $notification) {
                    $data = json_decode((string) $notification->data, true);
                    if (! is_array($data) || ! isset($data['conversation_id'])) {
                        continue;
                    }

                    $oldId = (int) $data['conversation_id'];
                    if (! isset($redirects[$oldId])) {
                        continue;
                    }

                    $data['conversation_id'] = $redirects[$oldId];
                    DB::table('notifications')
                        ->where('id', $notification->id)
                        ->update(['data' => json_encode($data, JSON_THROW_ON_ERROR)]);
                }
            });
    }
}
