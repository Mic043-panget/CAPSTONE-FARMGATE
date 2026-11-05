import React from 'react';
import { createRoot } from 'react-dom/client';

import { BuyerCart } from './features/buyer/BuyerCart';
import { CheckoutPage } from './features/buyer/CheckoutPage';
import { ListingDetails } from './features/buyer/ListingDetails';
import { NotificationsPage } from './features/buyer/NotificationsPage';
import { AdminWorkspace } from './features/admin/AdminWorkspace';
import { RiderDashboard } from './features/rider/RiderDashboard';
import { SellerWorkspace } from './features/seller/SellerWorkspace';
import { AIChatPage } from './features/shared/AIChatPage';
import { OrderVerificationPage } from './features/shared/OrderVerificationPage';
import api, { initializeCsrf } from './lib/api';
import { confirmAction, showError, showSuccess } from './lib/alerts';
import type { Category, Listing, User } from './shared/types';
import { ValidatedField } from './shared/components/ValidatedField';
import { Pagination } from './shared/components/Pagination';
import { NavigationBadge, navigationBadgeLabel } from './shared/components/NavigationBadge';
import { email as validateEmail, password as validatePassword, required } from './shared/validation';
import './app.css';

const BuyerProfile = React.lazy(() => import('./features/buyer/BuyerProfile').then((module) => ({ default: module.BuyerProfile })));
const OrderDetailsPage = React.lazy(() => import('./features/buyer/OrderDetailsPage').then((module) => ({ default: module.OrderDetailsPage })));

type MarketplaceView = 'all' | 'top' | 'newest' | 'promotions';
type BuyerTab = 'home' | 'events' | 'chats' | 'notifications' | 'profile';
const pesoPrice = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2 });

const buyerNavigation: { id: BuyerTab; label: string }[] = [
    { id: 'home', label: 'Home' },
    { id: 'events', label: 'Events' },
    { id: 'chats', label: 'Chats' },
    { id: 'notifications', label: 'Notification' },
    { id: 'profile', label: 'Profile' },
];

function buyerTabFromHash(hash: string): BuyerTab {
    if (hash === '#assistant') return 'chats';
    if (/^#order\/\d+$/.test(hash)) return 'profile';
    if (/^#chats(?:\/\d+)?(?:\/order\/\d+)?$/.test(hash)) return 'chats';
    if (hash === '#events' || hash === '#chats' || hash === '#notifications' || hash === '#profile') {
        return hash.slice(1) as BuyerTab;
    }

    return 'home';
}

function BuyerNavigationIcon({ name }: { name: BuyerTab }) {
    const paths: Record<BuyerTab, React.ReactNode> = {
        home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-6h6v6" /></>,
        events: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></>,
        chats: <><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" /></>,
        notifications: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
        profile: <><circle cx="12" cy="8" r="4" /><path d="M5 21a7 7 0 0 1 14 0" /></>,
    };

    return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function marketplaceViewFromHash(hash: string): MarketplaceView {
    if (hash === '#top-products') return 'top';
    if (hash === '#new-products') return 'newest';
    if (hash === '#promotions' || hash === '#special-deals') return 'promotions';
    return 'all';
}

function listingIdFromHash(hash: string): number | null {
    const match = /^#listing\/(\d+)$/.exec(hash);
    return match ? Number(match[1]) : null;
}

function orderIdFromHash(hash: string): number | null {
    const match = /^#order\/(\d+)$/.exec(hash);
    return match ? Number(match[1]) : null;
}

function orderReferenceFromHash(hash: string): string | null {
    const match = /^#verify\/(FG-(?:[A-Z]{2}-S\d{5,}-P\d{5,}-[23456789A-HJ-NP-Z]{16}|[A-F0-9]{32}))$/i.exec(hash);
    return match?.[1].toUpperCase() ?? null;
}

function chatDetailsFromHash(hash: string): { conversationId: number | null; orderId: number | null } {
    const match = /^#chats(?:\/(\d+))?(?:\/order\/(\d+))?$/.exec(hash);
    return {
        conversationId: match?.[1] ? Number(match[1]) : null,
        orderId: match?.[2] ? Number(match[2]) : null,
    };
}

function ListingPurchaseActions({ listingId, availableQuantity, onAddToCart, onBuyNow, onError }: {
    listingId: number;
    availableQuantity: number;
    onAddToCart: (listingId: number, quantity: number) => Promise<boolean>;
    onBuyNow: (listingId: number, quantity: number) => Promise<string | null>;
    onError: (message: string) => void;
}) {
    const [remainingQuantity, setRemainingQuantity] = React.useState(availableQuantity);
    const [busy, setBusy] = React.useState<'cart' | 'buy' | null>(null);
    const [message, setMessage] = React.useState('');

    async function addToCart() {
        setBusy('cart');
        setMessage('');
        try {
            if (await onAddToCart(listingId, 1)) setMessage('Added to cart.');
        } catch (requestError: any) {
            const errorMessage = requestError.userMessage ?? requestError.response?.data?.message ?? 'The item could not be added to your cart.';
            setMessage(errorMessage);
            onError(errorMessage);
        } finally {
            setBusy(null);
        }
    }

    async function buyNow() {
        setBusy('buy');
        setMessage('');
        try {
            const result = await onBuyNow(listingId, 0);
            if (result) {
                setMessage(result);
                setRemainingQuantity((quantity) => Math.max(0, quantity - 1));
            }
        } catch (requestError: any) {
            const errorMessage = requestError.userMessage ?? requestError.response?.data?.message ?? 'The order could not be placed.';
            setMessage(errorMessage);
            onError(errorMessage);
        } finally {
            setBusy(null);
        }
    }

    return <>
        <div className="listing-purchase-actions">
            <button className="listing-add-button" type="button" disabled={busy !== null || remainingQuantity < 1} onClick={addToCart}>{busy === 'cart' ? 'Adding...' : 'Add to cart'}</button>
            <button className="listing-buy-button" type="button" disabled={busy !== null || remainingQuantity < 1} onClick={buyNow}>{busy === 'buy' ? 'Opening checkout...' : 'Buy now'}</button>
        </div>
        {message && <p className="listing-purchase-message" role="status">{message}</p>}
    </>;
}

function RegistrationPhoneVerificationDialog({ user, code, error, message, loading, onCodeChange, onVerify, onResend, onClose }: {
    user: User;
    code: string;
    error: string;
    message: string;
    loading: boolean;
    onCodeChange: (code: string) => void;
    onVerify: (event: React.FormEvent<HTMLFormElement>) => void;
    onResend: () => void;
    onClose: () => void;
}) {
    return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
        <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="phone-verification-title">
            <button className="modal-close" type="button" aria-label="Close phone verification" onClick={onClose}>×</button>
            <p className="eyebrow">Account security</p>
            <h2 id="phone-verification-title">Verify your phone number</h2>
            <p>Enter the six-digit code sent to {user.phone_number}. Codes expire after 10 minutes.</p>
            <form noValidate onSubmit={onVerify}>
                <label>Verification code<input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => onCodeChange(event.target.value.replace(/\D/g, '').slice(0, 6))} required /></label>
                {error && <p className="error" role="alert">{error}</p>}
                {message && <p role="status">{message}</p>}
                <button type="submit" disabled={loading || code.length !== 6}>{loading ? 'Checking...' : 'Verify phone'}</button>
            </form>
            <div className="buyer-account-settings-actions">
                <button type="button" disabled={loading} onClick={onResend}>{loading ? 'Sending...' : 'Resend code'}</button>
                <button type="button" onClick={onClose}>Do this later</button>
            </div>
        </section>
    </div>;
}

function FarmgateApp() {
    const [user, setUser] = React.useState<User | null>(null);
    const userRef = React.useRef<User | null>(null);
    const [mode, setMode] = React.useState<'login' | 'register'>('login');
    const [name, setName] = React.useState('');
    const [email, setEmail] = React.useState('');
    const [password, setPassword] = React.useState('');
    const [passwordConfirmation, setPasswordConfirmation] = React.useState('');
    const [phoneNumber, setPhoneNumber] = React.useState('');
    const [phoneCode, setPhoneCode] = React.useState('');
    const [sellerRegistrationCode, setSellerRegistrationCode] = React.useState('');
    const [sellerRegistrationCodeSent, setSellerRegistrationCodeSent] = React.useState(false);
    const [sellerRegistrationVerificationToken, setSellerRegistrationVerificationToken] = React.useState('');
    const [sellerRegistrationPhoneError, setSellerRegistrationPhoneError] = React.useState('');
    const [sellerRegistrationPhoneMessage, setSellerRegistrationPhoneMessage] = React.useState('');
    const [sellerRegistrationPhoneLoading, setSellerRegistrationPhoneLoading] = React.useState(false);
    const [phoneVerificationPrompt, setPhoneVerificationPrompt] = React.useState(false);
    const [phoneFlowError, setPhoneFlowError] = React.useState('');
    const [phoneFlowMessage, setPhoneFlowMessage] = React.useState('');
    const [phoneFlowLoading, setPhoneFlowLoading] = React.useState(false);
    const [role, setRole] = React.useState<'BUYER' | 'SELLER'>('BUYER');
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    const [categories, setCategories] = React.useState<Category[]>([]);
    const [listings, setListings] = React.useState<Listing[]>([]);
    const [search, setSearch] = React.useState('');
    const [categoryId, setCategoryId] = React.useState('');
    const [marketplaceLoading, setMarketplaceLoading] = React.useState(true);
    const [marketplaceError, setMarketplaceError] = React.useState('');
    const [marketplaceRetry, setMarketplaceRetry] = React.useState(0);
    const [listingPage, setListingPage] = React.useState(1);
    const [listingLastPage, setListingLastPage] = React.useState(1);
    const [authOpen, setAuthOpen] = React.useState(false);
    const [authSubmitAttempt, setAuthSubmitAttempt] = React.useState(0);
    const [isEventsPage, setIsEventsPage] = React.useState(() => window.location.hash === '#events');
    const [buyerTab, setBuyerTab] = React.useState<BuyerTab>(() => buyerTabFromHash(window.location.hash));
    const [buyerUnreadNotificationCount, setBuyerUnreadNotificationCount] = React.useState(0);
    const [buyerUnreadChatCount, setBuyerUnreadChatCount] = React.useState(0);
    const [productListingId, setProductListingId] = React.useState<number | null>(() => listingIdFromHash(window.location.hash));
    const [orderDetailsId, setOrderDetailsId] = React.useState<number | null>(() => orderIdFromHash(window.location.hash));
    const [chatDetails, setChatDetails] = React.useState(() => chatDetailsFromHash(window.location.hash));
    const [cartOpen, setCartOpen] = React.useState(false);
    const [cartCount, setCartCount] = React.useState(0);
    const [checkoutOpen, setCheckoutOpen] = React.useState(false);
    const [checkoutBuyNow, setCheckoutBuyNow] = React.useState<{ listingId: number; quantity: number } | null>(null);
    const [marketplaceView, setMarketplaceView] = React.useState<MarketplaceView>(() => marketplaceViewFromHash(window.location.hash));
    const logoutInFlightRef = React.useRef(false);
    const reportError = React.useCallback((message: string) => {
        setError(message);
        showError(message);
    }, []);
    const clearBuyerNotificationBadge = React.useCallback(() => setBuyerUnreadNotificationCount(0), []);
    const refreshBuyerNavigationCounts = React.useCallback(async () => {
        if (user?.role !== 'BUYER') return;
        try {
            const response = await api.get<{ unread_count: number; unread_chat_count: number }>('/api/notifications');
            if (userRef.current?.id !== user.id) return;
            setBuyerUnreadNotificationCount(response.data.unread_count);
            setBuyerUnreadChatCount(response.data.unread_chat_count);
        } catch (requestError: any) {
            reportError(requestError.userMessage ?? 'Unread messages and notifications could not be loaded.');
        }
    }, [reportError, user?.id, user?.role]);

    React.useEffect(() => {
        const result = new URLSearchParams(window.location.search).get('oauth');
        if (!result) return;

        const messages: Record<string, string> = {
            unconfigured: 'Google sign-in is not configured yet.',
            failed: 'Google sign-in could not be completed. Please try again.',
            unverified: 'Google sign-in requires a verified email address.',
            'account-conflict': 'That Google account is linked to a different FARMGATE account.',
        };
        if (messages[result]) {
            setError(messages[result]);
            showError(messages[result]);
            setAuthOpen(true);
        }
        window.history.replaceState({}, '', `${window.location.pathname}${window.location.hash}`);
    }, []);

    React.useEffect(() => {
        const query = new URLSearchParams(window.location.search);
        const paymentResult = query.get('payment');
        const orderId = Number(query.get('order_id'));
        if (!paymentResult) return;

        if (paymentResult === 'cancelled') {
            showError('PayMongo checkout was cancelled. The order will not be sent to the seller unless payment is confirmed.');
        } else if (paymentResult === 'success' && Number.isInteger(orderId) && orderId > 0) {
            let active = true;
            void (async () => {
                for (let attempt = 0; attempt < 8 && active; attempt++) {
                    try {
                        const response = await api.get<{ order: { payment_status: string; order_reference: string } }>(`/api/orders/${orderId}`);
                        if (!active) return;
                        if (response.data.order.payment_status === 'PAID') {
                            showSuccess(`Payment for order ${response.data.order.order_reference} was confirmed. The seller will review your order.`);
                            return;
                        }
                        if (['FAILED', 'UNPAID'].includes(response.data.order.payment_status)) {
                            showError('PayMongo did not confirm this payment. Check your orders before trying again.');
                            return;
                        }
                    } catch {
                        if (active) showError('Payment confirmation is still processing. Check your orders in a moment.');
                        return;
                    }
                    await new Promise((resolve) => window.setTimeout(resolve, 1500));
                }
                if (active) showError('Payment confirmation is still processing. Do not retry until the order payment status updates.');
            })();

            window.history.replaceState({}, '', `${window.location.pathname}${window.location.hash}`);
            return () => { active = false; };
        } else {
            showError('The payment return did not include a valid order reference.');
        }
        window.history.replaceState({}, '', `${window.location.pathname}${window.location.hash}`);
    }, []);

    React.useEffect(() => {
        userRef.current = user;
    }, [user]);

    React.useEffect(() => {
        function syncPageFromHash() {
            setIsEventsPage(window.location.hash === '#events');
            setBuyerTab(buyerTabFromHash(window.location.hash));
            setProductListingId(listingIdFromHash(window.location.hash));
            setOrderDetailsId(orderIdFromHash(window.location.hash));
            setChatDetails(chatDetailsFromHash(window.location.hash));
            setMarketplaceView(marketplaceViewFromHash(window.location.hash));
        }

        window.addEventListener('hashchange', syncPageFromHash);
        window.addEventListener('popstate', syncPageFromHash);
        return () => {
            window.removeEventListener('hashchange', syncPageFromHash);
            window.removeEventListener('popstate', syncPageFromHash);
        };
    }, []);

    React.useEffect(() => {
        function handleUnauthenticated() {
            if (logoutInFlightRef.current || !userRef.current) {
                return;
            }

            setUser(null);
            setAuthOpen(true);
            setLoading(false);
        }

        window.addEventListener('farmgate:unauthenticated', handleUnauthenticated);
        window.addEventListener('farmgate:session-expired', handleUnauthenticated);

        return () => {
            window.removeEventListener('farmgate:unauthenticated', handleUnauthenticated);
            window.removeEventListener('farmgate:session-expired', handleUnauthenticated);
        };
    }, []);

    React.useEffect(() => {
        if (!authOpen || user) {
            return;
        }

        function closeOnEscape(event: KeyboardEvent) {
            if (event.key === 'Escape') {
                setAuthOpen(false);
            }
        }

        document.addEventListener('keydown', closeOnEscape);
        document.body.style.overflow = 'hidden';

        return () => {
            document.removeEventListener('keydown', closeOnEscape);
            document.body.style.overflow = '';
        };
    }, [authOpen, user]);

    React.useEffect(() => {
        if (!phoneVerificationPrompt) return undefined;

        function closeOnEscape(event: KeyboardEvent) {
            if (event.key === 'Escape') setPhoneVerificationPrompt(false);
        }

        document.addEventListener('keydown', closeOnEscape);
        document.body.style.overflow = 'hidden';

        return () => {
            document.removeEventListener('keydown', closeOnEscape);
            document.body.style.overflow = '';
        };
    }, [phoneVerificationPrompt]);

    React.useEffect(() => {
        api.get<{ user: User }>('/api/auth/user', {
            headers: { 'X-Auth-Check': 'silent' },
        })
            .then((response) => setUser(response.data.user))
            .catch((requestError: any) => {
                if (requestError.response?.status !== 401) {
                    reportError(requestError.userMessage ?? 'We could not restore your session.');
                }
            })
            .finally(() => setLoading(false));
    }, []);

    React.useEffect(() => {
        if (user?.role !== 'BUYER') {
            setCartCount(0);
            return;
        }
        api.get<{ items: { quantity: number }[] }>('/api/cart')
            .then((response) => setCartCount(response.data.items.reduce((total, item) => total + item.quantity, 0)))
            .catch(() => setCartCount(0));
    }, [user]);

    React.useEffect(() => {
        setBuyerUnreadNotificationCount(0);
        setBuyerUnreadChatCount(0);
    }, [user?.id, user?.role]);

    React.useEffect(() => {
        if (user?.role !== 'BUYER'
            || buyerTab === 'notifications'
            || (buyerTab === 'chats' && chatDetails.conversationId !== null)) return undefined;
        const refresh = () => { void refreshBuyerNavigationCounts(); };
        refresh();
        window.addEventListener('focus', refresh);
        return () => window.removeEventListener('focus', refresh);
    }, [buyerTab, chatDetails.conversationId, refreshBuyerNavigationCounts, user?.id, user?.role]);

    React.useEffect(() => {
        api.get<{ categories: Category[] }>('/api/categories').then((response) => {
            setCategories(response.data.categories);
        }).catch(() => reportError('Categories could not be loaded.'));
    }, []);

    React.useEffect(() => {
        let active = true;
        const timer = window.setTimeout(() => {
            setMarketplaceLoading(true);
            setMarketplaceError('');
            api.get<{ data: Listing[]; last_page: number }>('/api/listings', {
                params: {
                    q: search || undefined,
                    category_id: categoryId || undefined,
                    page: listingPage,
                    sort: marketplaceView === 'top' ? 'popular' : 'newest',
                    promotions: marketplaceView === 'promotions' ? 1 : undefined,
                },
            }).then((response) => {
                if (!active) return;
                setListings(response.data.data);
                setListingLastPage(response.data.last_page);
            }).catch(() => {
                if (active) setMarketplaceError('Products could not be loaded. Check your connection and try again.');
            }).finally(() => { if (active) setMarketplaceLoading(false); });
        }, search ? 200 : 0);

        return () => {
            active = false;
            window.clearTimeout(timer);
        };
    }, [categoryId, listingPage, marketplaceRetry, marketplaceView, search]);

    React.useEffect(() => {
        if (categories.length && !categoryId) {
            setCategoryId('');
        }
    }, [categories, categoryId]);

    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError(null);
        setAuthSubmitAttempt((attempt) => attempt + 1);
        if (mode === 'register' && role === 'SELLER' && !sellerRegistrationVerificationToken) {
            setSellerRegistrationPhoneError('Verify your phone number before creating a seller account.');
            return;
        }
        const normalizedPhoneNumber = phoneNumber.replace(/[\s().-]/g, '');
        const validationError = validateEmail(email) ?? validatePassword(password) ?? (mode === 'register'
            ? required(name, 'Name')
                ?? (!/^(09\d{9}|\+639\d{9})$/.test(normalizedPhoneNumber) ? 'Enter a valid Philippine mobile number (09XXXXXXXXX or +639XXXXXXXXX).' : null)
                ?? (password !== passwordConfirmation ? 'Passwords do not match.' : null)
            : null);
        if (validationError) {
            setError(validationError);
            showError(validationError);
            return;
        }
        setLoading(true);

        try {
            await initializeCsrf();
            const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
            const payload = mode === 'login'
                ? { email, password }
                : {
                    name,
                    email,
                    password,
                    password_confirmation: passwordConfirmation,
                    role,
                    phone_number: phoneNumber,
                    ...(role === 'SELLER' ? { phone_verification_token: sellerRegistrationVerificationToken } : {}),
                };
            const response = await api.post<{ user: User }>(endpoint, payload);
            setUser(response.data.user);
            if (mode === 'register') {
                if (role === 'SELLER') {
                    setAuthOpen(false);
                    setSellerRegistrationCode('');
                    setSellerRegistrationVerificationToken('');
                    showSuccess('Seller account created. Welcome to FARMGATE.');
                    return;
                }
                setPhoneVerificationPrompt(true);
                setPhoneCode('');
                setPhoneFlowError('');
                setPhoneFlowMessage('');
                try {
                    const sendResponse = await api.post<{ message: string; user: User }>('/api/profile/phone/send', { phone_number: response.data.user.phone_number });
                    setUser(sendResponse.data.user);
                    setPhoneFlowMessage(sendResponse.data.message);
                } catch (sendError: any) {
                    setPhoneFlowError(sendError.userMessage ?? sendError.response?.data?.message ?? 'Your account was created, but the code could not be sent. You can try again here or in Account Settings.');
                }
                setAuthOpen(false);
            } else {
                setAuthOpen(false);
                showSuccess('Signed in successfully.');
            }
        } catch (requestError: any) {
            const errorMessage = requestError.response?.data?.message ?? requestError.userMessage ?? 'We could not complete that request.';
            if (
                mode === 'register'
                && role === 'SELLER'
                && (errorMessage.includes('Verify your phone number') || errorMessage.includes('Phone verification has expired'))
            ) {
                setSellerRegistrationCode('');
                setSellerRegistrationCodeSent(true);
                setSellerRegistrationVerificationToken('');
                setSellerRegistrationPhoneError(errorMessage);
            }
            reportError(errorMessage);
        } finally {
            setLoading(false);
        }
    }

    function updateSellerRegistrationPhoneNumber(value: string) {
        setPhoneNumber(value);
        setSellerRegistrationCode('');
        setSellerRegistrationCodeSent(false);
        setSellerRegistrationVerificationToken('');
        setSellerRegistrationPhoneError('');
        setSellerRegistrationPhoneMessage('');
    }

    async function sendSellerRegistrationPhoneCode() {
        const normalizedPhoneNumber = phoneNumber.replace(/[\s().-]/g, '');
        if (!/^(09\d{9}|\+639\d{9})$/.test(normalizedPhoneNumber)) {
            setSellerRegistrationPhoneError('Enter a valid Philippine mobile number (09XXXXXXXXX or +639XXXXXXXXX).');
            setSellerRegistrationPhoneMessage('');
            return;
        }

        setSellerRegistrationPhoneLoading(true);
        setSellerRegistrationPhoneError('');
        setSellerRegistrationPhoneMessage('');
        try {
            await initializeCsrf();
            const response = await api.post<{ message: string }>('/api/auth/seller-registration/phone/send', { phone_number: phoneNumber });
            setSellerRegistrationCode('');
            setSellerRegistrationCodeSent(true);
            setSellerRegistrationVerificationToken('');
            setSellerRegistrationPhoneMessage(response.data.message);
        } catch (requestError: any) {
            const errorMessage = requestError.response?.data?.message ?? requestError.userMessage ?? 'The verification code could not be sent.';
            if (requestError.response?.status === 503) {
                setSellerRegistrationCode('');
                setSellerRegistrationCodeSent(false);
            }
            setSellerRegistrationPhoneError(errorMessage);
        } finally {
            setSellerRegistrationPhoneLoading(false);
        }
    }

    async function verifySellerRegistrationPhoneCode() {
        if (sellerRegistrationCode.length !== 6) {
            setSellerRegistrationPhoneError('Enter the six-digit verification code.');
            return;
        }

        setSellerRegistrationPhoneLoading(true);
        setSellerRegistrationPhoneError('');
        setSellerRegistrationPhoneMessage('');
        try {
            await initializeCsrf();
            const response = await api.post<{ message: string; phone_verification_token: string }>('/api/auth/seller-registration/phone/verify', {
                phone_number: phoneNumber,
                code: sellerRegistrationCode,
            });
            setSellerRegistrationVerificationToken(response.data.phone_verification_token);
            setSellerRegistrationPhoneMessage(response.data.message);
        } catch (requestError: any) {
            setSellerRegistrationPhoneError(requestError.response?.data?.message ?? requestError.userMessage ?? 'The verification code could not be confirmed.');
        } finally {
            setSellerRegistrationPhoneLoading(false);
        }
    }

    async function resendRegistrationPhoneCode() {
        if (!user?.phone_number) return;
        setPhoneFlowLoading(true);
        setPhoneFlowError('');
        setPhoneFlowMessage('');
        try {
            const response = await api.post<{ message: string; user: User }>('/api/profile/phone/send', { phone_number: user.phone_number });
            setUser(response.data.user);
            setPhoneFlowMessage(response.data.message);
        } catch (requestError: any) {
            setPhoneFlowError(requestError.userMessage ?? requestError.response?.data?.message ?? 'The verification code could not be sent.');
        } finally {
            setPhoneFlowLoading(false);
        }
    }

    async function verifyRegistrationPhone(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setPhoneFlowLoading(true);
        setPhoneFlowError('');
        setPhoneFlowMessage('');
        try {
            const response = await api.post<{ message: string; user: User }>('/api/profile/phone/verify', { code: phoneCode });
            setUser(response.data.user);
            setPhoneVerificationPrompt(false);
            setPhoneCode('');
            showSuccess('Your phone number is verified.');
        } catch (requestError: any) {
            setPhoneFlowError(requestError.userMessage ?? requestError.response?.data?.message ?? 'The verification code could not be confirmed.');
        } finally {
            setPhoneFlowLoading(false);
        }
    }

    function clearClientSession() {
        ['laravel_session', 'farmgate-session', 'XSRF-TOKEN'].forEach((name) => {
            document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
        });
    }

    async function logout() {
        if (logoutInFlightRef.current) {
            return;
        }

        const confirmed = await confirmAction({ title: 'Log out?', text: 'You will need to sign in again to place orders.', confirmText: 'Log out', danger: true });
        if (!confirmed) return;

        logoutInFlightRef.current = true;
        let loggedOut = false;

        try {
            await api.post('/api/auth/logout');
            loggedOut = true;
        } catch (requestError: any) {
            const status = requestError.response?.status;
            if (status !== 401 && status !== 419) {
                reportError(requestError.userMessage ?? 'We could not log you out.');
            }
        } finally {
            clearClientSession();
            setUser(null);
            setAuthOpen(false);
            logoutInFlightRef.current = false;
            if (loggedOut) showSuccess('You have been logged out.');
        }
    }

    function navigateMarketplace(view: MarketplaceView) {
        setSearch('');
        setCategoryId('');
        setListingPage(1);
        setIsEventsPage(false);
        setBuyerTab('home');
        setProductListingId(null);
        setOrderDetailsId(null);
        setMarketplaceView(view);
        const route = {
            all: '#marketplace',
            top: '#top-products',
            newest: '#new-products',
            promotions: '#promotions',
        }[view];
        window.history.pushState({}, '', route);
        window.requestAnimationFrame(() => document.getElementById('marketplace')?.scrollIntoView({ behavior: 'smooth' }));
    }

    function openMarketplace(event: React.MouseEvent<HTMLAnchorElement>) {
        event.preventDefault();
        navigateMarketplace('all');
    }

    function openMarketplaceView(event: React.MouseEvent<HTMLAnchorElement>, view: MarketplaceView) {
        event.preventDefault();
        navigateMarketplace(view);
    }

    function openCategories(event: React.MouseEvent<HTMLAnchorElement>) {
        event.preventDefault();
        navigateMarketplace('all');
        window.requestAnimationFrame(() => document.querySelector('.category-nav')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }

    function navigateBuyerTab(tab: BuyerTab) {
        setBuyerTab(tab);
        setProductListingId(null);
        setOrderDetailsId(null);
        setChatDetails({ conversationId: null, orderId: null });
        setIsEventsPage(tab === 'events');
        window.history.pushState({}, '', `#${tab === 'home' ? 'marketplace' : tab}`);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function navigateBuyerChat(conversationId: number) {
        setBuyerTab('chats');
        setProductListingId(null);
        setOrderDetailsId(null);
        setChatDetails({ conversationId, orderId: null });
        setIsEventsPage(false);
        window.history.pushState({}, '', `#chats/${conversationId}`);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function navigateListingDetails(listingId: number) {
        setProductListingId(listingId);
        setOrderDetailsId(null);
        setIsEventsPage(false);
        setBuyerTab('home');
        window.history.pushState({}, '', `#listing/${listingId}`);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function navigateOrderDetails(orderId: number) {
        setBuyerTab('profile');
        setProductListingId(null);
        setOrderDetailsId(orderId);
        setIsEventsPage(false);
        window.history.pushState({}, '', `#order/${orderId}`);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function navigateOrderList() {
        setOrderDetailsId(null);
        setBuyerTab('profile');
        window.history.pushState({}, '', '#profile');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function navigateOrderChat(conversationId: number, orderId: number) {
        setBuyerTab('chats');
        setProductListingId(null);
        setOrderDetailsId(null);
        setChatDetails({ conversationId, orderId });
        setIsEventsPage(false);
        window.history.pushState({}, '', `#chats/${conversationId}/order/${orderId}`);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    async function startOrderChat(sellerId: number, orderId: number) {
        try {
            const response = await api.post<{ conversation: { id: number } }>('/api/chat/direct-conversations', { recipient_id: sellerId });
            navigateOrderChat(response.data.conversation.id, orderId);
        } catch (requestError: any) {
            reportError(requestError.userMessage ?? requestError.response?.data?.message ?? 'A chat with the seller could not be opened.');
        }
    }

    async function addListingToCart(listingId: number, quantity: number): Promise<boolean> {
        if (user?.role !== 'BUYER') {
            setAuthOpen(true);
            return false;
        }
        const response = await api.post<{ cart: { items: { quantity: number }[] } }>('/api/cart/items', { listing_id: listingId, quantity });
        setCartCount(response.data.cart.items.reduce((total, item) => total + item.quantity, 0));
        showSuccess('Added to cart.');
        return true;
    }

    async function buyListingNow(listingId: number, quantity: number): Promise<string | null> {
        if (user?.role !== 'BUYER') {
            setAuthOpen(true);
            return null;
        }
        setCheckoutBuyNow({ listingId, quantity });
        setCartOpen(false);
        setCheckoutOpen(true);
        return null;
    }

    const listingPhotos = listings.flatMap((listing) => listing.images.map((image) => ({
        url: image.url,
        alt: image.alt_text ?? listing.name,
    })));
    const mainPromoPhoto = listingPhotos[0] ?? { url: '/images/farmgate-cattle-field.jpg', alt: 'Three Holstein cows in a green pasture' };
    const newListingsPhoto = listingPhotos[1] ?? { url: '/images/farmgate-cattle-pasture.jpg', alt: 'Cattle grazing in a sunny pasture' };
    const localDealsPhoto = listingPhotos[2] ?? listingPhotos[0] ?? { url: '/images/farmgate-cattle-field.jpg', alt: 'Local livestock in a farm field' };

    if (loading && !user) {
        return <main className="app-shell"><div className="loading-state"><span className="loading-mark" />Loading FARMGATE...</div></main>;
    }

    if (user?.role === 'ADMIN') {
        return <AdminWorkspace onError={reportError} onLogout={logout} />;
    }

    if (user?.role === 'SELLER') {
        return <>
            <SellerWorkspace categories={categories} error={error} user={user} onError={reportError} onUserUpdated={setUser} onLogout={logout} />
            {phoneVerificationPrompt && <RegistrationPhoneVerificationDialog user={user} code={phoneCode} error={phoneFlowError} message={phoneFlowMessage} loading={phoneFlowLoading} onCodeChange={setPhoneCode} onVerify={verifyRegistrationPhone} onResend={() => void resendRegistrationPhoneCode()} onClose={() => setPhoneVerificationPrompt(false)} />}
        </>;
    }

    if (user?.role === 'RIDER') {
        return <>
            <RiderDashboard user={user} onUserUpdated={setUser} onError={reportError} onLogout={logout} />
            {phoneVerificationPrompt && <RegistrationPhoneVerificationDialog user={user} code={phoneCode} error={phoneFlowError} message={phoneFlowMessage} loading={phoneFlowLoading} onCodeChange={setPhoneCode} onVerify={verifyRegistrationPhone} onResend={() => void resendRegistrationPhoneCode()} onClose={() => setPhoneVerificationPrompt(false)} />}
        </>;
    }

    return (
        <main className={`app-shell${user?.role === 'BUYER' ? ' buyer-app-shell' : ''}`}>
            <header className="site-header">
                <a className="brand" href="/">FARM<span>GATE</span></a>
                <div className="header-actions"><div className="header-meta"><span className="location-dot" /> Bongabong, Oriental Mindoro {user && <><span className="header-divider" /> {user.role}</>}</div>{user?.role === 'BUYER' && <button className="buyer-cart-toggle" type="button" aria-label={`Open shopping cart${cartCount ? ` with ${cartCount} items` : ''}`} onClick={() => setCartOpen(true)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 8h14l1 13H4L5 8Z" /><path d="M9 8a3 3 0 0 1 6 0" /></svg><span>Cart</span>{cartCount > 0 && <b>{cartCount}</b>}</button>}{!user && <button className="header-auth" type="button" onClick={() => setAuthOpen(true)}>Log in <span>↗</span></button>}</div>
                {user?.role === 'BUYER' ? <nav className="buyer-main-nav" aria-label="Buyer navigation">{buyerNavigation.map((item) => {
                    const badgeCount = item.id === 'notifications'
                        ? buyerUnreadNotificationCount
                        : item.id === 'chats' ? buyerUnreadChatCount : 0;
                    const badgeLabel = badgeCount > 0
                        ? item.id === 'chats'
                            ? navigationBadgeLabel(badgeCount, 'unread message', 'unread messages')
                            : navigationBadgeLabel(badgeCount, 'unread notification', 'unread notifications')
                        : '';
                    return <button type="button" key={item.id} className={buyerTab === item.id ? 'active' : ''} aria-current={buyerTab === item.id ? 'page' : undefined} aria-label={badgeLabel ? `${item.label}, ${badgeLabel}` : item.label} title={badgeLabel ? `${item.label}, ${badgeLabel}` : item.label} onClick={() => navigateBuyerTab(item.id)}><BuyerNavigationIcon name={item.id} /><span className="buyer-nav-label">{item.label}</span><NavigationBadge count={badgeCount} /></button>;
                })}</nav> : <nav className="quick-promo-nav" aria-label="Marketplace shortcuts">
                    <a href="#top-products" onClick={(event) => openMarketplaceView(event, 'top')}><span className="quick-promo-icon" aria-hidden="true">✦</span><span>Top Products</span></a>
                    <a href="#promotions" onClick={(event) => openMarketplaceView(event, 'promotions')}><span className="quick-promo-icon" aria-hidden="true">%</span><span>Promotions</span></a>
                    <a href="#new-products" onClick={(event) => openMarketplaceView(event, 'newest')}><span className="quick-promo-icon" aria-hidden="true">+</span><span>New Products</span></a>
                    <a href="#events"><span className="quick-promo-icon" aria-hidden="true">◷</span><span>Events</span></a>
                    <a href="#new-products" onClick={(event) => openMarketplaceView(event, 'newest')}><span className="quick-promo-icon" aria-hidden="true">✳</span><span>Fresh Arrivals</span></a>
                    <a href="#special-deals" onClick={(event) => openMarketplaceView(event, 'promotions')}><span className="quick-promo-icon" aria-hidden="true">₱</span><span>Special Deals</span></a>
                </nav>}
            </header>
            {user?.role === 'BUYER' && <BuyerCart open={cartOpen} onClose={() => setCartOpen(false)} onCheckout={() => { setCheckoutBuyNow(null); setCartOpen(false); setCheckoutOpen(true); }} onCartCountChange={setCartCount} onError={reportError} />}
            {checkoutOpen && user?.role === 'BUYER' && <CheckoutPage user={user} buyNow={checkoutBuyNow} onCancel={() => setCheckoutOpen(false)} onComplete={(_orderId, fromCart) => { if (fromCart) setCartCount(0); setCheckoutOpen(false); setCheckoutBuyNow(null); }} onError={reportError} />}
            {orderDetailsId !== null && user?.role === 'BUYER' ? <React.Suspense fallback={<section className="buyer-profile-main" aria-busy="true"><p className="buyer-orders-loading">Loading order details...</p></section>}><OrderDetailsPage orderId={orderDetailsId} user={user} onBack={navigateOrderList} onChatWithSeller={(sellerId) => void startOrderChat(sellerId, orderDetailsId)} onError={reportError} /></React.Suspense> : productListingId !== null ? <ListingDetails listingId={productListingId} canPurchase={user?.role === 'BUYER'} onBack={() => navigateMarketplace('all')} onOpenListing={navigateListingDetails} onAddToCart={addListingToCart} onBuyNow={buyListingNow} onError={reportError} /> : user?.role === 'BUYER' && buyerTab === 'chats' ? <AIChatPage role="BUYER" initialConversationId={chatDetails.conversationId ?? undefined} orderId={chatDetails.orderId ?? undefined} onUnreadMessagesRead={refreshBuyerNavigationCounts} /> : user?.role === 'BUYER' && buyerTab === 'notifications' ? <NotificationsPage onOpenOrder={navigateOrderDetails} onOpenConversation={navigateBuyerChat} onNotificationsRead={clearBuyerNotificationBadge} /> : buyerTab === 'profile' && user?.role === 'BUYER' ? <React.Suspense fallback={<section className="buyer-profile-main" aria-busy="true"><p className="buyer-orders-loading">Loading your account...</p></section>}><BuyerProfile user={user} onUserUpdated={setUser} onLogout={logout} onNavigateHome={() => navigateBuyerTab('home')} onOpenOrder={navigateOrderDetails} /></React.Suspense> : isEventsPage ? <section className="events-page" aria-labelledby="events-page-title"><a href="#marketplace" onClick={openMarketplace}>Back to the marketplace</a><p className="eyebrow">Community calendar</p><h1 id="events-page-title">FarmGate Events</h1><p>No upcoming events have been announced.</p></section> : <>
            <div className="marketplace-top">
                <section className="promo-market-grid" aria-label="FarmGate promotions">
                    <article className="promo-main">
                        <div className="promo-main-copy"><p className="eyebrow">Local livestock marketplace</p><h1>Good animals.<br /><em>Fair trade.</em></h1><p className="intro-copy">Find trusted livestock from local farmers, with transparent pricing and delivery all the way to your door.</p><button className="hero-cta" type="button" onClick={() => document.querySelector('.marketplace')?.scrollIntoView({ behavior: 'smooth' })}>Explore the market <span>→</span></button></div>
                        <div className="promo-main-image"><img src={mainPromoPhoto.url} alt={mainPromoPhoto.alt} fetchPriority="high" /></div>
                    </article>
                    <div className="promo-side-banners">
                        <a className="promo-side-card promo-new-listings" href="#new-products" onClick={(event) => openMarketplaceView(event, 'newest')}>
                            <img src={newListingsPhoto.url} alt={newListingsPhoto.alt} loading="lazy" />
                            <span className="promo-side-copy"><span className="eyebrow">Fresh from local farms</span><strong>New farm listings</strong><span>Discover the latest livestock <b aria-hidden="true">→</b></span></span>
                        </a>
                        <a className="promo-side-card promo-local-deals" href="#promotions" onClick={(event) => openMarketplaceView(event, 'promotions')}>
                            <img src={localDealsPhoto.url} alt={localDealsPhoto.alt} loading="lazy" />
                            <span className="promo-side-copy"><span className="eyebrow">Local farmer offers</span><strong>Good trade, close to home</strong><span>Browse active listings <b aria-hidden="true">→</b></span></span>
                        </a>
                    </div>
                </section>
                <nav className="marketplace-shortcuts" aria-label="Marketplace quick access">
                    <a href="#marketplace" onClick={openMarketplace}><span className="marketplace-shortcut-icon" aria-hidden="true">🐄</span><span>Livestock<small>Explore</small></span></a>
                    <a href="#marketplace" onClick={openCategories}><span className="marketplace-shortcut-icon" aria-hidden="true">🌾</span><span>Categories<small>Browse</small></span></a>
                    <a href="#top-products" onClick={(event) => openMarketplaceView(event, 'top')}><span className="marketplace-shortcut-icon" aria-hidden="true">🔥</span><span>Top Products<small>Popular</small></span></a>
                    <a href="#promotions" onClick={(event) => openMarketplaceView(event, 'promotions')}><span className="marketplace-shortcut-icon" aria-hidden="true">🎉</span><span>Promotions<small>Explore</small></span></a>
                    <a href="#new-products" onClick={(event) => openMarketplaceView(event, 'newest')}><span className="marketplace-shortcut-icon" aria-hidden="true">🆕</span><span>New Products<small>Latest</small></span></a>
                    <a href="#events"><span className="marketplace-shortcut-icon" aria-hidden="true">📅</span><span>Events<small>Upcoming</small></span></a>
                    <a href="#special-deals" onClick={(event) => openMarketplaceView(event, 'promotions')}><span className="marketplace-shortcut-icon" aria-hidden="true">💰</span><span>Special Deals<small>Offers</small></span></a>
                </nav>
            </div>
            <section className="marketplace" id="marketplace" aria-label="Livestock marketplace">
                <div className="marketplace-heading"><div><p className="eyebrow">{marketplaceView === 'top' ? 'Most buyer interest' : marketplaceView === 'newest' ? 'Recently published' : marketplaceView === 'promotions' ? 'Seller offers' : 'The market'}</p><h2>{marketplaceView === 'top' ? 'Top Products' : marketplaceView === 'newest' ? 'New Products' : marketplaceView === 'promotions' ? 'Promotions & Deals' : 'Available livestock'}</h2></div><span>{marketplaceLoading ? 'Updating...' : `${listings.length} ${marketplaceView === 'promotions' ? 'offers' : 'results'}`}</span></div>
                <div className="marketplace-tools"><label className="search-field"><span className="sr-only">Search livestock</span><input value={search} onChange={(event) => { setSearch(event.target.value); setListingPage(1); }} placeholder="Search by animal, breed, or description" /></label>{(search || categoryId) && <button className="clear-button" type="button" onClick={() => { setSearch(''); setCategoryId(''); setListingPage(1); }}>Clear</button>}</div>
                <nav className="category-nav" aria-label="Livestock categories" onWheel={(event) => { if (event.deltaY !== 0) event.currentTarget.scrollLeft += event.deltaY; }}><button className={!categoryId ? 'active' : ''} type="button" onClick={() => { setCategoryId(''); setListingPage(1); }}>All livestock</button>{categories.map((category) => <button className={categoryId === String(category.id) ? 'active' : ''} key={category.id} type="button" onClick={() => { setCategoryId(String(category.id)); setListingPage(1); }}>{category.name}</button>)}</nav>
                {marketplaceError && <div className="marketplace-error" role="alert"><p>{marketplaceError}</p><button type="button" disabled={marketplaceLoading} onClick={() => setMarketplaceRetry((retry) => retry + 1)}>{marketplaceLoading ? 'Retrying...' : 'Try again'}</button></div>}
                {marketplaceLoading ? <div className="listing-grid loading-grid">{[1, 2, 3].map((item) => <div className="listing-skeleton" key={item} />)}</div> : <div className="listing-grid">{listings.map((listing) => <article className="listing-card" key={listing.id}>
                    <a className="listing-image-link" href={`#listing/${listing.id}`} onClick={(event) => { event.preventDefault(); navigateListingDetails(listing.id); }}><div className="listing-image-wrap">{listing.images[0] ? <img src={listing.images[0].url} alt={listing.images[0].alt_text ?? listing.name} /> : <span className="listing-image-placeholder">{listing.name.slice(0, 1)}</span>}<span className="listing-type">{listing.pricing_type === 'PER_KILO' ? 'Per kilo' : 'Per head'}</span></div></a>
                    <div className="listing-card-body"><a className="listing-details-link" href={`#listing/${listing.id}`} onClick={(event) => { event.preventDefault(); navigateListingDetails(listing.id); }}><p className="eyebrow">{listing.category.name}</p><h3>{listing.name}</h3><p>{listing.breed ?? 'Healthy livestock'} <span className="muted-separator">/</span> {listing.quantity} {listing.pricing_type === 'PER_KILO' ? 'kg available' : 'head available'}</p>{listing.promotion && <span className="listing-promotion-badge">{listing.promotion.name}</span>}<div className={`listing-price${listing.promotion ? ' has-promotion' : ''}`}>{listing.promotion && <del>{pesoPrice.format(Number(listing.original_price))}</del>}<strong>{pesoPrice.format(Number(listing.current_price ?? (listing.pricing_type === 'PER_KILO' ? listing.price_per_kilo : listing.price_per_head)))} <small>/ {listing.pricing_type === 'PER_KILO' ? 'kg' : 'head'}</small></strong>{listing.promotion && <small className="listing-savings">Save {pesoPrice.format(Number(listing.original_price) - Number(listing.current_price))} per unit</small>}<small>by {listing.seller.name}</small></div></a>{user?.role === 'BUYER' && <ListingPurchaseActions listingId={listing.id} availableQuantity={listing.quantity} onAddToCart={addListingToCart} onBuyNow={buyListingNow} onError={reportError} />}</div>
                </article>)}</div>}
                {!marketplaceLoading && !marketplaceError && !listings.length && <div className="empty-state"><span className="empty-icon">⌕</span><strong>{marketplaceView === 'promotions' ? 'No active promotions yet' : 'No livestock found'}</strong><p>{marketplaceView === 'promotions' ? 'There are no discounted listings available right now. Browse active livestock listings instead.' : 'Try a different search or browse all categories.'}</p><button type="button" onClick={() => navigateMarketplace('all')}>{marketplaceView === 'promotions' ? 'Browse all livestock' : 'Reset search'}</button></div>}
                <Pagination page={listingPage} lastPage={listingLastPage} onChange={setListingPage} />
            </section>
            {user && user.role !== 'BUYER' && <section className="account-panel" aria-live="polite"><p className="eyebrow">Your account</p><h2>Welcome back, {user.name.split(' ')[0]}.</h2><p className="account-email">{user.email}</p><p className="role-badge">{user.role}</p><button type="button" onClick={logout}>Log out <span>↗</span></button></section>}
            {phoneVerificationPrompt && user && <RegistrationPhoneVerificationDialog user={user} code={phoneCode} error={phoneFlowError} message={phoneFlowMessage} loading={phoneFlowLoading} onCodeChange={setPhoneCode} onVerify={verifyRegistrationPhone} onResend={() => void resendRegistrationPhoneCode()} onClose={() => setPhoneVerificationPrompt(false)} />}
            {!user && authOpen && (
                <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setAuthOpen(false); }}>
                    <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
                        <button className="modal-close" type="button" aria-label="Close login dialog" onClick={() => setAuthOpen(false)}>×</button>
                        <div className="mode-switch" role="tablist" aria-label="Account action">
                            <button type="button" className={mode === 'login' ? 'selected' : ''} onClick={() => setMode('login')}>Log in</button>
                            <button type="button" className={mode === 'register' ? 'selected' : ''} onClick={() => setMode('register')}>Create account</button>
                        </div>
                        <h2 id="auth-title">{mode === 'login' ? 'Return to your account' : 'Join the marketplace'}</h2>
                        <form noValidate onSubmit={submit}>
                            {mode === 'register' && <ValidatedField validationTrigger={authSubmitAttempt} label="Name" value={name} onChange={setName} validate={(value) => required(value, 'Name')} />}
                            {mode === 'register' && <ValidatedField validationTrigger={authSubmitAttempt} label="Phone number" type="tel" value={phoneNumber} onChange={updateSellerRegistrationPhoneNumber} validate={(value) => /^(09\d{9}|\+639\d{9})$/.test(value.replace(/[\s().-]/g, '')) ? null : 'Enter a valid Philippine mobile number (09XXXXXXXXX or +639XXXXXXXXX).'} />}
                            <ValidatedField validationTrigger={authSubmitAttempt} label="Email" type="email" value={email} onChange={setEmail} validate={validateEmail} />
                            <ValidatedField validationTrigger={authSubmitAttempt} label="Password" type="password" value={password} onChange={setPassword} validate={validatePassword} />
                            {mode === 'register' && <>
                                <ValidatedField validationTrigger={authSubmitAttempt} label="Confirm password" type="password" value={passwordConfirmation} onChange={setPasswordConfirmation} validate={(value) => value === password ? null : 'Passwords do not match.'} />
                                <ValidatedField as="select" label="Account type" value={role} onChange={(value) => setRole(value as 'BUYER' | 'SELLER')}>
                                    <option value="BUYER">Buyer</option>
                                    <option value="SELLER">Seller</option>
                                </ValidatedField>
                            </>}
                            {mode === 'register' && role === 'SELLER' && <section className="seller-registration-phone" aria-labelledby="seller-registration-phone-title">
                                <div><strong id="seller-registration-phone-title">Verify your phone number</strong><p>We’ll text a six-digit code before creating your seller account.</p></div>
                                {sellerRegistrationCodeSent && !sellerRegistrationVerificationToken && <label>Verification code<input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={sellerRegistrationCode} onChange={(event) => setSellerRegistrationCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>}
                                {!sellerRegistrationVerificationToken && <div className="seller-registration-phone-actions">
                                    <button type="button" disabled={sellerRegistrationPhoneLoading} onClick={() => void sendSellerRegistrationPhoneCode()}>{sellerRegistrationPhoneLoading ? 'Sending...' : sellerRegistrationCodeSent ? 'Resend code' : 'Send verification code'}</button>
                                    {sellerRegistrationCodeSent && <button type="button" disabled={sellerRegistrationPhoneLoading || sellerRegistrationCode.length !== 6} onClick={() => void verifySellerRegistrationPhoneCode()}>{sellerRegistrationPhoneLoading ? 'Checking...' : 'Verify code'}</button>}
                                </div>}
                                {sellerRegistrationPhoneError && <p className="error" role="alert">{sellerRegistrationPhoneError}</p>}
                                {sellerRegistrationPhoneMessage && <p className={sellerRegistrationVerificationToken ? 'seller-registration-phone-success' : ''} role="status">{sellerRegistrationPhoneMessage}</p>}
                            </section>}
                            {error && <p className="error" role="alert">{error}</p>}
                            <button type="submit" disabled={loading || (mode === 'register' && role === 'SELLER' && !sellerRegistrationVerificationToken)}>{loading ? 'Working...' : mode === 'login' ? 'Log in' : mode === 'register' && role === 'SELLER' && !sellerRegistrationVerificationToken ? 'Verify your phone to continue' : 'Create account'} <span>↗</span></button>
                        </form>
                        {mode === 'login' && <>
                            <div className="auth-divider"><span>or</span></div>
                            <button className="google-auth-button" type="button" onClick={() => window.location.assign('/api/auth/google/redirect')}>
                                <span className="google-auth-mark" aria-hidden="true">G</span>
                                Continue with Google
                            </button>
                        </>}
                    </section>
                </div>
            )}
            </>}
        </main>
    );
}

declare global {
    interface Window {
        __FARMGATE_ROOT__?: ReturnType<typeof createRoot>;
    }
}

const appElement = document.getElementById('app');
if (!appElement) {
    throw new Error('FARMGATE app root element not found.');
}

const root = window.__FARMGATE_ROOT__ ?? createRoot(appElement);
window.__FARMGATE_ROOT__ = root;

function FarmgateRoot() {
    const [hash, setHash] = React.useState(window.location.hash);

    React.useEffect(() => {
        const syncHash = () => setHash(window.location.hash);
        window.addEventListener('hashchange', syncHash);
        window.addEventListener('popstate', syncHash);

        return () => {
            window.removeEventListener('hashchange', syncHash);
            window.removeEventListener('popstate', syncHash);
        };
    }, []);

    const reference = orderReferenceFromHash(hash);
    return reference ? <OrderVerificationPage reference={reference} /> : <FarmgateApp />;
}

root.render(<FarmgateRoot />);
