import React from 'react';
import api, { initializeCsrf } from '../../lib/api';
import type { Category, Listing, User } from '../../shared/types';
import { Pagination } from '../../shared/components/Pagination';
import { ComplaintList } from './ComplaintList';
import { SellerListingForm } from './SellerListingForm';
import { SellerListingEditor } from './SellerListingEditor';
import { ReportPanel } from '../shared/ReportPanel';
import { confirmAction, showSuccess } from '../../lib/alerts';
import { AIChatPage, type ChatReportContext } from '../shared/AIChatPage';
import { AnalyticsDashboard } from '../shared/AnalyticsDashboard';
import { SellerOrdersPage } from './SellerOrdersPage';
import { SellerPromotions } from './SellerPromotions';
import { NotificationsPage } from '../buyer/NotificationsPage';
import { NavigationBadge, navigationBadgeLabel } from '../../shared/components/NavigationBadge';

const LocationMap = React.lazy(() => import('../../shared/components/LocationMap').then((module) => ({ default: module.LocationMap })));

type SellerPage = 'dashboard' | 'orders' | 'notifications' | 'listings' | 'promotions' | 'interests' | 'complaints' | 'reports' | 'chats' | 'location' | 'account';
type SellerSettingsTab = 'profile' | 'password' | 'phone' | 'preferences' | 'pickup';
type SellerNavigationBadge = 'orders' | 'notifications' | 'complaints' | 'chats';
type SellerAccountPreference = 'order_notifications' | 'chat_notifications' | 'allow_direct_messages';
type SellerWorkspaceProps = {
    categories: Category[];
    error: string | null;
    user: User;
    onError: (message: string) => void;
    onUserUpdated: (user: User) => void;
    onLogout: () => void;
};

type SellerSummary = {
    total_completed_sales: string;
    sales_today: string;
    sales_this_month: string;
    completed_orders: number;
    pending_orders: number;
    active_listings: number;
    sold_listings: number;
    interested_buyers: number;
    recent_orders: { id: number; order_reference: string; status: string; total_amount: string; created_at: string; delivery?: { status: string; has_delivery_proof?: boolean; proof_captured_at?: string | null } | null }[];
};

type SellerNotification = {
    id: string;
    data: {
        type?: string;
        order_id?: number;
        order_reference?: string;
        buyer_name?: string;
        listing_name?: string;
        moderation_status?: string;
        reasons?: string[];
        flags?: string[];
    };
    created_at: string;
};

type SellerListing = Listing & {
    status: string;
    created_at?: string;
    breed?: string | null;
    sex?: string | null;
    age_months?: number | null;
    description?: string | null;
    pickup_location?: string | null;
    health_information?: string | null;
    vaccination_information?: string | null;
};
type ListingSortColumn = 'name' | 'category' | 'price' | 'quantity' | 'status';
type SellerInterest = { id: number; status: string; buyer?: { name: string }; listing?: { name: string } };

const navigation: { id: SellerPage; label: string; icon: string; badge?: SellerNavigationBadge }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: '◈' },
    { id: 'orders', label: 'Orders', icon: '▣', badge: 'orders' },
    { id: 'notifications', label: 'Notifications', icon: '', badge: 'notifications' },
    { id: 'listings', label: 'My listings', icon: '▤' },
    { id: 'promotions', label: 'Promotions', icon: '％' },
    { id: 'complaints', label: 'Complaints', icon: '!', badge: 'complaints' },
    { id: 'reports', label: 'Reports', icon: '▥' },
    { id: 'chats', label: 'Chats', icon: '✦', badge: 'chats' },
    { id: 'account', label: 'Settings', icon: '◉' },
];

const interestStatuses = ['INTERESTED', 'CONTACTED', 'NEGOTIATING', 'PURCHASED', 'CLOSED'];

export function SellerWorkspace({ categories, error, user, onError, onUserUpdated, onLogout }: SellerWorkspaceProps) {
    const [page, setPage] = React.useState<SellerPage>('dashboard');
    const [settingsTab, setSettingsTab] = React.useState<SellerSettingsTab>('profile');
    const [navigationCounts, setNavigationCounts] = React.useState<Record<SellerNavigationBadge, number>>({
        orders: 0,
        notifications: 0,
        complaints: 0,
        chats: 0,
    });
    const [reportContext, setReportContext] = React.useState<ChatReportContext | null>(null);
    const [summary, setSummary] = React.useState<SellerSummary | null>(null);
    const [orderUpdateRequests, setOrderUpdateRequests] = React.useState<SellerNotification[]>([]);
    const [listingModerationNotices, setListingModerationNotices] = React.useState<SellerNotification[]>([]);
    const [summaryLoading, setSummaryLoading] = React.useState(false);
    const [listings, setListings] = React.useState<SellerListing[]>([]);
    const [listingLoading, setListingLoading] = React.useState(false);
    const [listingPage, setListingPage] = React.useState(1);
    const [listingLastPage, setListingLastPage] = React.useState(1);
    const [listingRevision, setListingRevision] = React.useState(0);
    const [listingSearch, setListingSearch] = React.useState('');
    const [listingSort, setListingSort] = React.useState<ListingSortColumn>('name');
    const [listingSortDirection, setListingSortDirection] = React.useState<'asc' | 'desc'>('asc');
    const [editingListingId, setEditingListingId] = React.useState<number | null>(null);
    const [listingActionId, setListingActionId] = React.useState<number | null>(null);
    const [interests, setInterests] = React.useState<SellerInterest[]>([]);
    const [interestLoading, setInterestLoading] = React.useState(false);
    const [interestPage, setInterestPage] = React.useState(1);
    const [interestLastPage, setInterestLastPage] = React.useState(1);
    const [interestRevision, setInterestRevision] = React.useState(0);
    const [listingFormOpen, setListingFormOpen] = React.useState(false);
    const [notice, setNotice] = React.useState<string | null>(null);
    const [pickupLocation, setPickupLocation] = React.useState<{ latitude: number; longitude: number } | null>(null);
    const [locationLoading, setLocationLoading] = React.useState(false);
    const [locationSaving, setLocationSaving] = React.useState(false);
    const [phoneNumber, setPhoneNumber] = React.useState(user.phone_number ?? '');
    const [phoneCode, setPhoneCode] = React.useState('');
    const [phoneBusy, setPhoneBusy] = React.useState(false);
    const [sellerName, setSellerName] = React.useState(user.name);
    const [sellerUsername, setSellerUsername] = React.useState(user.username ?? user.email.split('@')[0]);
    const [sellerEmail, setSellerEmail] = React.useState(user.email);
    const [businessName, setBusinessName] = React.useState('');
    const [businessPhone, setBusinessPhone] = React.useState('');
    const [businessAddress, setBusinessAddress] = React.useState('');
    const [profileSaving, setProfileSaving] = React.useState(false);
    const [currentPassword, setCurrentPassword] = React.useState('');
    const [newPassword, setNewPassword] = React.useState('');
    const [passwordConfirmation, setPasswordConfirmation] = React.useState('');
    const [passwordSaving, setPasswordSaving] = React.useState(false);
    const [emailVerificationBusy, setEmailVerificationBusy] = React.useState(false);
    const [accountSettingsLoading, setAccountSettingsLoading] = React.useState(false);
    const [savingPreference, setSavingPreference] = React.useState<SellerAccountPreference | null>(null);
    const [accountPreferences, setAccountPreferences] = React.useState<Record<SellerAccountPreference, boolean>>({
        order_notifications: true,
        chat_notifications: true,
        allow_direct_messages: true,
    });
    const [initialChatConversationId, setInitialChatConversationId] = React.useState<number | null>(null);
    const clearSellerNotificationBadge = React.useCallback(() => {
        setNavigationCounts((counts) => ({ ...counts, notifications: 0 }));
    }, []);

    const refreshNavigationCounts = React.useCallback(async () => {
        const results = await Promise.allSettled([
            api.get<{ summary: Pick<SellerSummary, 'pending_orders'> }>('/api/dashboard/seller'),
            api.get<{ unread_count: number; unread_chat_count: number }>('/api/notifications'),
            api.get<{ action_required_total: number }>('/api/seller/complaints'),
        ]);
        const errors: string[] = [];

        const [ordersResult, notificationsResult, complaintsResult] = results;
        if (ordersResult.status === 'fulfilled') {
            const pendingOrders = ordersResult.value.data?.summary?.pending_orders;
            if (typeof pendingOrders === 'number' && Number.isFinite(pendingOrders)) {
                setNavigationCounts((counts) => ({ ...counts, orders: pendingOrders }));
            } else {
                errors.push('Order attention count could not be loaded.');
            }
        } else {
            errors.push('Order attention count could not be loaded.');
        }
        if (notificationsResult.status === 'fulfilled') {
            const { unread_count: notifications, unread_chat_count: chats } = notificationsResult.value.data ?? {};
            if (typeof notifications === 'number' && Number.isFinite(notifications)
                && typeof chats === 'number' && Number.isFinite(chats)) {
                setNavigationCounts((counts) => ({ ...counts, notifications, chats }));
            } else {
                errors.push('Unread notification count could not be loaded.');
            }
        } else {
            errors.push('Unread notification count could not be loaded.');
        }
        if (complaintsResult.status === 'fulfilled') {
            const complaints = complaintsResult.value.data?.action_required_total;
            if (typeof complaints === 'number' && Number.isFinite(complaints)) {
                setNavigationCounts((counts) => ({ ...counts, complaints }));
            } else {
                errors.push('Complaint action count could not be loaded.');
            }
        } else {
            errors.push('Complaint action count could not be loaded.');
        }

        if (errors.length) onError(errors.join(' '));
    }, [onError]);

    React.useEffect(() => {
        setPhoneNumber(user.phone_number ?? '');
    }, [user.phone_number]);

    React.useEffect(() => {
        setSellerName(user.name);
        setSellerUsername(user.username ?? user.email.split('@')[0]);
        setSellerEmail(user.email);
    }, [user.email, user.name, user.username]);

    React.useEffect(() => {
        if (page === 'notifications' || (page === 'chats' && initialChatConversationId !== null)) return undefined;
        const refresh = () => { void refreshNavigationCounts(); };
        refresh();
        window.addEventListener('focus', refresh);
        return () => window.removeEventListener('focus', refresh);
    }, [initialChatConversationId, page, refreshNavigationCounts]);

    async function sendPhoneCode() {
        setPhoneBusy(true);
        try {
            const response = await api.post<{ message: string; user: User }>('/api/profile/phone/send', { phone_number: phoneNumber });
            onUserUpdated(response.data.user);
            showSuccess(response.data.message);
        } catch (requestError: any) {
            onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'A verification code could not be sent.');
        } finally {
            setPhoneBusy(false);
        }
    }

    async function verifyPhoneCode(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setPhoneBusy(true);
        try {
            const response = await api.post<{ message: string; user: User }>('/api/profile/phone/verify', { code: phoneCode });
            onUserUpdated(response.data.user);
            setPhoneCode('');
            showSuccess(response.data.message);
        } catch (requestError: any) {
            onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'The verification code could not be confirmed.');
        } finally {
            setPhoneBusy(false);
        }
    }

    React.useEffect(() => {
        if (page !== 'dashboard') return;
        setSummaryLoading(true);
        api.get<{ summary: SellerSummary }>('/api/dashboard/seller')
            .then((response) => setSummary(response.data.summary))
            .catch(() => onError('The seller dashboard could not be loaded.'))
            .finally(() => setSummaryLoading(false));
    }, [onError, page]);

    React.useEffect(() => {
        if (page !== 'dashboard') return;
        api.get<{ notifications: SellerNotification[] }>('/api/notifications')
            .then((response) => {
                setOrderUpdateRequests(response.data.notifications.filter((notification) => notification.data?.type === 'order_update_requested'));
                setListingModerationNotices(response.data.notifications.filter((notification) => [
                    'listing_moderation_updated',
                    'listing_moderation_needs_review',
                ].includes(notification.data?.type ?? '')));
            })
            .catch((requestError: any) => onError(requestError.userMessage ?? 'Seller notifications could not be loaded.'));
    }, [onError, page]);

    React.useEffect(() => {
        if (page !== 'listings') return;
        let active = true;
        setListingLoading(true);
        api.get<{ listings: { data: SellerListing[]; last_page: number } }>('/api/seller/listings', {
            params: { page: listingPage, q: listingSearch.trim() || undefined, sort: listingSort, direction: listingSortDirection },
        })
            .then((response) => {
                if (!active) return;
                const lastPage = response.data.listings.last_page;
                setListingLastPage(lastPage);
                if (listingPage > lastPage) {
                    setListingPage(lastPage);
                    return;
                }
                setListings(response.data.listings.data);
            })
            .catch(() => { if (active) onError('Your listings could not be loaded.'); })
            .finally(() => { if (active) setListingLoading(false); });
        return () => { active = false; };
    }, [listingPage, listingRevision, listingSearch, listingSort, listingSortDirection, onError, page]);

    React.useEffect(() => {
        if (page !== 'interests') return;
        setInterestLoading(true);
        api.get<{ interests: { data: SellerInterest[]; last_page: number } }>('/api/seller/interests', { params: { page: interestPage } })
            .then((response) => {
                setInterests(response.data.interests.data);
                setInterestLastPage(response.data.interests.last_page);
            })
            .catch(() => onError('Buyer interest could not be loaded.'))
            .finally(() => setInterestLoading(false));
    }, [interestPage, interestRevision, onError, page]);

    React.useEffect(() => {
        if (page !== 'location' && page !== 'account') return;
        setLocationLoading(true);
        api.get<{ profile: { latitude: number | null; longitude: number | null; business_name: string | null; phone: string | null; address: string | null } }>('/api/seller/profile')
            .then((response) => {
                const { latitude, longitude, business_name, phone, address } = response.data.profile;
                setPickupLocation(latitude !== null && longitude !== null ? { latitude, longitude } : null);
                setBusinessName(business_name ?? '');
                setBusinessPhone(phone ?? '');
                setBusinessAddress(address ?? '');
            })
            .catch((requestError: any) => onError(requestError.userMessage ?? 'Your pickup location could not be loaded.'))
            .finally(() => setLocationLoading(false));
    }, [onError, page]);

    React.useEffect(() => {
        if (page !== 'account' && page !== 'location') return undefined;
        let active = true;
        setAccountSettingsLoading(true);
        api.get<{ preferences: Record<SellerAccountPreference, boolean> }>('/api/profile/settings')
            .then((response) => {
                if (active) setAccountPreferences(response.data.preferences);
            })
            .catch((requestError: any) => {
                if (active) onError(requestError.userMessage ?? 'Account preferences could not be loaded.');
            })
            .finally(() => {
                if (active) setAccountSettingsLoading(false);
            });
        return () => { active = false; };
    }, [onError, page]);

    async function updateAccountPreference(preference: SellerAccountPreference, enabled: boolean) {
        setSavingPreference(preference);
        try {
            const response = await api.put<{ preferences: Record<SellerAccountPreference, boolean> }>('/api/profile/settings', {
                [preference]: enabled,
            });
            setAccountPreferences(response.data.preferences);
            showSuccess('Account preference saved.');
        } catch (requestError: any) {
            onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'The account preference could not be saved.');
        } finally {
            setSavingPreference(null);
        }
    }

    async function saveSellerAccount(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const emailChanged = sellerEmail.trim().toLowerCase() !== user.email.toLowerCase();
        const confirmed = await confirmAction({
            title: 'Save account and business details?',
            text: emailChanged
                ? `A verification email will be sent to ${sellerEmail.trim()}. Your new email address will remain unverified until you use that link.`
                : 'Your account and seller business details will be updated.',
            confirmText: 'Save details',
        });
        if (!confirmed) return;
        setProfileSaving(true);
        try {
            await initializeCsrf();
            const response = await api.put<{ user: User; email_verification_required: boolean }>('/api/profile', {
                name: sellerName,
                username: sellerUsername,
                email: sellerEmail,
                business_name: businessName,
                business_phone: businessPhone,
                business_address: businessAddress,
            });
            onUserUpdated(response.data.user);
            setSellerName(response.data.user.name);
            setSellerUsername(response.data.user.username ?? response.data.user.email.split('@')[0]);
            setSellerEmail(response.data.user.email);
            showSuccess(response.data.email_verification_required
                ? 'Seller details saved. Verify your new email address using the link we sent.'
                : 'Seller account and business details saved.');
        } catch (requestError: any) {
            onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'Seller account details could not be saved.');
        } finally {
            setProfileSaving(false);
        }
    }

    async function changeSellerPassword(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!await confirmAction({ title: 'Change your password?', text: 'Your current password is required to confirm this change.', confirmText: 'Change password' })) return;
        setPasswordSaving(true);
        try {
            await initializeCsrf();
            await api.put('/api/profile/password', {
                current_password: currentPassword,
                password: newPassword,
                password_confirmation: passwordConfirmation,
            });
            setCurrentPassword('');
            setNewPassword('');
            setPasswordConfirmation('');
            showSuccess('Password updated.');
        } catch (requestError: any) {
            onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'The password could not be changed.');
        } finally {
            setPasswordSaving(false);
        }
    }

    async function resendSellerEmailVerification() {
        if (!await confirmAction({ title: 'Send an email verification link?', text: `A verification link will be sent to ${user.email}.`, confirmText: 'Send verification link' })) return;
        setEmailVerificationBusy(true);
        try {
            await initializeCsrf();
            const response = await api.post<{ message: string }>('/api/profile/email/verification-notification');
            showSuccess(response.data.message);
        } catch (requestError: any) {
            onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'The verification email could not be sent.');
        } finally {
            setEmailVerificationBusy(false);
        }
    }

    React.useEffect(() => {
        if (page !== 'location' && page !== 'account') return;
        if (page === 'location') setSettingsTab('pickup');
    }, [page]);

    async function submitListing(listing: SellerListing) {
        if (!await confirmAction({ title: 'Submit this listing?', text: 'The listing will be sent for review or published according to your seller settings.', confirmText: 'Submit listing' })) return;
        setListingActionId(listing.id);
        try {
            await initializeCsrf();
            const response = await api.post<{ listing: { status: string } }>(`/api/seller/listings/${listing.id}/submit`);
            setNotice(response.data.listing.status === 'PENDING_REVIEW' ? 'Listing submitted for admin review.' : 'Listing submitted and is now active.');
            showSuccess(response.data.listing.status === 'PENDING_REVIEW' ? 'Listing submitted for review.' : 'Listing published.');
            setListingRevision((revision) => revision + 1);
        } catch (requestError: any) {
            onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'This listing could not be submitted.');
        } finally {
            setListingActionId(null);
        }
    }

    async function deleteListing(listing: SellerListing) {
        if (!await confirmAction({
            title: 'Delete this listing?',
            text: `"${listing.name}" will be removed. Only drafts and rejected listings can be deleted.`,
            confirmText: 'Delete listing',
            danger: true,
        })) return;
        setListingActionId(listing.id);
        try {
            await initializeCsrf();
            await api.delete(`/api/seller/listings/${listing.id}`);
            setNotice('Listing deleted.');
            setEditingListingId(null);
            setListingRevision((revision) => revision + 1);
            showSuccess('Listing deleted.');
        } catch (requestError: any) {
            onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'The listing could not be deleted.');
        } finally {
            setListingActionId(null);
        }
    }

    async function cancelListing(listing: SellerListing) {
        const pending = listing.status === 'PENDING_REVIEW';
        if (!await confirmAction({
            title: pending ? 'Cancel this submission?' : 'Cancel this active listing?',
            text: `"${listing.name}" will be removed from the marketplace and returned to Draft.`,
            confirmText: pending ? 'Cancel submission' : 'Cancel listing',
            danger: true,
        })) return;
        setListingActionId(listing.id);
        try {
            await initializeCsrf();
            await api.post(`/api/seller/listings/${listing.id}/cancel`);
            setNotice('Listing cancelled and returned to Draft.');
            setListingRevision((revision) => revision + 1);
            showSuccess('Listing cancelled and returned to Draft.');
        } catch (requestError: any) {
            onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'The listing could not be cancelled.');
        } finally {
            setListingActionId(null);
        }
    }

    function sortListings(column: ListingSortColumn) {
        setListingPage(1);
        if (column === listingSort) {
            setListingSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc');
        } else {
            setListingSort(column);
            setListingSortDirection('asc');
        }
    }

    async function updateInterest(interest: SellerInterest, status: string) {
        if (!await confirmAction({ title: 'Update buyer interest?', text: `The interest status will change to ${status.replaceAll('_', ' ').toLowerCase()}.`, confirmText: 'Update status' })) return;
        try {
            await initializeCsrf();
            await api.patch(`/api/seller/interests/${interest.id}`, { status });
            setInterestRevision((revision) => revision + 1);
            showSuccess('Buyer interest updated.');
        } catch (requestError: any) {
            onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'Buyer interest could not be updated.');
        }
    }

    async function savePickupLocation() {
        if (!pickupLocation) return;
        if (!await confirmAction({
            title: 'Update pickup location?',
            text: 'This saved map pin is used as the pickup point for checkout and order route calculations.',
            confirmText: 'Save pickup location',
        })) return;
        setLocationSaving(true);
        try {
            await initializeCsrf();
            await api.put('/api/seller/profile/location', pickupLocation);
            setNotice('Pickup location saved. Delivery distance will be calculated from this map pin.');
            showSuccess('Pickup location saved.');
        } catch (requestError: any) {
            onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'Your pickup location could not be saved.');
        } finally {
            setLocationSaving(false);
        }
    }

    function analyzeReport(report: ChatReportContext) {
        setReportContext(report);
        setPage('chats');
    }

    function renderPage() {
        if (page === 'orders') {
            return <SellerOrdersPage onNavigationCountsChanged={refreshNavigationCounts} />;
        }
        if (page === 'notifications') {
            return <NotificationsPage
                role="SELLER"
                onNotificationsRead={clearSellerNotificationBadge}
                onOpenConversation={(conversationId) => {
                    setInitialChatConversationId(conversationId);
                    setPage('chats');
                }}
            />;
        }
        if (page === 'dashboard') {
            return <>
                <AnalyticsDashboard role="SELLER" />
                <section className="seller-work-section">
                    <div className="seller-work-heading"><div><p className="eyebrow">Recent activity</p><h2>Latest orders</h2></div><button type="button" className="seller-inline-action" onClick={() => setPage('reports')}>View reports</button></div>
                    {summaryLoading ? <p className="seller-loading">Loading order activity...</p> : summary?.recent_orders.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Order</th><th>Status</th><th>Delivery</th><th>Proof</th><th>Order date</th><th>Total</th></tr></thead><tbody>{summary.recent_orders.map((order) => <tr key={order.id}><td><strong>{order.order_reference}</strong></td><td><span className="status-pill">{order.status}</span></td><td>{order.delivery?.status?.replaceAll('_', ' ') ?? 'Not assigned'}</td><td>{order.delivery?.has_delivery_proof ? `Recorded · ${order.delivery.proof_captured_at ? new Date(order.delivery.proof_captured_at).toLocaleString() : 'time unavailable'}` : order.delivery?.status === 'DELIVERED' ? 'Missing' : 'Pending'}</td><td>{new Date(order.created_at).toLocaleDateString()}</td><td>PHP {order.total_amount}</td></tr>)}</tbody></table></div> : <p className="seller-empty">No orders have been placed yet.</p>}
                    <p className="seller-total-sales">Lifetime completed sales <strong>PHP {summary?.total_completed_sales ?? '0.00'}</strong></p>
                </section>
                {orderUpdateRequests.length > 0 && <section className="seller-work-section seller-order-update-requests" aria-labelledby="seller-order-update-requests-title">
                    <div className="seller-work-heading"><div><p className="eyebrow">Buyer requests</p><h2 id="seller-order-update-requests-title">Order updates requested</h2></div></div>
                    <ul>{orderUpdateRequests.map((request) => <li key={request.id}><strong>{request.data.buyer_name ?? 'A buyer'} asked for an update on {request.data.order_reference ? `order ${request.data.order_reference}` : 'an order'}.</strong><time dateTime={request.created_at}>{new Date(request.created_at).toLocaleString()}</time></li>)}</ul>
                </section>}
                {listingModerationNotices.length > 0 && <section className="seller-work-section seller-order-update-requests" aria-labelledby="seller-listing-review-notices-title">
                    <div className="seller-work-heading"><div><p className="eyebrow">AI moderation</p><h2 id="seller-listing-review-notices-title">Listing review updates</h2></div></div>
                    <ul>{listingModerationNotices.map((notification) => {
                        const reasons = [...(notification.data.reasons ?? []), ...(notification.data.flags ?? [])];
                        const status = notification.data.moderation_status;
                        const approved = status === 'AUTO_APPROVED' || status === 'ADMIN_APPROVED';
                        const rejected = status === 'AUTO_REJECTED' || status === 'ADMIN_REJECTED';
                        const disabled = status === 'ADMIN_DISABLED';
                        return <li key={notification.id}>
                            <div><strong>{notification.data.listing_name ?? 'Your listing'} {approved ? 'is now active.' : rejected ? 'was rejected.' : disabled ? 'was disabled.' : 'needs administrator review.'}</strong>
                                <p>{reasons.length ? `Reason: ${reasons.join(' ')}` : approved ? 'The listing passed review and is visible in the marketplace.' : rejected ? 'The listing did not meet FARMGATE marketplace requirements.' : disabled ? 'The listing is not visible in the marketplace.' : 'AI moderation could not approve the listing automatically. It remains pending administrator review.'}</p>
                            </div>
                            <time dateTime={notification.created_at}>{new Date(notification.created_at).toLocaleString()}</time>
                        </li>;
                    })}</ul>
                </section>}
                <div className="seller-quick-actions"><button type="button" onClick={() => { setPage('listings'); setListingFormOpen(true); }}>Add a listing</button><button type="button" onClick={() => setPage('interests')}>Review buyer interest</button></div>
            </>;
        }

        if (page === 'listings') {
            const sortButton = (column: ListingSortColumn, label: string) => <button
                className="seller-listing-sort"
                type="button"
                onClick={() => sortListings(column)}
                aria-label={`Sort by ${label}${listingSort === column ? `, currently ${listingSortDirection === 'asc' ? 'ascending' : 'descending'}` : ''}`}
            >{label}{listingSort === column ? <span aria-hidden="true">{listingSortDirection === 'asc' ? ' ↑' : ' ↓'}</span> : <span aria-hidden="true"> ↕</span>}</button>;
            const editingListing = listings.find((listing) => listing.id === editingListingId);
            return <section className="seller-work-section">
                <div className="seller-work-heading"><div><p className="eyebrow">Catalog</p><h2>My listings</h2></div><button className="seller-inline-action" type="button" onClick={() => setListingFormOpen((open) => !open)}>{listingFormOpen ? 'Close form' : 'Add listing +'}</button></div>
                {notice && <p className="seller-notice" role="status">{notice}</p>}
                {listingFormOpen && <div className="seller-listing-form-wrap"><SellerListingForm categories={categories} onSaved={() => { setNotice('Draft saved. Submit it for review when it is ready.'); setListingFormOpen(false); setListingRevision((revision) => revision + 1); }} onError={onError} /></div>}
                {editingListing && <SellerListingEditor key={editingListing.id} listing={editingListing} categories={categories} onCancel={() => setEditingListingId(null)} onError={onError} onSaved={() => {
                    setNotice('Listing changes saved.');
                    setEditingListingId(null);
                    setListingRevision((revision) => revision + 1);
                    showSuccess('Listing changes saved.');
                }} />}
                <label className="seller-listing-search">Search listings by name or category
                    <input type="search" value={listingSearch} onChange={(event) => {
                        setListingSearch(event.target.value);
                        setListingPage(1);
                    }} placeholder="e.g. Native pig or Swine" aria-label="Search listings by name or category" />
                </label>
                {listingLoading ? <p className="seller-loading" role="status">Loading your listings...</p> : listings.length ? <div className="data-table-wrap"><table className="data-table seller-listings-table">
                    <caption className="sr-only">Your livestock listings. Activate a column heading to sort ascending or descending.</caption>
                    <thead><tr>
                        <th aria-sort={listingSort === 'name' ? listingSortDirection === 'asc' ? 'ascending' : 'descending' : 'none'}>{sortButton('name', 'Listing')}</th>
                        <th aria-sort={listingSort === 'category' ? listingSortDirection === 'asc' ? 'ascending' : 'descending' : 'none'}>{sortButton('category', 'Category')}</th>
                        <th aria-sort={listingSort === 'price' ? listingSortDirection === 'asc' ? 'ascending' : 'descending' : 'none'}>{sortButton('price', 'Price')}</th>
                        <th aria-sort={listingSort === 'quantity' ? listingSortDirection === 'asc' ? 'ascending' : 'descending' : 'none'}>{sortButton('quantity', 'Available')}</th>
                        <th aria-sort={listingSort === 'status' ? listingSortDirection === 'asc' ? 'ascending' : 'descending' : 'none'}>{sortButton('status', 'Status')}</th>
                        <th>Actions</th>
                    </tr></thead>
                    <tbody>{listings.map((listing) => {
                        const editable = ['DRAFT', 'REJECTED'].includes(listing.status);
                        const cancellable = ['ACTIVE', 'PENDING_REVIEW'].includes(listing.status);
                        const busy = listingActionId === listing.id;
                        const price = listing.pricing_type === 'PER_KILO' ? listing.price_per_kilo : listing.price_per_head;
                        return <tr key={listing.id}>
                            <td data-label="Listing"><strong>{listing.name}</strong></td>
                            <td data-label="Category">{listing.category.name}</td>
                            <td data-label="Price">PHP {Number(price ?? 0).toLocaleString()} / {listing.pricing_type === 'PER_KILO' ? 'kg' : 'head'}</td>
                            <td data-label="Available">{listing.quantity} {listing.pricing_type === 'PER_KILO' ? 'kg' : 'head'}</td>
                            <td data-label="Status"><span className={`status-pill status-${listing.status.toLowerCase()}`}>{listing.status.replaceAll('_', ' ')}</span></td>
                            <td data-label="Actions"><div className="seller-listing-actions">{editable ? <>
                                <button className="seller-table-action" type="button" disabled={busy} onClick={() => setEditingListingId(listing.id)} aria-label={`Edit ${listing.name}`}>Edit</button>
                                <button className="seller-table-action seller-listing-delete" type="button" disabled={busy} onClick={() => void deleteListing(listing)} aria-label={`Delete ${listing.name}`}>{busy ? 'Working...' : 'Delete'}</button>
                                <button className="seller-table-action" type="button" disabled={busy} onClick={() => void submitListing(listing)} aria-label={`Submit ${listing.name} for review`}>{busy ? 'Working...' : 'Submit'}</button>
                            </> : cancellable ? <button className="seller-table-action seller-listing-delete" type="button" disabled={busy} onClick={() => void cancelListing(listing)} aria-label={`${listing.status === 'PENDING_REVIEW' ? 'Cancel submission for' : 'Cancel active listing'} ${listing.name}`}>{busy ? 'Working...' : 'Cancel'}</button> : <span className="seller-muted">No actions available</span>}</div></td>
                        </tr>;
                    })}</tbody>
                </table></div> : <p className="seller-empty">{listingSearch.trim() ? 'No listings match your search.' : 'You have not created any listings yet.'}</p>}
                <Pagination page={listingPage} lastPage={listingLastPage} onChange={setListingPage} />
            </section>;
        }
        if (page === 'promotions') return <SellerPromotions onError={onError} />;

        if (page === 'interests') {
            return <section className="seller-work-section">
                <div className="seller-work-heading"><div><p className="eyebrow">Sales pipeline</p><h2>Buyer interest</h2></div></div>
                {interestLoading ? <p className="seller-loading">Loading buyer interest...</p> : interests.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Buyer</th><th>Listing</th><th>Received</th><th>Interest status</th></tr></thead><tbody>{interests.map((interest) => <tr key={interest.id}><td>{interest.buyer?.name ?? 'Buyer'}</td><td><strong>{interest.listing?.name ?? 'Listing'}</strong></td><td><span className="status-pill">#{interest.id}</span></td><td><label className="seller-status-control"><span className="sr-only">Update interest status for {interest.buyer?.name ?? 'buyer'}</span><select value={interest.status} onChange={(event) => updateInterest(interest, event.target.value)}>{interestStatuses.map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}</select></label></td></tr>)}</tbody></table></div> : <p className="seller-empty">No buyers have expressed interest in your listings yet.</p>}
                <Pagination page={interestPage} lastPage={interestLastPage} onChange={setInterestPage} />
            </section>;
        }

        if (page === 'complaints') return <ComplaintList onError={onError} />;
        if (page === 'chats') return <AIChatPage
            role="SELLER"
            reportContext={reportContext}
            initialConversationId={initialChatConversationId ?? undefined}
            onUnreadMessagesRead={() => {
                setInitialChatConversationId(null);
                void refreshNavigationCounts();
            }}
        />;
        if (page === 'account' || page === 'location') return <section className="seller-work-section seller-settings-page">
            <div className="seller-work-heading"><div><p className="eyebrow">Seller portal settings</p><h2>Settings</h2></div></div>
            <div className="seller-settings-tabs" role="tablist" aria-label="Seller settings">
                {([
                    ['profile', 'Profile & business'],
                    ['password', 'Password'],
                    ['phone', 'Phone security'],
                    ['preferences', 'Notifications & privacy'],
                    ['pickup', 'Pickup location'],
                ] as const).map(([tab, label]) => <button
                    key={tab}
                    id={`seller-settings-tab-${tab}`}
                    className="seller-settings-tab"
                    type="button"
                    role="tab"
                    aria-selected={settingsTab === tab}
                    aria-controls={`seller-settings-panel-${tab}`}
                    tabIndex={settingsTab === tab ? 0 : -1}
                    onClick={() => setSettingsTab(tab)}
                    onKeyDown={(event) => {
                        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                        event.preventDefault();
                        const tabs: SellerSettingsTab[] = ['profile', 'password', 'phone', 'preferences', 'pickup'];
                        const current = tabs.indexOf(tab);
                        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
                        setSettingsTab(tabs[next]);
                        document.getElementById(`seller-settings-tab-${tabs[next]}`)?.focus();
                    }}
                >{label}</button>)}
            </div>
            <section className="seller-account-management" aria-labelledby="seller-account-management-heading">
                <p id="seller-account-management-heading" className="seller-account-management-heading">Account management</p>
                <section className="seller-settings-section" id="seller-settings-panel-profile" role="tabpanel" aria-labelledby="seller-settings-tab-profile" hidden={settingsTab !== 'profile'} tabIndex={-1}>
                    <div className="seller-work-heading"><div><p className="eyebrow">Seller account</p><h3 id="seller-profile-settings-heading">Settings</h3></div></div>
                    <form className="seller-account-form" onSubmit={saveSellerAccount}>
                        <label>Account name<input type="text" autoComplete="name" maxLength={120} required value={sellerName} onChange={(event) => setSellerName(event.target.value)} /></label>
                        <label>Username<input type="text" autoComplete="username" minLength={3} maxLength={32} pattern="[A-Za-z0-9_-]+" required value={sellerUsername} onChange={(event) => setSellerUsername(event.target.value)} /></label>
                        <label>Email address<input type="email" autoComplete="email" maxLength={255} required value={sellerEmail} onChange={(event) => setSellerEmail(event.target.value)} /></label>
                        <p className="seller-email-verification">Email status: {user.email_verified_at ? 'Verified' : 'Not verified'}{!user.email_verified_at && <> · <button type="button" className="seller-text-action" disabled={emailVerificationBusy} onClick={() => void resendSellerEmailVerification()}>{emailVerificationBusy ? 'Sending...' : 'Resend verification email'}</button></>}</p>
                        <label>Business name<input type="text" autoComplete="organization" maxLength={255} value={businessName} onChange={(event) => setBusinessName(event.target.value)} /></label>
                        <label>Business contact phone<input type="tel" autoComplete="tel" inputMode="tel" maxLength={30} value={businessPhone} onChange={(event) => setBusinessPhone(event.target.value)} /><small>This business contact is separate from your verified account phone number.</small></label>
                        <label>Business address<textarea autoComplete="street-address" maxLength={2000} value={businessAddress} onChange={(event) => setBusinessAddress(event.target.value)} /></label>
                        <button className="seller-inline-action" type="submit" disabled={profileSaving}>{profileSaving ? 'Saving details...' : 'Save account details'}</button>
                    </form>
                </section>
                <section className="seller-settings-section" id="seller-settings-panel-password" role="tabpanel" aria-labelledby="seller-settings-tab-password" hidden={settingsTab !== 'password'} tabIndex={-1}>
                    <div className="seller-work-heading"><div><p className="eyebrow">Profile protection</p><h3 id="seller-password-settings-heading">Change password</h3></div></div>
                    <form className="seller-account-form" onSubmit={changeSellerPassword}>
                        <label>Current password<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
                        <label>New password<input type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label>
                        <label>Confirm new password<input type="password" autoComplete="new-password" minLength={8} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} required /></label>
                        <button className="seller-inline-action" type="submit" disabled={passwordSaving}>{passwordSaving ? 'Updating password...' : 'Update password'}</button>
                    </form>
                </section>
                <section className="seller-settings-section" id="seller-settings-panel-phone" role="tabpanel" aria-labelledby="seller-settings-tab-phone" hidden={settingsTab !== 'phone'} tabIndex={-1}>
                    <div className="seller-work-heading"><div><p className="eyebrow">Profile protection</p><h3 id="seller-account-security-heading">Phone verification</h3></div></div>
                    <p>Verify a Philippine mobile number for your account. Codes expire after 10 minutes.</p>
                    <p>{user.phone_number || 'No phone number added'} · {user.phone_verified_at ? 'Verified' : 'Not verified'}</p>
                    <label>Phone number<input type="tel" inputMode="tel" autoComplete="tel" maxLength={30} placeholder="09XXXXXXXXX or +639XXXXXXXXX" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} /></label>
                    <button className="seller-inline-action" type="button" disabled={phoneBusy || !phoneNumber.trim()} onClick={() => void sendPhoneCode()}>{phoneBusy ? 'Sending...' : user.phone_number === phoneNumber && user.phone_verified_at ? 'Phone verified' : user.phone_number === phoneNumber ? 'Send / resend code' : 'Verify this number'}</button>
                    {!user.phone_verified_at && <form onSubmit={verifyPhoneCode}>
                        <label>Six-digit verification code<input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={phoneCode} onChange={(event) => setPhoneCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required /></label>
                        <button className="seller-inline-action" type="submit" disabled={phoneBusy || phoneCode.length !== 6}>{phoneBusy ? 'Checking...' : 'Verify phone number'}</button>
                    </form>}
                </section>
                <section className="seller-settings-section" id="seller-settings-panel-preferences" role="tabpanel" aria-labelledby="seller-settings-tab-preferences" hidden={settingsTab !== 'preferences'} tabIndex={-1}>
                    <div className="seller-work-heading"><div><p className="eyebrow">Communication controls</p><h3 id="seller-notification-preferences-heading">Notifications &amp; privacy</h3></div></div>
                    <p>Choose which in-app updates you receive and whether other users can start or continue direct messages with you.</p>
                    {accountSettingsLoading ? <p className="seller-loading" role="status">Loading account preferences...</p> : <>
                        <label className="buyer-account-setting-toggle">
                            <span><strong>Order notifications</strong><small>In-app notifications when buyers place orders or your order status changes.</small></span>
                            <input type="checkbox" checked={accountPreferences.order_notifications} disabled={savingPreference !== null} onChange={(event) => void updateAccountPreference('order_notifications', event.target.checked)} />
                        </label>
                        <label className="buyer-account-setting-toggle">
                            <span><strong>Chat notifications</strong><small>In-app notifications when you receive a new chat message.</small></span>
                            <input type="checkbox" checked={accountPreferences.chat_notifications} disabled={savingPreference !== null} onChange={(event) => void updateAccountPreference('chat_notifications', event.target.checked)} />
                        </label>
                        <label className="buyer-account-setting-toggle">
                            <span><strong>Allow direct messages</strong><small>When off, other users cannot start or continue a direct conversation. Order and listing-interest eligibility rules still apply.</small></span>
                            <input type="checkbox" checked={accountPreferences.allow_direct_messages} disabled={savingPreference !== null} onChange={(event) => void updateAccountPreference('allow_direct_messages', event.target.checked)} />
                        </label>
                    </>}
                </section>
                <section className="seller-settings-section" id="seller-settings-panel-pickup" role="tabpanel" aria-labelledby="seller-settings-tab-pickup" hidden={settingsTab !== 'pickup'} tabIndex={-1}>
                    <div className="seller-work-heading"><div><p className="eyebrow">Delivery setup</p><h3 id="seller-pickup-location-heading">Pickup location</h3></div></div>
                    <p className="seller-location-help">New seller accounts start at the Bongabong map center as an approximate pickup location. Move the pin to the exact place where buyers or delivery providers should collect livestock; checkout and order route maps use the saved location.</p>
                    {locationLoading ? <p className="seller-loading">Loading pickup location...</p> : <>
                        <React.Suspense fallback={<p className="seller-loading">Loading location map...</p>}>
                            <LocationMap latitude={pickupLocation?.latitude ?? 12.7321} longitude={pickupLocation?.longitude ?? 121.3654} onChange={(latitude, longitude) => setPickupLocation({ latitude, longitude })} tooltip="Drag to your livestock pickup location" />
                        </React.Suspense>
                        {pickupLocation && <p className="seller-location-coordinates">{pickupLocation.latitude.toFixed(5)}, {pickupLocation.longitude.toFixed(5)}</p>}
                        <button className="seller-inline-action" type="button" disabled={!pickupLocation || locationSaving} onClick={savePickupLocation}>{locationSaving ? 'Saving...' : 'Save pickup location'}</button>
                        {!pickupLocation && <p className="seller-location-help">Click the map or drag the pin to your business pickup location before saving.</p>}
                    </>}
                    {notice && <p className="seller-notice" role="status">{notice}</p>}
                </section>
            </section>
        </section>;
        return <ReportPanel role="SELLER" onError={onError} onAnalyze={analyzeReport} />;
    }

    const activeNavigation = navigation.find((item) => item.id === page) ?? (page === 'location' ? navigation.find((item) => item.id === 'account') : undefined);
    const pageTitle = page === 'location' || page === 'account' ? 'Settings' : activeNavigation?.label ?? (page === 'interests' ? 'Buyer interest' : '');

    return <main className="admin-shell seller-shell">
        <aside className="admin-sidebar">
            <a className="brand" href="/">FARM<span>GATE</span></a>
            <div className="admin-sidebar-label">SELLER PORTAL</div>
            <nav aria-label="Seller navigation">{navigation.map((item) => {
                const badgeCount = item.badge ? navigationCounts[item.badge] : 0;
                const badgeDescription = item.badge === 'orders'
                    ? navigationBadgeLabel(badgeCount, 'order needing attention', 'orders needing attention')
                    : item.badge === 'notifications'
                        ? navigationBadgeLabel(badgeCount, 'unread notification', 'unread notifications')
                        : item.badge === 'complaints'
                            ? navigationBadgeLabel(badgeCount, 'complaint needing action', 'complaints needing action')
                            : item.badge === 'chats'
                                ? navigationBadgeLabel(badgeCount, 'unread message', 'unread messages')
                                : '';
                const selected = page === item.id || (page === 'location' && item.id === 'account');
                return <button type="button" key={item.id} className={selected ? 'active' : ''} aria-current={selected ? 'page' : undefined} aria-label={badgeCount > 0 ? `${item.label}, ${badgeDescription}` : item.label} title={badgeCount > 0 ? `${item.label}, ${badgeDescription}` : item.label} onClick={() => { setPage(item.id); setNotice(null); }}><span className="nav-icon" aria-hidden="true">{item.id === 'notifications' ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg> : item.icon}</span><span className="seller-nav-label">{item.label}</span><NavigationBadge count={badgeCount} /></button>;
            })}</nav>
            <button className="sidebar-logout" type="button" onClick={onLogout}>Log out <span>↗</span></button>
        </aside>
        <section className="admin-content seller-content">
            <header className="admin-header"><div><p className="eyebrow">FARMGATE seller workspace</p><h1>{pageTitle}</h1><p>Manage your listings, orders, and buyer relationships.</p></div><span className="admin-role">SELLER</span></header>
            {error && <p className="seller-error" role="alert">{error}</p>}
            {renderPage()}
        </section>
    </main>;
}