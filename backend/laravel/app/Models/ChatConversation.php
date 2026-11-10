<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['user_id', 'recipient_id', 'listing_id', 'direct_key', 'kind', 'title', 'report_context', 'needs_human_attention', 'attention_notified_at', 'ai_paused'])]
class ChatConversation extends Model
{
    protected function casts(): array
    {
        return [
            'report_context' => 'array',
            'needs_human_attention' => 'boolean',
            'attention_notified_at' => 'datetime',
            'ai_paused' => 'boolean',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function messages(): HasMany
    {
        return $this->hasMany(ChatMessage::class, 'conversation_id');
    }

    public function recipient(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recipient_id');
    }

    public function listing(): BelongsTo
    {
        return $this->belongsTo(LivestockListing::class, 'listing_id');
    }
}
