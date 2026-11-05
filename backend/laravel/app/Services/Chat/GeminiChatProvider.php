<?php

namespace App\Services\Chat;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

class GeminiChatProvider implements ChatProvider
{
    public function respond(string $systemInstruction, array $history): string
    {
        $apiKey = (string) config('services.gemini.api_key');
        $model = (string) config('services.gemini.model', 'gemini-2.5-flash-lite');
        $fallbackModel = (string) config('services.gemini.fallback_model', 'gemini-2.5-flash');

        if ($apiKey === '' || $model === '') {
            Log::error('Gemini chat provider is not configured.', [
                'model' => $model !== '' ? $model : null,
                'has_api_key' => $apiKey !== '',
            ]);
            throw new ChatProviderException('Chat provider is not configured.');
        }

        $contents = array_map(static fn (array $item): array => [
            'role' => $item['role'] === 'assistant' ? 'model' : 'user',
            'parts' => [['text' => $item['content']]],
        ], $history);

        $models = array_values(array_unique(array_filter([$model, $fallbackModel])));
        $lastFailure = null;

        foreach ($models as $candidateModel) {
            try {
                $response = Http::acceptJson()
                    ->withHeaders(['x-goog-api-key' => $apiKey])
                    ->timeout((int) config('services.gemini.timeout', 20))
                    ->post(
                        'https://generativelanguage.googleapis.com/v1beta/models/'.rawurlencode($candidateModel).':generateContent',
                        [
                            'systemInstruction' => ['parts' => [['text' => $systemInstruction]]],
                            'contents' => $contents,
                            'generationConfig' => [
                                'maxOutputTokens' => 1200,
                                'temperature' => 0.3,
                            ],
                        ],
                    );
            } catch (Throwable $exception) {
                Log::warning('Gemini chat provider request failed at the transport layer.', [
                    'model' => $candidateModel,
                    'exception_class' => $exception::class,
                ]);
                $lastFailure = $exception;

                continue;
            }

            if (! $response->successful()) {
                $providerStatus = $response->json('error.status');
                Log::warning('Gemini chat provider rejected or could not complete a request.', [
                    'model' => $candidateModel,
                    'http_status' => $response->status(),
                    'provider_status' => is_string($providerStatus) && preg_match('/^[A-Z0-9_]{1,64}$/', $providerStatus)
                        ? $providerStatus
                        : null,
                    'provider_message' => $this->safeProviderMessage(
                        $response->json('error.message'),
                        $apiKey,
                    ),
                ]);

                if (! in_array($response->status(), [404, 429, 500, 502, 503, 504], true)) {
                    throw new ChatProviderException('Chat provider rejected the request.');
                }
                $lastFailure = new ChatProviderException('Chat provider model is unavailable.');

                continue;
            }

            $parts = $response->json('candidates.0.content.parts');
            $text = is_array($parts)
                ? trim(collect($parts)
                    ->filter(fn (mixed $part): bool => is_array($part) && is_string($part['text'] ?? null))
                    ->pluck('text')
                    ->implode("\n"))
                : '';

            if ($text !== '') {
                return mb_substr($text, 0, 4000);
            }

            Log::warning('Gemini chat provider returned no text.', [
                'model' => $candidateModel,
                'http_status' => $response->status(),
            ]);
            $lastFailure = new ChatProviderException('Chat provider returned an empty response.');
        }

        throw new ChatProviderException('All configured chat models are temporarily unavailable.', previous: $lastFailure);
    }

    private function safeProviderMessage(mixed $message, string $apiKey): ?string
    {
        if (! is_string($message) || trim($message) === '') {
            return null;
        }

        $message = str_replace($apiKey, '[redacted]', $message);
        $message = preg_replace('/(?:AIza|AQ\\.)[A-Za-z0-9._-]{20,}/', '[redacted]', $message) ?? '';

        return mb_substr(trim($message), 0, 300);
    }
}
