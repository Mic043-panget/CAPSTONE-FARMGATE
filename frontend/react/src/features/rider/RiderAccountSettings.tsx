import React from 'react';
import api, { initializeCsrf } from '../../lib/api';
import { confirmAction, showSuccess } from '../../lib/alerts';
import type { User } from '../../shared/types';
import { SettingsCategoryIcon } from '../shared/SettingsCategoryIcon';
import { RiderSetupGuide } from './RiderSetupGuide';
import { ImageUploadPreview, IMAGE_UPLOAD_HINT, imageUploadError } from '../../shared/components/ImageUploadPreview';
import { FileDropzone } from '../../shared/components/FileDropzone';

type SettingsTab = 'profile' | 'password' | 'delivery' | 'vehicle' | 'payout' | 'notifications' | 'location';
type PayoutMethod = { method_type: 'BANK' | 'GCASH'; status: string };
type PayoutDestinationType = 'BANK' | 'GCASH';
type PayoutDestination = {
    id: number;
    destination_type: PayoutDestinationType;
    account_holder_masked: string;
    bank_name_masked: string | null;
    account_number_masked: string | null;
    wallet_number_masked: string | null;
    status: string;
    verified_at: string | null;
    consent_version: string | null;
    is_current: boolean;
};
type PayoutDestinationConsent = { version: string; notice: string };
type RiderSettings = {
    availability: 'AVAILABLE' | 'OFFLINE';
    vehicle_type: string | null;
    plate_number: string | null;
    vehicle_make_model: string | null;
    vehicle_color: string | null;
    license_expires_on: string | null;
    vehicle_registration_expires_on: string | null;
    pending_vehicle_change: {
        id: number;
        vehicle_reference: string;
        status: string;
        created_at: string;
        decision_reason: string | null;
    } | null;
    is_verified: boolean;
    last_location_at: string | null;
};
type VehicleChangeFields = {
    plate_number: string;
    vehicle_type: string;
    vehicle_make_model: string;
    vehicle_color: string;
    license_expires_on: string;
    vehicle_registration_expires_on: string;
};
type AccountPreferences = {
    order_notifications: boolean;
    chat_notifications: boolean;
    allow_direct_messages: boolean;
};

const tabs: { id: SettingsTab; label: string; icon: string }[] = [
    { id: 'profile', label: 'Profile & contact', icon: 'account' },
    { id: 'password', label: 'Password', icon: 'security' },
    { id: 'delivery', label: 'Delivery preferences', icon: 'delivery' },
    { id: 'vehicle', label: 'Vehicle information', icon: 'rider' },
    { id: 'payout', label: 'Payout destination', icon: 'finance' },
    { id: 'notifications', label: 'Notifications', icon: 'notifications' },
    { id: 'location', label: 'Location permissions', icon: 'distance' },
];

const defaultPreferences: AccountPreferences = {
    order_notifications: true,
    chat_notifications: true,
    allow_direct_messages: true,
};

function RiderSettingsHeading({ icon, eyebrow, title, description }: {
    icon: string;
    eyebrow: string;
    title: string;
    description: string;
}) {
    return <header className="seller-work-heading settings-category-heading">
        <span className="settings-section-icon"><SettingsCategoryIcon name={icon} /></span>
        <div><p className="eyebrow">{eyebrow}</p><h3>{title}</h3><p>{description}</p></div>
    </header>;
}

function errorMessage(error: any, fallback: string): string {
    return error.userMessage ?? error.response?.data?.message ?? fallback;
}

export function RiderAccountSettings({ user, onUserUpdated, onError, onReviewTutorial, setupProgressVisible, setupProgressButtonRef, onToggleSetupProgress, onCloseSetupProgress }: {
    user: User;
    onUserUpdated: (user: User) => void;
    onError: (message: string) => void;
    onReviewTutorial: () => void;
    setupProgressVisible: boolean;
    setupProgressButtonRef: React.RefObject<HTMLButtonElement | null>;
    onToggleSetupProgress: () => void;
    onCloseSetupProgress: () => void;
}) {
    const [tab, setTab] = React.useState<SettingsTab>('profile');
    const [name, setName] = React.useState(user.name);
    const [username, setUsername] = React.useState(user.username ?? user.email.split('@')[0]);
    const [email, setEmail] = React.useState(user.email);
    const [phone, setPhone] = React.useState(user.phone_number ?? '');
    const [phoneCode, setPhoneCode] = React.useState('');
    const [phoneBusy, setPhoneBusy] = React.useState(false);
    const [profileBusy, setProfileBusy] = React.useState(false);
    const [passwordBusy, setPasswordBusy] = React.useState(false);
    const [currentPassword, setCurrentPassword] = React.useState('');
    const [newPassword, setNewPassword] = React.useState('');
    const [passwordConfirmation, setPasswordConfirmation] = React.useState('');
    const [photoBusy, setPhotoBusy] = React.useState(false);
    const [photoCandidate, setPhotoCandidate] = React.useState<File | null>(null);
    const [settings, setSettings] = React.useState<RiderSettings | null>(null);
    const [payoutDestination, setPayoutDestination] = React.useState<PayoutDestination | null>(null);
    const [payoutMethods, setPayoutMethods] = React.useState<PayoutMethod[]>([]);
    const [payoutType, setPayoutType] = React.useState<'BANK' | 'GCASH'>('BANK');
    const [payoutHolder, setPayoutHolder] = React.useState('');
    const [payoutBank, setPayoutBank] = React.useState('');
    const [payoutAccount, setPayoutAccount] = React.useState('');
    const [payoutWallet, setPayoutWallet] = React.useState('');
    const [payoutPassword, setPayoutPassword] = React.useState('');
    const [payoutBusy, setPayoutBusy] = React.useState(false);
    const [setupRefreshKey, setSetupRefreshKey] = React.useState(0);
    const [settingsBusy, setSettingsBusy] = React.useState(false);
    const [vehicleFields, setVehicleFields] = React.useState<VehicleChangeFields>({
        plate_number: '', vehicle_type: '', vehicle_make_model: '', vehicle_color: '',
        license_expires_on: '', vehicle_registration_expires_on: '',
    });
    const [vehicleLicense, setVehicleLicense] = React.useState<File | null>(null);
    const [vehicleRegistration, setVehicleRegistration] = React.useState<File | null>(null);
    const [vehiclePhotos, setVehiclePhotos] = React.useState<File[]>([]);
    const [preferences, setPreferences] = React.useState(defaultPreferences);
    const [preferenceBusy, setPreferenceBusy] = React.useState(false);
    const [loading, setLoading] = React.useState(true);
    const [notice, setNotice] = React.useState('');
    const [payoutConsent, setPayoutConsent] = React.useState<PayoutDestinationConsent | null>(null);
    const [payoutConsentAccepted, setPayoutConsentAccepted] = React.useState(false);
    const [payoutDestinationLoading, setPayoutDestinationLoading] = React.useState(true);
    const [payoutDestinationMessage, setPayoutDestinationMessage] = React.useState('');
    const [locationPermission, setLocationPermission] = React.useState<'checking' | 'granted' | 'prompt' | 'denied' | 'unsupported'>('checking');

    React.useEffect(() => {
        setName(user.name);
        setUsername(user.username ?? user.email.split('@')[0]);
        setEmail(user.email);
        setPhone(user.phone_number ?? '');
    }, [user.email, user.name, user.phone_number, user.username]);

    const refreshSettings = React.useCallback(async () => {
        setLoading(true);
        try {
            const [riderResponse, accountResponse, payoutResponse] = await Promise.all([
                api.get<{ settings: RiderSettings }>('/api/riders/settings'),
                api.get<{ preferences: AccountPreferences }>('/api/profile/settings'),
                api.get<{
                    destination: PayoutDestination | null;
                    methods: PayoutMethod[];
                    consent: PayoutDestinationConsent;
                }>('/api/rider/payout-destination'),
            ]);
            setSettings(riderResponse.data.settings);
            setVehicleFields({
                plate_number: riderResponse.data.settings.plate_number ?? '',
                vehicle_type: riderResponse.data.settings.vehicle_type ?? '',
                vehicle_make_model: riderResponse.data.settings.vehicle_make_model ?? '',
                vehicle_color: riderResponse.data.settings.vehicle_color ?? '',
                license_expires_on: riderResponse.data.settings.license_expires_on ?? '',
                vehicle_registration_expires_on: riderResponse.data.settings.vehicle_registration_expires_on ?? '',
            });
            setPreferences({ ...defaultPreferences, ...accountResponse.data.preferences });
            setPayoutDestination(payoutResponse.data.destination);
            setPayoutMethods(payoutResponse.data.methods);
            setPayoutConsent(payoutResponse.data.consent);
            const existingDestinationType = payoutResponse.data.destination?.destination_type;
            const existingMethod = payoutResponse.data.methods.some((method) => method.method_type === existingDestinationType);
            setPayoutType(existingMethod && existingDestinationType
                ? existingDestinationType
                : payoutResponse.data.methods[0]?.method_type ?? 'BANK');
        } catch (requestError: any) {
            onError(errorMessage(requestError, 'Rider account settings could not be loaded.'));
        } finally {
            setLoading(false);
            setPayoutDestinationLoading(false);
        }
    }, [onError]);

    React.useEffect(() => { void refreshSettings(); }, [refreshSettings]);

    React.useEffect(() => {
        let mounted = true;
        if (!navigator.geolocation) {
            setLocationPermission('unsupported');
            return undefined;
        }
        if (!navigator.permissions?.query) {
            setLocationPermission('prompt');
            return undefined;
        }
        navigator.permissions.query({ name: 'geolocation' }).then((permission) => {
            if (!mounted) return;
            setLocationPermission(permission.state);
            permission.onchange = () => {
                if (mounted) setLocationPermission(permission.state);
            };
        }).catch(() => {
            if (mounted) setLocationPermission('prompt');
        });
        return () => { mounted = false; };
    }, []);

    async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (profileBusy) return;
        if (email.trim().toLowerCase() !== user.email.toLowerCase()
            && !await confirmAction({
                title: 'Change your sign-in email?',
                text: `Verification will be required for ${email.trim()}.`,
                confirmText: 'Change email',
            })) return;
        setProfileBusy(true);
        setNotice('');
        try {
            await initializeCsrf();
            const response = await api.put<{ user: User; email_verification_required: boolean }>('/api/profile', {
                name: name.trim(),
                username: username.trim(),
                email: email.trim(),
            });
            onUserUpdated(response.data.user);
            setNotice(response.data.email_verification_required
                ? 'Profile saved. Verify your new email using the link sent to that address.'
                : 'Profile details saved.');
            showSuccess(response.data.email_verification_required ? 'Profile saved. Verify your new email.' : 'Profile details saved.');
        } catch (requestError: any) {
            onError(errorMessage(requestError, 'Profile details could not be saved.'));
        } finally {
            setProfileBusy(false);
        }
    }

    async function sendPhoneCode() {
        if (!phone.trim() || phoneBusy) return;
        if (phone.trim() !== (user.phone_number ?? '')
            && !await confirmAction({
                title: 'Update your account phone number?',
                text: 'A verification code will be sent to this number. It will remain unverified until the code is confirmed.',
                confirmText: 'Send verification code',
            })) return;
        setPhoneBusy(true);
        setNotice('');
        try {
            await initializeCsrf();
            const response = await api.post<{ message: string; user: User }>('/api/profile/phone/send', { phone_number: phone.trim() });
            onUserUpdated(response.data.user);
            setPhoneCode('');
            setNotice(response.data.message);
            showSuccess(response.data.message);
        } catch (requestError: any) {
            onError(errorMessage(requestError, 'Phone verification could not be started.'));
        } finally {
            setPhoneBusy(false);
        }
    }

    async function verifyPhone(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (phoneCode.length !== 6 || phoneBusy) return;
        setPhoneBusy(true);
        try {
            await initializeCsrf();
            const response = await api.post<{ message: string; user: User }>('/api/profile/phone/verify', { code: phoneCode });
            onUserUpdated(response.data.user);
            setPhoneCode('');
            setNotice(response.data.message);
            showSuccess(response.data.message);
        } catch (requestError: any) {
            onError(errorMessage(requestError, 'The verification code was not accepted.'));
        } finally {
            setPhoneBusy(false);
        }
    }

    async function changePassword(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const hasPassword = user.password_setup_complete;
        if (!await confirmAction({
            title: hasPassword ? 'Change your password?' : 'Set a password?',
            text: hasPassword ? 'Your current password is required. You will use the new password for future sign-ins.' : 'You can set a password for this signed-in account now.',
            confirmText: hasPassword ? 'Change password' : 'Set password',
        })) return;
        setPasswordBusy(true);
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
            setNotice('Password updated.');
            setSetupRefreshKey((revision) => revision + 1);
            showSuccess('Password updated.');
        } catch (requestError: any) {
            onError(errorMessage(requestError, 'The password could not be changed.'));
        } finally {
            setPasswordBusy(false);
        }
    }

    async function updatePhoto(file: File | null) {
        if (!file) return;
        const validationError = imageUploadError(file);
        if (validationError) {
            onError(validationError);
            return;
        }
        if (!await confirmAction({ title: 'Update your profile photo?', text: 'The new image will appear on your FarmGate account.', confirmText: 'Update photo' })) return;
        setPhotoCandidate(file);
        const formData = new FormData();
        formData.append('photo', file);
        setPhotoBusy(true);
        try {
            await initializeCsrf();
            const response = await api.post<{ user: User }>('/api/profile/photo', formData);
            onUserUpdated(response.data.user);
            setPhotoCandidate(null);
            setNotice('Profile photo updated.');
            showSuccess('Profile photo updated.');
        } catch (requestError: any) {
            onError(errorMessage(requestError, 'The profile photo could not be uploaded.'));
        } finally {
            setPhotoBusy(false);
        }
    }

    async function removePhoto() {
        if (!await confirmAction({ title: 'Remove your profile photo?', text: 'Your account will return to its default profile image.', confirmText: 'Remove photo', danger: true })) return;
        setPhotoBusy(true);
        try {
            await initializeCsrf();
            const response = await api.delete<{ user: User }>('/api/profile/photo');
            onUserUpdated(response.data.user);
            setNotice('Profile photo removed.');
            showSuccess('Profile photo removed.');
        } catch (requestError: any) {
            onError(errorMessage(requestError, 'The profile photo could not be removed.'));
        } finally {
            setPhotoBusy(false);
        }
    }

    async function requestVehicleChange(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!settings?.is_verified || settingsBusy) return;
        if (!vehicleLicense || !vehicleRegistration || vehiclePhotos.length < 1 || vehiclePhotos.length > 5) {
            onError('Upload a valid driver license, vehicle registration, and 1 to 5 vehicle photos.');
            return;
        }
        setSettingsBusy(true);
        try {
            await initializeCsrf();
            const body = new FormData();
            Object.entries(vehicleFields).forEach(([key, value]) => body.append(key, value.trim()));
            body.append('driver_license', vehicleLicense);
            body.append('vehicle_registration', vehicleRegistration);
            vehiclePhotos.forEach((file) => body.append('vehicle_photos[]', file));
            await api.post('/api/rider/vehicle-change', body);
            setVehicleLicense(null);
            setVehicleRegistration(null);
            setVehiclePhotos([]);
            setNotice('Vehicle update submitted. Your current approved vehicle remains active until an admin approves the change.');
            setSetupRefreshKey((revision) => revision + 1);
            showSuccess('Vehicle update submitted for admin review.');
            await refreshSettings();
        } catch (requestError: any) {
            onError(errorMessage(requestError, 'Vehicle update could not be submitted. Your current vehicle remains active; check the files and retry.'));
        } finally {
            setSettingsBusy(false);
        }
    }

    function updateVehicleField(field: keyof VehicleChangeFields, value: string) {
        setVehicleFields((current) => ({ ...current, [field]: value }));
    }

    function validVehicleFiles(selected: File[], imagesOnly: boolean): File[] | null {
        const invalid = selected.find((file) => file.type === 'application/pdf'
            ? imagesOnly || file.size > 10 * 1024 * 1024
            : Boolean(imageUploadError(file)));
        if (invalid) {
            onError(invalid.type === 'application/pdf'
                ? 'PDF documents must be 10 MB or smaller.'
                : imageUploadError(invalid) ?? 'Choose a supported image.');
            return null;
        }
        return selected;
    }

    async function savePayoutDestination(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!payoutConsent
            || !payoutConsentAccepted
            || payoutBusy
            || !payoutMethods.some((method) => method.method_type === payoutType && method.status === 'ACTIVE')) return;
        setPayoutBusy(true);
        setPayoutDestinationMessage('');
        try {
            await initializeCsrf();
            const response = await api.put<{ message: string; destination: PayoutDestination }>('/api/rider/payout-destination', {
                current_password: payoutPassword,
                destination_type: payoutType,
                account_holder: payoutHolder.trim(),
                ...(payoutType === 'BANK'
                    ? { bank_name: payoutBank.trim(), account_number: payoutAccount.trim() }
                    : { wallet_number: payoutWallet.trim() }),
                consent_accepted: true,
                consent_version: payoutConsent.version,
            });
            setPayoutDestination(response.data.destination);
            setSetupRefreshKey((revision) => revision + 1);
            setPayoutPassword('');
            setPayoutHolder('');
            setPayoutBank('');
            setPayoutAccount('');
            setPayoutWallet('');
            setPayoutConsentAccepted(false);
            setPayoutDestinationMessage(response.data.message);
        } catch (requestError: any) {
            onError(errorMessage(requestError, 'Payout destination could not be saved.'));
        } finally {
            setPayoutBusy(false);
        }
    }

    async function changeAvailability(availability: RiderSettings['availability']) {
        if (!settings || settings.availability === availability || settingsBusy) return;
        const confirmed = await confirmAction({
            title: availability === 'AVAILABLE' ? 'Go available for delivery offers?' : 'Go offline?',
            text: availability === 'AVAILABLE'
                ? 'Your verified rider account may receive nearby offers. While the rider dashboard is open, FARMGATE periodically refreshes your device location to match offers within the assignment distance.'
                : 'You will stop receiving new delivery offers. Complete active deliveries before going offline.',
            confirmText: availability === 'AVAILABLE' ? 'Go available' : 'Go offline',
            danger: availability === 'OFFLINE',
        });
        if (!confirmed) return;
        setSettingsBusy(true);
        try {
            await initializeCsrf();
            const response = await api.put<{ settings: RiderSettings }>('/api/riders/settings', { availability });
            setSettings(response.data.settings);
            setNotice(availability === 'AVAILABLE' ? 'You are available for delivery offers.' : 'You are offline and will not receive new offers.');
            showSuccess(availability === 'AVAILABLE' ? 'Availability updated.' : 'You are now offline.');
        } catch (requestError: any) {
            onError(errorMessage(requestError, 'Availability could not be changed.'));
            await refreshSettings();
        } finally {
            setSettingsBusy(false);
        }
    }

    async function updatePreference(key: keyof AccountPreferences, checked: boolean) {
        const previous = preferences;
        setPreferences((current) => ({ ...current, [key]: checked }));
        setPreferenceBusy(true);
        try {
            await initializeCsrf();
            const response = await api.put<{ preferences: AccountPreferences }>('/api/profile/settings', { [key]: checked });
            setPreferences({ ...defaultPreferences, ...response.data.preferences });
            setSetupRefreshKey((revision) => revision + 1);
            showSuccess('Notification settings saved.');
        } catch (requestError: any) {
            setPreferences(previous);
            onError(errorMessage(requestError, 'Notification settings could not be saved.'));
        } finally {
            setPreferenceBusy(false);
        }
    }

    async function checkLocationAccess() {
        if (!navigator.geolocation) {
            setLocationPermission('unsupported');
            return;
        }
        navigator.geolocation.getCurrentPosition(
            () => {
                setLocationPermission('granted');
                setNotice('Location access is available on this device. Your location is refreshed for nearby-offer matching while you are available and the rider dashboard is open.');
            },
            (error) => {
                setLocationPermission(error.code === error.PERMISSION_DENIED ? 'denied' : 'prompt');
                if (error.code === error.PERMISSION_DENIED) onError('Location access was denied. Allow it in your browser settings to share delivery progress or verify a QR scan.');
                else onError(error.message || 'The current location could not be read.');
            },
            { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
        );
    }

    function tabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, current: SettingsTab) {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = tabs.findIndex((item) => item.id === current);
        const nextIndex = event.key === 'Home' ? 0
            : event.key === 'End' ? tabs.length - 1
                : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
        const next = tabs[nextIndex].id;
        setTab(next);
        document.getElementById(`rider-settings-tab-${next}`)?.focus();
    }

    const permissionLabel = locationPermission === 'checking' ? 'Checking…' : ({
        granted: 'Allowed',
        prompt: 'Not yet requested',
        denied: 'Blocked in browser settings',
        unsupported: 'Not supported by this browser',
    } as const)[locationPermission];
    const photoUrl = user.profile_photo_url;

    return <section className="seller-work-section seller-settings-page settings-panel rider-account-settings" aria-labelledby="rider-account-settings-title">
        <header className="admin-section-heading settings-page-heading">
            <div className="settings-page-title">
                <span className="settings-page-icon"><SettingsCategoryIcon name="rider" /></span>
                <div><p className="eyebrow">Rider portal settings</p><h2 id="rider-account-settings-title">Account settings</h2></div>
            </div>
            <button
                ref={setupProgressButtonRef}
                type="button"
                className="seller-inline-action settings-setup-progress-button"
                aria-controls="rider-setup-progress"
                aria-expanded={setupProgressVisible}
                onClick={onToggleSetupProgress}
            >{setupProgressVisible ? 'Hide setup progress' : 'View setup progress'}</button>
        </header>
        <p className="rider-settings-intro">Only your signed-in account can view and update these settings. Changes to phone number require verification.</p>
        {notice && <p className="rider-settings-notice" role="status">{notice}</p>}
        <RiderSetupGuide
            user={user}
            refreshKey={setupRefreshKey}
            progressVisible={setupProgressVisible}
            onCloseProgress={onCloseSetupProgress}
            onOpenSection={(section, focusTarget = true, targetId) => {
                setTab(section);
                if (focusTarget) {
                    window.requestAnimationFrame(() => {
                        const target = document.getElementById(targetId ?? `rider-settings-panel-${section}`);
                        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        target?.focus({ preventScroll: true });
                    });
                }
            }}
            onReviewTutorial={onReviewTutorial}
        />
        <nav className="seller-settings-tabs settings-category-nav rider-settings-tabs" role="tablist" aria-label="Rider account settings">
            {tabs.map((item) => <button
                key={item.id}
                id={`rider-settings-tab-${item.id}`}
                className={`seller-settings-tab settings-category-tab${tab === item.id ? ' is-active' : ''}`}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                aria-controls={`rider-settings-panel-${item.id}`}
                tabIndex={tab === item.id ? 0 : -1}
                onClick={() => setTab(item.id)}
                onKeyDown={(event) => tabKeyDown(event, item.id)}
            ><SettingsCategoryIcon name={item.icon} /><span>{item.label}</span></button>)}
        </nav>
        <section className="seller-account-management settings-focused-panel" aria-label="Rider account management">
            <p className="seller-account-management-heading">Account management</p>
        {loading ? <p className="seller-loading" role="status">Loading your private settings…</p> : <>
            <section className="seller-settings-section rider-settings-panel" id="rider-settings-panel-profile" role="tabpanel" aria-labelledby="rider-settings-tab-profile" hidden={tab !== 'profile'} tabIndex={-1}>
                <RiderSettingsHeading icon="account" eyebrow="Rider account" title="Profile & contact" description="Manage your account details and verified contact information." />
                <div className="rider-profile-header">
                    <div className="rider-profile-avatar">{photoUrl ? <img src={photoUrl} alt={`${user.name}'s profile`} /> : <span aria-label="Default profile image" role="img">{user.name.slice(0, 1).toUpperCase()}</span>}</div>
                    <ImageUploadPreview file={photoCandidate} alt="Selected rider profile photo preview" />
                    <div><p className="eyebrow">Rider profile</p><h3>{user.name}</h3><p>{user.role} · {settings?.is_verified ? 'Verified rider' : 'Verification pending'}</p></div>
                    <div className="rider-photo-actions">
                        <FileDropzone label="Profile photo" accept="image/jpeg,image/png,image/webp" disabled={photoBusy} buttonLabel={photoBusy ? 'Updating…' : 'Change photo'} onFiles={(files) => void updatePhoto(files[0] ?? null)} helperText={IMAGE_UPLOAD_HINT} />
                        {photoUrl && <button type="button" className="seller-text-action" disabled={photoBusy} onClick={() => void removePhoto()}>Remove photo</button>}
                    </div>
                </div>
                <form className="seller-account-form rider-profile-form" onSubmit={(event) => void saveProfile(event)}>
                    <label>Full name<input type="text" autoComplete="name" minLength={2} maxLength={120} required value={name} onChange={(event) => setName(event.target.value)} /></label>
                    <label>Username<input type="text" autoComplete="username" minLength={3} maxLength={32} pattern="[A-Za-z0-9_\-]+" required value={username} onChange={(event) => setUsername(event.target.value)} /><small>Letters, numbers, underscores, and hyphens.</small></label>
                    <label>Email address<input type="email" autoComplete="email" maxLength={255} required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
                    <p className="rider-settings-field-note">Email status: {user.email_verified_at ? 'Verified' : 'Not verified'}. Changing your email requires verification.</p>
                    <button className="seller-inline-action" type="submit" disabled={profileBusy}>{profileBusy ? 'Saving profile…' : 'Save profile'}</button>
                </form>
                <section id="rider-phone-settings" className="rider-phone-settings" aria-labelledby="rider-phone-title" tabIndex={-1}>
                    <div><p className="eyebrow">Contact security</p><h3 id="rider-phone-title">Verified phone number</h3></div>
                    <p>{user.phone_number || 'No number added'} · {user.phone_verified_at ? 'Verified' : 'Not verified'}</p>
                    <label>Philippine mobile number<input type="tel" inputMode="tel" autoComplete="tel" maxLength={30} pattern="(09[0-9]{9}|\\+639[0-9]{9})" placeholder="09XXXXXXXXX or +639XXXXXXXXX" value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
                    <p className="rider-settings-field-note">Sending a code saves this number to your account and requires verification before it is treated as verified.</p>
                    <button className="seller-inline-action" type="button" disabled={phoneBusy || !phone.trim()} onClick={() => void sendPhoneCode()}>{phoneBusy ? 'Sending code…' : user.phone_number === phone && user.phone_verified_at ? 'Phone verified' : 'Send / resend code'}</button>
                    {!user.phone_verified_at && <form className="rider-phone-code-form" onSubmit={(event) => void verifyPhone(event)}>
                        <label>Six-digit verification code<input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={phoneCode} onChange={(event) => setPhoneCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
                        <button className="seller-inline-action" type="submit" disabled={phoneBusy || phoneCode.length !== 6}>{phoneBusy ? 'Checking…' : 'Verify phone'}</button>
                    </form>}
                </section>
            </section>
            <section className="seller-settings-section rider-settings-panel" id="rider-settings-panel-password" role="tabpanel" aria-labelledby="rider-settings-tab-password" hidden={tab !== 'password'} tabIndex={-1}>
                <RiderSettingsHeading icon="security" eyebrow="Profile protection" title={user.password_setup_complete ? 'Change password' : 'Set a password'} description="Update the password used to sign in to your account." />
                <form className="seller-account-form rider-password-form" onSubmit={(event) => void changePassword(event)}>
                    {user.password_setup_complete
                        ? <label>Current password<input type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
                        : <p>No password is set yet. Set one to enable password sign-in for your account.</p>}
                    <label>New password<input type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
                    <label>Confirm new password<input type="password" autoComplete="new-password" minLength={8} required value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} /></label>
                    <button className="seller-inline-action" type="submit" disabled={passwordBusy}>{passwordBusy ? 'Saving password…' : user.password_setup_complete ? 'Update password' : 'Set password'}</button>
                </form>
            </section>
            <section className="seller-settings-section rider-settings-panel" id="rider-settings-panel-delivery" role="tabpanel" aria-labelledby="rider-settings-tab-delivery" hidden={tab !== 'delivery'} tabIndex={-1}>
                <RiderSettingsHeading icon="delivery" eyebrow="Delivery setup" title="Availability &amp; vehicle" description="Manage whether you receive new delivery offers." />
                <div className="rider-availability-card">
                    <div><span className={`rider-availability-indicator${settings?.availability === 'AVAILABLE' ? ' online' : ''}`} aria-hidden="true" /><div><strong>{settings?.availability === 'AVAILABLE' ? 'Available for offers' : 'Offline'}</strong><p>{settings?.is_verified ? 'You can manage whether you receive new delivery offers.' : 'Your rider profile is pending verification; offers are unavailable until an administrator verifies it.'}</p></div></div>
                    <div className="rider-availability-actions">
                        {settings?.availability === 'AVAILABLE'
                            ? <button className="seller-inline-action danger" type="button" disabled={settingsBusy} onClick={() => void changeAvailability('OFFLINE')}>{settingsBusy ? 'Saving…' : 'Go offline'}</button>
                            : <button className="seller-inline-action" type="button" disabled={settingsBusy || !settings?.is_verified} onClick={() => void changeAvailability('AVAILABLE')}>{settingsBusy ? 'Saving…' : 'Go available'}</button>}
                    </div>
                </div>
            </section>
            <section className="seller-settings-section rider-settings-panel" id="rider-settings-panel-vehicle" role="tabpanel" aria-labelledby="rider-settings-tab-vehicle" hidden={tab !== 'vehicle'} tabIndex={-1}>
                <RiderSettingsHeading icon="rider" eyebrow="Admin-reviewed change" title="Vehicle information" description="Review approved details and submit changes for administrator review." />
                <p>Approved vehicle details remain active while updates are reviewed. License, OR/CR, and vehicle photos are private, encrypted, and available only to you and authorized admin reviewers.</p>
                <dl className="rider-approved-vehicle">
                <div><dt>Approved vehicle</dt><dd>{settings?.vehicle_type ?? 'Not recorded'} · {settings?.vehicle_make_model ?? '—'}</dd></div>
                <div><dt>Plate / color</dt><dd>{settings?.plate_number ?? 'Not recorded'} · {settings?.vehicle_color ?? '—'}</dd></div>
                <div><dt>License expires</dt><dd>{settings?.license_expires_on ?? 'Not recorded'}</dd></div>
                <div><dt>OR/CR expires</dt><dd>{settings?.vehicle_registration_expires_on ?? 'Not recorded'}</dd></div>
                </dl>
                {settings?.pending_vehicle_change && <p className="rider-settings-notice" role="status">
                {settings.pending_vehicle_change.status === 'PENDING'
                    ? `${settings.pending_vehicle_change.vehicle_reference} is awaiting admin review (${new Date(settings.pending_vehicle_change.created_at).toLocaleString()}).`
                    : `${settings.pending_vehicle_change.vehicle_reference}: ${settings.pending_vehicle_change.status.replaceAll('_', ' ')}.`}
                {settings.pending_vehicle_change.decision_reason && <><br />Admin note: {settings.pending_vehicle_change.decision_reason}</>}
                </p>}
                <form className="seller-account-form rider-vehicle-change-form" onSubmit={(event) => void requestVehicleChange(event)}>
                <h4>Request a vehicle update or document replacement</h4>
                <label>Plate number<input autoComplete="off" pattern="[A-Za-z0-9][A-Za-z0-9 \-]{1,15}" maxLength={16} required value={vehicleFields.plate_number} onChange={(event) => updateVehicleField('plate_number', event.target.value.toUpperCase())} /></label>
                <label>Vehicle type<select required value={vehicleFields.vehicle_type} onChange={(event) => updateVehicleField('vehicle_type', event.target.value)}><option value="">Choose vehicle type</option><option>Motorcycle</option><option>Tricycle</option><option>Car</option><option>Van</option><option>Pickup</option><option>Truck</option><option>Other</option></select></label>
                <label>Make and model<input maxLength={120} required value={vehicleFields.vehicle_make_model} onChange={(event) => updateVehicleField('vehicle_make_model', event.target.value)} /></label>
                <label>Color<input maxLength={60} required value={vehicleFields.vehicle_color} onChange={(event) => updateVehicleField('vehicle_color', event.target.value)} /></label>
                <label>Driver license expiry<input type="date" min={new Date().toISOString().slice(0, 10)} required value={vehicleFields.license_expires_on} onChange={(event) => updateVehicleField('license_expires_on', event.target.value)} /></label>
                <label>OR/CR expiry<input type="date" min={new Date().toISOString().slice(0, 10)} required value={vehicleFields.vehicle_registration_expires_on} onChange={(event) => updateVehicleField('vehicle_registration_expires_on', event.target.value)} /></label>
                <div><FileDropzone label="Replacement driver license" accept="image/jpeg,image/png,image/webp,application/pdf" onFiles={(selected) => { const files = validVehicleFiles(selected, false); if (files?.[0]) setVehicleLicense(files[0]); }} helperText={`Why required: verify current license details. Images: ${IMAGE_UPLOAD_HINT} PDF: up to 10 MB. ${vehicleLicense?.name ?? ''}`} /><ImageUploadPreview file={vehicleLicense} alt="Selected replacement driver license preview" /></div>
                <div><FileDropzone label="Current OR/CR" accept="image/jpeg,image/png,image/webp,application/pdf" onFiles={(selected) => { const files = validVehicleFiles(selected, false); if (files?.[0]) setVehicleRegistration(files[0]); }} helperText={`Why required: verify current registration. Images: ${IMAGE_UPLOAD_HINT} PDF: up to 10 MB. ${vehicleRegistration?.name ?? ''}`} /><ImageUploadPreview file={vehicleRegistration} alt="Selected vehicle registration preview" /></div>
                <div><FileDropzone label="Vehicle photos" accept="image/jpeg,image/png,image/webp" multiple onFiles={(selected) => { const files = validVehicleFiles(selected, true); if (files?.length) { if (files.length + vehiclePhotos.length > 5) onError('Upload no more than 5 vehicle photos.'); else setVehiclePhotos((current) => [...current, ...files]); } }} helperText={`1 to 5 clear photos; ${IMAGE_UPLOAD_HINT}`} />{vehiclePhotos.map((file, index) => <span className="rider-vehicle-photo-file" key={`${file.name}-${index}`}>{file.name}<button type="button" className="seller-text-action" onClick={() => setVehiclePhotos((current) => current.filter((_, fileIndex) => fileIndex !== index))}>Remove</button><ImageUploadPreview file={file} alt={`Vehicle photo ${index + 1} preview`} /></span>)}</div>
                {settings?.pending_vehicle_change?.status !== 'PENDING' && <button className="seller-inline-action" type="submit" disabled={settingsBusy}>{settingsBusy ? 'Submitting…' : 'Submit vehicle update'}</button>}
                </form>
            </section>
            <section className="seller-settings-section rider-settings-panel" id="rider-settings-panel-payout" role="tabpanel" aria-labelledby="rider-settings-tab-payout" hidden={tab !== 'payout'} tabIndex={-1}>
                <RiderSettingsHeading icon="finance" eyebrow="Rider earnings" title="Bank or GCash payout destination" description="Manage the destination for eligible rider earnings." />
                <p>Provide the account where you want your delivery earnings paid. Farmgate stores account details encrypted and only displays masked values. A payout is not initiated when you submit these details.</p>
                {payoutDestinationLoading ? <p className="seller-loading" role="status">Loading payout destination…</p> : <>
                    {payoutDestination && <div className="seller-payout-destination-summary" aria-live="polite">
                        <p><strong>Verification status:</strong> <span className="status-pill">{payoutDestination.status.replaceAll('_', ' ')}</span></p>
                        <p><strong>Destination:</strong> {payoutDestination.destination_type === 'BANK' ? 'Bank transfer' : 'GCash'}</p>
                        <p><strong>Account holder:</strong> {payoutDestination.account_holder_masked}</p>
                        {payoutDestination.destination_type === 'BANK'
                            ? <><p><strong>Bank:</strong> {payoutDestination.bank_name_masked}</p><p><strong>Account:</strong> {payoutDestination.account_number_masked}</p></>
                            : <p><strong>GCash number:</strong> {payoutDestination.wallet_number_masked}</p>}
                        <p>Updating the details sends them for administrator verification again. Pending payouts linked to the current destination must be resolved first.</p>
                    </div>}
                    {payoutMethods.length === 0 && <p className="rider-settings-notice" role="status">No payout destination method is currently enabled. Ask Farmgate administration to configure and verify a bank or GCash method.</p>}
                    {payoutConsent && payoutMethods.length > 0 && <form className="seller-payout-destination-form" onSubmit={(event) => void savePayoutDestination(event)}>
                        <div className="seller-payout-destination-notice" role="note">
                            <strong>Operational notice · {payoutConsent.version}</strong>
                            <p>{payoutConsent.notice}</p>
                        </div>
                        <label className="seller-payout-destination-consent">
                            <input type="checkbox" checked={payoutConsentAccepted} onChange={(event) => setPayoutConsentAccepted(event.target.checked)} />
                            <span>I have read and acknowledge this operational notice.</span>
                        </label>
                        <fieldset disabled={!payoutConsentAccepted || payoutBusy}>
                            <legend>Destination details</legend>
                            <label>Destination type
                                <select value={payoutType} onChange={(event) => setPayoutType(event.target.value as PayoutDestinationType)}>
                                    {payoutMethods.map((method) => <option key={method.method_type} value={method.method_type}>{method.method_type === 'GCASH' ? 'GCash' : 'Bank transfer'}</option>)}
                                </select>
                            </label>
                            <label>Account holder name
                                <input value={payoutHolder} onChange={(event) => setPayoutHolder(event.target.value)} autoComplete="off" maxLength={120} required />
                            </label>
                            {payoutType === 'BANK' ? <>
                                <label>Bank name
                                    <input value={payoutBank} onChange={(event) => setPayoutBank(event.target.value)} autoComplete="off" maxLength={100} required />
                                </label>
                                <label>Bank account number
                                    <input value={payoutAccount} onChange={(event) => setPayoutAccount(event.target.value)} autoComplete="off" maxLength={40} required />
                                </label>
                            </> : <label>GCash mobile number
                                <input value={payoutWallet} onChange={(event) => setPayoutWallet(event.target.value)} autoComplete="off" inputMode="tel" maxLength={24} required />
                            </label>}
                            <label>Confirm with your current password
                                <input type="password" value={payoutPassword} onChange={(event) => setPayoutPassword(event.target.value)} autoComplete="current-password" required />
                            </label>
                            <p className="rider-settings-field-note">Saving or changing details resets verification. Changes are blocked while a payout is pending or processing. Farmgate does not initiate transfers; admins record external payments only after independent confirmation.</p>
                            <button className="seller-payout-destination-submit" type="submit" disabled={payoutBusy || !payoutMethods.some((method) => method.method_type === payoutType && method.status === 'ACTIVE')}>
                                {payoutBusy ? 'Saving…' : payoutDestination ? 'Save and request verification' : 'Save destination'}
                            </button>
                        </fieldset>
                        {payoutDestinationMessage && <p role="status">{payoutDestinationMessage}</p>}
                    </form>}
                </>}
            </section>
            <section className="seller-settings-section rider-settings-panel" id="rider-settings-panel-notifications" role="tabpanel" aria-labelledby="rider-settings-tab-notifications" hidden={tab !== 'notifications'} tabIndex={-1}>
                <RiderSettingsHeading icon="notifications" eyebrow="Communication controls" title="Notification settings" description="Control in-app updates and direct-message privacy." />
                <p>These controls apply to in-app updates for your account.</p>
                <label className="buyer-account-setting-toggle"><span><strong>Order and delivery updates</strong><small>Assignment and order status notifications.</small></span><input type="checkbox" checked={preferences.order_notifications} disabled={preferenceBusy} onChange={(event) => void updatePreference('order_notifications', event.target.checked)} /></label>
                <label className="buyer-account-setting-toggle"><span><strong>Chat notifications</strong><small>In-app notification when a direct message arrives.</small></span><input type="checkbox" checked={preferences.chat_notifications} disabled={preferenceBusy} onChange={(event) => void updatePreference('chat_notifications', event.target.checked)} /></label>
                <label className="buyer-account-setting-toggle"><span><strong>Allow direct messages</strong><small>Allow eligible buyers and sellers to start or continue a direct conversation.</small></span><input type="checkbox" checked={preferences.allow_direct_messages} disabled={preferenceBusy} onChange={(event) => void updatePreference('allow_direct_messages', event.target.checked)} /></label>
            </section>
            <section className="seller-settings-section rider-settings-panel" id="rider-settings-panel-location" role="tabpanel" aria-labelledby="rider-settings-tab-location" hidden={tab !== 'location'} tabIndex={-1}>
                <RiderSettingsHeading icon="distance" eyebrow="Device permissions" title="Location access" description="Control location permission for delivery matching and verification." />
                <p>When you are marked available and the rider dashboard is open, FARMGATE periodically uses your device location to match offers within the assignment distance. Active-delivery location sharing is started separately and can be stopped at any time. FARMGATE does not request background location access.</p>
                <div className="rider-location-permission"><span>Browser permission</span><strong>{permissionLabel}</strong></div>
                <button className="seller-inline-action" type="button" onClick={() => void checkLocationAccess()} disabled={locationPermission === 'unsupported'}>{locationPermission === 'granted' ? 'Check location access again' : 'Request location access'}</button>
                <p className="rider-settings-field-note">You can change this permission in your browser or device settings. Delivery location sharing is started separately on an assigned delivery and can be stopped at any time.</p>
            </section>
        </>}
        </section>
    </section>;
}
