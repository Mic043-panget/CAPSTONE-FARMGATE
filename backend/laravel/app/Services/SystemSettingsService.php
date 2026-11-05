<?php

namespace App\Services;

use App\Models\DeliveryRateTier;
use App\Models\SystemSetting;
use App\Models\SystemSettingHistory;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class SystemSettingsService
{
    public const DEFINITIONS = [
        'account_registration_enabled' => ['default' => true, 'type' => 'boolean', 'category' => 'account', 'label' => 'Account registration enabled'],
        'buyer_registration_enabled' => ['default' => true, 'type' => 'boolean', 'category' => 'account', 'label' => 'Buyer registration enabled'],
        'seller_registration_enabled' => ['default' => true, 'type' => 'boolean', 'category' => 'account', 'label' => 'Seller registration enabled'],
        'rider_registration_enabled' => ['default' => false, 'type' => 'boolean', 'category' => 'account', 'label' => 'Rider registration enabled'],
        'minimum_password_length' => ['default' => 8, 'type' => 'integer', 'category' => 'security', 'label' => 'Minimum password length'],
        'session_timeout_minutes' => ['default' => 120, 'type' => 'integer', 'category' => 'security', 'label' => 'Session timeout'],
        'maximum_login_attempts' => ['default' => 10, 'type' => 'integer', 'category' => 'security', 'label' => 'Maximum login attempts'],
        'account_lockout_minutes' => ['default' => 15, 'type' => 'integer', 'category' => 'security', 'label' => 'Account lockout duration'],
        'email_verification_required' => ['default' => false, 'type' => 'boolean', 'category' => 'security', 'label' => 'Email verification required'],
        'phone_verification_required' => ['default' => false, 'type' => 'boolean', 'category' => 'security', 'label' => 'Phone verification required'],
        'seller_verification_required' => ['default' => true, 'type' => 'boolean', 'category' => 'seller', 'label' => 'Seller verification required'],
        'rider_verification_required' => ['default' => true, 'type' => 'boolean', 'category' => 'rider', 'label' => 'Rider verification required'],
        'allow_account_deactivation' => ['default' => true, 'type' => 'boolean', 'category' => 'account', 'label' => 'Allow account deactivation'],
        'allow_account_reactivation' => ['default' => true, 'type' => 'boolean', 'category' => 'account', 'label' => 'Allow account reactivation'],
        'minimum_order_amount' => ['default' => 0, 'type' => 'decimal', 'category' => 'orders', 'label' => 'Minimum order amount'],
        'maximum_order_amount' => ['default' => 1000000, 'type' => 'decimal', 'category' => 'orders', 'label' => 'Maximum order amount'],
        'order_cancellation_minutes' => ['default' => 60, 'type' => 'integer', 'category' => 'orders', 'label' => 'Order cancellation window'],
        'seller_confirmation_minutes' => ['default' => 60, 'type' => 'integer', 'category' => 'orders', 'label' => 'Seller confirmation window'],
        'buyer_payment_minutes' => ['default' => 60, 'type' => 'integer', 'category' => 'orders', 'label' => 'Buyer payment window'],
        'automatic_order_expiration_enabled' => ['default' => true, 'type' => 'boolean', 'category' => 'orders', 'label' => 'Automatic order expiration'],
        'allow_seller_cancellation' => ['default' => false, 'type' => 'boolean', 'category' => 'orders', 'label' => 'Allow seller cancellation'],
        'allow_partial_quantity_fulfillment' => ['default' => false, 'type' => 'boolean', 'category' => 'orders', 'label' => 'Allow partial fulfillment'],
        'maximum_items_per_order' => ['default' => 50, 'type' => 'integer', 'category' => 'orders', 'label' => 'Maximum items per order'],
        'order_processing_fee' => ['default' => 0, 'type' => 'decimal', 'category' => 'charges', 'label' => 'Order processing fee'],
        'platform_service_fee_rate' => ['default' => 0, 'type' => 'decimal', 'category' => 'charges', 'label' => 'Platform service fee rate (%)'],
        'platform_fee_percent' => ['default' => 0, 'type' => 'decimal', 'category' => 'charges', 'label' => 'Platform fee rate (%)'],
        'transaction_fee_rate' => ['default' => 0, 'type' => 'decimal', 'category' => 'charges', 'label' => 'Transaction fee rate (%)'],
        'seller_fee_rate' => ['default' => 0, 'type' => 'decimal', 'category' => 'charges', 'label' => 'Seller fee rate (%)'],
        'buyer_service_fee_rate' => ['default' => 0, 'type' => 'decimal', 'category' => 'charges', 'label' => 'Buyer service fee rate (%)'],
        'payment_processing_fee_rate' => ['default' => 0, 'type' => 'decimal', 'category' => 'charges', 'label' => 'Payment processing fee rate (%)'],
        'cancellation_fee' => ['default' => 0, 'type' => 'decimal', 'category' => 'charges', 'label' => 'Cancellation fee'],
        'refund_processing_fee' => ['default' => 0, 'type' => 'decimal', 'category' => 'charges', 'label' => 'Refund processing fee'],
        'delivery_base_fee' => ['default' => 50, 'type' => 'decimal', 'category' => 'delivery', 'label' => 'Delivery base fee'],
        'delivery_rate_per_km' => ['default' => 10, 'type' => 'decimal', 'category' => 'delivery', 'label' => 'Delivery rate per kilometer'],
        'delivery_included_km' => ['default' => 0, 'type' => 'decimal', 'category' => 'delivery', 'label' => 'Included delivery distance'],
        'delivery_min_fee' => ['default' => 50, 'type' => 'decimal', 'category' => 'delivery', 'label' => 'Minimum delivery fee'],
        'delivery_max_fee' => ['default' => 0, 'type' => 'decimal', 'category' => 'delivery', 'label' => 'Maximum delivery fee (0 = unlimited)'],
        'free_delivery_enabled' => ['default' => false, 'type' => 'boolean', 'category' => 'delivery', 'label' => 'Free delivery enabled'],
        'free_delivery_minimum_order' => ['default' => 0, 'type' => 'decimal', 'category' => 'delivery', 'label' => 'Free delivery minimum order'],
        'delivery_distance_limit_km' => ['default' => 100, 'type' => 'decimal', 'category' => 'delivery', 'label' => 'Delivery distance limit'],
        'delivery_calculation_method' => ['default' => 'STANDARD', 'type' => 'string', 'category' => 'distance', 'label' => 'Delivery calculation method'],
        'delivery_tiers_enabled' => ['default' => false, 'type' => 'boolean', 'category' => 'distance', 'label' => 'Distance tiers enabled'],
        'rider_base_compensation' => ['default' => 0, 'type' => 'decimal', 'category' => 'rider', 'label' => 'Rider base compensation'],
        'rider_per_km_compensation' => ['default' => 0, 'type' => 'decimal', 'category' => 'rider', 'label' => 'Rider per kilometer compensation'],
        'rider_minimum_compensation' => ['default' => 0, 'type' => 'decimal', 'category' => 'rider', 'label' => 'Rider minimum compensation'],
        'rider_maximum_compensation' => ['default' => 0, 'type' => 'decimal', 'category' => 'rider', 'label' => 'Rider maximum compensation'],
        'rider_cancellation_compensation' => ['default' => 0, 'type' => 'decimal', 'category' => 'rider', 'label' => 'Rider cancellation compensation'],
        'rider_waiting_fee' => ['default' => 0, 'type' => 'decimal', 'category' => 'rider', 'label' => 'Rider waiting fee'],
        'rider_waiting_minutes' => ['default' => 15, 'type' => 'integer', 'category' => 'rider', 'label' => 'Rider waiting threshold'],
        'automatic_rider_assignment_enabled' => ['default' => true, 'type' => 'boolean', 'category' => 'rider', 'label' => 'Automatic rider assignment'],
        'rider_offer_radius_km' => ['default' => 25, 'type' => 'decimal', 'category' => 'rider', 'label' => 'Maximum rider assignment distance'],
        'rider_offer_expiry_minutes' => ['default' => 10, 'type' => 'integer', 'category' => 'rider', 'label' => 'Rider offer expiry'],
        'maximum_rider_assignment_attempts' => ['default' => 3, 'type' => 'integer', 'category' => 'rider', 'label' => 'Maximum rider assignment attempts'],
        'seller_listing_approval_required' => ['default' => true, 'type' => 'boolean', 'category' => 'seller', 'label' => 'Seller listing approval required'],
        'maximum_active_listings' => ['default' => 100, 'type' => 'integer', 'category' => 'seller', 'label' => 'Maximum active listings'],
        'listing_expiration_days' => ['default' => 0, 'type' => 'integer', 'category' => 'listings', 'label' => 'Listing expiration days'],
        'minimum_livestock_quantity' => ['default' => 1, 'type' => 'integer', 'category' => 'listings', 'label' => 'Minimum livestock quantity'],
        'maximum_livestock_quantity' => ['default' => 100000, 'type' => 'integer', 'category' => 'listings', 'label' => 'Maximum livestock quantity'],
        'maximum_images_per_listing' => ['default' => 10, 'type' => 'integer', 'category' => 'listings', 'label' => 'Maximum images per listing'],
        'price_change_requires_approval' => ['default' => false, 'type' => 'boolean', 'category' => 'listings', 'label' => 'Price change requires approval'],
        'quantity_change_requires_approval' => ['default' => false, 'type' => 'boolean', 'category' => 'listings', 'label' => 'Quantity change requires approval'],
        'email_notifications_enabled' => ['default' => true, 'type' => 'boolean', 'category' => 'notifications', 'label' => 'Email notifications enabled'],
        'in_app_notifications_enabled' => ['default' => true, 'type' => 'boolean', 'category' => 'notifications', 'label' => 'In-app notifications enabled'],
        'order_notifications_enabled' => ['default' => true, 'type' => 'boolean', 'category' => 'notifications', 'label' => 'Order notifications enabled'],
        'delivery_notifications_enabled' => ['default' => true, 'type' => 'boolean', 'category' => 'notifications', 'label' => 'Delivery notifications enabled'],
        'complaint_notifications_enabled' => ['default' => true, 'type' => 'boolean', 'category' => 'notifications', 'label' => 'Complaint notifications enabled'],
        'system_name' => ['default' => 'FARMGATE', 'type' => 'string', 'category' => 'system', 'label' => 'System name'],
        'system_description' => ['default' => 'Local livestock marketplace', 'type' => 'string', 'category' => 'system', 'label' => 'System description'],
        'maintenance_mode' => ['default' => false, 'type' => 'boolean', 'category' => 'system', 'label' => 'Maintenance mode'],
        'timezone' => ['default' => 'Asia/Manila', 'type' => 'string', 'category' => 'system', 'label' => 'Timezone'],
        'currency' => ['default' => 'PHP', 'type' => 'string', 'category' => 'system', 'label' => 'Currency'],
        'pagination_limit' => ['default' => 15, 'type' => 'integer', 'category' => 'system', 'label' => 'Pagination limit'],
        'date_format' => ['default' => 'Y-m-d', 'type' => 'string', 'category' => 'system', 'label' => 'Date format'],
        'time_format' => ['default' => 'H:i', 'type' => 'string', 'category' => 'system', 'label' => 'Time format'],
    ];

    public function definitions(): array { return self::DEFINITIONS; }

    public function values(bool $includeMetadata = false): array
    {
        $stored = SystemSetting::query()->where('is_active', true)->get()->keyBy('key');
        $values = [];
        foreach (self::DEFINITIONS as $key => $definition) {
            $values[$key] = $this->castValue($stored[$key]->value ?? $definition['default'], $definition['type']);
        }
        return $includeMetadata ? ['values' => $values, 'definitions' => self::DEFINITIONS] : $values;
    }

    public function get(string $key): mixed
    {
        $definition = self::DEFINITIONS[$key] ?? null;
        if (! $definition) { return null; }
        return Cache::remember("farmgate.setting.{$key}", 300, fn () => $this->castValue(SystemSetting::query()->where('key', $key)->where('is_active', true)->value('value') ?? $definition['default'], $definition['type']));
    }

    public function getInt(string $key): int { return (int) $this->get($key); }
    public function getDecimal(string $key): float { return (float) $this->get($key); }
    public function getBoolean(string $key): bool { return (bool) $this->get($key); }
    public function getString(string $key): string { return (string) $this->get($key); }
    public function number(string $key): float { return $this->getDecimal($key); }

    public function validate(array $values): array
    {
        $errors = [];
        $normalized = [];
        foreach ($values as $key => $value) {
            $definition = self::DEFINITIONS[$key] ?? null;
            if (! $definition) { $errors["settings.{$key}"][] = 'This setting is not supported.'; continue; }
            $valid = match ($definition['type']) {
                'boolean' => is_bool($value) || in_array($value, [0, 1, '0', '1', 'true', 'false'], true),
                'integer' => filter_var($value, FILTER_VALIDATE_INT) !== false,
                'decimal' => is_numeric($value),
                'json' => is_array($value) || is_object($value),
                default => is_string($value) || is_numeric($value),
            };
            if (! $valid) { $errors["settings.{$key}"][] = "The {$key} value has an invalid type."; continue; }
            $normalized[$key] = $this->castValue($value, $definition['type']);
            if (in_array($definition['type'], ['integer', 'decimal'], true) && $normalized[$key] < 0) { $errors["settings.{$key}"][] = 'The value cannot be negative.'; }
            if (str_ends_with($key, '_rate') || str_ends_with($key, '_percent')) { if ((float) $normalized[$key] > 100) { $errors["settings.{$key}"][] = 'Percentage rates cannot exceed 100.'; } }
        }
        if ($errors) { throw ValidationException::withMessages($errors); }
        return $normalized;
    }

    public function update(array $values, int $actorId, ?string $reason = null): void
    {
        $values = $this->validate($values);
        if (($values['delivery_min_fee'] ?? $this->getDecimal('delivery_min_fee')) > 0 && ($values['delivery_max_fee'] ?? $this->getDecimal('delivery_max_fee')) > 0 && $values['delivery_min_fee'] > $values['delivery_max_fee']) { throw ValidationException::withMessages(['settings.delivery_min_fee' => 'Minimum delivery fee cannot exceed maximum delivery fee.']); }
        DB::transaction(function () use ($values, $actorId, $reason): void {
            foreach ($values as $key => $value) {
                $definition = self::DEFINITIONS[$key];
                $setting = SystemSetting::query()->lockForUpdate()->where('key', $key)->first();
                $oldValue = $setting?->value;
                $setting ??= new SystemSetting(['key' => $key, 'created_by' => $actorId]);
                $setting->fill(['value' => is_array($value) ? json_encode($value, JSON_THROW_ON_ERROR) : (string) $value, 'type' => $definition['type'], 'category' => $definition['category'], 'label' => $definition['label'], 'is_active' => true, 'is_public' => false, 'updated_by' => $actorId]);
                $setting->save();
                Cache::forget("farmgate.setting.{$key}");
                if ($oldValue !== (string) $setting->value) { SystemSettingHistory::create(['system_setting_id' => $setting->id, 'key' => $key, 'old_value' => $oldValue, 'new_value' => (string) $setting->value, 'changed_by' => $actorId, 'change_reason' => $reason]); }
            }
        });
    }

    public function deliveryFee(float $distanceKm, float $orderSubtotal = 0): float
    {
        if ($this->getBoolean('free_delivery_enabled') && $orderSubtotal >= $this->getDecimal('free_delivery_minimum_order')) { return 0.0; }
        $tier = $this->getBoolean('delivery_tiers_enabled') ? DeliveryRateTier::query()->where('is_active', true)->where('min_km', '<=', $distanceKm)->where(fn ($query) => $query->whereNull('max_km')->orWhere('max_km', '>=', $distanceKm))->orderByDesc('priority')->first() : null;
        $fee = $tier ? (float) $tier->base_fee + max(0, $distanceKm - (float) $tier->min_km) * (float) $tier->fee_per_km : $this->getDecimal('delivery_base_fee') + max(0, $distanceKm - $this->getDecimal('delivery_included_km')) * $this->getDecimal('delivery_rate_per_km');
        $minimum = $this->getDecimal('delivery_min_fee');
        $maximum = $this->getDecimal('delivery_max_fee');
        return round($maximum > 0 ? min($maximum, max($minimum, $fee)) : max($minimum, $fee), 2);
    }

    public function distanceKm(float $fromLat, float $fromLng, float $toLat, float $toLng): float
    {
        $latitudeDelta = deg2rad($toLat - $fromLat); $longitudeDelta = deg2rad($toLng - $fromLng);
        $a = sin($latitudeDelta / 2) ** 2 + cos(deg2rad($fromLat)) * cos(deg2rad($toLat)) * sin($longitudeDelta / 2) ** 2;
        return round(6371 * 2 * atan2(sqrt($a), sqrt(1 - $a)), 2);
    }

    private function castValue(mixed $value, string $type): mixed
    {
        return match ($type) { 'boolean' => filter_var($value, FILTER_VALIDATE_BOOLEAN), 'integer' => (int) $value, 'decimal' => (float) $value, 'json' => is_string($value) ? json_decode($value, true, 512, JSON_THROW_ON_ERROR) : $value, default => (string) $value };
    }
}
