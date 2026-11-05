import React from 'react';
import api from '../../lib/api';

type NotificationCategory = 'ALL' | 'ORDERS' | 'CHATS' | 'SYSTEM';

type AppNotification = {
    id: string;
    type: string;
    data: {
        type?: string;
        order_id?: number | string;
        order_reference?: string;
        status?: string;
        buyer_name?: string;
        reason?: string | null;
        message?: string;
        listing_name?: string;
        moderation_status?: string;
        reasons?: string[];
        flags?: string[];
        conversation_id?: number;
        sender_name?: string;
    };
    read_at: string | null;
    created_at: string;
};

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

function notificationContent(notification: AppNotification, role: 'BUYER' | 'SELLER' | 'RIDER'): { title: string; message: string } {
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
            title: `Rider assigned to order${orderReference}`,
            message: notification.data.message ?? 'A rider has accepted your delivery.',
        };
    }

    if (notification.data.type === 'rider_offer_available') {
        return {
            title: `Delivery offer${notification.data.order_reference ? ` · ${notification.data.order_reference}` : ''}`,
            message: notification.data.message ?? 'A delivery offer is available for review.',
        };
    }

    if (notification.data.type === 'order_delivery_status_changed') {
        return {
            title: `Delivery update${notification.data.order_reference ? ` · ${notification.data.order_reference}` : ''}`,
            message: notification.data.message ?? 'The delivery status has changed.',
        };
    }

    if (notification.data.type === 'delivery_proof_recorded') {
        return {
            title: `Proof of delivery recorded${notification.data.order_reference ? ` · ${notification.data.order_reference}` : ''}`,
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
        return {
            title: `New message from ${notification.data.sender_name ?? 'a user'}`,
            message: 'Open the conversation to read the message.',
        };
    }

    if (notification.data.type === 'rider_assignment_waiting') {
        const orderReference = notification.data.order_reference ? ` ${notification.data.order_reference}` : '';
        return {
            title: `Rider assignment pending for order${orderReference}`,
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

export function NotificationsPage({ onOpenOrder, onOpenConversation, onNotificationsRead, role = 'BUYER' }: {
    onOpenOrder?: (orderId: number) => void;
    onOpenConversation?: (conversationId: number) => void;
    onNotificationsRead?: () => void;
    role?: 'BUYER' | 'SELLER' | 'RIDER';
}) {
    const [notifications, setNotifications] = React.useState<AppNotification[]>([]);
    const [category, setCategory] = React.useState<NotificationCategory>('ALL');
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState('');
    const [readError, setReadError] = React.useState('');

    React.useEffect(() => {
        let active = true;
        api.get<{ notifications: AppNotification[]; unread_count: number }>('/api/notifications')
            .then(async (response) => {
                if (!active) return;
                setNotifications(response.data.notifications);
                if (response.data.unread_count === 0) {
                    onNotificationsRead?.();
                    return;
                }
                try {
                    await api.post('/api/notifications/read');
                    if (!active) return;
                    const readAt = new Date().toISOString();
                    setNotifications(response.data.notifications.map((notification) => ({
                        ...notification,
                        read_at: notification.data.type === 'chat_message' ? notification.read_at : notification.read_at ?? readAt,
                    })));
                    onNotificationsRead?.();
                } catch (requestError) {
                    const message = requestError instanceof Error && 'userMessage' in requestError && typeof requestError.userMessage === 'string'
                        ? requestError.userMessage
                        : 'Notifications could not be marked as read.';
                    if (active) setReadError(message);
                }
            })
            .catch((requestError: { userMessage?: string }) => {
                if (active) setError(requestError.userMessage ?? 'Notifications could not be loaded.');
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => { active = false; };
    }, [onNotificationsRead]);

    const filteredNotifications = notifications.filter((notification) => category === 'ALL' || categoryFor(notification) === category);

    return <section className="buyer-notifications" aria-labelledby="buyer-notifications-title">
        <header className="buyer-notifications-heading">
            <span aria-hidden="true">🔔</span>
            <h1 id="buyer-notifications-title">Notifications</h1>
        </header>
        <nav className="buyer-notification-filters" aria-label="Filter notifications" role="tablist">
            {categories.map((item) => <button type="button" role="tab" aria-selected={category === item.id} className={category === item.id ? 'active' : ''} key={item.id} onClick={() => setCategory(item.id)}>{item.label}</button>)}
        </nav>
        <div className="buyer-notification-content" aria-live="polite">
            {loading ? <p className="buyer-notifications-state">Loading notifications...</p> : error ? <p className="buyer-notifications-state error" role="alert">{error}</p> : <>
                {readError && <p className="buyer-notifications-state error" role="alert">{readError}</p>}
                {filteredNotifications.length ? <div className="buyer-notification-list">
                    {filteredNotifications.map((notification) => {
                        const content = notificationContent(notification, role);
                        return <article className={`buyer-notification${notification.read_at ? '' : ' unread'}`} key={notification.id}>
                            <div><strong>{content.title}</strong><time dateTime={notification.created_at}>{new Date(notification.created_at).toLocaleString()}</time></div>
                            <p>{content.message}</p>
                            {notification.data.order_id && onOpenOrder && <button type="button" onClick={() => onOpenOrder(Number(notification.data.order_id))}>View order</button>}
                            {notification.data.conversation_id && onOpenConversation && <button type="button" onClick={() => onOpenConversation(Number(notification.data.conversation_id))}>View chat</button>}
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
