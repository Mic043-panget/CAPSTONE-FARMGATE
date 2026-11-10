<?php

namespace App\Services;

class PaymentProviderReadinessService
{
    /**
     * Expose readiness facts only. Never return provider credential values.
     *
     * @return array{
     *     credentials_configured: bool,
     *     test_mode_credentials: bool,
     *     webhook_signing_configured: bool,
     *     configuration_verified: bool,
     *     qr_receiving_ready: bool,
     *     seller_payouts_enabled: bool,
     *     seller_payouts_status: string
     * }
     */
    public function paymongo(): array
    {
        $secretKey = config('services.paymongo.secret_key');
        $credentialsConfigured = filled($secretKey);
        $testModeCredentials = is_string($secretKey) && str_starts_with($secretKey, 'sk_test_');
        $webhookSigningConfigured = filled(config('services.paymongo.webhook_secret'));
        $configurationVerified = (bool) config('payments.paymongo.configuration_verified', false);

        return [
            'credentials_configured' => $credentialsConfigured,
            'test_mode_credentials' => $testModeCredentials,
            'webhook_signing_configured' => $webhookSigningConfigured,
            'configuration_verified' => $configurationVerified,
            'qr_receiving_ready' => $testModeCredentials && $webhookSigningConfigured && $configurationVerified,
            'seller_payouts_enabled' => false,
            'seller_payouts_status' => 'DISABLED_NOT_INTEGRATED',
        ];
    }
}
