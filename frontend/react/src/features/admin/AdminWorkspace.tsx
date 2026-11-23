import React from 'react';
import { AdminDashboard } from './AdminDashboard';
import { AdminDataTable } from './AdminDataTable';
import { ComplaintQueue } from './ComplaintQueue';
import { ReviewQueue } from './ReviewQueue';
import { ListingQueue } from './ListingQueue';
import { ReportPanel } from '../shared/ReportPanel';
import { AdminSettings } from './AdminSettings';
import { AuditHistory } from './AuditHistory';
import { AIChatPage, type ChatReportContext } from '../shared/AIChatPage';
import { AdminOrderReceipt } from './AdminOrderReceipt';
import { NotificationsPage } from '../buyer/NotificationsPage';
import { AdminRiderPage } from './AdminRiderPage';
import { UserAccountActions } from './UserAccountActions';
import { AdminPromotionsPage } from './AdminPromotionsPage';
import { AdminDeliveryDetails } from './AdminDeliveryDetails';
import { AdminPaymentsPage } from './AdminPaymentsPage';
import api from '../../lib/api';
import { WorkspaceAccountControl, WorkspaceMobileHeader, useWorkspaceMobileMenu } from '../shared/WorkspaceMobileHeader';
import { WorkspaceBannerArtwork } from '../shared/WorkspaceBannerArtwork';
import { RoleMobileBottomNavigation } from '../shared/RoleMobileBottomNavigation';
import { FarmgateBrand } from '../shared/FarmgateBrand';
import { WorkspaceSidebarIcon } from '../shared/WorkspaceSidebarIcon';

type Page = 'dashboard' | 'users' | 'listings' | 'orders' | 'transactions' | 'payments' | 'deliveries' | 'categories' | 'complaints' | 'reviews' | 'rider' | 'promotions' | 'notifications' | 'reports' | 'chats' | 'security' | 'settings';
type AdminWorkspaceProps = { onError: (message: string) => void; onLogout: () => void; userName: string; profilePhotoUrl?: string | null };

const primaryNavigation: { id: Page; label: string; icon: string }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: '◈' },
    { id: 'users', label: 'Users & accounts', icon: '♙' },
    { id: 'listings', label: 'Listings', icon: '▤' },
    { id: 'orders', label: 'Orders', icon: '□' },
    { id: 'transactions', label: 'Transactions', icon: '⇄' },
    { id: 'payments', label: 'Payments', icon: '₱' },
    { id: 'deliveries', label: 'Deliveries', icon: '↗' },
    { id: 'categories', label: 'Categories', icon: '⌘' },
    { id: 'complaints', label: 'Complaints & disputes', icon: '!' },
    { id: 'reviews', label: 'Review moderation', icon: '★' },
    { id: 'rider', label: 'Rider', icon: '♧' },
    { id: 'promotions', label: 'Promotions', icon: '％' },
    { id: 'notifications', label: 'Notifications', icon: '✉' },
    { id: 'reports', label: 'Reports', icon: '▥' },
    { id: 'chats', label: 'Chats', icon: '✦' },
    { id: 'security', label: 'Security', icon: '◉' },
    { id: 'settings', label: 'System settings', icon: '⚙' },
];
const mobileDrawerExcludedPages: Page[] = ['listings', 'chats', 'notifications'];
const adminMobileDestinations = [
    { id: 'dashboard', label: 'Home', icon: 'home' },
    { id: 'chats', label: 'Chats', icon: 'chat' },
    { id: 'listings', label: 'Listings', icon: 'document' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
] as const;

const userRoleTabs = [
    { label: 'All accounts', value: '' },
    { label: 'Buyers', value: 'BUYER' },
    { label: 'Sellers', value: 'SELLER' },
    { label: 'Riders', value: 'RIDER' },
    { label: 'Admins', value: 'ADMIN' },
];

function userVerificationLabel(row: Record<string, any>): string {
    const emailVerified = Boolean(row.email_verified_at);
    const phoneVerified = Boolean(row.phone_verified_at);
    if (emailVerified && phoneVerified) return 'Verified · email and mobile';
    if (emailVerified) return 'Verified · email';
    if (phoneVerified) return 'Verified · mobile';
    return 'Not verified';
}

function userJoinDate(value: unknown): string {
    if (typeof value !== 'string' || !value) return 'Date unavailable';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString();
}

const orderStatusTabs = [
    { label: 'All', value: '' },
    { label: 'Pending Confirmation', value: 'PENDING_CONFIRMATION' },
    { label: 'Confirmed', value: 'CONFIRMED' },
    { label: 'Preparing', value: 'PREPARING' },
    { label: 'Ready for Pickup', value: 'READY_FOR_PICKUP' },
    { label: 'On the Way', value: 'FULFILLING' },
    { label: 'Delivered', value: 'DELIVERED' },
    { label: 'Completed', value: 'COMPLETED' },
    { label: 'Cancelled', value: 'CANCELLED' },
    { label: 'Rejected', value: 'REJECTED' },
];

const orderStatusLabels: Record<string, string> = {
    PENDING_CONFIRMATION: 'Pending Confirmation',
    CONFIRMED: 'Confirmed',
    PREPARING: 'Preparing',
    READY_FOR_PICKUP: 'Ready for Pickup',
    FULFILLING: 'On the Way',
    'ON THE WAY': 'On the Way',
    DELIVERED: 'Delivered',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
    REJECTED: 'Rejected',
};

function orderStatusLabel(value: unknown): string {
    if (typeof value !== 'string' || !value) return 'Status unavailable';
    return orderStatusLabels[value] ?? value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function orderStatusTone(value: unknown): 'pending' | 'complete' | 'cancelled' | 'progress' {
    const status = typeof value === 'string' ? value.toUpperCase() : '';
    if (status.includes('PENDING')) return 'pending';
    if (status.includes('CANCELLED') || status.includes('REJECTED')) return 'cancelled';
    if (status.includes('COMPLETED') || status.includes('DELIVERED')) return 'complete';
    return 'progress';
}

const deliveryStatusLabels: Record<string, string> = {
    PENDING_ASSIGNMENT: 'Pending assignment',
    SEARCHING_FOR_RIDER: 'Searching for rider',
    RIDER_OFFERED: 'Rider offered',
    RIDER_ACCEPTED: 'Rider accepted',
    PICKUP_PENDING: 'Pickup pending',
    PICKED_UP: 'Picked up',
    IN_TRANSIT: 'In transit',
    DELIVERED: 'Delivered',
    FAILED: 'Failed',
    CANCELLED: 'Cancelled',
    WAITING_FOR_RIDER: 'Waiting for rider',
};

function deliveryStatusLabel(value: unknown): string {
    if (typeof value !== 'string' || !value) return 'Status unavailable';
    return deliveryStatusLabels[value] ?? value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function deliveryStatusTone(value: unknown): 'pending' | 'complete' | 'cancelled' | 'progress' {
    const status = typeof value === 'string' ? value.toUpperCase() : '';
    if (status === 'DELIVERED') return 'complete';
    if (status === 'CANCELLED' || status === 'FAILED') return 'cancelled';
    if (['PENDING_ASSIGNMENT', 'SEARCHING_FOR_RIDER', 'RIDER_OFFERED', 'RIDER_ACCEPTED', 'PICKUP_PENDING', 'WAITING_FOR_RIDER'].includes(status)) return 'pending';
    return 'progress';
}

function AdminOrderSummaryIcon({ name }: { name: 'order' | 'buyer' | 'seller' | 'total' }) {
    return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {name === 'order' ? <><path d="M3 4h2l2.2 11.2a2 2 0 0 0 2 1.6h8.5a2 2 0 0 0 1.9-1.4L21 8H6" /><circle cx="10" cy="20" r="1" /><circle cx="18" cy="20" r="1" /></>
            : name === 'buyer' ? <><circle cx="12" cy="8" r="3.5" /><path d="M4.5 21c.6-4 3.2-6 7.5-6s6.9 2 7.5 6" /></>
                : name === 'seller' ? <><path d="M4 10v11h16V10M3 9l2-5h14l2 5" /><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M9 21v-6h6v6" /></>
                    : <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v5c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 10v5c0 1.7 3.6 3 8 3M4 15v4c0 1.7 3.6 3 8 3" /></>}
    </svg>;
}

function AdminDeliverySummaryIcon({ name }: { name: 'delivery' | 'proof' | 'created' }) {
    return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {name === 'delivery' ? <><path d="M3 6h11v11H3zM14 10h4l3 3v4h-7z" /><circle cx="7.5" cy="18.5" r="1.5" /><circle cx="18" cy="18.5" r="1.5" /></>
            : name === 'proof' ? <><path d="m5 12 4 4L19 6" /><path d="M20 12v7H4V5h11" /></>
                : <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18" /></>}
    </svg>;
}

const orderSortOptions = [
    { label: 'Newest order', value: 'newest' },
    { label: 'Oldest order', value: 'oldest' },
    { label: 'Order reference (A-Z)', value: 'reference_asc' },
    { label: 'Order reference (Z-A)', value: 'reference_desc' },
    { label: 'Buyer (A-Z)', value: 'buyer_asc' },
    { label: 'Buyer (Z-A)', value: 'buyer_desc' },
    { label: 'Seller (A-Z)', value: 'seller_asc' },
    { label: 'Seller (Z-A)', value: 'seller_desc' },
    { label: 'Status (A-Z)', value: 'status_asc' },
    { label: 'Status (Z-A)', value: 'status_desc' },
    { label: 'Total price (low to high)', value: 'total_asc' },
    { label: 'Total price (high to low)', value: 'total_desc' },
];

const deliveryStatusTabs = [
    { label: 'All', value: '' },
    { label: 'Searching for rider', value: 'SEARCHING_FOR_RIDER' },
    { label: 'Rider offered', value: 'RIDER_OFFERED' },
    { label: 'Rider accepted', value: 'RIDER_ACCEPTED' },
    { label: 'Pickup pending', value: 'PICKUP_PENDING' },
    { label: 'Picked up', value: 'PICKED_UP' },
    { label: 'In transit', value: 'IN_TRANSIT' },
    { label: 'Delivered', value: 'DELIVERED' },
    { label: 'Failed', value: 'FAILED' },
    { label: 'Cancelled', value: 'CANCELLED' },
    { label: 'Pending assignment', value: 'PENDING_ASSIGNMENT' },
    { label: 'Waiting for rider', value: 'WAITING_FOR_RIDER' },
];

const deliverySortOptions = [
    { label: 'Newest created', value: 'newest' },
    { label: 'Oldest created', value: 'oldest' },
    { label: 'Delivery reference (A–Z)', value: 'reference_asc' },
    { label: 'Delivery reference (Z–A)', value: 'reference_desc' },
    { label: 'Rider (A–Z)', value: 'rider_asc' },
    { label: 'Status (A–Z)', value: 'status_asc' },
    { label: 'Status (Z–A)', value: 'status_desc' },
];

export function AdminWorkspace({ onError, onLogout, userName, profilePhotoUrl }: AdminWorkspaceProps) {
    const [page, setPage] = React.useState<Page>(() => window.location.hash === '#notifications' ? 'notifications' : 'dashboard');
    const [settingsInitialCategory, setSettingsInitialCategory] = React.useState('account');
    const [reportContext, setReportContext] = React.useState<ChatReportContext | null>(null);
    const [notificationOrderId, setNotificationOrderId] = React.useState<number | null>(null);
    const [notificationOrderSearch, setNotificationOrderSearch] = React.useState<string | null>(null);
    const [notificationDeliverySearch, setNotificationDeliverySearch] = React.useState<string | null>(null);
    const [notificationCaseId, setNotificationCaseId] = React.useState<number | null>(null);
    const [notificationReviewId, setNotificationReviewId] = React.useState<number | null>(null);
    const [notificationListingId, setNotificationListingId] = React.useState<number | null>(null);
    const [notificationApplicationId, setNotificationApplicationId] = React.useState<number | null>(null);
    const [notificationVehicleChangeId, setNotificationVehicleChangeId] = React.useState<number | null>(null);
    const [notificationAuditId, setNotificationAuditId] = React.useState<number | null>(null);
    const [notificationConversationId, setNotificationConversationId] = React.useState<number | null>(null);
    const [transactionsOpen, setTransactionsOpen] = React.useState(false);
    const [mobileNavOpen, setMobileNavOpen] = useWorkspaceMobileMenu();
    const [unreadNotificationCount, setUnreadNotificationCount] = React.useState(0);
    const notificationCountErrorReported = React.useRef(false);
    const transactionsRef = React.useRef<HTMLDivElement>(null);

    const refreshUnreadNotificationCount = React.useCallback(async () => {
        try {
            const response = await api.get<{ unread_count: number }>('/api/notifications');
            const unreadCount = response.data?.unread_count;
            if (typeof unreadCount !== 'number' || !Number.isFinite(unreadCount) || unreadCount < 0) {
                if (!notificationCountErrorReported.current) onError('Unread notification count could not be loaded.');
                notificationCountErrorReported.current = true;
                return;
            }
            setUnreadNotificationCount(Math.floor(unreadCount));
            notificationCountErrorReported.current = false;
        } catch (requestError: any) {
            if (!notificationCountErrorReported.current) {
                onError(requestError.userMessage ?? 'Unread notification count could not be loaded.');
            }
            notificationCountErrorReported.current = true;
        }
    }, [onError]);

    React.useEffect(() => {
        document.documentElement.classList.add('admin-workspace-open');
        document.body.classList.add('admin-workspace-open');

        return () => {
            document.documentElement.classList.remove('admin-workspace-open');
            document.body.classList.remove('admin-workspace-open');
        };
    }, []);

    React.useEffect(() => {
        const refresh = () => { void refreshUnreadNotificationCount(); };
        refresh();
        const interval = window.setInterval(refresh, 30000);
        window.addEventListener('focus', refresh);
        return () => {
            window.clearInterval(interval);
            window.removeEventListener('focus', refresh);
        };
    }, [page, refreshUnreadNotificationCount]);

    React.useEffect(() => {
        function closeTransactions(event: MouseEvent) {
            if (!transactionsRef.current?.contains(event.target as Node)) setTransactionsOpen(false);
        }
        document.addEventListener('mousedown', closeTransactions);
        return () => document.removeEventListener('mousedown', closeTransactions);
    }, []);

    React.useEffect(() => {
        const handleHashChange = () => {
            if (window.location.hash === '#notifications') navigate('notifications');
        };
        window.addEventListener('hashchange', handleHashChange);

        return () => window.removeEventListener('hashchange', handleHashChange);
    }, []);

    function navigate(nextPage: Page) {
        setPage(nextPage);
        setTransactionsOpen(false);
        setMobileNavOpen(false);
    }

    function analyzeReport(report: ChatReportContext) {
        setReportContext(report);
        navigate('chats');
    }

    async function openDeliveryNotification(deliveryId: number) {
        try {
            const response = await api.get<{ delivery: { delivery_reference: string } }>(`/api/admin/deliveries/${deliveryId}`);
            setNotificationDeliverySearch(response.data.delivery.delivery_reference);
            navigate('deliveries');
        } catch (requestError: any) {
            onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'The delivery linked to this notification is unavailable.');
        }
    }

    async function openOrderNotification(orderId: number) {
        try {
            const response = await api.get<{ order: { order_reference: string } }>(`/api/admin/orders/${orderId}`);
            setNotificationOrderId(orderId);
            setNotificationOrderSearch(response.data.order.order_reference);
            navigate('orders');
        } catch (requestError: any) {
            onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'The order linked to this notification is unavailable.');
        }
    }

    function renderPage() {
        switch (page) {
            case 'dashboard': return <AdminDashboard onError={onError} userName={userName} onOpenOrder={(orderId) => { void openOrderNotification(orderId); }} />;
            case 'users': return <AdminDataTable title="Users & accounts" eyebrow="Governance" endpoint="admin/users" collection="users" onError={onError} filterParam="role" filterTabs={userRoleTabs} verifiedParam="verified" responsiveCards presentation="users" columns={[
                { label: 'Name', className: 'admin-user-name-cell', render: (row) => {
                    const verified = Boolean(row.email_verified_at || row.phone_verified_at);
                    const role = String(row.role ?? '');
                    const status = row.deleted_at ? 'Inactive' : 'Active';
                    return <div className="admin-user-identity">
                        <span className="admin-user-avatar" aria-hidden="true">
                            <svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="24" fill="currentColor" opacity=".1" /><circle cx="24" cy="18" r="8" fill="currentColor" /><path d="M9 42c.9-8.1 6.8-12 15-12s14.1 3.9 15 12" fill="currentColor" /></svg>
                        </span>
                        <span className="admin-user-identity-copy">
                            <strong>{row.name}</strong>
                            <span className="admin-user-mobile-email"><span className="sr-only">Email: </span>{row.email}</span>
                            <span className="admin-user-mobile-meta">
                                <span className="admin-user-badges">
                                    <span className="admin-user-role-badge"><span className="sr-only">Role: </span>{role}</span>
                                    <span className={`admin-user-verification${verified ? ' is-verified' : ' is-unverified'}`}>
                                        {verified && <svg aria-hidden="true" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="9" fill="currentColor" /><path d="m5.5 10 3 3 6-6" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                                        <span className="sr-only">Account verification: </span>{userVerificationLabel(row)}
                                    </span>
                                </span>
                                <span className={`admin-user-mobile-status${row.deleted_at ? ' is-inactive' : ''}`}><span className="sr-only">Account status: </span>{status}</span>
                                <time dateTime={typeof row.created_at === 'string' ? row.created_at : undefined}>
                                    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none"><rect x="3" y="4.5" width="14" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.7" /><path d="M6.5 2.5v4M13.5 2.5v4M3 8h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
                                    <span className="sr-only">Joined: </span>{userJoinDate(row.created_at)}
                                </time>
                            </span>
                        </span>
                    </div>;
                } },
                { label: 'Email', className: 'admin-user-email-cell', render: (row) => row.email },
                { label: 'Role', className: 'admin-user-desktop-cell', render: (row) => <span className="status-pill">{row.role}</span> },
                { label: 'Account verification', className: 'admin-user-desktop-cell', render: (row) => userVerificationLabel(row) },
                { label: 'Account status', className: 'admin-user-desktop-cell', render: (row) => <span className={`status-pill${row.deleted_at ? ' user-account-inactive' : ''}`}>{row.deleted_at ? 'Inactive' : 'Active'}</span> },
                { label: 'Joined', className: 'admin-user-desktop-cell', render: (row) => userJoinDate(row.created_at) },
                { label: 'Actions', className: 'admin-user-actions-cell', render: (row, refresh) => <UserAccountActions user={{
                    id: Number(row.id),
                    name: String(row.name ?? ''),
                    email: String(row.email ?? ''),
                    role: String(row.role ?? ''),
                    deleted_at: typeof row.deleted_at === 'string' ? row.deleted_at : null,
                    moderation_violations_count: Number(row.moderation_violations_count ?? 0),
                    email_verified_at: typeof row.email_verified_at === 'string' ? row.email_verified_at : null,
                    phone_verified_at: typeof row.phone_verified_at === 'string' ? row.phone_verified_at : null,
                    created_at: String(row.created_at ?? ''),
                }} onError={onError} onRefresh={refresh} /> },
            ]} />;
            case 'listings': return <ListingQueue onError={onError} onOpenCategories={() => navigate('categories')} initialListingId={notificationListingId ?? undefined} onInitialListingHandled={() => setNotificationListingId(null)} />;
            case 'orders': return <AdminDataTable title="Orders" eyebrow="Operations" description="Govern marketplace activity with scoped access and clear operational history." endpoint="admin/orders" collection="orders" onError={onError} initialSearch={notificationOrderSearch ?? undefined} onInitialSearchApplied={() => setNotificationOrderSearch(null)} filterParam="status" filterLabel="status" filterTabs={orderStatusTabs} countTabs sortOptions={orderSortOptions} searchPlaceholder="Search order or payment reference, buyer or seller" responsiveCards showRecordRange presentation="orders" columns={[
                { label: 'Order reference', className: 'admin-order-reference-cell', render: (row) => <div className="admin-order-card-identity"><span className={`admin-order-card-icon admin-order-card-icon--${orderStatusTone(row.display_status ?? row.status)}`}><AdminOrderSummaryIcon name="order" /></span><div className="admin-order-card-identity-copy"><strong className="admin-order-reference-text">{row.order_reference}</strong><span className={`status-pill admin-order-status admin-order-status--${orderStatusTone(row.display_status ?? row.status)} admin-order-card-mobile-status`}>{orderStatusLabel(row.display_status ?? row.status)}</span></div></div> },
                { label: 'Buyer', className: 'admin-order-buyer-cell', render: (row) => <div className="admin-order-card-meta"><AdminOrderSummaryIcon name="buyer" /><span><small>Buyer</small><strong>{row.buyer?.name ?? '—'}</strong></span></div> },
                { label: 'Seller', className: 'admin-order-seller-cell', render: (row) => <div className="admin-order-card-meta"><AdminOrderSummaryIcon name="seller" /><span><small>Seller</small><strong>{row.seller?.name ?? '—'}</strong></span></div> },
                { label: 'Status', className: 'admin-order-status-cell', render: (row) => <span className={`status-pill admin-order-status admin-order-status--${orderStatusTone(row.display_status ?? row.status)}`}>{orderStatusLabel(row.display_status ?? row.status)}</span> },
                { label: 'Total', className: 'admin-order-total admin-order-total-cell', render: (row) => <div className="admin-order-card-meta admin-order-card-total"><AdminOrderSummaryIcon name="total" /><span><small>Total</small><strong>PHP {Number(row.total_amount ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span></div> },
                { label: 'Actions', className: 'admin-order-actions-cell', render: (row) => <AdminOrderReceipt orderId={row.id} reference={row.order_reference} onError={onError} openInitially={notificationOrderId === Number(row.id)} onOpenStarted={() => setNotificationOrderId(null)} triggerLabel="View details" showMoreActions /> },
            ]} />;
            case 'transactions': return <ReportPanel role="ADMIN" preparedBy={userName} onError={onError} onAnalyze={analyzeReport} />;
            case 'payments': return <AdminPaymentsPage onError={onError} onOpenSystemSettings={() => { setSettingsInitialCategory('finance'); navigate('settings'); }} />;
            case 'deliveries': return <AdminDataTable title="Deliveries" eyebrow="Operations" description="Track delivery assignments, rider progress, proof, and completion history." endpoint="admin/deliveries" collection="deliveries" onError={onError} initialSearch={notificationDeliverySearch ?? undefined} onInitialSearchApplied={() => setNotificationDeliverySearch(null)} filterParam="status" filterLabel="status" filterTabs={deliveryStatusTabs} countTabs sortOptions={deliverySortOptions} searchPlaceholder="Search delivery reference, order, or rider" responsiveCards showRecordRange presentation="deliveries" columns={[
                { label: 'Delivery reference', className: 'admin-delivery-reference-cell', render: (row) => <div className="admin-delivery-card-identity"><span className={`admin-order-card-icon admin-order-card-icon--${deliveryStatusTone(row.status)}`}><AdminDeliverySummaryIcon name="delivery" /></span><div className="admin-order-card-identity-copy"><strong className="admin-order-reference-text">{row.delivery_reference}</strong><span className={`status-pill admin-order-status admin-order-status--${deliveryStatusTone(row.status)} admin-order-card-mobile-status`}>{deliveryStatusLabel(row.status)}</span></div></div> },
                { label: 'Order reference', className: 'admin-delivery-order-cell', render: (row) => <div className="admin-delivery-card-meta"><AdminOrderSummaryIcon name="order" /><span><small>Order</small><strong>{row.order?.order_reference ?? 'Unavailable'}</strong></span></div> },
                { label: 'Rider', className: 'admin-delivery-rider-cell', render: (row) => <div className="admin-delivery-card-meta"><AdminOrderSummaryIcon name="buyer" /><span><small>Rider</small><strong>{row.rider?.name ?? 'Unassigned'}</strong></span></div> },
                { label: 'Status', className: 'admin-delivery-status-cell', render: (row) => <span className={`status-pill admin-order-status admin-order-status--${deliveryStatusTone(row.status)}`}>{deliveryStatusLabel(row.status)}</span> },
                { label: 'Proof', className: 'admin-delivery-proof-cell', render: (row) => <div className="admin-delivery-card-meta"><AdminDeliverySummaryIcon name="proof" /><span><small>Delivery proof</small><strong>{row.proof_corrections_count > 0 ? 'Correction recorded' : row.has_delivery_proof ? 'Proof saved' : 'Not submitted'}</strong></span></div> },
                { label: 'Created', className: 'admin-delivery-created-cell', render: (row) => {
                    const createdAt = typeof row.created_at === 'string' ? new Date(row.created_at) : null;
                    const label = createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.toLocaleString() : 'Date unavailable';
                    return <div className="admin-delivery-card-meta"><AdminDeliverySummaryIcon name="created" /><span><small>Created</small><time dateTime={createdAt && !Number.isNaN(createdAt.getTime()) ? row.created_at : undefined}>{label}</time></span></div>;
                } },
                { label: 'Action', className: 'admin-delivery-actions-cell', render: (row, refresh) => <AdminDeliveryDetails deliveryId={row.id} deliveryReference={row.delivery_reference} onError={onError} onCorrected={refresh} /> },
            ]} />;
            case 'categories': return <AdminDataTable title="Categories" eyebrow="Catalog" endpoint="admin/categories" collection="categories" onError={onError} controls={<button className="admin-back-to-listings" type="button" onClick={() => navigate('listings')}><span aria-hidden="true">←</span>Back to listings</button>} columns={[{ label: 'Category', render: (row) => <strong>{row.name}</strong> }, { label: 'Slug', render: (row) => row.slug }, { label: 'Listings', render: (row) => row.listings_count }, { label: 'Status', render: (row) => row.is_active ? 'Active' : 'Inactive' }]} />;
            case 'complaints': return <ComplaintQueue onError={onError} initialCaseId={notificationCaseId ?? undefined} onInitialCaseHandled={() => setNotificationCaseId(null)} />;
            case 'reviews': return <ReviewQueue onError={onError} initialReviewId={notificationReviewId ?? undefined} onInitialReviewHandled={() => setNotificationReviewId(null)} />;
            case 'rider': return <AdminRiderPage onError={onError} initialApplicationId={notificationApplicationId ?? undefined} onInitialApplicationHandled={() => setNotificationApplicationId(null)} initialVehicleChangeId={notificationVehicleChangeId ?? undefined} onInitialVehicleChangeHandled={() => setNotificationVehicleChangeId(null)} />;
            case 'promotions': return <AdminPromotionsPage onError={onError} />;
            case 'notifications': return <NotificationsPage role="ADMIN"
                onOpenOrder={(orderId) => { void openOrderNotification(orderId); }}
                onOpenConversation={(conversationId) => { setNotificationConversationId(conversationId); navigate('chats'); }}
                onOpenCase={(caseId) => { setNotificationCaseId(caseId); navigate('complaints'); }}
                onOpenReview={(reviewId) => { setNotificationReviewId(reviewId); navigate('reviews'); }}
                onOpenListing={(listingId) => { setNotificationListingId(listingId); navigate('listings'); }}
                onOpenApplication={(applicationId) => { setNotificationApplicationId(applicationId); navigate('rider'); }}
                onOpenVehicleUpdate={(changeId) => { setNotificationVehicleChangeId(changeId); navigate('rider'); }}
                onOpenAudit={(auditId) => { setNotificationAuditId(auditId); navigate('security'); }}
                onOpenDelivery={(deliveryId) => { void openDeliveryNotification(deliveryId); }}
                onOpenEvent={(eventId) => { window.location.hash = `calendar/event/${eventId}`; navigate('promotions'); }}
            />;
            case 'reports': return <ReportPanel role="ADMIN" preparedBy={userName} onError={onError} onAnalyze={analyzeReport} adminReportsPage />;
            case 'chats': return <AIChatPage role="ADMIN" reportContext={reportContext} onReportContextHandled={() => setReportContext(null)} initialConversationId={notificationConversationId ?? undefined} onOpenOrder={(orderId) => { void openOrderNotification(orderId); }} />;
            case 'security': return <AuditHistory preparedBy={userName} onError={onError} initialAuditId={notificationAuditId ?? undefined} onInitialAuditHandled={() => setNotificationAuditId(null)} />;
            case 'settings': return <AdminSettings onError={onError} initialCategory={settingsInitialCategory} onOpenAuditHistory={() => navigate('security')} />;
        }
    }

    const navigationItems = primaryNavigation.filter((item) => !['orders', 'deliveries', 'categories'].includes(item.id));

    return <main className="admin-shell">
        <aside className={`admin-sidebar role-sidebar admin-workspace-sidebar${mobileNavOpen ? ' mobile-open' : ''}`} onKeyDown={(event) => {
            if (event.key === 'Escape') setMobileNavOpen(false);
        }}>
            <WorkspaceMobileHeader role="admin" menuOpen={mobileNavOpen} controlsId="admin-mobile-navigation" onToggle={() => setMobileNavOpen((open) => !open)} location="Bongabong, Oriental Mindoro" notificationCount={unreadNotificationCount} notificationsActive={page === 'notifications'} onOpenNotifications={() => navigate('notifications')} />
            <div className="role-mobile-menu-panel" id="admin-mobile-navigation">
                <FarmgateBrand label="FARMGATE home" />
                <div className="admin-sidebar-label">ADMIN</div>
                <nav className={transactionsOpen ? 'transactions-open' : undefined} aria-label="Admin navigation">
                    {navigationItems.map((item) => item.id === 'transactions'
                        ? <div className="nav-dropdown" key={item.id} ref={transactionsRef}>
                            <button className={['transactions', 'orders', 'deliveries'].includes(page) ? 'active' : ''} type="button" aria-expanded={transactionsOpen} aria-haspopup="menu" onClick={() => setTransactionsOpen((open) => !open)}>
                                <span className="nav-icon"><WorkspaceSidebarIcon name={item.id} /></span>{item.label}<span className="nav-chevron" aria-hidden="true">{transactionsOpen ? '▲' : '▼'}</span>
                            </button>
                            {transactionsOpen && <div className="nav-submenu" role="menu">
                                <button className={page === 'orders' ? 'active' : ''} type="button" role="menuitem" aria-current={page === 'orders' ? 'page' : undefined} onClick={() => navigate('orders')}>Orders</button>
                                <button className={page === 'deliveries' ? 'active' : ''} type="button" role="menuitem" aria-current={page === 'deliveries' ? 'page' : undefined} onClick={() => navigate('deliveries')}>Deliveries</button>
                            </div>}
                        </div>
                        : <button className={`${page === item.id ? 'active' : ''}${item.id === 'notifications' ? ' admin-notifications-sidebar-link' : ''}${mobileDrawerExcludedPages.includes(item.id) ? ' admin-mobile-menu-excluded' : ''}`} type="button" key={item.id} aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}>
                            <span className="nav-icon"><WorkspaceSidebarIcon name={item.id} /></span>{item.label}
                        </button>)}
                </nav>
                <button className="sidebar-logout" type="button" onClick={onLogout}>Log out <span>↗</span></button>
            </div>
        </aside>
        <section className={`admin-content${page === 'dashboard' ? ' admin-dashboard-content' : ''}${page === 'users' ? ' admin-users-content' : ''}`}>
            <header className={`admin-header workspace-banner-header${page === 'dashboard' ? ' admin-dashboard-page-header' : ''}${page === 'users' ? ' admin-users-page-header' : ''}${page === 'listings' ? ' admin-listings-page-header' : ''}`}>
                <div>
                    <p className="eyebrow">FARMGATE control room</p>
                    <h1>{page === 'dashboard' && <svg className="admin-dashboard-heading-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M4 19V12m5 7V5m5 14v-9m5 9V8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}{primaryNavigation.find((item) => item.id === page)?.label ?? page}</h1>
                    <p>{page === 'users'
                        ? 'Manage and oversee user accounts across the platform.'
                        : page === 'listings'
                            ? 'Manage marketplace listings with scoped access and clear operational history.'
                            : 'Govern marketplace activity with scoped access and clear operational history.'}</p>
                </div>
                <WorkspaceBannerArtwork />
                <div className="role-header-context">
                    <button className={`admin-notifications-header-link${page === 'notifications' ? ' active' : ''}`} type="button" aria-label="Notifications" aria-current={page === 'notifications' ? 'page' : undefined} title="Notifications" onClick={() => navigate('notifications')}>
                        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                    <WorkspaceAccountControl role="admin" userName={userName} profilePhotoUrl={profilePhotoUrl} onOpenAccount={() => { setSettingsInitialCategory('account'); navigate('settings'); }} />
                </div>
            </header>
            {renderPage()}
            <RoleMobileBottomNavigation items={adminMobileDestinations} activeId={page} navigationLabel="Key admin destinations" onNavigate={navigate} />
        </section>
    </main>;
}
