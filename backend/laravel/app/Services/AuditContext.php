<?php

namespace App\Services;

use App\Models\AuditLog;
use App\Models\ChatConversation;
use App\Models\ChatMessage;
use Illuminate\Database\Eloquent\Model;

class AuditContext
{
    /** @var array<int, array<string, mixed>> */
    private array $changes = [];

    public function record(string $operation, Model $model, array $before, array $after): void
    {
        if ($model instanceof AuditLog || str_ends_with(class_basename($model), 'History')) {
            return;
        }

        $before = $this->sanitize($before, $model);
        $after = $this->sanitize($after, $model);
        $fields = array_values(array_unique(array_merge(array_keys($before), array_keys($after))));
        $changedFields = [];
        foreach ($fields as $field) {
            if (($before[$field] ?? null) !== ($after[$field] ?? null)) {
                $changedFields[] = ['field' => $field, 'old' => $before[$field] ?? null, 'new' => $after[$field] ?? null];
            }
        }

        $this->changes[] = [
            'operation' => $operation,
            'entity_type' => class_basename($model),
            'entity_id' => $model->getKey(),
            'before' => $before,
            'after' => $after,
            'changed_fields' => $changedFields,
        ];
    }

    /** @return array<int, array<string, mixed>> */
    public function changes(): array
    {
        return $this->changes;
    }

    public function clear(): void
    {
        $this->changes = [];
    }

    private function sanitize(array $values, Model $model): array
    {
        $sensitive = [
            'password',
            'password_hash',
            'current_password',
            'remember_token',
            'token',
            'access_token',
            'refresh_token',
            'secret',
            'api_key',
            'csrf_token',
            'otp_hash',
            'otp',
            'code',
            'verification_code',
            'email',
            'name',
            'phone',
            'phone_number',
            'account_holder',
            'bank_name',
            'account_number',
            'wallet_number',
            'transaction_reference',
            'transaction_reference_hash',
            'external_reference',
            'external_reference_hash',
            'receiver_name',
            'verification_reason',
            'reconciliation_reason',
            'evidence_path',
            'evidence_sha256',
            'evidence_mime_type',
            'proof_path',
            'proof_sha256',
            'proof_mime_type',
            'receipt_path',
            'qr_path',
            'qr_mime_type',
            'wallet_provider',
            'destination_details',
            'date_of_birth',
            'residential_address',
            'license_number',
            'license_number_hash',
            'plate_number',
            'vehicle_make_model',
            'vehicle_color',
            'path',
            'original_name',
            'recipient_name',
            'address',
            'shipping_address',
            'pickup_address',
            'street_address',
            'address_line2',
            'delivery_notes',
            'label',
            'barangay',
            'province',
            'city_municipality',
            'postal_code',
            'latitude',
            'longitude',
            'pickup_latitude',
            'pickup_longitude',
            'rider_location_latitude',
            'rider_location_longitude',
            'rider_location_updated_at',
            'rider_location_captured_at',
            'privacy_content',
            'terms_content',
            'safety_content',
            'retention_content',
            'last_location_at',
            'pickup_verification_latitude',
            'pickup_verification_longitude',
            'delivery_verification_latitude',
            'delivery_verification_longitude',
            'delivery_proof_path',
            'delivery_proof_sha256',
            'delivery_proof_mime_type',
            'delivery_proof_latitude',
            'delivery_proof_longitude',
            'delivery_recipient_name',
            'old_proof_path',
            'new_proof_path',
            'old_recipient_name',
            'new_recipient_name',
            'qr_token',
            'pickup_qr_token_hash',
            'delivery_qr_token_hash',
        ];
        if ($model instanceof ChatMessage) {
            $sensitive[] = 'content';
        }
        if ($model instanceof ChatConversation) {
            $sensitive[] = 'title';
            $sensitive[] = 'report_context';
        }

        foreach ($sensitive as $key) {
            unset($values[$key]);
        }

        return array_map(function (mixed $value): mixed {
            if (is_object($value) && method_exists($value, 'value')) {
                return $value->value;
            }
            if ($value instanceof \DateTimeInterface) {
                return $value->format(DATE_ATOM);
            }
            if (is_resource($value)) {
                return '[resource]';
            }

            return $value;
        }, $values);
    }
}
