import React from 'react';
import api, { initializeCsrf } from '../../lib/api';
import type { Category, Listing, User } from '../../shared/types';
import { Pagination } from '../../shared/components/Pagination';
import { ComplaintList } from './ComplaintList';
import { ReviewList } from './ReviewList';
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
import { SellerPayouts } from './SellerPayouts';
import { WorkspaceAccountControl, WorkspaceMobileHeader, useWorkspaceMobileMenu } from '../shared/WorkspaceMobileHeader';
import { WorkspaceBannerArtwork } from '../shared/WorkspaceBannerArtwork';
import { RoleMobileBottomNavigation } from '../shared/RoleMobileBottomNavigation';
import { SellerShopProfileSettings } from './SellerShopProfileSettings';
import { SellerSetupGuide } from './SellerSetupGuide';
import { SettingsCategoryIcon } from '../shared/SettingsCategoryIcon';
import { FarmgateBrand } from '../shared/FarmgateBrand';
import { WorkspaceSidebarIcon } from '../shared/WorkspaceSidebarIcon';

const LocationMap = React.lazy(() => import('../../shared/components/LocationMap').then((module) => ({ default: module.LocationMap })));

type SellerPage = 'dashboard' | 'orders' | 'payouts' | 'notifications' | 'listings' | 'promotions' | 'complaints' | 'reviews' | 'reports' | 'chats' | 'location' | 'account';
type SellerSettingsTab = 'profile' | 'shop' | 'password' | 'phone' | 'preferences' | 'pickup';
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
    orders_needing_confirmation: number;
    active_listings: number;
    sold_listings: number;
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
    updated_at?: string | null;
    breed?: string | null;
    sex?: string | null;
    age_months?: number | null;
    description?: string | null;
    pickup_location?: string | null;
    health_information?: string | null;
    vaccination_information?: string | null;
};
type SellerListingSummary = { total: number; active: number; pending_review: number; draft: number };
type ListingSortColumn = 'name' | 'category' | 'price' | 'quantity' | 'status' | 'created_at' | 'updated_at';
const navigation: { id: SellerPage; label: string; icon: string; badge?: SellerNavigationBadge }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: '◈' },
    { id: 'orders', label: 'Orders', icon: '▣', badge: 'orders' },
    { id: 'payouts', label: 'Payouts', icon: '₱' },
    { id: 'notifications', label: 'Notifications', icon: '', badge: 'notifications' },
    { id: 'listings', label: 'My listings', icon: '▤' },
    { id: 'promotions', label: 'Promotions', icon: '％' },
    { id: 'complaints', label: 'Complaints', icon: '!', badge: 'complaints' },
    { id: 'reviews', label: 'Reviews', icon: '★' },
    { id: 'reports', label: 'Reports', icon: '▥' },
    { id: 'chats', label: 'Chats', icon: '✦', badge: 'chats' },
    { id: 'account', label: 'Settings', icon: '◉' },
];
const sellerMobileDestinations = [
    { id: 'dashboard', label: 'Home', icon: 'home' },
    { id: 'chats', label: 'Chats', icon: 'chat' },
    { id: 'listings', label: 'Listings', icon: 'document' },
    { id: 'account', label: 'Settings', icon: 'settings' },
] as const;

const listingStatuses = ['ACTIVE', 'PENDING_REVIEW', 'DRAFT', 'REJECTED', 'SOLD', 'DISABLED', 'ARCHIVED'];
const listingSortOptions: { value: `${ListingSortColumn}:${'asc' | 'desc'}`; label: string }[] = [
    { value: 'created_at:desc', label: 'Newest first' },
    { value: 'created_at:asc', label: 'Oldest first' },
    { value: 'updated_at:desc', label: 'Recently updated' },
    { value: 'updated_at:asc', label: 'Least recently updated' },
    { value: 'name:asc', label: 'Name A–Z' },
    { value: 'name:desc', label: 'Name Z–A' },
    { value: 'category:asc', label: 'Category A–Z' },
    { value: 'category:desc', label: 'Category Z–A' },
    { value: 'price:asc', label: 'Price: low to high' },
    { value: 'price:desc', label: 'Price: high to low' },
    { value: 'quantity:asc', label: 'Available: low to high' },
    { value: 'quantity:desc', label: 'Available: high to low' },
    { value: 'status:asc', label: 'Status A–Z' },
    { value: 'status:desc', label: 'Status Z–A' },
];

type SellerListingIconName = 'total' | 'active' | 'pending' | 'draft' | 'livestock' | 'search' | 'category' | 'status' | 'sort' | 'view' | 'edit' | 'delete' | 'submit' | 'cancel' | 'rejected';

function SellerListingIcon({ name }: { name: SellerListingIconName }) {
    const icons: Record<SellerListingIconName, React.ReactNode> = {
        total: <><path d="m4 7 8-4 8 4-8 4-8-4Z" /><path d="m4 12 8 4 8-4M4 17l8 4 8-4" /></>,
        active: <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></>,
        pending: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
        draft: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5" /></>,
        livestock: <><path d="M3.5 13c0-3 2.3-5 5.7-5h6.2l2.1-2 2.2 1.2-.5 2.4c1.3.9 2.3 2.3 2.3 4v2h-2.2v2h-2v-2H8v2H6v-2H3.5z" /><circle cx="14.5" cy="10.8" r=".7" /></>,
        search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
        category: <><path d="M20 13 13 20 3 10V4h6l11 9Z" /><circle cx="7.5" cy="7.5" r="1" /></>,
        status: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="8" cy="6" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="10" cy="18" r="2" /></>,
        sort: <><path d="M8 4v16M4 8l4-4 4 4M16 20V4m-4 12 4 4 4-4" /></>,
        view: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
        edit: <><path d="m4 16.5-.8 4.3 4.3-.8L19 8.5 15.5 5 4 16.5Z" /><path d="m13.8 6.7 3.5 3.5" /></>,
        delete: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3" /></>,
        submit: <><path d="M21 3 10 14" /><path d="m21 3-7 18-4-7-7-4 18-7Z" /></>,
        cancel: <><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6m0-6-6 6" /></>,
        rejected: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6m0 4h.01" /></>,
    };

    return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{icons[name]}</svg>;
}

export function SellerWorkspace({ categories, error, user, onError, onUserUpdated, onLogout }: SellerWorkspaceProps) {
    const [page, setPage] = React.useState<SellerPage>(() => window.location.hash === '#notifications' ? 'notifications' : 'dashboard');
    const [mobileNavOpen, setMobileNavOpen] = useWorkspaceMobileMenu();
    const [notificationCaseReference, setNotificationCaseReference] = React.useState<string | null>(null);
    const [notificationOrderId, setNotificationOrderId] = React.useState<number | null>(null);
    const [settingsTab, setSettingsTab] = React.useState<SellerSettingsTab>('profile');
    const [setupRefreshKey, setSetupRefreshKey] = React.useState(0);
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
    const [listingLoadingError, setListingLoadingError] = React.useState<string | null>(null);
    const [listingSummary, setListingSummary] = React.useState<SellerListingSummary | null>(null);
    const [listingResultRange, setListingResultRange] = React.useState<{ from: number | null; to: number | null; total: number }>({ from: null, to: null, total: 0 });
    const [listingPage, setListingPage] = React.useState(1);
    const [listingLastPage, setListingLastPage] = React.useState(1);
    const [listingRevision, setListingRevision] = React.useState(0);
    const [listingSearch, setListingSearch] = React.useState('');
    const [listingCategoryFilter, setListingCategoryFilter] = React.useState('');
    const [listingStatusFilter, setListingStatusFilter] = React.useState('');
    const [listingSort, setListingSort] = React.useState<ListingSortColumn>('created_at');
    const [listingSortDirection, setListingSortDirection] = React.useState<'asc' | 'desc'>('desc');
    const [editingListingId, setEditingListingId] = React.useState<number | null>(null);
    const [listingActionId, setListingActionId] = React.useState<number | null>(null);
    const [listingFormOpen, setListingFormOpen] = React.useState(false);
    const [notice, setNotice] = React.useState<string | null>(null);
    const [pickupLocation, setPickupLocation] = React.useState<{ latitude: number; longitude: number } | null>(null);
    const [pickupLocationConfirmed, setPickupLocationConfirmed] = React.useState(false);
    const [locationLoading, setLocationLoading] = React.useState(false);
    const [locationLocating, setLocationLocating] = React.useState(false);
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
    const [notificationListingId, setNotificationListingId] = React.useState<number | null>(null);
    React.useEffect(() => {
        if (page !== 'dashboard') return;
        document.body.classList.add('seller-dashboard-open');

        return () => document.body.classList.remove('seller-dashboard-open');
    }, [page]);

    const refreshNavigationCounts = React.useCallback(async (notificationCounts?: { unread_count: number; unread_chat_count: number }) => {
        if (notificationCounts) {
            setNavigationCounts((counts) => ({
                ...counts,
                notifications: notificationCounts.unread_count,
                chats: notificationCounts.unread_chat_count,
            }));
            return;
        }

        const results = await Promise.allSettled([
            api.get<{ summary: Pick<SellerSummary, 'orders_needing_confirmation'> }>('/api/dashboard/seller'),
            api.get<{ unread_count: number; unread_chat_count: number }>('/api/notifications'),
            api.get<{ action_required_total: number }>('/api/seller/complaints'),
        ]);
        const errors: string[] = [];

        const [ordersResult, notificationsResult, complaintsResult] = results;
        if (ordersResult.status === 'fulfilled') {
            const ordersNeedingConfirmation = ordersResult.value.data?.summary?.orders_needing_confirmation;
            if (typeof ordersNeedingConfirmation === 'number' && Number.isFinite(ordersNeedingConfirmation)) {
                setNavigationCounts((counts) => ({ ...counts, orders: ordersNeedingConfirmation }));
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
    const clearSellerNotificationBadge = refreshNavigationCounts;

    React.useEffect(() => {
        const handleHashChange = () => {
            if (window.location.hash === '#notifications') setPage('notifications');
        };
        window.addEventListener('hashchange', handleHashChange);

        return () => window.removeEventListener('hashchange', handleHashChange);
    }, []);

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
        let active = true;
        let refreshing = false;
        setSummaryLoading(true);

        const refresh = () => {
            if (!active || refreshing || document.visibilityState === 'hidden') return;
            refreshing = true;
            api.get<{ summary: SellerSummary }>('/api/dashboard/seller')
                .then((response) => {
                    if (active) setSummary(response.data.summary);
                })
                .catch(() => {
                    if (active) onError('The seller dashboard could not be loaded.');
                })
                .finally(() => {
                    refreshing = false;
                    if (active) setSummaryLoading(false);
                });
        };

        refresh();
        const interval = window.setInterval(refresh, 30000);
        window.addEventListener('focus', refresh);
        document.addEventListener('visibilitychange', refresh);

        return () => {
            active = false;
            window.clearInterval(interval);
            window.removeEventListener('focus', refresh);
            document.removeEventListener('visibilitychange', refresh);
        };
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
        setListingLoadingError(null);
        api.get<{
            listings: { data: SellerListing[]; from: number | null; to: number | null; total: number; last_page: number };
            summary: SellerListingSummary;
        }>('/api/seller/listings', {
            params: {
                page: listingPage,
                q: listingSearch.trim() || undefined,
                category_id: listingCategoryFilter || undefined,
                status: listingStatusFilter || undefined,
                sort: listingSort,
                direction: listingSortDirection,
            },
        })
            .then((response) => {
                if (!active) return;
                setListingLoadingError(null);
                const lastPage = response.data.listings.last_page;
                setListingLastPage(lastPage);
                setListingSummary(response.data.summary);
                setListingResultRange({
                    from: response.data.listings.from,
                    to: response.data.listings.to,
                    total: response.data.listings.total,
                });
                if (listingPage > lastPage) {
                    setListingPage(lastPage);
                    return;
                }
                setListings(response.data.listings.data);
            })
            .catch(() => {
                if (!active) return;
                setListingLoadingError('Your listings could not be loaded.');
            })
            .finally(() => { if (active) setListingLoading(false); });
        return () => { active = false; };
    }, [listingCategoryFilter, listingPage, listingRevision, listingSearch, listingSort, listingSortDirection, listingStatusFilter, page]);

    React.useEffect(() => {
        if (page !== 'location' && page !== 'account') return;
        setLocationLoading(true);
        api.get<{ profile: { latitude: number | null; longitude: number | null; pickup_location_confirmed: boolean; business_name: string | null; phone: string | null; address: string | null } }>('/api/seller/profile')
            .then((response) => {
                const { latitude, longitude, pickup_location_confirmed, business_name, phone, address } = response.data.profile;
                setPickupLocation(latitude !== null && longitude !== null ? { latitude, longitude } : null);
                setPickupLocationConfirmed(pickup_location_confirmed);
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
            setSetupRefreshKey((revision) => revision + 1);
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
            setSetupRefreshKey((revision) => revision + 1);
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
        const hasPassword = user.password_setup_complete;
        if (!await confirmAction({
            title: hasPassword ? 'Change your password?' : 'Set a password?',
            text: hasPassword ? 'Your current password is required to confirm this change.' : 'You can set a password for this signed-in account now.',
            confirmText: hasPassword ? 'Change password' : 'Set password',
        })) return;
        setPasswordSaving(true);
        try {
            await initializeCsrf();
            const response = await api.put<{ user: User }>('/api/profile/password', {
                ...(hasPassword ? { current_password: currentPassword } : {}),
                password: newPassword,
                password_confirmation: passwordConfirmation,
            });
            onUserUpdated(response.data.user);
            setCurrentPassword('');
            setNewPassword('');
            setPasswordConfirmation('');
            setSetupRefreshKey((revision) => revision + 1);
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

    function locatePickupLocation() {
        if (!navigator.geolocation) {
            onError('Location services are unavailable. Use a supported browser over HTTPS or localhost.');
            return;
        }

        setLocationLocating(true);
        navigator.geolocation.getCurrentPosition(
            (position) => {
                setPickupLocation({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                });
                setPickupLocationConfirmed(false);
                setNotice('Current location added to the map. Save the pickup location to apply it to your business.');
                setLocationLocating(false);
            },
            (error) => {
                const message = error.code === error.PERMISSION_DENIED
                    ? 'Location access was denied. Allow location access in your browser settings or move the map pin manually.'
                    : error.code === error.POSITION_UNAVAILABLE
                        ? 'Your current location is unavailable. Try again or move the map pin manually.'
                        : error.code === error.TIMEOUT
                            ? 'Finding your location timed out. Try again or move the map pin manually.'
                            : 'Your location could not be accessed. Try again or move the map pin manually.';
                onError(message);
                setLocationLocating(false);
            },
            { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
        );
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
            setPickupLocationConfirmed(true);
            setSetupRefreshKey((revision) => revision + 1);
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
            return <SellerOrdersPage
                onNavigationCountsChanged={refreshNavigationCounts}
                initialOrderId={notificationOrderId}
                onInitialOrderHandled={() => setNotificationOrderId(null)}
            />;
        }
        if (page === 'payouts') return <SellerPayouts onError={onError} />;
        if (page === 'notifications') {
            return <NotificationsPage
                role="SELLER"
                onNotificationsRead={clearSellerNotificationBadge}
                onOpenOrder={(orderId) => { setNotificationOrderId(orderId); setPage('orders'); }}
                onOpenCase={(_, caseReference) => { setNotificationCaseReference(caseReference ?? null); setPage('complaints'); }}
                onOpenReview={() => setPage('reviews')}
                onOpenListing={(listingId) => { setNotificationListingId(listingId); setListingSearch(String(listingId)); setListingPage(1); setPage('listings'); }}
                onOpenConversation={(conversationId) => {
                    setInitialChatConversationId(conversationId);
                    setPage('chats');
                }}
                onOpenEvent={(eventId) => { window.location.hash = `calendar/event/${eventId}`; setPage('promotions'); }}
            />;
        }
        if (page === 'dashboard') {
            return <>
                <AnalyticsDashboard role="SELLER" preparedBy={user.name} onOpenOrder={(orderId) => { setNotificationOrderId(orderId); setPage('orders'); }} />
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
                <div className="seller-quick-actions"><button type="button" onClick={() => { setPage('listings'); setListingFormOpen(true); }}>Add a listing</button></div>
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
            const listingSummaryCards: { label: string; value: number | undefined; icon: SellerListingIconName; tone: string }[] = [
                { label: 'Total listings', value: listingSummary?.total, icon: 'total', tone: 'total' },
                { label: 'Active', value: listingSummary?.active, icon: 'active', tone: 'active' },
                { label: 'Pending review', value: listingSummary?.pending_review, icon: 'pending', tone: 'pending' },
                { label: 'Drafts', value: listingSummary?.draft, icon: 'draft', tone: 'draft' },
            ];
            const hasListingFilter = Boolean(listingSearch.trim() || listingCategoryFilter || listingStatusFilter);
            return <section className="seller-work-section seller-listings-page">
                <div className="seller-listing-summary-grid" aria-label="Listing summary">
                    {listingSummaryCards.map((card) => <article className={`seller-listing-summary-card seller-listing-summary-card--${card.tone}`} key={card.label}>
                        <span className="seller-listing-summary-icon"><SellerListingIcon name={card.icon} /></span>
                        <span className="seller-listing-summary-copy"><span>{card.label}</span><strong>{card.value ?? (listingLoading ? '…' : '—')}</strong></span>
                    </article>)}
                </div>
                <div className="seller-listing-catalog-panel">
                    <div className="seller-work-heading">
                        <div><p className="eyebrow">Catalog</p><h2>My listings</h2></div>
                        <button className="seller-inline-action seller-listing-add-action" type="button" onClick={() => setListingFormOpen((open) => !open)}>
                            {listingFormOpen ? 'Close form' : <><span>Add listing</span><span aria-hidden="true">+</span></>}
                        </button>
                    </div>
                {notice && <p className="seller-notice" role="status">{notice}</p>}
                {listingFormOpen && <div className="seller-listing-form-wrap"><SellerListingForm categories={categories} onSaved={() => { setNotice('Draft saved. Submit it for review when it is ready.'); setListingFormOpen(false); setListingRevision((revision) => revision + 1); }} onError={onError} /></div>}
                {editingListing && <SellerListingEditor key={editingListing.id} listing={editingListing} categories={categories} onCancel={() => setEditingListingId(null)} onError={onError} onSaved={() => {
                    setNotice('Listing changes saved.');
                    setEditingListingId(null);
                    setListingRevision((revision) => revision + 1);
                    showSuccess('Listing changes saved.');
                }} />}
                    <div className="seller-listing-toolbar">
                        <label className="seller-listing-control seller-listing-search">
                            <span>Search listings</span>
                            <span className="seller-listing-control-input"><SellerListingIcon name="search" /><input type="search" value={listingSearch} onChange={(event) => {
                                setListingSearch(event.target.value);
                                setListingPage(1);
                            }} placeholder="Search by name or category" aria-label="Search listings by name or category" /></span>
                        </label>
                        <label className="seller-listing-control">
                            <span>Category</span>
                            <span className="seller-listing-control-input"><SellerListingIcon name="category" /><select value={listingCategoryFilter} onChange={(event) => {
                                setListingCategoryFilter(event.target.value);
                                setListingPage(1);
                            }} aria-label="Filter listings by category">
                                <option value="">All categories</option>
                                {categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
                            </select></span>
                        </label>
                        <label className="seller-listing-control">
                            <span>Status</span>
                            <span className="seller-listing-control-input"><SellerListingIcon name="status" /><select value={listingStatusFilter} onChange={(event) => {
                                setListingStatusFilter(event.target.value);
                                setListingPage(1);
                            }} aria-label="Filter listings by status">
                                <option value="">All statuses</option>
                                {listingStatuses.map((status) => <option value={status} key={status}>{status.toLowerCase().replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase())}</option>)}
                            </select></span>
                        </label>
                        <label className="seller-listing-control">
                            <span>Sort by</span>
                            <span className="seller-listing-control-input"><SellerListingIcon name="sort" /><select value={`${listingSort}:${listingSortDirection}`} onChange={(event) => {
                                const [sort, direction] = event.target.value.split(':') as [ListingSortColumn, 'asc' | 'desc'];
                                setListingSort(sort);
                                setListingSortDirection(direction);
                                setListingPage(1);
                            }} aria-label="Sort listings">
                                {listingSortOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                            </select></span>
                        </label>
                    </div>
                    {listingLoading ? <p className="seller-loading seller-listing-state" role="status">Loading your listings...</p> : listingLoadingError ? <div className="seller-listing-state seller-listing-load-error">
                        <p role="alert">{listingLoadingError}</p>
                        <button className="seller-inline-action" type="button" onClick={() => setListingRevision((revision) => revision + 1)}>Try again</button>
                    </div> : listings.length ? <div className="data-table-wrap seller-listings-table-wrap"><table className="data-table seller-listings-table">
                        <caption className="sr-only">Your livestock listings. Activate a column heading to sort ascending or descending.</caption>
                        <thead><tr>
                            <th aria-sort={listingSort === 'name' ? listingSortDirection === 'asc' ? 'ascending' : 'descending' : 'none'}>{sortButton('name', 'Listing')}</th>
                            <th aria-sort={listingSort === 'category' ? listingSortDirection === 'asc' ? 'ascending' : 'descending' : 'none'}>{sortButton('category', 'Category')}</th>
                            <th aria-sort={listingSort === 'price' ? listingSortDirection === 'asc' ? 'ascending' : 'descending' : 'none'}>{sortButton('price', 'Price')}</th>
                            <th aria-sort={listingSort === 'quantity' ? listingSortDirection === 'asc' ? 'ascending' : 'descending' : 'none'}>{sortButton('quantity', 'Available')}</th>
                            <th aria-sort={listingSort === 'status' ? listingSortDirection === 'asc' ? 'ascending' : 'descending' : 'none'}>{sortButton('status', 'Status')}</th>
                            <th aria-sort={listingSort === 'updated_at' ? listingSortDirection === 'asc' ? 'ascending' : 'descending' : 'none'}>{sortButton('updated_at', 'Updated')}</th>
                            <th>Actions</th>
                        </tr></thead>
                        <tbody>{listings.map((listing) => {
                            const editable = ['DRAFT', 'REJECTED'].includes(listing.status);
                            const cancellable = ['ACTIVE', 'PENDING_REVIEW'].includes(listing.status);
                            const viewable = listing.status === 'ACTIVE';
                            const busy = listingActionId === listing.id;
                            const price = listing.pricing_type === 'PER_KILO' ? listing.price_per_kilo : listing.price_per_head;
                            const statusIcon: SellerListingIconName = listing.status === 'ACTIVE' ? 'active' : listing.status === 'PENDING_REVIEW' ? 'pending' : listing.status === 'DRAFT' ? 'draft' : listing.status === 'REJECTED' ? 'rejected' : 'total';
                            const statusLabel = listing.status.toLowerCase().replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
                            const updatedAt = listing.updated_at ? new Date(listing.updated_at) : null;
                            const updatedAtValid = updatedAt && !Number.isNaN(updatedAt.getTime());
                            return <tr key={listing.id} className={listing.id === notificationListingId ? 'seller-listing-notification-target' : undefined} aria-current={listing.id === notificationListingId ? 'true' : undefined}>
                                <td data-label="Listing"><span className="seller-listing-identity">
                                    {listing.images?.[0]?.url
                                        ? <img className="seller-listing-thumbnail" src={listing.images[0].url} alt="" loading="lazy" />
                                        : <span className="seller-listing-thumbnail seller-listing-thumbnail--empty"><SellerListingIcon name="livestock" /></span>}
                                    <strong>{listing.name}</strong>
                                </span></td>
                                <td data-label="Category"><span className="seller-listing-category">{listing.category.name}</span></td>
                                <td data-label="Price"><strong className="seller-listing-price">{price == null ? '—' : `₱${Number(price).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} / ${listing.pricing_type === 'PER_KILO' ? 'kg' : 'head'}`}</strong></td>
                                <td data-label="Available">{listing.quantity} {listing.pricing_type === 'PER_KILO' ? 'kg' : 'head'}</td>
                                <td data-label="Status"><span className={`seller-listing-status seller-listing-status--${listing.status.toLowerCase()}`}><SellerListingIcon name={statusIcon} />{statusLabel}</span></td>
                                <td data-label="Updated">{updatedAtValid && listing.updated_at ? <time className="seller-listing-updated" dateTime={listing.updated_at}>
                                    <span>{updatedAt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                    <small>{updatedAt.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}</small>
                                </time> : '—'}</td>
                                <td data-label="Actions"><div className="seller-listing-actions">
                                    {viewable && <a className="seller-table-action seller-listing-view" href={`#listing/${listing.id}`} aria-label={`View ${listing.name}`}><SellerListingIcon name="view" /><span>View</span></a>}
                                    {editable && <>
                                        <button className="seller-table-action seller-listing-edit" type="button" disabled={busy} onClick={() => setEditingListingId(listing.id)} aria-label={`Edit ${listing.name}`}><SellerListingIcon name="edit" /><span>Edit</span></button>
                                        <button className="seller-table-action seller-listing-delete" type="button" disabled={busy} onClick={() => void deleteListing(listing)} aria-label={`Delete ${listing.name}`}><SellerListingIcon name="delete" /><span>{busy ? 'Working...' : 'Delete'}</span></button>
                                        <button className="seller-table-action seller-listing-submit" type="button" disabled={busy} onClick={() => void submitListing(listing)} aria-label={`Submit ${listing.name} for review`}><SellerListingIcon name="submit" /><span>{busy ? 'Working...' : 'Submit'}</span></button>
                                    </>}
                                    {cancellable && <button className="seller-table-action seller-listing-delete" type="button" disabled={busy} onClick={() => void cancelListing(listing)} aria-label={`${listing.status === 'PENDING_REVIEW' ? 'Cancel submission for' : 'Cancel active listing'} ${listing.name}`}><SellerListingIcon name="cancel" /><span>{busy ? 'Working...' : 'Cancel'}</span></button>}
                                    {!viewable && !editable && !cancellable && <span className="seller-muted" aria-label="No actions available">—</span>}
                                </div></td>
                            </tr>;
                        })}</tbody>
                    </table></div> : <p className="seller-empty seller-listing-state">{hasListingFilter ? 'No listings match your filters.' : 'You have not created any listings yet.'}</p>}
                    <div className="seller-listing-results-footer">
                            <p role="status">{listingLoading ? 'Loading listing results…' : listingLoadingError ? 'Listing results are unavailable.' : listingResultRange.total === 0 ? 'Showing 0 of 0 listings' : `Showing ${listingResultRange.from ?? 1}–${listingResultRange.to ?? listings.length} of ${listingResultRange.total} listings`}</p>
                            {!listingLoading && !listingLoadingError && <Pagination page={listingPage} lastPage={listingLastPage} onChange={setListingPage} />}
                    </div>
                </div>
            </section>;
        }
        if (page === 'promotions') return <SellerPromotions onError={onError} />;
        if (page === 'complaints') return <ComplaintList onError={onError} initialCaseReference={notificationCaseReference} onInitialCaseHandled={() => setNotificationCaseReference(null)} />;
        if (page === 'reviews') return <ReviewList onError={onError} />;
        if (page === 'chats') return <AIChatPage
            role="SELLER"
            reportContext={reportContext}
            initialConversationId={initialChatConversationId ?? undefined}
            onOpenOrder={(orderId) => { setNotificationOrderId(orderId); setPage('orders'); }}
            onUnreadMessagesRead={() => {
                setInitialChatConversationId(null);
                void refreshNavigationCounts();
            }}
        />;
        if (page === 'account' || page === 'location') return <section className="seller-work-section seller-settings-page settings-panel" aria-labelledby="seller-settings-title">
            <header className="admin-section-heading settings-page-heading">
                <div className="settings-page-title">
                    <span className="settings-page-icon"><SettingsCategoryIcon name="system" /></span>
                    <div><p className="eyebrow">Seller portal settings</p><h2 id="seller-settings-title">Settings</h2></div>
                </div>
            </header>
            <SellerSetupGuide
                user={user}
                refreshKey={setupRefreshKey}
                onOpenSection={(section, focusTarget = true) => {
                    if (section === 'payouts') {
                        setPage('payouts');
                        return;
                    }
                    setPage('account');
                    setSettingsTab(section);
                    if (focusTarget) {
                        window.requestAnimationFrame(() => {
                            const target = document.getElementById(`seller-settings-panel-${section}`);
                            target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            target?.focus({ preventScroll: true });
                        });
                    }
                }}
            />
            <nav className="seller-settings-tabs settings-category-nav" role="tablist" aria-label="Seller settings">
                {([
                    ['profile', 'Profile & business', 'account'],
                    ['shop', 'Shop profile', 'seller'],
                    ['password', 'Password', 'security'],
                    ['phone', 'Phone security', 'security'],
                    ['preferences', 'Notifications & privacy', 'notifications'],
                    ['pickup', 'Pickup location', 'delivery'],
                ] as const).map(([tab, label, icon]) => <button
                    key={tab}
                    id={`seller-settings-tab-${tab}`}
                    className={`seller-settings-tab settings-category-tab${settingsTab === tab ? ' is-active' : ''}`}
                    type="button"
                    role="tab"
                    aria-selected={settingsTab === tab}
                    aria-controls={`seller-settings-panel-${tab}`}
                    tabIndex={settingsTab === tab ? 0 : -1}
                    onClick={() => setSettingsTab(tab)}
                    onKeyDown={(event) => {
                        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                        event.preventDefault();
                        const tabs: SellerSettingsTab[] = ['profile', 'shop', 'password', 'phone', 'preferences', 'pickup'];
                        const current = tabs.indexOf(tab);
                        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
                        setSettingsTab(tabs[next]);
                        document.getElementById(`seller-settings-tab-${tabs[next]}`)?.focus();
                    }}
                ><SettingsCategoryIcon name={icon} /><span>{label}</span></button>)}
            </nav>
            <section className="seller-account-management settings-focused-panel" aria-labelledby="seller-account-management-heading">
                <p id="seller-account-management-heading" className="seller-account-management-heading">Account management</p>
                <section className="seller-settings-section" id="seller-settings-panel-profile" role="tabpanel" aria-labelledby="seller-settings-tab-profile" hidden={settingsTab !== 'profile'} tabIndex={-1}>
                    <div className="seller-work-heading settings-category-heading"><span className="settings-section-icon"><SettingsCategoryIcon name="account" /></span><div><p className="eyebrow">Seller account</p><h3 id="seller-profile-settings-heading">Profile &amp; business</h3><p>Manage your seller account and business contact details.</p></div></div>
                    <form className="seller-account-form" onSubmit={saveSellerAccount}>
                        <label>Account name<input type="text" autoComplete="name" maxLength={120} required value={sellerName} onChange={(event) => setSellerName(event.target.value)} /></label>
                        <label>Username<input type="text" autoComplete="username" minLength={3} maxLength={32} pattern="[A-Za-z0-9_\-]+" required value={sellerUsername} onChange={(event) => setSellerUsername(event.target.value)} /></label>
                        <label>Email address<input type="email" autoComplete="email" maxLength={255} required value={sellerEmail} onChange={(event) => setSellerEmail(event.target.value)} /></label>
                        <p className="seller-email-verification" role="status">Contact verification: {user.email_verified_at || user.phone_verified_at ? 'Verified' : 'Not verified'}. A verified email or mobile number allows you to add livestock listings.</p>
                        <p className="seller-email-verification">Email status: {user.email_verified_at ? 'Verified' : 'Not verified'}{!user.email_verified_at && <> · <button type="button" className="seller-text-action" disabled={emailVerificationBusy} onClick={() => void resendSellerEmailVerification()}>{emailVerificationBusy ? 'Sending...' : 'Resend verification email'}</button></>}</p>
                        <label>Business name<input type="text" autoComplete="organization" maxLength={255} value={businessName} onChange={(event) => setBusinessName(event.target.value)} /></label>
                        <label>Business contact phone<input type="tel" autoComplete="tel" inputMode="tel" maxLength={30} value={businessPhone} onChange={(event) => setBusinessPhone(event.target.value)} /><small>This business contact is separate from your verified account phone number.</small></label>
                        <label>Business address<textarea autoComplete="street-address" maxLength={2000} value={businessAddress} onChange={(event) => setBusinessAddress(event.target.value)} /></label>
                        <button className="seller-inline-action" type="submit" disabled={profileSaving}>{profileSaving ? 'Saving details...' : 'Save account details'}</button>
                    </form>
                </section>
                <section className="seller-settings-section" id="seller-settings-panel-shop" role="tabpanel" aria-labelledby="seller-settings-tab-shop" hidden={settingsTab !== 'shop'} tabIndex={-1}>
                    <SellerShopProfileSettings defaultShopName={user.name} onSaved={() => setSetupRefreshKey((revision) => revision + 1)} />
                </section>
                <section className="seller-settings-section" id="seller-settings-panel-password" role="tabpanel" aria-labelledby="seller-settings-tab-password" hidden={settingsTab !== 'password'} tabIndex={-1}>
                    <div className="seller-work-heading settings-category-heading"><span className="settings-section-icon"><SettingsCategoryIcon name="security" /></span><div><p className="eyebrow">Profile protection</p><h3 id="seller-password-settings-heading">{user.password_setup_complete ? 'Change password' : 'Set a password'}</h3><p>Update the password used to sign in to your account.</p></div></div>
                    <form className="seller-account-form" onSubmit={changeSellerPassword}>
                        {user.password_setup_complete
                            ? <label>Current password<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
                            : <p>No password is set yet. Set one to enable password sign-in for your account.</p>}
                        <label>New password<input type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label>
                        <label>Confirm new password<input type="password" autoComplete="new-password" minLength={8} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} required /></label>
                        <button className="seller-inline-action" type="submit" disabled={passwordSaving}>{passwordSaving ? 'Saving password...' : user.password_setup_complete ? 'Update password' : 'Set password'}</button>
                    </form>
                </section>
                <section className="seller-settings-section" id="seller-settings-panel-phone" role="tabpanel" aria-labelledby="seller-settings-tab-phone" hidden={settingsTab !== 'phone'} tabIndex={-1}>
                    <div className="seller-work-heading settings-category-heading"><span className="settings-section-icon"><SettingsCategoryIcon name="security" /></span><div><p className="eyebrow">Profile protection</p><h3 id="seller-account-security-heading">Phone verification</h3><p>Verify a Philippine mobile number for your account. Codes expire after 10 minutes.</p></div></div>
                    <p>{user.phone_number || 'No phone number added'} · {user.phone_verified_at ? 'Verified' : 'Not verified'}</p>
                    <label>Phone number<input type="tel" inputMode="tel" autoComplete="tel" maxLength={30} placeholder="09XXXXXXXXX or +639XXXXXXXXX" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} /></label>
                    <button className="seller-inline-action" type="button" disabled={phoneBusy || !phoneNumber.trim()} onClick={() => void sendPhoneCode()}>{phoneBusy ? 'Sending...' : user.phone_number === phoneNumber && user.phone_verified_at ? 'Phone verified' : user.phone_number === phoneNumber ? 'Send / resend code' : 'Verify this number'}</button>
                    {!user.phone_verified_at && <form onSubmit={verifyPhoneCode}>
                        <label>Six-digit verification code<input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={phoneCode} onChange={(event) => setPhoneCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required /></label>
                        <button className="seller-inline-action" type="submit" disabled={phoneBusy || phoneCode.length !== 6}>{phoneBusy ? 'Checking...' : 'Verify phone number'}</button>
                    </form>}
                </section>
                <section className="seller-settings-section" id="seller-settings-panel-preferences" role="tabpanel" aria-labelledby="seller-settings-tab-preferences" hidden={settingsTab !== 'preferences'} tabIndex={-1}>
                    <div className="seller-work-heading settings-category-heading"><span className="settings-section-icon"><SettingsCategoryIcon name="notifications" /></span><div><p className="eyebrow">Communication controls</p><h3 id="seller-notification-preferences-heading">Notifications &amp; privacy</h3><p>Control in-app updates and direct-message privacy.</p></div></div>
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
                    <div className="seller-work-heading settings-category-heading"><span className="settings-section-icon"><SettingsCategoryIcon name="delivery" /></span><div><p className="eyebrow">Delivery setup</p><h3 id="seller-pickup-location-heading">Pickup location</h3></div></div>
                    <p className="seller-location-help">Delivery fees require a pickup pin that you have explicitly saved. Move the pin to the exact place where buyers or delivery providers should collect livestock; the map-center pin is only a visual starting point and is never used until you save it.</p>
                    {locationLoading ? <p className="seller-loading">Loading pickup location...</p> : <>
                        <button className="seller-inline-action" type="button" disabled={locationLocating || locationSaving} onClick={locatePickupLocation}>{locationLocating ? 'Locating...' : 'Use my current location'}</button>
                        <React.Suspense fallback={<p className="seller-loading">Loading location map...</p>}>
                            <LocationMap latitude={pickupLocation?.latitude ?? 12.7321} longitude={pickupLocation?.longitude ?? 121.3654} onChange={(latitude, longitude) => {
                                setPickupLocation({ latitude, longitude });
                                setPickupLocationConfirmed(false);
                            }} tooltip="Drag to your livestock pickup location" />
                        </React.Suspense>
                        {pickupLocation && <p className="seller-location-coordinates">{pickupLocation.latitude.toFixed(5)}, {pickupLocation.longitude.toFixed(5)}</p>}
                        {pickupLocationConfirmed && <p className="seller-notice" role="status">Pickup pin saved and confirmed.</p>}
                        <button className="seller-inline-action" type="button" disabled={!pickupLocation || locationSaving} onClick={savePickupLocation}>{locationSaving ? 'Saving...' : 'Save pickup location'}</button>
                        {!pickupLocation && <p className="seller-location-help">Click the map or drag the pin to your business pickup location before saving.</p>}
                    </>}
                    {notice && <p className="seller-notice" role="status">{notice}</p>}
                </section>
            </section>
        </section>;
        return <ReportPanel role="SELLER" preparedBy={user.name} onError={onError} onAnalyze={analyzeReport} sellerReportsPage />;
    }

    const activeNavigation = navigation.find((item) => item.id === page) ?? (page === 'location' ? navigation.find((item) => item.id === 'account') : undefined);
    const pageTitle = page === 'location' || page === 'account' ? 'Settings' : activeNavigation?.label ?? '';

    return <main className={`admin-shell seller-shell${page === 'dashboard' ? ' seller-dashboard-open' : ''}`}>
        <aside className={`admin-sidebar role-sidebar${mobileNavOpen ? ' mobile-open' : ''}`} onKeyDown={(event) => {
            if (event.key === 'Escape') setMobileNavOpen(false);
        }}>
            <WorkspaceMobileHeader
                role="seller"
                menuOpen={mobileNavOpen}
                controlsId="seller-mobile-navigation"
                onToggle={() => setMobileNavOpen((open) => !open)}
                location="Bongabong, Oriental Mindoro"
                notificationCount={navigationCounts.notifications}
                notificationsActive={page === 'notifications'}
                onOpenNotifications={() => { setPage('notifications'); setMobileNavOpen(false); }}
            />
            <div className="role-mobile-menu-panel" id="seller-mobile-navigation">
            <FarmgateBrand />
            <div className="admin-sidebar-label">SELLER PORTAL</div>
            <nav aria-label="Seller navigation">{navigation.map((item) => {
                const badgeCount = item.badge ? navigationCounts[item.badge] : 0;
                const mobileMenuExcluded = ['notifications', 'chats', 'listings'].includes(item.id);
                const badgeDescription = item.badge === 'orders'
                    ? navigationBadgeLabel(badgeCount, 'order awaiting confirmation', 'orders awaiting confirmation')
                    : item.badge === 'notifications'
                        ? navigationBadgeLabel(badgeCount, 'unread notification', 'unread notifications')
                        : item.badge === 'complaints'
                            ? navigationBadgeLabel(badgeCount, 'complaint needing action', 'complaints needing action')
                            : item.badge === 'chats'
                                ? navigationBadgeLabel(badgeCount, 'unread message', 'unread messages')
                                : '';
                const selected = page === item.id || (page === 'location' && item.id === 'account');
                return <button type="button" key={item.id} className={`${selected ? 'active' : ''}${mobileMenuExcluded ? ' role-mobile-menu-excluded' : ''}`} aria-current={selected ? 'page' : undefined} aria-label={badgeCount > 0 ? `${item.label}, ${badgeDescription}${item.badge === 'orders' ? '. Separate from unread notifications.' : ''}` : item.label} title={badgeCount > 0 ? `${item.label}, ${badgeDescription}${item.badge === 'orders' ? ' (separate from unread notifications)' : ''}` : item.label} onClick={() => { setPage(item.id); setNotice(null); setMobileNavOpen(false); }}><span className="nav-icon"><WorkspaceSidebarIcon name={item.id} /></span><span className="seller-nav-label">{item.label}</span>{item.badge === 'orders' && badgeCount > 0
                    ? <span className="seller-orders-pending-badge" aria-hidden="true">{badgeCount > 99 ? '99+' : Math.floor(badgeCount)} pending</span>
                    : <NavigationBadge count={badgeCount} />}</button>;
            })}</nav>
            <button className="sidebar-logout" type="button" onClick={onLogout}>Log out <span>↗</span></button>
            </div>
        </aside>
        <section className={`admin-content seller-content${page === 'dashboard' ? ' seller-content-dashboard' : ''}`}>
            <header className="admin-header workspace-banner-header"><div><p className="eyebrow">FARMGATE seller workspace</p><h1>{pageTitle}</h1><p>Manage your listings, orders, and buyer relationships.</p></div><WorkspaceBannerArtwork /><div className="role-header-context"><span className="admin-role">SELLER</span><WorkspaceAccountControl role="seller" userName={user.name} profilePhotoUrl={user.profile_photo_url} onOpenAccount={() => { setSettingsTab('profile'); setPage('account'); }} /></div></header>
            <div className={page === 'dashboard' ? 'seller-dashboard-scroll' : undefined} tabIndex={page === 'dashboard' ? 0 : undefined} aria-label={page === 'dashboard' ? 'Seller dashboard content' : undefined}>
                {error && <p className="seller-error" role="alert">{error}</p>}
                {renderPage()}
            </div>
        </section>
        <RoleMobileBottomNavigation
            items={sellerMobileDestinations}
            activeId={page === 'location' ? 'account' : page}
            navigationLabel="Key seller destinations"
            onNavigate={(destination) => { setPage(destination); setNotice(null); setMobileNavOpen(false); }}
        />
    </main>;
}