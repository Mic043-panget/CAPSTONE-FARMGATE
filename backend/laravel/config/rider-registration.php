<?php

return [
    'policy_version' => env('RIDER_POLICY_VERSION'),
    'effective_date' => env('RIDER_POLICY_EFFECTIVE_DATE'),
    'privacy_contact' => env('RIDER_PRIVACY_CONTACT'),
    'privacy_policy_url' => env('RIDER_PRIVACY_POLICY_URL'),
    'terms_url' => env('RIDER_TERMS_URL'),
    'safety_policy_url' => env('RIDER_SAFETY_POLICY_URL'),
    'retention_policy_approved' => (bool) env('RIDER_RETENTION_POLICY_APPROVED', false),
    'selfie_collection_enabled' => (bool) env('RIDER_SELFIE_COLLECTION_ENABLED', false),
    'policy_package_path' => env('RIDER_POLICY_PACKAGE_PATH', base_path('../../../PRIVACY_POLICY.md')),
];
