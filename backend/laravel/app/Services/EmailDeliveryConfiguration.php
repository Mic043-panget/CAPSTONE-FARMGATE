<?php

namespace App\Services;

class EmailDeliveryConfiguration
{
    public function isConfigured(): bool
    {
        $mailer = config('mail.default');
        $smtp = config("mail.mailers.{$mailer}", []);
        $scheme = strtolower((string) ($smtp['scheme'] ?? ''));
        $port = filter_var($smtp['port'] ?? null, FILTER_VALIDATE_INT);

        return $mailer === 'smtp'
            && filled($smtp['host'] ?? null)
            && $port !== false
            && $port >= 1
            && $port <= 65535
            && in_array($scheme, ['smtp', 'smtps'], true)
            && filled($smtp['username'] ?? null)
            && filled($smtp['password'] ?? null)
            && filter_var(config('mail.from.address'), FILTER_VALIDATE_EMAIL) !== false;
    }

    /**
     * Expose readiness only; never return transport credentials or endpoints.
     *
     * @return array{status: string, configured: bool, mailer: string}
     */
    public function status(): array
    {
        $configured = $this->isConfigured();

        return [
            'status' => $configured ? 'ready' : 'setup_required',
            'configured' => $configured,
            'mailer' => (string) config('mail.default', 'log'),
        ];
    }
}
