<?php

namespace App\Services;

use App\Enums\Role;
use App\Models\User;

class NotificationLinkService
{
    /**
     * @param  array<string, mixed>  $data
     * @return array{url: string, label: string}
     */
    public function for(User $recipient, array $data, string $notificationId): array
    {
        $base = rtrim((string) config('services.frontend_url'), '/');
        $label = 'View notification';
        $fragment = '#notifications';

        if (($data['type'] ?? null) === 'order_status_changed' && $recipient->role === Role::BUYER && isset($data['order_id'])) {
            $label = 'View order';
            $fragment = '#order/'.(int) $data['order_id'];
        } elseif (($data['type'] ?? null) === 'order_status_changed' && $recipient->role === Role::SELLER) {
            $label = 'View seller update';
        } elseif (($data['type'] ?? null) === 'order_status_changed' && $recipient->role === Role::RIDER) {
            $label = 'View delivery update';
        } elseif (($data['type'] ?? null) === 'seller_payout_recorded' && $recipient->role === Role::SELLER) {
            $label = 'View payout update';
        } elseif (($data['type'] ?? null) === 'rider_application_status' && $recipient->role === Role::RIDER) {
            $label = 'View application update';
        } elseif (isset($data['conversation_id'])) {
            $label = 'View conversation';
        } elseif (isset($data['event_id'])) {
            $label = 'View event';
        } elseif (isset($data['promotion_id'])) {
            $label = 'View promotion';
        } elseif (isset($data['order_id'])) {
            $label = match ($recipient->role) {
                Role::BUYER => 'View buyer update',
                Role::SELLER => 'View seller update',
                Role::RIDER => 'View delivery update',
                default => 'View notification',
            };
        }

        return [
            'url' => $base.'/?notification='.rawurlencode($notificationId).$fragment,
            'label' => $label,
        ];
    }

    /**
     * @return array{url: string, label: string}
     */
    public function forOrderRecipient(User $recipient, int $orderId): array
    {
        $base = rtrim((string) config('services.frontend_url'), '/');
        if ($recipient->role === Role::BUYER) {
            return ['url' => $base.'/#order/'.$orderId, 'label' => 'View order'];
        }

        return [
            'url' => $base.'/#notifications',
            'label' => $recipient->role === Role::RIDER ? 'View delivery update' : 'View order update',
        ];
    }
}
