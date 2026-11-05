<?php

namespace App\Services\Chat;

interface ChatProvider
{
    /**
     * @param  array<int, array{role: 'user'|'assistant', content: string}>  $history
     */
    public function respond(string $systemInstruction, array $history): string;
}
