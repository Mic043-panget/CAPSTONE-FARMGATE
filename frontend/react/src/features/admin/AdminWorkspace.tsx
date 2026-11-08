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
import { AdminDeliveryProofActions } from './AdminDeliveryProofActions';
import { AdminOrderReceipt } from './AdminOrderReceipt';
import { NotificationsPage } from '../buyer/NotificationsPage';
import { RiderApplicationQueue } from './RiderApplicationQueue';

type Page = 'dashboard' | 'users' | 'listings' | 'orders' | 'transactions' | 'deliveries' | 'categories' | 'complaints' | 'reviews' | 'rider-applications' | 'notifications' | 'reports' | 'chats' | 'security' | 'settings';
type AdminWorkspaceProps = { onError: (message: string) => void; onLogout: () => void };

const primaryNavigation: { id: Page; label: string; icon: string }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: '◈' },
    { id: 'users', label: 'Users & accounts', icon: '♙' },
    { id: 'listings', label: 'Listings', icon: '▤' },
    { id: 'orders', label: 'Orders', icon: '□' },
    { id: 'transactions', label: 'Transactions', icon: '₱' },
    { id: 'deliveries', label: 'Deliveries', icon: '↗' },
    { id: 'categories', label: 'Categories', icon: '⌘' },
    { id: 'complaints', label: 'Complaints & disputes', icon: '!' },
    { id: 'reviews', label: 'Review moderation', icon: '★' },
    { id: 'rider-applications', label: 'Rider applications', icon: '♧' },
    { id: 'notifications', label: 'Notifications', icon: '♧' },
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

export function AdminWorkspace({ onError, onLogout }: AdminWorkspaceProps) {
    const [page, setPage] = React.useState<Page>('dashboard');
    const [reportContext, setReportContext] = React.useState<ChatReportContext | null>(null);
    const [transactionsOpen, setTransactionsOpen] = React.useState(false);
    const transactionsRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        function closeTransactions(event: MouseEvent) {
            if (!transactionsRef.current?.contains(event.target as Node)) setTransactionsOpen(false);
        }
        document.addEventListener('mousedown', closeTransactions);
        return () => document.removeEventListener('mousedown', closeTransactions);
    }, []);

    function navigate(nextPage: Page) {
        setPage(nextPage);
        setTransactionsOpen(false);
    }

    function analyzeReport(report: ChatReportContext) {
        setReportContext(report);
        navigate('chats');
    }

    function renderPage() {
        switch (page) {
            case 'dashboard': return <AdminDashboard onError={onError} />;
            case 'users': return <AdminDataTable title="Users & accounts" eyebrow="Governance" endpoint="admin/users" collection="users" onError={onError} filterParam="role" filterTabs={userRoleTabs} verifiedParam="verified" columns={[{ label: 'Name', render: (row) => <strong>{row.name}</strong> }, { label: 'Email', render: (row) => row.email }, { label: 'Role', render: (row) => <span className="status-pill">{row.role}</span> }, { label: 'Verified', render: (row) => row.email_verified_at ? 'Verified' : 'Unverified' }, { label: 'Joined', render: (row) => new Date(row.created_at).toLocaleDateString() }]} />;
            case 'listings': return <ListingQueue onError={onError} />;
            case 'orders': return <AdminDataTable title="Orders" eyebrow="Operations" endpoint="admin/orders" collection="orders" onError={onError} filterParam="status" filterLabel="status" filterTabs={orderStatusTabs} countTabs sortOptions={orderSortOptions} searchPlaceholder="Search order reference, buyer or seller" columns={[{ label: 'Order reference', render: (row) => <AdminOrderReceipt orderId={row.id} reference={row.order_reference} onError={onError} /> }, { label: 'Buyer', render: (row) => row.buyer?.name ?? '-' }, { label: 'Seller', render: (row) => row.seller?.name ?? '-' }, { label: 'Status', render: (row) => <span className="status-pill">{row.display_status ?? row.status}</span> }, { label: 'Total', render: (row) => `PHP ${row.total_amount}` }]} />;
            case 'transactions': return <ReportPanel role="ADMIN" onError={onError} onAnalyze={analyzeReport} />;
            case 'deliveries': return <AdminDataTable title="Deliveries" eyebrow="Live operations" endpoint="admin/deliveries" collection="deliveries" onError={onError} columns={[{ label: 'Delivery', render: (row) => <strong>#{row.id}</strong> }, { label: 'Order', render: (row) => row.order?.order_reference ?? '-' }, { label: 'Rider', render: (row) => row.rider?.name ?? 'Unassigned' }, { label: 'Status', render: (row) => <span className="status-pill">{row.status}</span> }, { label: 'Proof & corrections', render: (row, refresh) => <AdminDeliveryProofActions row={row} onCorrected={refresh} /> }, { label: 'Created', render: (row) => new Date(row.created_at).toLocaleString() }]} />;
            case 'categories': return <AdminDataTable title="Categories" eyebrow="Catalog" endpoint="admin/categories" collection="categories" onError={onError} columns={[{ label: 'Category', render: (row) => <strong>{row.name}</strong> }, { label: 'Slug', render: (row) => row.slug }, { label: 'Listings', render: (row) => row.listings_count }, { label: 'Status', render: (row) => row.is_active ? 'Active' : 'Inactive' }]} />;
            case 'complaints': return <ComplaintQueue onError={onError} />;
            case 'reviews': return <ReviewQueue onError={onError} />;
            case 'rider-applications': return <RiderApplicationQueue onError={onError} />;
            case 'notifications': return <NotificationsPage role="ADMIN" onOpenOrder={() => setPage('orders')} />;
            case 'reports': return <ReportPanel role="ADMIN" onError={onError} onAnalyze={analyzeReport} />;
            case 'chats': return <AIChatPage role="ADMIN" reportContext={reportContext} />;
            case 'security': return <AuditHistory onError={onError} />;
            case 'settings': return <AdminSettings onError={onError} />;
        }
    }

    return <main className="admin-shell"><aside className="admin-sidebar"><a className="brand" href="/">FARM<span>GATE</span></a><div className="admin-sidebar-label">ADMIN</div><nav className={transactionsOpen ? 'transactions-open' : undefined} aria-label="Admin navigation">{primaryNavigation.filter((item) => !['orders', 'deliveries', 'categories', 'reports'].includes(item.id)).map((item) => item.id === 'transactions' ? <div className="nav-dropdown" key={item.id} ref={transactionsRef}><button className={['transactions', 'orders', 'deliveries', 'reports'].includes(page) ? 'active' : ''} type="button" aria-expanded={transactionsOpen} aria-haspopup="menu" onClick={() => setTransactionsOpen((open) => !open)}><span className="nav-icon">{item.icon}</span>{item.label}<span className="nav-chevron" aria-hidden="true">{transactionsOpen ? '▲' : '▼'}</span></button>{transactionsOpen && <div className="nav-submenu" role="menu"><button className={page === 'orders' ? 'active' : ''} type="button" role="menuitem" onClick={() => navigate('orders')}>Orders</button><button className={page === 'deliveries' ? 'active' : ''} type="button" role="menuitem" onClick={() => navigate('deliveries')}>Deliveries</button><button className={page === 'reports' ? 'active' : ''} type="button" role="menuitem" onClick={() => navigate('reports')}>Reports</button></div>}</div> : <button className={page === item.id ? 'active' : ''} type="button" key={item.id} onClick={() => navigate(item.id)}><span className="nav-icon">{item.icon}</span>{item.label}</button>)}</nav><button className="sidebar-logout" type="button" onClick={onLogout}>Log out <span>↗</span></button></aside><section className="admin-content"><header className="admin-header"><div><p className="eyebrow">FARMGATE control room</p><h1>{primaryNavigation.find((item) => item.id === page)?.label}</h1><p>Govern marketplace activity with scoped access and clear operational history.</p></div><span className="admin-role">ADMIN</span></header>{renderPage()}</section></main>;
}
