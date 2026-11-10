import React from 'react';
import api from '../../lib/api';
import { ViewDetailsAction } from '../../shared/components/Button';
import { LoadingSkeleton } from '../../shared/components/LoadingSkeleton';

type NotificationCategory = 'ALL' | 'ORDERS' | 'CHATS' | 'SYSTEM';

type AppNotification = {
    id: string;
    type: string;
    data: {
        type?: string;
        order_id?: number | string;
        case_id?: number | string;
        review_id?: number | string;
        listing_id?: number | string;
        application_id?: number | string;
        vehicle_change_id?: number | string;
        audit_log_id?: number | string;
        delivery_id?: number | string;
        event_id?: number | string;
        promotion_id?: number | string;
        case_type?: string;
        case_reference?: string;
        review_reference?: string;
        delivery_reference?: string;
        application_reference?: string;
        vehicle_reference?: string;
        order_reference?: string;
        status?: string;
        title?: string;
        action?: string;
        buyer_name?: string;
        reason?: string | null;
        message?: string;
        listing_name?: string;
        moderation_status?: string;
        reasons?: string[];
        flags?: string[];
        conversation_id?: number;
        sender_name?: string;
        attention_required?: boolean;
    };
    read_at: string | null;
    created_at: string;
    is_critical: boolean;
    delivery_statuses?: { channel: string; status: string; attempts: number }[];
};

type PushConfig = { enabled: boolean; public_key: string | null };
type NotificationUnreadCounts = { unread_count: number; unread_chat_count: number };

function decodePushKey(value: string): ArrayBuffer {
    const padded = value + '='.repeat((4 - value.length % 4) % 4);
    const binary = window.atob(padded.replaceAll('-', '+').replaceAll('_', '/'));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const buffer = new ArrayBuffer(bytes.length);
    new Uint8Array(buffer).set(bytes);

    return buffer;
}

function samePushKey(current: ArrayBuffer | null, expected: ArrayBuffer): boolean {
    if (!current) return false;
    const actual = new Uint8Array(current);
    const expectedBytes = new Uint8Array(expected);

    return actual.length === expectedBytes.length && actual.every((value, index) => value === expectedBytes[index]);
}

function deliveryStatusLabel(channel: string, status: string): string {
    const channelLabel = channel === 'push' ? 'Device' : 'Email';
    const statusLabel: Record<string, string> = {
        queued: 'queued',
        sending: 'sending',
        delivered: 'delivered',
        failed: 'failed',
        skipped: 'disabled by preference',
        not_configured: 'not configured',
        not_subscribed: 'not enabled on a device',
        managed: 'handled by the order email service',
    };

    return `${channelLabel}: ${statusLabel[status] ?? status.replaceAll('_', ' ')}`;
}

const categories: { id: NotificationCategory; label: string }[] = [
    { id: 'ALL', label: 'All' },
    { id: 'ORDERS', label: 'Orders' },
    { id: 'CHATS', label: 'Chats' },
    { id: 'SYSTEM', label: 'System' },
];

function categoryFor(notification: AppNotification): NotificationCategory {
    if (notification.data.type?.startsWith('order_')
        || notification.data.type === 'rider_assignment_waiting'
        || notification.data.type === 'delivery_proof_recorded') return 'ORDERS';
    if (notification.data.type?.startsWith('chat_')) return 'CHATS';
    return 'SYSTEM';
}

function notificationContent(notification: AppNotification, role: 'BUYER' | 'SELLER' | 'RIDER' | 'ADMIN'): { title: string; message: string } {
    if (notification.data.type === 'order_case_updated') {
        const type = notification.data.case_type === 'RETURN_REFUND' ? 'Return/refund' : 'Complaint';
        return {
            title: `${notification.data.case_reference ?? `${type} update`}${notification.data.order_reference ? ` · ${notification.data.order_reference}` : ''}`,
            message: notification.data.message ?? 'An order case was updated.',
        };
    }

    if (notification.data.type === 'review_moderation_updated') {
        return { title: `Review moderation · ${notification.data.review_reference ?? 'Review'}`, message: notification.data.message ?? 'Your review was reviewed by admin.' };
    }
    if (notification.data.type === 'rider_application_status') {
        const reference = notification.data.vehicle_reference ?? notification.data.application_reference ?? 'Rider application';
        return { title: reference, message: notification.data.message ?? 'Your rider application status has changed.' };
    }
    if (notification.data.type === 'calendar_event') {
        return { title: notification.data.title ?? 'Calendar event update', message: notification.data.message ?? 'A calendar event has been updated.' };
    }
    if (notification.data.type === 'promotion_changed') {
        return { title: notification.data.title ?? 'Promotion update', message: notification.data.message ?? 'A Farmgate promotion has changed.' };
    }
    if (notification.data.type === 'order_status_changed') {
        const orderReference = notification.data.order_reference ? ` ${notification.data.order_reference}` : '';
        const status = notification.data.status?.replaceAll('_', ' ').toLowerCase() ?? 'updated';
        if (role === 'SELLER' || role === 'RIDER') {
            return {
                title: `Order${orderReference} ${status}`,
                message: `The status of order${orderReference} is now ${status}.${notification.data.reason ? ` Reason: ${notification.data.reason}` : ''}`,
            };
        }
        return {
            title: `Order${orderReference} ${status}`,
            message: notification.data.reason
                ? `The status of your order${orderReference || ''} is now ${status}. Reason: ${notification.data.reason}`
                : `The status of your order${orderReference || ''} is now ${status}.`,
        };
    }

    if (notification.data.type === 'order_rider_assigned') {
        const orderReference = notification.data.order_reference ? ` ${notification.data.order_reference}` : '';
        return {
            title: `Delivery ${notification.data.delivery_reference ?? ''} · Rider assigned to order${orderReference}`,
            message: notification.data.message ?? 'A rider has accepted your delivery.',
        };
    }

    if (notification.data.type === 'rider_offer_available') {
        return {
            title: `Delivery offer · ${notification.data.delivery_reference ?? notification.data.order_reference ?? 'Farmgate'}`,
            message: notification.data.message ?? 'A delivery offer is available for review.',
        };
    }

    if (notification.data.type === 'order_delivery_status_changed') {
        return {
            title: `Delivery ${notification.data.delivery_reference ?? notification.data.order_reference ?? ''} update`,
            message: notification.data.message ?? 'The delivery status has changed.',
        };
    }

    if (notification.data.type === 'delivery_proof_recorded') {
        return {
            title: `Proof recorded · ${notification.data.delivery_reference ?? notification.data.order_reference ?? 'Delivery'}`,
            message: notification.data.message ?? 'Recipient confirmation and the delivery photo have been saved.',
        };
    }

    if (notification.data.type === 'order_update_requested') {
        const orderReference = notification.data.order_reference ? ` ${notification.data.order_reference}` : '';
        return {
            title: `Update requested for ${orderReference ? `order${orderReference}` : 'an order'}`,
            message: `${notification.data.buyer_name ?? 'A buyer'} asked you to send an update about this order.`,
        };
    }

    if (notification.data.type === 'chat_message') {
        if (notification.data.attention_required) {
            return {
                title: 'Chat needs human attention',
                message: 'The automated assistant flagged this conversation for a person to review.',
            };
        }
        return {
            title: `New message from ${notification.data.sender_name ?? 'a user'}`,
            message: 'Open the conversation to read the message.',
        };
    }

    if (notification.data.type === 'rider_assignment_waiting') {
        const orderReference = notification.data.order_reference ? ` ${notification.data.order_reference}` : '';
        return {
            title: `Rider assignment pending · ${notification.data.delivery_reference ?? `order${orderReference}`}`,
            message: notification.data.message ?? 'No eligible rider is currently available. Assignment can be retried.',
        };
    }

    if (['listing_moderation_updated', 'listing_moderation_needs_review'].includes(notification.data.type ?? '')) {
        const reasons = [...(notification.data.reasons ?? []), ...(notification.data.flags ?? [])];
        const status = notification.data.moderation_status;
        const approved = status === 'AUTO_APPROVED' || status === 'ADMIN_APPROVED';
        const rejected = status === 'AUTO_REJECTED' || status === 'ADMIN_REJECTED';
        const disabled = status === 'ADMIN_DISABLED';
        return {
            title: approved
                ? `${notification.data.listing_name ?? 'Your listing'} is now active`
                : rejected
                    ? `${notification.data.listing_name ?? 'Your listing'} was rejected`
                    : disabled
                        ? `${notification.data.listing_name ?? 'Your listing'} was disabled`
                        : `${notification.data.listing_name ?? 'Your listing'} needs administrator review`,
            message: reasons.length
                ? `Reason: ${reasons.join(' ')}`
                : approved
                    ? 'The listing passed review and is visible in the marketplace.'
                    : rejected
                        ? 'The listing did not meet FARMGATE marketplace requirements.'
                        : disabled
                            ? 'The listing is not visible in the marketplace.'
                            : 'AI moderation could not approve the listing automatically. It remains pending administrator review.',
        };
    }

    return { title: 'Notification', message: notification.data.message ?? 'You have a new notification.' };
}

export function NotificationsPage({ onOpenOrder, onOpenConversation, onOpenCase, onOpenReview, onOpenListing, onOpenApplication, onOpenVehicleUpdate, onOpenAudit, onOpenDelivery, onOpenEvent, onOpenPromotion, onNotificationsRead, role = 'BUYER' }: {
    onOpenOrder?: (orderId: number, orderReference?: string) => void;
    onOpenConversation?: (conversationId: number) => void;
    onOpenCase?: (caseId: number, caseReference?: string) => void;
    onOpenReview?: (reviewId: number) => void;
    onOpenListing?: (listingId: number) => void;
    onOpenApplication?: (applicationId: number) => void;
    onOpenVehicleUpdate?: (changeId: number) => void;
    onOpenAudit?: (auditId: number) => void;
    onOpenDelivery?: (deliveryId: number) => void;
    onOpenEvent?: (eventId: number) => void;
    onOpenPromotion?: (promotionId: number) => void;
    onNotificationsRead?: (counts?: NotificationUnreadCounts) => void | Promise<void>;
    role?: 'BUYER' | 'SELLER' | 'RIDER' | 'ADMIN';
}) {
    const [notifications, setNotifications] = React.useState<AppNotification[]>([]);
    const [category, setCategory] = React.useState<NotificationCategory>('ALL');
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState('');
    const [readError, setReadError] = React.useState('');
    const [bulkReadCount, setBulkReadCount] = React.useState(0);
    const [bulkReadBusy, setBulkReadBusy] = React.useState(false);
    const [bulkReadMessage, setBulkReadMessage] = React.useState('');
    const [refreshError, setRefreshError] = React.useState('');
    const [browserPermission, setBrowserPermission] = React.useState<NotificationPermission | 'unsupported'>(() => (
        typeof window !== 'undefined' && 'Notification' in window ? window.Notification.permission : 'unsupported'
    ));
    const [browserPermissionMessage, setBrowserPermissionMessage] = React.useState('');
    const [pushConfig, setPushConfig] = React.useState<PushConfig | null>(null);
    const [pushSubscribed, setPushSubscribed] = React.useState(false);
    const [pushBusy, setPushBusy] = React.useState(false);
    const [pushMessage, setPushMessage] = React.useState('');
    const [notificationPreferences, setNotificationPreferences] = React.useState({
        order_notifications: true,
        chat_notifications: true,
        event_notifications: true,
    });
    const seenNotificationIds = React.useRef(new Set<string>());
    const notificationLinkHandled = React.useRef(false);

    async function openNotification(notification: AppNotification) {
        setReadError('');
        const data = notification.data;
        const target = data.case_id ? { type: 'case', id: data.case_id }
            : data.review_id ? { type: 'review', id: data.review_id }
                : data.listing_id ? { type: 'listing', id: data.listing_id }
                    : data.application_id ? { type: 'application', id: data.application_id }
                        : data.vehicle_change_id ? { type: 'vehicle_change', id: data.vehicle_change_id }
                            : data.audit_log_id ? { type: 'audit', id: data.audit_log_id }
                                : data.delivery_id ? { type: 'delivery', id: data.delivery_id }
                                    : data.event_id ? { type: 'event', id: data.event_id }
                                        : data.promotion_id ? { type: 'promotion', id: data.promotion_id }
                                            : data.order_id ? { type: 'order', id: data.order_id }
                                                : data.conversation_id ? { type: 'conversation', id: data.conversation_id } : undefined;
        const hasOpenHandler = Boolean(
            (data.case_id && onOpenCase)
            || (data.review_id && onOpenReview)
            || (data.listing_id && onOpenListing)
            || (data.application_id && onOpenApplication)
            || (data.vehicle_change_id && onOpenVehicleUpdate)
            || (data.audit_log_id && onOpenAudit)
            || (data.delivery_id && onOpenDelivery)
            || (data.event_id && onOpenEvent)
            || (data.promotion_id && onOpenPromotion)
            || (data.order_id && onOpenOrder)
            || (data.conversation_id && onOpenConversation)
            || (data.order_id && onOpenOrder && (data.case_id || data.review_id))
        );
        try {
            const response = await api.post<{ notification: AppNotification; unread_count: number; unread_chat_count: number; bulk_read_count: number }>(`/api/notifications/${notification.id}/read`, {
                target_available: hasOpenHandler,
                target_type: target?.type,
                target_id: target?.id === undefined ? undefined : String(target.id),
            });
            setNotifications((current) => current.map((item) => item.id === notification.id
                ? { ...item, read_at: response.data.notification.read_at ?? item.read_at }
                : item));
            setBulkReadCount(response.data.bulk_read_count);
            onNotificationsRead?.(response.data);
        } catch (requestError) {
            const message = requestError instanceof Error && 'userMessage' in requestError && typeof requestError.userMessage === 'string'
                ? requestError.userMessage
                : 'This notification could not be opened. Refresh and try again.';
            setReadError(message);
            return;
        }

        if (!hasOpenHandler) {
            setReadError('This item is unavailable from the current page or your access has changed. The unavailable link was recorded.');
            return;
        }

        const linkedId = (value: number | string | undefined) => value === undefined ? undefined : Number(value);
        const caseId = linkedId(data.case_id);
        const reviewId = linkedId(data.review_id);
        const listingId = linkedId(data.listing_id);
        const applicationId = linkedId(data.application_id);
        const vehicleChangeId = linkedId(data.vehicle_change_id);
        const auditId = linkedId(data.audit_log_id);
        const deliveryId = linkedId(data.delivery_id);
        const eventId = linkedId(data.event_id);
        const promotionId = linkedId(data.promotion_id);

        if (caseId && onOpenCase) onOpenCase(caseId, data.case_reference);
        else if (reviewId && onOpenReview) onOpenReview(reviewId);
        else if (listingId && onOpenListing) onOpenListing(listingId);
        else if (applicationId && onOpenApplication) onOpenApplication(applicationId);
        else if (vehicleChangeId && onOpenVehicleUpdate) onOpenVehicleUpdate(vehicleChangeId);
        else if (auditId && onOpenAudit) onOpenAudit(auditId);
        else if (deliveryId && onOpenDelivery) onOpenDelivery(deliveryId);
        else if (eventId && onOpenEvent) onOpenEvent(eventId);
        else if (promotionId && onOpenPromotion) onOpenPromotion(promotionId);
        else if (data.order_id && onOpenOrder) onOpenOrder(Number(data.order_id), data.order_reference);
        else if (data.conversation_id && onOpenConversation) onOpenConversation(Number(data.conversation_id));
    }

    React.useEffect(() => {
        let active = true;
        api.get<{ notifications: AppNotification[]; unread_count: number; unread_chat_count: number; bulk_read_count: number; preferences: typeof notificationPreferences }>('/api/notifications')
            .then(async (response) => {
                if (!active) return;
                seenNotificationIds.current = new Set(response.data.notifications.map((notification) => notification.id));
                setNotifications(response.data.notifications);
                setBulkReadCount(response.data.bulk_read_count ?? 0);
                setNotificationPreferences(response.data.preferences);
                onNotificationsRead?.(response.data);
            })
            .catch((requestError: { userMessage?: string }) => {
                if (active) setError(requestError.userMessage ?? 'Notifications could not be loaded.');
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => { active = false; };
    }, [onNotificationsRead]);

    React.useEffect(() => {
        let active = true;
        const refreshOnFocus = () => {
            api.get<{ notifications: AppNotification[]; unread_count: number; unread_chat_count: number; bulk_read_count: number; preferences: typeof notificationPreferences }>('/api/notifications')
                .then((response) => {
                    if (!active) return;
                    seenNotificationIds.current = new Set(response.data.notifications.map((notification) => notification.id));
                    setNotifications(response.data.notifications);
                    setBulkReadCount(response.data.bulk_read_count);
                    setNotificationPreferences(response.data.preferences);
                    setRefreshError('');
                    onNotificationsRead?.(response.data);
                })
                .catch((requestError: { userMessage?: string }) => {
                    if (active) setRefreshError(requestError.userMessage ?? 'Notifications could not be refreshed.');
                });
        };
        window.addEventListener('focus', refreshOnFocus);
        return () => {
            active = false;
            window.removeEventListener('focus', refreshOnFocus);
        };
    }, [onNotificationsRead]);

    React.useEffect(() => {
        const notificationId = new URLSearchParams(window.location.search).get('notification');
        if (!notificationId || notificationLinkHandled.current || loading || error) return;

        notificationLinkHandled.current = true;
        const notification = notifications.find((item) => item.id === notificationId);
        const url = new URL(window.location.href);
        url.searchParams.delete('notification');
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
        if (notification) {
            void openNotification(notification);
        } else {
            setReadError('This notification is no longer available to your account.');
        }
    }, [error, loading, notifications]);

    React.useEffect(() => {
        let active = true;
        api.get<PushConfig>('/api/notifications/push-config')
            .then(async ({ data }) => {
                if (!active) return;
                setPushConfig(data);
                if (!data.enabled
                    || browserPermission !== 'granted'
                    || !('serviceWorker' in navigator)
                    || !('PushManager' in window)) return;

                const registration = await navigator.serviceWorker.register('/service-worker.js');
                let subscription = await registration.pushManager.getSubscription();
                const serverKey = decodePushKey(data.public_key ?? '');
                if (subscription && !samePushKey(subscription.options.applicationServerKey, serverKey)) {
                    await subscription.unsubscribe();
                    subscription = null;
                }
                if (!subscription) return;

                const serialized = subscription.toJSON();
                if (serialized.endpoint && serialized.keys?.p256dh && serialized.keys.auth) {
                    await api.post('/api/notifications/push-subscriptions', {
                        endpoint: serialized.endpoint,
                        expirationTime: serialized.expirationTime,
                        keys: serialized.keys,
                        contentEncoding: 'aes128gcm',
                    });
                    if (active) setPushSubscribed(true);
                }
            })
            .catch((requestError: { userMessage?: string }) => {
                if (active) setPushMessage(requestError.userMessage ?? 'Device notification settings could not be loaded.');
            });

        return () => { active = false; };
    }, [browserPermission]);

    React.useEffect(() => {
        if (browserPermission === 'unsupported') return undefined;
        const timer = window.setInterval(() => {
            api.get<{ notifications: AppNotification[]; unread_count: number; unread_chat_count: number; bulk_read_count: number; preferences: typeof notificationPreferences }>('/api/notifications')
                .then((response) => {
                    setNotificationPreferences(response.data.preferences);
                    const fresh = response.data.notifications.filter((notification) => !seenNotificationIds.current.has(notification.id));
                    for (const notification of fresh) {
                        seenNotificationIds.current.add(notification.id);
                        const criticalOrderUpdate = notification.data.type === 'order_status_changed'
                            && ['CANCELLED', 'REJECTED'].includes(notification.data.status ?? '');
                        const humanAttention = notification.data.type === 'chat_message' && notification.data.attention_required === true;
                        const calendarUpdate = notification.data.type === 'calendar_event'
                            && ['approved', 'cancelled', 'upcoming'].includes(notification.data.action ?? '');
                        const promotionUpdate = notification.data.type === 'promotion_changed';
                        const preferenceEnabled = notification.data.type === 'chat_message'
                            ? notificationPreferences.chat_notifications
                            : notification.data.type === 'calendar_event'
                                ? notificationPreferences.event_notifications
                                : notificationPreferences.order_notifications;
                        if (pushSubscribed
                            || browserPermission !== 'granted'
                            || window.Notification.permission !== 'granted'
                            || !preferenceEnabled
                            || (!criticalOrderUpdate && !humanAttention && !calendarUpdate && !promotionUpdate)) continue;
                        const content = notificationContent(notification, role);
                        const alert = new window.Notification(content.title, { body: content.message, tag: notification.id });
                        alert.onclick = () => {
                            window.focus();
                            void openNotification(notification);
                            alert.close();
                        };
                    }
                    setNotifications(response.data.notifications);
                    setBulkReadCount(response.data.bulk_read_count ?? 0);
                    setRefreshError('');
                    onNotificationsRead?.(response.data);
                })
                .catch((requestError: { userMessage?: string }) => {
                    setRefreshError(requestError.userMessage ?? 'New notifications could not be checked.');
                });
        }, 30000);

        return () => window.clearInterval(timer);
    }, [browserPermission, notificationPreferences.chat_notifications, notificationPreferences.event_notifications, notificationPreferences.order_notifications, onNotificationsRead, onOpenConversation, onOpenOrder, pushSubscribed, role]);

    async function enableBrowserNotifications(): Promise<void> {
        if (browserPermission === 'unsupported' || !('serviceWorker' in navigator) || !('PushManager' in window) || !window.isSecureContext) {
            setBrowserPermissionMessage('Background device notifications are not supported here. In-app notifications and email remain available.');
            return;
        }
        if (!pushConfig?.enabled || !pushConfig.public_key) {
            setBrowserPermissionMessage('Device notifications are not configured on this Farmgate server. In-app notifications and email remain available.');
            return;
        }
        setPushBusy(true);
        try {
            const permission = await window.Notification.requestPermission();
            setBrowserPermission(permission);
            if (permission !== 'granted') {
                setBrowserPermissionMessage('Device permission was not granted. Farmgate will keep in-app notifications and email available.');
                return;
            }

            const registration = await navigator.serviceWorker.register('/service-worker.js');
            const serverKey = decodePushKey(pushConfig.public_key);
            let subscription = await registration.pushManager.getSubscription();
            if (subscription && !samePushKey(subscription.options.applicationServerKey, serverKey)) {
                await subscription.unsubscribe();
                subscription = null;
            }
            subscription ??= await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: serverKey,
            });
            const serialized = subscription.toJSON();
            if (!serialized.endpoint || !serialized.keys?.p256dh || !serialized.keys.auth) {
                throw new Error('The browser returned an incomplete device subscription.');
            }
            await api.post('/api/notifications/push-subscriptions', {
                endpoint: serialized.endpoint,
                expirationTime: serialized.expirationTime,
                keys: serialized.keys,
                contentEncoding: 'aes128gcm',
            });
            setPushSubscribed(true);
            setBrowserPermissionMessage('Device notifications are enabled. Important updates can appear even when the notifications page is closed.');
        } catch (requestError) {
            setBrowserPermissionMessage(requestError instanceof Error
                ? `Device notifications could not be enabled: ${requestError.message}`
                : 'Device notifications could not be enabled. In-app notifications and email remain available.');
        } finally {
            setPushBusy(false);
        }
    }

    async function disableDeviceNotifications(): Promise<void> {
        setPushBusy(true);
        try {
            const registration = await navigator.serviceWorker.getRegistration('/service-worker.js');
            const subscription = await registration?.pushManager.getSubscription();
            if (subscription) {
                await api.delete('/api/notifications/push-subscriptions', { data: { endpoint: subscription.endpoint } });
                await subscription.unsubscribe();
            }
            setPushSubscribed(false);
            setBrowserPermissionMessage('Device notifications are disabled for this browser. In-app notifications and email remain available.');
        } catch (requestError) {
            setBrowserPermissionMessage(requestError instanceof Error
                ? `Device notifications could not be disabled: ${requestError.message}`
                : 'Device notification settings could not be updated.');
        } finally {
            setPushBusy(false);
        }
    }

    async function markAllAsRead(): Promise<void> {
        if (bulkReadBusy || bulkReadCount === 0) return;
        setBulkReadBusy(true);
        setReadError('');
        setBulkReadMessage('');
        try {
            const response = await api.post<{
                marked_count: number;
                marked_ids: string[];
                bulk_read_count: number;
                unread_count: number;
                unread_chat_count: number;
            }>('/api/notifications/read');
            const markedIds = new Set(response.data.marked_ids);
            const readAt = new Date().toISOString();
            setNotifications((current) => current.map((notification) => (
                markedIds.has(notification.id)
                    ? { ...notification, read_at: notification.read_at ?? readAt }
                    : notification
            )));
            setBulkReadCount(response.data.bulk_read_count ?? 0);
            setBulkReadMessage(response.data.marked_count
                ? `${response.data.marked_count} informational notification${response.data.marked_count === 1 ? '' : 's'} marked as read. Critical alerts remain unread until opened or acknowledged.`
                : 'There are no unread informational notifications to mark as read.');
            onNotificationsRead?.(response.data);
        } catch (requestError) {
            const message = requestError instanceof Error && 'userMessage' in requestError && typeof requestError.userMessage === 'string'
                ? requestError.userMessage
                : 'Notifications could not be marked as read. Try again.';
            setReadError(message);
        } finally {
            setBulkReadBusy(false);
        }
    }

    async function acknowledgeNotification(notification: AppNotification): Promise<void> {
        setReadError('');
        try {
            const response = await api.post<{ notification: AppNotification; unread_count: number; unread_chat_count: number; bulk_read_count: number }>(`/api/notifications/${notification.id}/read`);
            setNotifications((current) => current.map((item) => item.id === notification.id
                ? { ...item, read_at: response.data.notification.read_at ?? item.read_at }
                : item));
            setBulkReadCount(response.data.bulk_read_count);
            onNotificationsRead?.(response.data);
        } catch (requestError) {
            const message = requestError instanceof Error && 'userMessage' in requestError && typeof requestError.userMessage === 'string'
                ? requestError.userMessage
                : 'This notification could not be acknowledged. Try again.';
            setReadError(message);
        }
    }

    const filteredNotifications = notifications.filter((notification) => category === 'ALL' || categoryFor(notification) === category);

    return <section className="buyer-notifications" aria-label="Notifications">
        <div className="buyer-notification-device-alerts">
            <button type="button" onClick={() => void enableBrowserNotifications()} disabled={pushBusy || pushSubscribed || browserPermission === 'unsupported' || pushConfig?.enabled === false}>
                {pushBusy ? 'Updating...' : pushSubscribed ? 'Device notifications enabled' : 'Enable device notifications'}
            </button>
            {pushSubscribed && <button type="button" onClick={() => void disableDeviceNotifications()} disabled={pushBusy}>Disable on this device</button>}
            <p aria-live="polite">
                {browserPermissionMessage || pushMessage || (browserPermission === 'unsupported' || !('serviceWorker' in navigator) || !('PushManager' in window)
                    ? 'Device notifications are unavailable on this browser or device. In-app notifications and email remain available.'
                    : browserPermission === 'denied'
                        ? 'Device notification permission is blocked in browser settings. In-app notifications and email remain available.'
                        : pushConfig?.enabled === false
                            ? 'Device notifications are not configured on this Farmgate server. In-app notifications and email remain available.'
                            : 'Allow browser permission to receive important updates on this device, even when Farmgate is closed.')}
            </p>
        </div>
        <nav className="buyer-notification-filters" aria-label="Filter notifications" role="tablist">
            {categories.map((item) => <button type="button" role="tab" aria-selected={category === item.id} className={category === item.id ? 'active' : ''} key={item.id} onClick={() => setCategory(item.id)}>{item.label}</button>)}
        </nav>
        {(bulkReadCount > 0 || notifications.some((notification) => !notification.read_at && notification.data.type !== 'chat_message')) && <div className="buyer-notification-bulk-actions">
            <p>Critical alerts remain unread until opened or acknowledged.</p>
            <button type="button" onClick={() => void markAllAsRead()} disabled={bulkReadBusy || bulkReadCount === 0} aria-busy={bulkReadBusy}>
                {bulkReadBusy ? 'Marking…' : 'Mark all as read'}
            </button>
        </div>}
        {bulkReadMessage && <p className="buyer-notifications-state" role="status">{bulkReadMessage}</p>}
        <div className="buyer-notification-content" aria-live="polite">
            {loading ? <LoadingSkeleton variant="list" count={4} label="Loading notifications" /> : error ? <p className="buyer-notifications-state error" role="alert">{error}</p> : <>
                {readError && <p className="buyer-notifications-state error" role="alert">{readError}</p>}
                {refreshError && <p className="buyer-notifications-state error" role="alert">{refreshError}</p>}
                {filteredNotifications.length ? <div className="buyer-notification-list">
                    {filteredNotifications.map((notification) => {
                        const content = notificationContent(notification, role);
                        return <article className={`buyer-notification${notification.read_at ? '' : ' unread'}`} key={notification.id}>
                            <div><strong>{content.title}</strong><span>{notification.read_at ? 'Read' : 'Unread'}</span><time dateTime={notification.created_at}>{new Date(notification.created_at).toLocaleString()}</time></div>
                            <p>{content.message}</p>
                            {notification.delivery_statuses?.length ? <p className="buyer-notification-delivery-status" aria-label="Notification delivery status">
                                Delivery: {notification.delivery_statuses.map((delivery) => deliveryStatusLabel(delivery.channel, delivery.status)).join(' · ')}
                            </p> : null}
                            {notification.data.order_id || notification.data.conversation_id || notification.data.case_id || notification.data.review_id || notification.data.listing_id || notification.data.application_id || notification.data.vehicle_change_id || notification.data.audit_log_id || notification.data.delivery_id || notification.data.event_id || notification.data.promotion_id
                                ? <ViewDetailsAction
                                    contextLabel={content.title}
                                    onClick={() => void openNotification(notification)}
                                />
                                : <span className="buyer-notification-unavailable">No related item is available for this notification.</span>}
                            {notification.is_critical && notification.data.type !== 'chat_message' && !notification.read_at && <button type="button" onClick={() => void acknowledgeNotification(notification)}>Acknowledge</button>}
                        </article>;
                    })}
                </div> : <div className="buyer-notifications-empty">
                    <svg aria-hidden="true" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 39h12M24 6a4 4 0 0 1 4 4c5 1.5 8 5.5 8 12v7l4 5H8l4-5v-7c0-6.5 3-10.5 8-12a4 4 0 0 1 4-4Z" /><path d="m8 8 32 32" /></svg>
                    <p>No notifications yet</p>
                </div>}
            </>}
        </div>
    </section>;
}
