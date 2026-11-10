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

type Page = 'dashboard' | 'users' | 'listings' | 'orders' | 'transactions' | 'payments' | 'deliveries' | 'categories' | 'complaints' | 'reviews' | 'rider' | 'promotions' | 'notifications' | 'reports' | 'chats' | 'security' | 'settings';
type AdminWorkspaceProps = { onError: (message: string) => void; onLogout: () => void; userName: string };

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

const userRoleTabs = [
    { label: 'All accounts', value: '' },
    { label: 'Buyers', value: 'BUYER' },
    { label: 'Sellers', value: 'SELLER' },
    { label: 'Riders', value: 'RIDER' },
    { label: 'Admins', value: 'ADMIN' },
];

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

export function AdminWorkspace({ onError, onLogout, userName }: AdminWorkspaceProps) {
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
    const transactionsRef = React.useRef<HTMLDivElement>(null);

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
            case 'users': return <AdminDataTable title="Users & accounts" eyebrow="Governance" endpoint="admin/users" collection="users" onError={onError} filterParam="role" filterTabs={userRoleTabs} verifiedParam="verified" columns={[
                { label: 'Name', render: (row) => <strong>{row.name}</strong> },
                { label: 'Email', render: (row) => row.email },
                { label: 'Role', render: (row) => <span className="status-pill">{row.role}</span> },
                { label: 'Verified', render: (row) => row.email_verified_at ? 'Verified' : 'Unverified' },
                { label: 'Account status', render: (row) => <span className={`status-pill${row.deleted_at ? ' user-account-inactive' : ''}`}>{row.deleted_at ? 'Inactive' : 'Active'}</span> },
                { label: 'Joined', render: (row) => new Date(row.created_at).toLocaleDateString() },
                { label: 'Actions', render: (row, refresh) => <UserAccountActions user={{
                    id: Number(row.id),
                    name: String(row.name ?? ''),
                    email: String(row.email ?? ''),
                    role: String(row.role ?? ''),
                    deleted_at: typeof row.deleted_at === 'string' ? row.deleted_at : null,
                    moderation_violations_count: Number(row.moderation_violations_count ?? 0),
                }} onError={onError} onRefresh={refresh} /> },
            ]} />;
            case 'listings': return <ListingQueue onError={onError} initialListingId={notificationListingId ?? undefined} onInitialListingHandled={() => setNotificationListingId(null)} />;
            case 'orders': return <AdminDataTable title="Orders" eyebrow="Operations" endpoint="admin/orders" collection="orders" onError={onError} initialSearch={notificationOrderSearch ?? undefined} onInitialSearchApplied={() => setNotificationOrderSearch(null)} filterParam="status" filterLabel="status" filterTabs={orderStatusTabs} countTabs sortOptions={orderSortOptions} searchPlaceholder="Search order or payment reference, buyer or seller" columns={[{ label: 'Order ID', render: (row) => row.id }, { label: 'Order reference', render: (row) => <AdminOrderReceipt orderId={row.id} reference={row.order_reference} onError={onError} openInitially={notificationOrderId === Number(row.id)} onOpenStarted={() => setNotificationOrderId(null)} /> }, { label: 'Buyer', render: (row) => row.buyer?.name ?? '-' }, { label: 'Seller', render: (row) => row.seller?.name ?? '-' }, { label: 'Status', render: (row) => <span className="status-pill">{row.display_status ?? row.status}</span> }, { label: 'Total', render: (row) => `PHP ${row.total_amount}`}]} />;
            case 'transactions': return <ReportPanel role="ADMIN" preparedBy={userName} onError={onError} onAnalyze={analyzeReport} />;
            case 'payments': return <AdminPaymentsPage onError={onError} onOpenSystemSettings={() => { setSettingsInitialCategory('finance'); navigate('settings'); }} />;
            case 'deliveries': return <AdminDataTable title="Deliveries" eyebrow="Live operations" endpoint="admin/deliveries" collection="deliveries" onError={onError} initialSearch={notificationDeliverySearch ?? undefined} onInitialSearchApplied={() => setNotificationDeliverySearch(null)} filterParam="status" filterLabel="status" filterTabs={deliveryStatusTabs} countTabs sortOptions={deliverySortOptions} searchPlaceholder="Search delivery reference, order, or rider" responsiveCards columns={[
                { label: 'Delivery reference', render: (row) => <strong>{row.delivery_reference}</strong> },
                { label: 'Order reference', render: (row) => row.order?.order_reference ?? '—' },
                { label: 'Rider', render: (row) => row.rider?.name ?? 'Unassigned' },
                { label: 'Status', render: (row) => <span className="status-pill">{String(row.status).replaceAll('_', ' ')}</span> },
                { label: 'Proof', render: (row) => row.proof_corrections_count > 0 ? 'Correction recorded' : row.has_delivery_proof ? 'Proof saved' : 'Not submitted' },
                { label: 'Created', render: (row) => new Date(row.created_at).toLocaleString() },
                { label: 'Action', render: (row, refresh) => <AdminDeliveryDetails deliveryId={row.id} onError={onError} onCorrected={refresh} /> },
            ]} />;
            case 'categories': return <AdminDataTable title="Categories" eyebrow="Catalog" endpoint="admin/categories" collection="categories" onError={onError} columns={[{ label: 'Category', render: (row) => <strong>{row.name}</strong> }, { label: 'Slug', render: (row) => row.slug }, { label: 'Listings', render: (row) => row.listings_count }, { label: 'Status', render: (row) => row.is_active ? 'Active' : 'Inactive' }]} />;
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
            case 'reports': return <ReportPanel role="ADMIN" preparedBy={userName} onError={onError} onAnalyze={analyzeReport} />;
            case 'chats': return <AIChatPage role="ADMIN" reportContext={reportContext} initialConversationId={notificationConversationId ?? undefined} onOpenOrder={(orderId) => { void openOrderNotification(orderId); }} />;
            case 'security': return <AuditHistory preparedBy={userName} onError={onError} initialAuditId={notificationAuditId ?? undefined} onInitialAuditHandled={() => setNotificationAuditId(null)} />;
            case 'settings': return <AdminSettings onError={onError} initialCategory={settingsInitialCategory} />;
        }
    }

    const navigationItems = primaryNavigation.filter((item) => !['orders', 'deliveries', 'categories'].includes(item.id));

    return <main className="admin-shell">
        <aside className="admin-sidebar">
            <a className="brand" href="/" aria-label="FARMGATE home">FARM<span>GATE</span></a>
            <div className="admin-sidebar-label">ADMIN</div>
            <nav className={transactionsOpen ? 'transactions-open' : undefined} aria-label="Admin navigation">
                {navigationItems.map((item) => item.id === 'transactions'
                    ? <div className="nav-dropdown" key={item.id} ref={transactionsRef}>
                        <button className={['transactions', 'orders', 'deliveries'].includes(page) ? 'active' : ''} type="button" aria-expanded={transactionsOpen} aria-haspopup="menu" onClick={() => setTransactionsOpen((open) => !open)}>
                            <span className="nav-icon">{item.icon}</span>{item.label}<span className="nav-chevron" aria-hidden="true">{transactionsOpen ? '▲' : '▼'}</span>
                        </button>
                        {transactionsOpen && <div className="nav-submenu" role="menu">
                            <button className={page === 'orders' ? 'active' : ''} type="button" role="menuitem" onClick={() => navigate('orders')}>Orders</button>
                            <button className={page === 'deliveries' ? 'active' : ''} type="button" role="menuitem" onClick={() => navigate('deliveries')}>Deliveries</button>
                        </div>}
                    </div>
                    : <button className={page === item.id ? 'active' : ''} type="button" key={item.id} onClick={() => navigate(item.id)}>
                        <span className="nav-icon">{item.icon}</span>{item.label}
                    </button>)}
            </nav>
            <button className="sidebar-logout" type="button" onClick={onLogout}>Log out <span>↗</span></button>
        </aside>
        <section className="admin-content">
            <header className="admin-header"><div><p className="eyebrow">FARMGATE control room</p><h1>{primaryNavigation.find((item) => item.id === page)?.label ?? page}</h1><p>Govern marketplace activity with scoped access and clear operational history.</p></div><span className="admin-role">ADMIN</span></header>
            {renderPage()}
        </section>
    </main>;
}
