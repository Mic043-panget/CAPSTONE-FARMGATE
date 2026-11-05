import React from 'react';
import api from '../../lib/api';
import type { User } from '../../shared/types';
import { confirmAction, showError, showSuccess } from '../../lib/alerts';
import { BuyerAddresses } from './BuyerAddresses';

type ProfileSection = 'profile' | 'addresses' | 'password' | 'settings' | 'orders' | 'reviews';

type BuyerOrder = {
    id: number;
    order_reference: string;
    status: string;
    buyer_can_cancel?: boolean;
    buyer_cancellation_blocked_reason?: string;
    total_amount: string;
    subtotal_amount?: string;
    delivery_fee?: string;
    delivery_method?: string;
    created_at: string;
    shipping_address?: {
        recipient_name?: string;
        street_address?: string;
        address_line2?: string | null;
        phone_number?: string | null;
        barangay?: string;
        city_municipality?: string;
        province?: string;
        postal_code?: string;
        latitude?: number | string | null;
        longitude?: number | string | null;
    } | null;
    seller?: {
        name: string;
        seller_profile?: {
            latitude: number | string | null;
            longitude: number | string | null;
            address?: string | null;
        } | null;
    } | null;
    delivery?: {
        status: string;
        pickup_latitude?: number | null;
        pickup_longitude?: number | null;
    } | null;
    items: { id: number; quantity: number; listing?: { name: string } | null }[];
};

type OrderFilter = 'ALL' | 'PENDING' | 'PREPARING' | 'SHIPPED' | 'ON_THE_WAY' | 'DELIVERED' | 'COMPLETE' | 'CANCELLED' | 'REVIEWS';
type AccountPreference = 'order_notifications' | 'chat_notifications' | 'allow_direct_messages';

const orderFilters: { id: OrderFilter; label: string }[] = [
    { id: 'ALL', label: 'All' },
    { id: 'PENDING', label: 'Pending' },
    { id: 'PREPARING', label: 'Preparing' },
    { id: 'SHIPPED', label: 'Shipped' },
    { id: 'ON_THE_WAY', label: 'On the Way' },
    { id: 'DELIVERED', label: 'Delivered' },
    { id: 'COMPLETE', label: 'Complete' },
    { id: 'CANCELLED', label: 'Cancelled' },
    { id: 'REVIEWS', label: 'Reviews' },
];

type BuyerReview = {
    id: number;
    order_id: number;
    order?: { order_reference: string } | null;
    seller?: { name: string } | null;
    rating: number;
    comment: string | null;
    status: string;
    created_at: string;
};

const profileSections: { id: ProfileSection; label: string; icon: 'profile' | 'address' | 'password' | 'settings' | 'orders' | 'reviews' }[] = [
    { id: 'profile', label: 'Profile', icon: 'profile' },
    { id: 'addresses', label: 'Addresses', icon: 'address' },
    { id: 'password', label: 'Change Password', icon: 'password' },
    { id: 'settings', label: 'Account Settings', icon: 'settings' },
    { id: 'orders', label: 'My Orders', icon: 'orders' },
    { id: 'reviews', label: 'My Reviews', icon: 'reviews' },
];

function ProfileMenuIcon({ name }: { name: (typeof profileSections)[number]['icon'] }) {
    const paths: Record<typeof name, React.ReactNode> = {
        profile: <><circle cx="12" cy="8" r="3.5" /><path d="M5 21a7 7 0 0 1 14 0" /></>,
        address: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
        password: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 1 1 8 0v3" /></>,
        settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.2 1-.9 1.7-1.5-.5a8 8 0 0 1-1.7 1l-.3 1.6h-2l-.4-1.5a8 8 0 0 1-1.9 0l-.7 1.4-1.8-.8.3-1.6a8 8 0 0 1-1.4-1.4l-1.6.3-.7-1.8 1.4-.8a8 8 0 0 1 0-1.9l-1.4-.7.8-1.8 1.6.3a8 8 0 0 1 1.4-1.4l-.3-1.6 1.8-.7.8 1.4a8 8 0 0 1 1.9 0l.7-1.4 1.8.8-.3 1.6a8 8 0 0 1 1.4 1.4l1.6-.3.7 1.8-1.4.8a8 8 0 0 1 0 1.9Z" /></>,
        orders: <><path d="M5 4h14v17H5zM8 8h8M8 12h8M8 16h5" /></>,
        reviews: <><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" /></>,
    };

    return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function ProfileAvatar({ user, large = false }: { user: User; large?: boolean }) {
    const [imageFailed, setImageFailed] = React.useState(false);

    React.useEffect(() => {
        setImageFailed(false);
    }, [user.profile_photo_url]);

    return <div className={`buyer-profile-avatar${large ? ' large' : ''}`}>
        {user.profile_photo_url && !imageFailed ? <img src={user.profile_photo_url} alt={`${user.name}'s profile`} onError={() => setImageFailed(true)} /> : <svg aria-label="Default profile image" role="img" viewBox="0 0 100 100"><circle cx="50" cy="50" r="49" /><path d="M50 52c12 0 20-10 20-23S62 8 50 8 30 17 30 29s8 23 20 23Zm0 8c-20 0-35 11-35 25v7h70v-7c0-14-15-25-35-25Z" /></svg>}
    </div>;
}

function memberSince(value?: string | null): string {
    if (!value) return 'Not available';
    return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

export function BuyerProfile({ user, onUserUpdated, onLogout, onNavigateHome, onOpenOrder }: { user: User; onUserUpdated: (user: User) => void; onLogout: () => void; onNavigateHome: () => void; onOpenOrder: (orderId: number) => void }) {
    const [section, setSection] = React.useState<ProfileSection>('profile');
    const [editing, setEditing] = React.useState(false);
    const [name, setName] = React.useState(user.name);
    const [username, setUsername] = React.useState(user.username ?? user.email.split('@')[0]);
    const [phoneNumber, setPhoneNumber] = React.useState(user.phone_number ?? '');
    const [phoneCode, setPhoneCode] = React.useState('');
    const [phoneVerificationBusy, setPhoneVerificationBusy] = React.useState(false);
    const [currentPassword, setCurrentPassword] = React.useState('');
    const [newPassword, setNewPassword] = React.useState('');
    const [passwordConfirmation, setPasswordConfirmation] = React.useState('');
    const [orders, setOrders] = React.useState<BuyerOrder[]>([]);
    const [reviews, setReviews] = React.useState<BuyerReview[]>([]);
    const [orderFilter, setOrderFilter] = React.useState<OrderFilter>('ALL');
    const [cancellingOrderId, setCancellingOrderId] = React.useState<number | null>(null);
    const [dataLoading, setDataLoading] = React.useState(false);
    const [saving, setSaving] = React.useState(false);
    const [accountSettingsLoading, setAccountSettingsLoading] = React.useState(false);
    const [savingPreference, setSavingPreference] = React.useState<AccountPreference | null>(null);
    const [verificationSending, setVerificationSending] = React.useState(false);
    const [emailVerifiedAt, setEmailVerifiedAt] = React.useState<string | null>(user.email_verified_at ?? null);
    const [accountPreferences, setAccountPreferences] = React.useState<Record<AccountPreference, boolean>>({
        order_notifications: true,
        chat_notifications: true,
        allow_direct_messages: true,
    });
    const [photoInput, setPhotoInput] = React.useState<HTMLInputElement | null>(null);
    const [message, setMessage] = React.useState('');
    const [error, setError] = React.useState('');

    React.useEffect(() => {
        setName(user.name);
        setUsername(user.username ?? user.email.split('@')[0]);
        setPhoneNumber(user.phone_number ?? '');
    }, [user]);

    React.useEffect(() => {
        if (section !== 'orders' && section !== 'reviews') return undefined;
        let active = true;
        setDataLoading(true);
        setMessage('');
        setError('');
        const request = section === 'orders'
            ? Promise.all([
                api.get<{ orders: BuyerOrder[] }>('/api/orders'),
                api.get<{ reviews: BuyerReview[] }>('/api/buyer/reviews'),
            ]).then(([orderResponse, reviewResponse]) => {
                if (active) {
                    setOrders(orderResponse.data.orders);
                    setReviews(reviewResponse.data.reviews);
                }
            })
            : api.get<{ reviews: BuyerReview[] }>('/api/buyer/reviews').then((response) => { if (active) setReviews(response.data.reviews); });
        request.catch((requestError: any) => {
            if (active) setError(requestError.userMessage ?? `Your ${section} could not be loaded.`);
        }).finally(() => {
            if (active) setDataLoading(false);
        });
        return () => { active = false; };
    }, [section, user.id]);

    React.useEffect(() => {
        if (section !== 'settings') return undefined;
        let active = true;
        setAccountSettingsLoading(true);
        setError('');
        api.get<{ email_verified_at: string | null; preferences: Record<AccountPreference, boolean> }>('/api/profile/settings')
            .then((response) => {
                if (!active) return;
                setEmailVerifiedAt(response.data.email_verified_at);
                setAccountPreferences(response.data.preferences);
            })
            .catch((requestError: any) => {
                if (active) setError(requestError.userMessage ?? 'Account settings could not be loaded.');
            })
            .finally(() => {
                if (active) setAccountSettingsLoading(false);
            });
        return () => { active = false; };
    }, [section, user.id]);

    async function updateAccountPreference(preference: AccountPreference, enabled: boolean) {
        setSavingPreference(preference);
        setError('');
        setMessage('');
        try {
            const response = await api.put<{ preferences: Record<AccountPreference, boolean> }>('/api/profile/settings', {
                [preference]: enabled,
            });
            setAccountPreferences(response.data.preferences);
            setMessage('Account preference saved.');
        } catch (requestError: any) {
            const settingsError = requestError.userMessage ?? requestError.response?.data?.message ?? 'The account preference could not be saved.';
            setError(settingsError);
            showError(settingsError);
        } finally {
            setSavingPreference(null);
        }
    }

    async function refreshEmailVerification() {
        setAccountSettingsLoading(true);
        setError('');
        try {
            const response = await api.get<{ email_verified_at: string | null }>('/api/profile/settings');
            setEmailVerifiedAt(response.data.email_verified_at);
            setMessage(response.data.email_verified_at ? 'Your email is verified.' : 'Your email is not verified yet.');
        } catch (requestError: any) {
            const refreshError = requestError.userMessage ?? 'Email verification status could not be refreshed.';
            setError(refreshError);
            showError(refreshError);
        } finally {
            setAccountSettingsLoading(false);
        }
    }

    async function resendVerificationEmail() {
        setVerificationSending(true);
        setError('');
        setMessage('');
        try {
            const response = await api.post<{ message: string }>('/api/profile/email/verification-notification');
            setMessage(response.data.message);
            showSuccess(response.data.message);
        } catch (requestError: any) {
            const verificationError = requestError.userMessage ?? requestError.response?.data?.message ?? 'A verification email could not be sent.';
            setError(verificationError);
            showError(verificationError);
        } finally {
            setVerificationSending(false);
        }
    }

    async function sendPhoneVerificationCode() {
        setPhoneVerificationBusy(true);
        setError('');
        setMessage('');
        try {
            const response = await api.post<{ message: string; user: User }>('/api/profile/phone/send', { phone_number: phoneNumber });
            onUserUpdated(response.data.user);
            setMessage(response.data.message);
            showSuccess(response.data.message);
        } catch (requestError: any) {
            const verificationError = requestError.userMessage ?? requestError.response?.data?.message ?? 'A verification code could not be sent.';
            setError(verificationError);
            showError(verificationError);
        } finally {
            setPhoneVerificationBusy(false);
        }
    }

    async function verifyPhoneNumber(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setPhoneVerificationBusy(true);
        setError('');
        setMessage('');
        try {
            const response = await api.post<{ message: string; user: User }>('/api/profile/phone/verify', { code: phoneCode });
            onUserUpdated(response.data.user);
            setPhoneCode('');
            setPhoneNumber(response.data.user.phone_number ?? '');
            setMessage(response.data.message);
            showSuccess(response.data.message);
        } catch (requestError: any) {
            const verificationError = requestError.userMessage ?? requestError.response?.data?.message ?? 'The verification code could not be confirmed.';
            setError(verificationError);
            showError(verificationError);
        } finally {
            setPhoneVerificationBusy(false);
        }
    }

    async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setSaving(true);
        setError('');
        setMessage('');
        try {
            const response = await api.put<{ user: User }>('/api/profile', { name, username });
            onUserUpdated(response.data.user);
            setEditing(false);
            setMessage('Profile updated.');
            showSuccess('Profile updated.');
        } catch (requestError: any) {
            const message = requestError.userMessage ?? requestError.response?.data?.message ?? 'Your profile could not be updated.';
            setError(message);
            showError(message);
        } finally {
            setSaving(false);
        }
    }

    async function savePassword(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const confirmed = await confirmAction({ title: 'Change your password?', text: 'You will use the new password the next time you sign in.', confirmText: 'Change password' });
        if (!confirmed) return;
        setSaving(true);
        setError('');
        setMessage('');
        try {
            await api.put('/api/profile/password', { current_password: currentPassword, password: newPassword, password_confirmation: passwordConfirmation });
            setCurrentPassword('');
            setNewPassword('');
            setPasswordConfirmation('');
            setMessage('Password updated.');
            showSuccess('Password updated.');
        } catch (requestError: any) {
            const message = requestError.userMessage ?? requestError.response?.data?.message ?? 'The password could not be changed.';
            setError(message);
            showError(message);
        } finally {
            setSaving(false);
        }
    }

    async function uploadPhoto(event: React.ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 1024 * 1024) {
            setError('Choose a JPG or PNG image no larger than 1 MB.');
            return;
        }
        const formData = new FormData();
        formData.append('photo', file);
        setSaving(true);
        setError('');
        setMessage('');
        try {
            const response = await api.post<{ user: User }>('/api/profile/photo', formData);
            onUserUpdated(response.data.user);
            setMessage('Profile photo updated.');
            showSuccess('Profile photo updated.');
        } catch (requestError: any) {
            const message = requestError.userMessage ?? requestError.response?.data?.message ?? 'The photo could not be uploaded.';
            setError(message);
            showError(message);
        } finally {
            setSaving(false);
        }
    }

    async function removePhoto() {
        const confirmed = await confirmAction({ title: 'Remove your profile photo?', confirmText: 'Remove photo', danger: true });
        if (!confirmed) return;
        setSaving(true);
        setError('');
        try {
            const response = await api.delete<{ user: User }>('/api/profile/photo');
            onUserUpdated(response.data.user);
            setMessage('Profile photo removed.');
            showSuccess('Profile photo removed.');
        } catch (requestError: any) {
            const message = requestError.userMessage ?? 'The photo could not be removed.';
            setError(message);
            showError(message);
        } finally {
            setSaving(false);
        }
    }

    async function cancelOrder(order: BuyerOrder) {
        const confirmed = await confirmAction({
            title: `Cancel order ${order.order_reference}?`,
            text: 'This will cancel your order and release the reserved livestock.',
            confirmText: 'Cancel order',
            danger: true,
        });
        if (!confirmed) return;

        setCancellingOrderId(order.id);
        setError('');
        setMessage('');
        try {
            const response = await api.patch<{ order: { status: string } }>(`/api/orders/${order.id}/status`, { status: 'CANCELLED' });
            setOrders((currentOrders) => currentOrders.map((currentOrder) => currentOrder.id === order.id
                ? { ...currentOrder, status: response.data.order.status }
                : currentOrder));
            setMessage(`Order ${order.order_reference} cancelled.`);
            showSuccess(`Order ${order.order_reference} cancelled.`);
        } catch (requestError: any) {
            const cancellationError = requestError.userMessage ?? requestError.response?.data?.message ?? 'The order could not be cancelled.';
            setError(cancellationError);
            showError(cancellationError);
        } finally {
            setCancellingOrderId(null);
        }
    }

    const selectedLabel = profileSections.find((item) => item.id === section)?.label ?? 'Profile';
    const filteredOrders = orders.filter((order) => {
        if (orderFilter === 'ALL') return true;
        if (orderFilter === 'PENDING') return ['PENDING_CONFIRMATION', 'CONFIRMED'].includes(order.status);
        if (orderFilter === 'PREPARING') return order.status === 'PREPARING';
        if (orderFilter === 'SHIPPED') return order.status === 'READY_FOR_PICKUP';
        if (orderFilter === 'ON_THE_WAY') return order.status === 'FULFILLING';
        if (orderFilter === 'DELIVERED') return order.delivery?.status === 'DELIVERED';
        if (orderFilter === 'COMPLETE') return order.status === 'COMPLETED';
        if (orderFilter === 'CANCELLED') return ['CANCELLED', 'REJECTED'].includes(order.status);
        return false;
    });

    return <section className="buyer-profile-layout" aria-label="Buyer account">
        <aside className="buyer-profile-sidebar">
            <div className="buyer-profile-identity">
                <ProfileAvatar user={user} />
                <div><strong>{user.username ?? user.email.split('@')[0]}</strong><button type="button" onClick={() => { setSection('profile'); setEditing(true); }}>Edit Profile</button></div>
            </div>
            <div className="buyer-profile-nav-group">
                <h2><ProfileMenuIcon name="profile" /> My Account</h2>
                {profileSections.slice(0, 4).map((item) => <button type="button" key={item.id} className={section === item.id ? 'active' : ''} aria-current={section === item.id ? 'page' : undefined} onClick={() => { setSection(item.id); setEditing(false); }}><ProfileMenuIcon name={item.icon} />{item.label}</button>)}
            </div>
            <div className="buyer-profile-nav-group">
                <h2><ProfileMenuIcon name="orders" /> My Purchases</h2>
                {profileSections.slice(4).map((item) => <button type="button" key={item.id} className={section === item.id ? 'active' : ''} aria-current={section === item.id ? 'page' : undefined} onClick={() => { setSection(item.id); setEditing(false); }}><ProfileMenuIcon name={item.icon} />{item.label}</button>)}
            </div>
            <button className="buyer-profile-logout" type="button" onClick={onLogout}><span aria-hidden="true">↪</span> Log out</button>
        </aside>

        <section className="buyer-profile-main" aria-labelledby="buyer-profile-title">
            <header className="buyer-profile-heading"><div><p className="eyebrow">Buyer account</p><h1 id="buyer-profile-title">{section === 'profile' ? 'My Profile' : selectedLabel}</h1><p>{section === 'profile' ? 'Manage and protect your account' : section === 'orders' ? 'Track your purchases and their status' : section === 'reviews' ? 'Feedback you have shared with sellers' : section === 'password' ? 'Keep your account secure' : section === 'addresses' ? 'Manage your delivery details' : 'Review your account information'}</p></div>{section === 'profile' && <button type="button" className="buyer-profile-edit" onClick={() => setEditing((current) => !current)}>{editing ? 'Cancel editing' : 'Edit profile'}</button>}</header>

            <div className="buyer-profile-content">
                {section === 'profile' && <>
                    <div className="buyer-profile-fields">
                        {editing ? <form className="buyer-profile-form" onSubmit={saveProfile}>
                            <label>Name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required /></label>
                            <label>Username<input value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={32} pattern="[A-Za-z0-9_-]+" required /></label>
                            <label>Email<input value={user.email} readOnly /><small>Email address cannot be changed here.</small></label>
                            <label>Phone number<input value={user.phone_number ?? ''} readOnly /><small>Manage and verify your phone number in Account Settings.</small></label>
                            <label>Password<input value="••••••••" readOnly /><small>Use Change Password to update your password.</small></label>
                            <label>Member since<input value={memberSince(user.created_at)} readOnly /></label>
                            <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save profile'}</button>
                        </form> : <dl className="buyer-profile-details">
                            <div><dt>Name</dt><dd>{user.name}</dd></div>
                            <div><dt>Username</dt><dd>{user.username ?? user.email.split('@')[0]}</dd></div>
                            <div><dt>Email</dt><dd>{user.email} <span className={`profile-verification${user.email_verified_at ? ' verified' : ''}`}>{user.email_verified_at ? 'Verified' : 'Not verified'}</span></dd></div>
                            <div><dt>Phone Number</dt><dd>{user.phone_number || 'Not added yet'} <span className={`profile-verification${user.phone_verified_at ? ' verified' : ''}`}>{user.phone_verified_at ? 'Verified' : user.phone_number ? 'Not verified' : 'Not added'}</span></dd></div>
                            <div><dt>Password</dt><dd>••••••••</dd></div>
                            <div><dt>Member Since</dt><dd>{memberSince(user.created_at)}</dd></div>
                        </dl>}
                    </div>
                    <aside className="buyer-profile-photo-panel">
                        <ProfileAvatar user={user} large />
                        <button type="button" onClick={() => photoInput?.click()} disabled={saving}>Change photo</button>
                        <input ref={setPhotoInput} className="sr-only" type="file" accept="image/jpeg,image/png" onChange={uploadPhoto} />
                        {user.profile_photo_url && <button className="buyer-profile-remove-photo" type="button" onClick={removePhoto} disabled={saving}>Remove photo</button>}
                        <p>Max size: 1 MB<br />Format: JPG, PNG</p>
                    </aside>
                </>}

                {section === 'password' && <form className="buyer-password-form" onSubmit={savePassword}>
                    <label>Current password<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
                    <label>New password<input type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label>
                    <label>Confirm new password<input type="password" autoComplete="new-password" minLength={8} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} required /></label>
                    <button type="submit" disabled={saving}>{saving ? 'Updating...' : 'Update password'}</button>
                </form>}

                {section === 'addresses' && <BuyerAddresses onError={setError} />}
                {section === 'settings' && <div className="buyer-account-settings">
                    <section className="buyer-account-settings-card" aria-labelledby="phone-verification-heading">
                        <p className="eyebrow">Account security</p><h2 id="phone-verification-heading">Phone verification</h2>
                        <p>Confirm a Philippine mobile number to keep your account contact details accurate.</p>
                        <span className={`profile-verification${user.phone_verified_at ? ' verified' : ''}`}>{user.phone_verified_at ? `Verified${new Date(user.phone_verified_at).toLocaleDateString() ? ` on ${new Date(user.phone_verified_at).toLocaleDateString()}` : ''}` : 'Not verified'}</span>
                        <label>Phone number
                            <input type="tel" inputMode="tel" autoComplete="tel" maxLength={30} placeholder="09XXXXXXXXX or +639XXXXXXXXX" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} />
                        </label>
                        <div className="buyer-account-settings-actions">
                            <button type="button" disabled={phoneVerificationBusy || !phoneNumber.trim()} onClick={() => void sendPhoneVerificationCode()}>{phoneVerificationBusy ? 'Sending...' : user.phone_number === phoneNumber && user.phone_verified_at ? 'Phone verified' : user.phone_number === phoneNumber ? 'Send / resend code' : 'Verify this number'}</button>
                        </div>
                        {!user.phone_verified_at && <form onSubmit={verifyPhoneNumber}>
                            <label>Six-digit code
                                <input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={phoneCode} onChange={(event) => setPhoneCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required />
                            </label>
                            <button type="submit" disabled={phoneVerificationBusy || phoneCode.length !== 6}>{phoneVerificationBusy ? 'Checking...' : 'Verify phone number'}</button>
                            <p className="buyer-account-settings-help">Codes expire after 10 minutes. Use Send / resend code to receive a new one.</p>
                        </form>}
                    </section>
                    <section className="buyer-account-settings-card" aria-labelledby="verification-heading">
                        <p className="eyebrow">Account security</p><h2 id="verification-heading">Email verification</h2>
                        <p>{user.email}</p>
                        <span className={`profile-verification${emailVerifiedAt ? ' verified' : ''}`}>{emailVerifiedAt ? `Verified${new Date(emailVerifiedAt).toLocaleDateString() ? ` on ${new Date(emailVerifiedAt).toLocaleDateString()}` : ''}` : 'Not verified'}</span>
                        <div className="buyer-account-settings-actions">
                            <button type="button" disabled={accountSettingsLoading} onClick={() => void refreshEmailVerification()}>{accountSettingsLoading ? 'Checking...' : 'Refresh status'}</button>
                            {!emailVerifiedAt && <button type="button" disabled={verificationSending} onClick={() => void resendVerificationEmail()}>{verificationSending ? 'Sending...' : 'Resend verification email'}</button>}
                        </div>
                        {!emailVerifiedAt && <p className="buyer-account-settings-help">Open the verification link sent to your email, then refresh this status.</p>}
                    </section>
                    {accountSettingsLoading ? <p className="buyer-orders-loading">Loading account settings...</p> : <>
                        <section className="buyer-account-settings-card" aria-labelledby="notifications-heading">
                            <p className="eyebrow">Notifications</p><h2 id="notifications-heading">Choose what updates you receive</h2>
                            <label className="buyer-account-setting-toggle"><span><strong>Order updates</strong><small>In-app notifications when your orders change status.</small></span><input type="checkbox" checked={accountPreferences.order_notifications} disabled={savingPreference !== null} onChange={(event) => void updateAccountPreference('order_notifications', event.target.checked)} /></label>
                            <label className="buyer-account-setting-toggle"><span><strong>New chat messages</strong><small>In-app notifications when someone sends you a direct message.</small></span><input type="checkbox" checked={accountPreferences.chat_notifications} disabled={savingPreference !== null} onChange={(event) => void updateAccountPreference('chat_notifications', event.target.checked)} /></label>
                        </section>
                        <section className="buyer-account-settings-card" aria-labelledby="privacy-heading">
                            <p className="eyebrow">Privacy</p><h2 id="privacy-heading">Direct messages</h2>
                            <label className="buyer-account-setting-toggle"><span><strong>Allow direct messages</strong><small>When off, other users cannot start or continue a direct conversation with you. Existing orders and listing interests still determine buyer–seller eligibility.</small></span><input type="checkbox" checked={accountPreferences.allow_direct_messages} disabled={savingPreference !== null} onChange={(event) => void updateAccountPreference('allow_direct_messages', event.target.checked)} /></label>
                        </section>
                    </>}
                </div>}

                {section === 'orders' && <div className="buyer-order-history">
                    <nav className="buyer-order-filters" aria-label="Filter orders" role="tablist">
                        {orderFilters.map((filter) => <button type="button" role="tab" aria-selected={orderFilter === filter.id} className={orderFilter === filter.id ? 'active' : ''} key={filter.id} onClick={() => setOrderFilter(filter.id)}>{filter.label}</button>)}
                    </nav>
                    {dataLoading ? <p className="buyer-orders-loading">Loading orders...</p> : orderFilter === 'REVIEWS' ? reviews.length ? <div className="buyer-profile-records">{reviews.map((review) => <article className="buyer-profile-record" key={review.id}><div><strong>Order {review.order?.order_reference ?? 'reference unavailable'}</strong><span className="buyer-review-stars" aria-label={`${review.rating} out of 5 stars`}>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</span></div><p>{review.comment || 'No written comment.'}</p><footer><span>Seller: {review.seller?.name ?? 'Seller'}</span><time dateTime={review.created_at}>{memberSince(review.created_at)}</time></footer></article>)}</div> : <div className="buyer-orders-empty"><span className="buyer-orders-empty-icon" aria-hidden="true">★</span><h2>No reviews found</h2><p>You haven’t reviewed any completed orders yet.</p></div> : filteredOrders.length ? <div className="buyer-order-list">{filteredOrders.map((order) => <article className="buyer-order-card" key={order.id}><header><div><span className="buyer-order-reference">Order {order.order_reference}</span><time dateTime={order.created_at}>{memberSince(order.created_at)}</time></div><span className={`buyer-order-status status-${order.status.toLowerCase()}`}>{order.status.replaceAll('_', ' ')}</span></header><p className="buyer-order-items">{order.items.map((item) => `${item.quantity} × ${item.listing?.name ?? 'Removed listing'}`).join(', ')}</p><footer><span>{order.seller?.name ? `Seller: ${order.seller.name}` : `${order.items.length} ${order.items.length === 1 ? 'item' : 'items'}`}</span><strong>PHP {Number(order.total_amount).toLocaleString()}</strong><button className="buyer-order-details-toggle" type="button" onClick={() => onOpenOrder(order.id)}>View details</button>{order.buyer_can_cancel && <button className="buyer-order-cancel" type="button" onClick={() => void cancelOrder(order)} disabled={cancellingOrderId !== null}>{cancellingOrderId === order.id ? 'Cancelling...' : 'Cancel order'}</button>}</footer>{order.buyer_cancellation_blocked_reason && <p className="buyer-order-cancellation-note">{order.buyer_cancellation_blocked_reason}</p>}</article>)}</div> : <div className="buyer-orders-empty"><svg aria-hidden="true" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 18h34l-3 19H10L7 18Z" /><path d="m7 18 8-10h18l8 10M19 24a5 5 0 0 0 10 0" /></svg><h2>No orders found</h2><p>{orders.length ? 'There are no orders in this status yet.' : 'You haven’t placed any orders yet.'}</p><button type="button" onClick={onNavigateHome}>Start shopping</button></div>}
                </div>}

                {section === 'reviews' && <div className="buyer-profile-records">{dataLoading ? <p>Loading reviews...</p> : reviews.length ? reviews.map((review) => <article className="buyer-profile-record" key={review.id}><div><strong>Order {review.order?.order_reference ?? 'reference unavailable'}</strong><span className="buyer-review-stars" aria-label={`${review.rating} out of 5 stars`}>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</span></div><p>{review.comment || 'No written comment.'}</p><footer><span>Seller: {review.seller?.name ?? 'Seller'}</span><time dateTime={review.created_at}>{memberSince(review.created_at)}</time></footer></article>) : <div className="buyer-profile-empty"><ProfileMenuIcon name="reviews" /><h2>No reviews yet</h2><p>Reviews you write after completing an order will appear here.</p></div>}</div>}
            </div>
            {error && <p className="buyer-profile-message error" role="alert">{error}</p>}
            {message && <p className="buyer-profile-message success" role="status">{message}</p>}
        </section>
    </section>;
}