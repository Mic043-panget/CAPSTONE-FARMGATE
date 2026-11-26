import React from 'react';
import api from '../../lib/api';
import { ViewDetailsAction } from '../../shared/components/Button';
import { LoadingSkeleton } from '../../shared/components/LoadingSkeleton';
import { NotificationDeviceSettingsControls, useDeviceNotificationSettings } from './NotificationDeviceSettings';

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

type NotificationUnreadCounts = { unread_count: number; unread_chat_count: number };

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

const notificationPageSize = 10;

function categoryFor(notification: AppNotification): NotificationCategory {
    if (notification.data.type?.startsWith('order_')
        || notification.data.type === 'rider_assignment_waiting'
        || notification.data.type === 'delivery_proof_recorded') return 'ORDERS';
    if (notification.data.type?.startsWith('chat_')) return 'CHATS';
    return 'SYSTEM';
}

function notificationIconFor(notification: AppNotification): 'order' | 'chat' | 'rider' | 'payment' | 'system' {
    const type = `${notification.data.type ?? ''} ${notification.type}`.toLowerCase();
    if (type.includes('chat')) return 'chat';
    if (type.includes('payment') || type.includes('cod') || type.includes('payout') || type.includes('remittance')) return 'payment';
    if (type.includes('rider') || type.includes('delivery')) return 'rider';
    if (type.includes('order')) return 'order';
    return 'system';
}

function NotificationIcon({ kind }: { kind: 'all' | 'order' | 'chat' | 'rider' | 'payment' | 'system' }) {
    return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {kind === 'all' ? <><path d="m12 3 8 4-8 4-8-4 8-4Z" /><path d="m4 12 8 4 8-4M4 17l8 4 8-4" /></>
            : kind === 'order' ? <><path d="M3 5h2l2.2 10.2a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 1.9-1.4L21 9H6" /><circle cx="10" cy="20" r="1" /><circle cx="18" cy="20" r="1" /></>
                : kind === 'chat' ? <><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H7l-4 2v-5.2A7.5 7.5 0 1 1 20 11.5Z" /><path d="M8 11h.01M12 11h.01M16 11h.01" /></>
                    : kind === 'rider' ? <><circle cx="7" cy="17" r="3" /><circle cx="18" cy="17" r="3" /><path d="M7 17h5l3-6h3l3 6M12 17l-2-5H7M15 7h2l2 4M14 5h.01" /></>
                        : kind === 'payment' ? <><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3M4 17c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>
                            : <><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2M12 19.2v2M4.7 4.7l1.4 1.4m11.8 11.8 1.4 1.4M2.8 12h2m14.4 0h2M4.7 19.3l1.4-1.4M17.9 6.1l1.4-1.4" /></>}
    </svg>;
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
    if (notification.data.type === 'seller_review_report_status') {
        return { title: `Review report · ${notification.data.review_reference ?? 'Review'}`, message: notification.data.message ?? 'There is an update to your review report.' };
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

export function NotificationsPage({ onOpenOrder, onOpenConversation, onOpenCase, onOpenReview, onOpenListing, onOpenApplication, onOpenVehicleUpdate, onOpenAudit, onOpenDelivery, onOpenEvent, onOpenPromotion, onNotificationsRead, onOpenSettings, role = 'BUYER' }: {
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
    onOpenSettings?: () => void;
    role?: 'BUYER' | 'SELLER' | 'RIDER' | 'ADMIN';
}) {
    const [notifications, setNotifications] = React.useState<AppNotification[]>([]);
    const [category, setCategory] = React.useState<NotificationCategory>('ALL');
    const [currentPage, setCurrentPage] = React.useState(1);
    const [selectedNotificationId, setSelectedNotificationId] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState('');
    const [readError, setReadError] = React.useState('');
    const [bulkReadCount, setBulkReadCount] = React.useState(0);
    const [bulkReadBusy, setBulkReadBusy] = React.useState(false);
    const [bulkReadMessage, setBulkReadMessage] = React.useState('');
    const [refreshError, setRefreshError] = React.useState('');
    const {
        browserPermission,
        pushSubscribed,
        enableBrowserNotifications,
        disableDeviceNotifications,
        ...deviceNotificationSettings
    } = useDeviceNotificationSettings();
    const [notificationPreferences, setNotificationPreferences] = React.useState({
        order_notifications: true,
        chat_notifications: true,
        event_notifications: true,
    });
    const seenNotificationIds = React.useRef(new Set<string>());
    const notificationLinkHandled = React.useRef(false);

    function hasAvailableDestination(notification: AppNotification): boolean {
        const data = notification.data;
        return Boolean(
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
        );
    }

    function hasRelatedItem(notification: AppNotification): boolean {
        const data = notification.data;
        return Boolean(data.order_id || data.conversation_id || data.case_id || data.review_id || data.listing_id
            || data.application_id || data.vehicle_change_id || data.audit_log_id || data.delivery_id
            || data.event_id || data.promotion_id);
    }

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
        const hasOpenHandler = hasAvailableDestination(notification);
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
            setSelectedNotificationId(notification.id);
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

    function viewNotification(notification: AppNotification): void {
        if (hasRelatedItem(notification)) {
            void openNotification(notification);
            return;
        }

        setSelectedNotificationId((selectedId) => selectedId === notification.id ? null : notification.id);
        if (!notification.read_at && notification.data.type !== 'chat_message') {
            void acknowledgeNotification(notification);
        }
    }

    const filteredNotifications = notifications.filter((notification) => category === 'ALL' || categoryFor(notification) === category);
    const pageCount = Math.max(1, Math.ceil(filteredNotifications.length / notificationPageSize));
    const safePage = Math.min(currentPage, pageCount);
    const pageStart = (safePage - 1) * notificationPageSize;
    const pageNotifications = filteredNotifications.slice(pageStart, pageStart + notificationPageSize);
    const pageEnd = Math.min(pageStart + pageNotifications.length, filteredNotifications.length);

    return <section className="buyer-notifications" aria-label="Notifications">
        {role !== 'BUYER' && <NotificationDeviceSettingsControls
            {...deviceNotificationSettings}
            browserPermission={browserPermission}
            pushSubscribed={pushSubscribed}
            enableBrowserNotifications={enableBrowserNotifications}
            disableDeviceNotifications={disableDeviceNotifications}
        />}
        <div className="farmgate-notification-filter-bar">
            <nav className="farmgate-notification-filters" aria-label="Filter notifications" role="tablist">
                {categories.map((item) => <button type="button" role="tab" aria-selected={category === item.id} className={category === item.id ? 'active' : ''} key={item.id} onClick={() => { setCategory(item.id); setCurrentPage(1); setSelectedNotificationId(null); }}>
                    <NotificationIcon kind={item.id === 'ALL' ? 'all' : item.id === 'ORDERS' ? 'order' : item.id === 'CHATS' ? 'chat' : 'system'} />
                    <span>{item.label}</span>
                </button>)}
            </nav>
            {role === 'BUYER' && onOpenSettings && <button
                type="button"
                className="buyer-notification-settings"
                aria-label="Notification settings"
                title="Notification settings"
                onClick={onOpenSettings}
            >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.2 1-.9 1.7-1.5-.5a8 8 0 0 1-1.7 1l-.3 1.6h-2l-.4-1.5a8 8 0 0 1-1.9 0l-.7 1.4-1.8-.8.3-1.6a8 8 0 0 1-1.4-1.4l-1.6.3-.7-1.8 1.4-.8a8 8 0 0 1 0-1.9l-1.4-.7.8-1.8 1.6.3a8 8 0 0 1 1.4-1.4l-.3-1.6 1.8-.7.8 1.4a8 8 0 0 1 1.9 0l.7-1.4 1.8.8-.3 1.6a8 8 0 0 1 1.4 1.4l1.6-.3.7 1.8-1.4.8a8 8 0 0 1 0 1.9Z" /></svg>
            </button>}
        </div>
        {(bulkReadCount > 0 || notifications.some((notification) => !notification.read_at && notification.data.type !== 'chat_message')) && <div className="farmgate-notification-bulk-actions">
            <p>Critical alerts remain unread until opened or acknowledged.</p>
            <button type="button" onClick={() => void markAllAsRead()} disabled={bulkReadBusy || bulkReadCount === 0} aria-busy={bulkReadBusy}>
                {bulkReadBusy ? 'Marking…' : 'Mark all as read'}
            </button>
        </div>}
        {bulkReadMessage && <p className="buyer-notifications-state" role="status">{bulkReadMessage}</p>}
        <div className="farmgate-notification-list-panel" aria-live="polite" aria-busy={loading}>
            {loading ? <LoadingSkeleton variant="list" count={4} label="Loading notifications" /> : error ? <p className="buyer-notifications-state error" role="alert">{error}</p> : <>
                {readError && <p className="buyer-notifications-state error" role="alert">{readError}</p>}
                {refreshError && <p className="buyer-notifications-state error" role="alert">{refreshError}</p>}
                {filteredNotifications.length ? <>
                    <div className="farmgate-notification-list">
                    {pageNotifications.map((notification) => {
                        const content = notificationContent(notification, role);
                        const selected = selectedNotificationId === notification.id;
                        const iconKind = notificationIconFor(notification);
                        return <article className={`farmgate-notification-row${notification.read_at ? '' : ' is-unread'}${notification.is_critical ? ' is-critical' : ''}`} key={notification.id}>
                            <span className={`farmgate-notification-icon is-${iconKind}`}><NotificationIcon kind={iconKind} /></span>
                            <div className="farmgate-notification-copy">
                                <div className="farmgate-notification-heading">
                                    <strong>{content.title}</strong>
                                    <span className={`farmgate-notification-status${notification.read_at ? '' : ' is-unread'}`}>{notification.read_at ? 'Read' : 'Unread'}</span>
                                    {notification.is_critical && <span className="farmgate-notification-critical">Critical</span>}
                                </div>
                                <p>{content.message}</p>
                                {notification.delivery_statuses?.length ? <p className="farmgate-notification-delivery" aria-label="Notification delivery status">
                                    <NotificationIcon kind="payment" />
                                    {notification.delivery_statuses.map((delivery) => deliveryStatusLabel(delivery.channel, delivery.status)).join(' · ')}
                                </p> : null}
                            </div>
                            <time className="farmgate-notification-time" dateTime={notification.created_at}>{new Date(notification.created_at).toLocaleString()}</time>
                            <div className="farmgate-notification-actions">
                                <ViewDetailsAction
                                    className="farmgate-notification-details-action"
                                    contextLabel={content.title}
                                    expanded={selected}
                                    controls={`notification-details-${notification.id}`}
                                    onClick={() => viewNotification(notification)}
                                />
                                {notification.is_critical && notification.data.type !== 'chat_message' && !notification.read_at && <button className="farmgate-notification-acknowledge" type="button" onClick={() => void acknowledgeNotification(notification)}>Acknowledge</button>}
                            </div>
                            {selected && <div className="farmgate-notification-details" id={`notification-details-${notification.id}`}>
                                <strong>{content.title}</strong>
                                <p>{content.message}</p>
                                <p><span>Received</span><time dateTime={notification.created_at}>{new Date(notification.created_at).toLocaleString()}</time></p>
                                {notification.delivery_statuses?.length ? <p><span>Delivery</span>{notification.delivery_statuses.map((delivery) => deliveryStatusLabel(delivery.channel, delivery.status)).join(' · ')}</p> : null}
                                {!hasAvailableDestination(notification) && <p className="farmgate-notification-no-destination">No related page is available for this notification.</p>}
                            </div>}
                        </article>;
                    })}
                    </div>
                    <footer className="farmgate-notification-pagination">
                        <p>Showing {pageStart + 1}–{pageEnd} of {filteredNotifications.length} records</p>
                        <div>
                            <button type="button" aria-label="Previous page" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={safePage <= 1}>‹</button>
                            <span aria-current="page">{safePage}</span>
                            <button type="button" aria-label="Next page" onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))} disabled={safePage >= pageCount}>›</button>
                        </div>
                    </footer>
                </> : <div className="buyer-notifications-empty">
                    <svg aria-hidden="true" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 39h12M24 6a4 4 0 0 1 4 4c5 1.5 8 5.5 8 12v7l4 5H8l4-5v-7c0-6.5 3-10.5 8-12a4 4 0 0 1 4-4Z" /><path d="m8 8 32 32" /></svg>
                    <p>No notifications yet</p>
                </div>}
            </>}
        </div>
    </section>;
}
