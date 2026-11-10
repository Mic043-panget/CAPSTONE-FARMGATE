<?php

namespace App\Services;

use App\Models\RiderPolicyPublication;

class RiderPolicyService
{
    public function active(): ?RiderPolicyPublication
    {
        $policy = RiderPolicyPublication::query()
            ->where('status', 'PUBLISHED')
            ->whereNotNull('published_at')
            ->whereDate('effective_date', '<=', today())
            ->orderByDesc('effective_date')
            ->orderByDesc('id')
            ->first();

        return $policy && $this->isComplete($policy) ? $policy : null;
    }

    public function publicStatus(SystemSettingsService $settings): array
    {
        $active = $this->active();
        $latest = $active ?? RiderPolicyPublication::query()
            ->where('status', 'PUBLISHED')
            ->whereNotNull('published_at')
            ->orderByDesc('effective_date')
            ->orderByDesc('id')
            ->first();
        $draft = RiderPolicyPublication::query()->where('status', 'DRAFT')->latest('id')->first();
        $missing = $this->missingDocuments($latest ?? $draft);
        $settingsEnabled = $settings->getBoolean('account_registration_enabled')
            && $settings->getBoolean('rider_registration_enabled');
        $open = $active !== null && $settingsEnabled;

        if ($open) {
            $status = 'OPEN';
            $message = null;
        } elseif (! $settingsEnabled && $active !== null) {
            $status = 'REGISTRATION_DISABLED';
            $message = 'Rider registration is temporarily disabled by Farmgate.';
        } elseif ($active === null && $latest !== null && $missing !== []) {
            $status = 'POLICY_INCOMPLETE';
            $message = 'Rider registration is closed because the available policy version is incomplete or cannot be verified.';
        } elseif ($active === null && $latest?->effective_date?->isAfter(today())) {
            $status = 'POLICY_SCHEDULED';
            $message = 'Rider registration will be considered after the published policy effective date.';
        } elseif ($active === null && ($draft !== null || $latest !== null)) {
            $status = 'POLICY_DRAFT';
            $message = 'Rider registration is closed while Farmgate completes and publishes the required rider policies.';
        } else {
            $status = 'POLICY_NOT_PUBLISHED';
            $message = 'Rider registration is closed until complete rider policies are published and effective.';
        }

        return [
            'minimum_password_length' => $settings->getInt('minimum_password_length'),
            'policy_version' => $active?->version,
            'effective_date' => $active?->effective_date?->toDateString(),
            'privacy_contact' => $active?->privacy_contact,
            'documents' => $active ? [
                'privacy' => $active->privacy_content,
                'terms' => $active->terms_content,
                'safety' => $active->safety_content,
                'retention' => $active->retention_content,
            ] : null,
            'registration_open' => $open,
            'registration_status' => $status,
            'status_message' => $message,
            'missing_documents' => $active ? [] : $missing,
        ];
    }

    public function missingDocuments(?RiderPolicyPublication $policy): array
    {
        if (! $policy) {
            return ['Policy version', ...array_values(RiderPolicyPublication::REQUIRED_DOCUMENTS), 'Privacy contact', 'Effective date'];
        }

        $missing = [];
        if (! filled($policy->version) || preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/', (string) $policy->version) !== 1) {
            $missing[] = 'Valid policy version';
        }
        foreach (RiderPolicyPublication::REQUIRED_DOCUMENTS as $field => $label) {
            if (! $this->isPublishableText($policy->{$field})) {
                $missing[] = $label;
            }
        }

        if (mb_strlen(trim((string) $policy->privacy_contact)) < 5) {
            $missing[] = 'Privacy contact';
        }
        if (! $policy->effective_date) {
            $missing[] = 'Effective date';
        }

        return $missing;
    }

    public function isComplete(RiderPolicyPublication $policy): bool
    {
        return filled($policy->version)
            && preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/', (string) $policy->version) === 1
            && $policy->effective_date !== null
            && mb_strlen(trim((string) $policy->privacy_contact)) >= 5
            && $this->missingDocuments($policy) === [];
    }

    public function hasPublishableEffectiveDate(RiderPolicyPublication $policy): bool
    {
        return $policy->effective_date !== null && $policy->effective_date->gte(today());
    }

    private function isPublishableText(?string $content): bool
    {
        $withoutMarkdownLinks = preg_replace('/\[[^\]]+\]\(https:\/\/[^)\s]+\)/u', '', (string) $content);

        return filled($content)
            && mb_strlen(trim($content)) >= 200
            && ! preg_match('/\[[^\]\r\n]+\]/u', $withoutMarkdownLinks);
    }
}
