import React from 'react';
import api from '../../lib/api';
import { AccountSetupProgress, type AccountSetupGroup, type AccountSetupStatus } from '../../shared/components/AccountSetupChecklist';
import { GuidedWalkthrough, type GuidedWalkthroughStep } from '../../shared/components/GuidedWalkthrough';
import type { User } from '../../shared/types';
import { hasValidPickupCoordinates, hasValidSavedPickupLocation } from './pickupLocation';

type SellerProfile = {
    business_name: string | null;
    phone: string | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    pickup_location_confirmed: boolean;
};
type ShopProfile = {
    shop_name: string | null;
    business_name: string | null;
    shop_image_url: string | null;
    verification_status: 'NOT_SUBMITTED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
};
type PayoutDestination = {
    destination_type: 'BANK' | 'GCASH';
    account_number_masked: string | null;
    wallet_number_masked: string | null;
    status: string;
} | null;
type SetupData = {
    profile: SellerProfile;
    shop: ShopProfile;
    payoutDestination: PayoutDestination;
    preferencesReviewedAt: string | null;
};
type SettingsSection = 'profile' | 'shop' | 'phone' | 'preferences' | 'pickup' | 'password' | 'payouts';

const sellerTourSections: SettingsSection[] = ['profile', 'shop', 'phone', 'pickup', 'preferences', 'password'];
const sellerTourSteps: GuidedWalkthroughStep[] = [
    {
        title: 'Profile & business',
        description: 'Update your account name, username, email, business name, business phone, and address here. Save the form to keep your changes.',
        targetSelectors: ['#seller-settings-panel-profile', '#seller-settings-tab-profile'],
    },
    {
        title: 'Farm profile',
        description: 'Set the farm name, image, and public business information buyers see on your farm page. Identity verification is handled separately and requires admin review.',
        targetSelectors: ['#seller-settings-panel-shop', '#seller-settings-tab-shop'],
    },
    {
        title: 'Phone security',
        description: 'Add or update your account phone number, request a one-time code, and verify it here.',
        targetSelectors: ['#seller-settings-panel-phone', '#seller-settings-tab-phone'],
    },
    {
        title: 'Pickup location',
        description: 'Choose your actual livestock pickup point on the map and save it. A map pin is not confirmed until you save it.',
        targetSelectors: ['#seller-settings-panel-pickup', '#seller-settings-tab-pickup'],
    },
    {
        title: 'Notifications & privacy',
        description: 'Choose which in-app order and chat updates you receive and whether other users can message you.',
        targetSelectors: ['#seller-settings-panel-preferences', '#seller-settings-tab-preferences'],
    },
    {
        title: 'Password & account security',
        description: 'Set a password for password sign-in or update your current password. Your existing sign-in method remains available.',
        targetSelectors: ['#seller-settings-panel-password', '#seller-settings-tab-password'],
    },
];

function requestErrorMessage(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'userMessage' in error && typeof error.userMessage === 'string') {
        return error.userMessage;
    }

    return 'Couldn’t load your setup progress.';
}

function stepStatus(complete: boolean, started: boolean, waiting = false): AccountSetupStatus {
    if (complete) return 'Complete';
    if (waiting) return 'Waiting for review';

    return started ? 'In progress' : 'Not started';
}

function payoutStatus(destination: PayoutDestination): AccountSetupStatus {
    if (!destination) return 'Not started';
    if (destination.status === 'VERIFIED') return 'Complete';
    if (destination.status === 'PENDING_VERIFICATION') return 'Waiting for review';
    if (destination.status === 'REJECTED') return 'In progress';

    return 'In progress';
}

export function SellerSetupGuide({ user, refreshKey, progressVisible, onCloseProgress, onOpenSection }: {
    user: User;
    refreshKey: number;
    progressVisible: boolean;
    onCloseProgress: () => void;
    onOpenSection: (section: SettingsSection, focusTarget?: boolean) => void;
}) {
    const [data, setData] = React.useState<SetupData | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState('');
    const [reviewBusy, setReviewBusy] = React.useState(false);
    const [tourOpen, setTourOpen] = React.useState(false);

    const refresh = React.useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const [profileResponse, shopResponse, payoutResponse, settingsResponse] = await Promise.all([
                api.get<{ profile: SellerProfile }>('/api/seller/profile'),
                api.get<{ profile: ShopProfile }>('/api/seller/shop-profile'),
                api.get<{ destination: PayoutDestination }>('/api/seller/payout-destination'),
                api.get<{ preferences_reviewed_at: string | null }>('/api/profile/settings'),
            ]);
            setData({
                profile: profileResponse.data.profile,
                shop: shopResponse.data.profile,
                payoutDestination: payoutResponse.data.destination,
                preferencesReviewedAt: settingsResponse.data.preferences_reviewed_at,
            });
        } catch (requestError: unknown) {
            setData(null);
            setError(requestErrorMessage(requestError));
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => { void refresh(); }, [refresh, refreshKey, user]);

    async function markPreferencesReviewed() {
        setReviewBusy(true);
        setError('');
        try {
            await api.put('/api/profile/settings', { mark_reviewed: true });
            await refresh();
        } catch (requestError: unknown) {
            setError(requestErrorMessage(requestError));
        } finally {
            setReviewBusy(false);
        }
    }

    if (loading || error || !data) return <>
        <AccountSetupProgress
            id="seller-setup-progress"
            hidden={!progressVisible}
            title="Seller setup"
            groups={[]}
            loading={loading}
            error={error || (!data ? 'Saved setup data is unavailable. Try again.' : '')}
            onRetry={() => void refresh()}
            onReviewTutorial={() => setTourOpen(true)}
        />
        <GuidedWalkthrough
            open={tourOpen}
            steps={sellerTourSteps}
            onStepChange={(index) => onOpenSection(sellerTourSections[index], false)}
            onClose={() => setTourOpen(false)}
        />
    </>;

    const profileComplete = Boolean(
        user.name.trim()
        && user.username?.trim()
        && user.email.trim()
        && data.profile.business_name?.trim()
        && data.profile.phone?.trim()
        && data.profile.address?.trim(),
    );
    const profileStarted = Boolean(data.profile.business_name || data.profile.phone || data.profile.address);
    const shopComplete = Boolean(data.shop.shop_name?.trim() && data.shop.shop_image_url && data.shop.business_name?.trim());
    const shopStarted = Boolean(data.shop.shop_name || data.shop.shop_image_url || data.shop.business_name);
    const identityStatus = data.shop.verification_status;
    const identityStepStatus: AccountSetupStatus = identityStatus === 'VERIFIED'
        ? 'Complete'
        : identityStatus === 'PENDING'
            ? 'Waiting for review'
            : identityStatus === 'REJECTED'
                ? 'In progress'
                : 'Not started';
    const payoutStepStatus = payoutStatus(data.payoutDestination);
    const maskedDestination = data.payoutDestination
        ? data.payoutDestination.destination_type === 'BANK'
            ? data.payoutDestination.account_number_masked
            : data.payoutDestination.wallet_number_masked
        : null;

    const groups: AccountSetupGroup[] = [
        {
            title: 'Business essentials',
            steps: [
                {
                    id: 'profile-business',
                    title: 'Profile & business',
                    description: 'Add your name, username, email, business name, business phone, and address.',
                    status: stepStatus(profileComplete, profileStarted),
                    actionLabel: 'Open profile',
                    onAction: () => onOpenSection('profile'),
                },
                {
                    id: 'shop-profile',
                    title: 'Farm profile',
                    description: 'Add a farm name, farm picture, and business information for your public farm page.',
                    status: stepStatus(shopComplete, shopStarted),
                    actionLabel: 'Open farm profile',
                    onAction: () => onOpenSection('shop'),
                },
                {
                    id: 'identity-verification',
                    title: 'Identity verification',
                    description: identityStatus === 'PENDING'
                        ? 'Pending review — an administrator is reviewing your ID. Uploading an ID does not verify your account or grant a badge.'
                        : identityStatus === 'VERIFIED'
                            ? 'Verified — an administrator approved your seller identity.'
                            : identityStatus === 'REJECTED'
                                ? 'Rejected — review the decision and submit a replacement ID for admin review.'
                                : 'Not submitted — submit a valid ID for admin review. Uploading an ID does not automatically verify you or grant a badge.',
                    status: identityStepStatus,
                    actionLabel: 'Open identity verification',
                    onAction: () => onOpenSection('shop'),
                },
                {
                    id: 'phone-security',
                    title: 'Phone security',
                    description: user.phone_verified_at
                        ? 'Your account phone number is verified.'
                        : user.phone_number
                            ? 'Verify your saved phone number with a one-time code.'
                            : 'Add a phone number and verify it with a one-time code.',
                    status: stepStatus(Boolean(user.phone_number && user.phone_verified_at), Boolean(user.phone_number)),
                    actionLabel: 'Open phone security',
                    onAction: () => onOpenSection('phone'),
                },
            ],
        },
        {
            title: 'Operations & security',
            steps: [
                {
                    id: 'payout-destination',
                    title: 'Payout destination',
                    description: data.payoutDestination
                        ? `${data.payoutDestination.destination_type === 'BANK' ? 'Bank' : 'GCash'} · ${maskedDestination ?? 'masked details unavailable'} · ${data.payoutDestination.status.replaceAll('_', ' ').toLowerCase()}. Admin verification is required before payouts.`
                        : 'Add bank or GCash details securely. Admin verification is required before payouts.',
                    status: payoutStepStatus,
                    actionLabel: 'Open payouts',
                    onAction: () => onOpenSection('payouts'),
                },
                {
                    id: 'pickup-location',
                    title: 'Pickup location',
                    description: hasValidSavedPickupLocation(data.profile)
                        ? 'Your pickup location has been saved and confirmed. A valid saved pin is required before a listing can be submitted or activated.'
                        : hasValidPickupCoordinates(data.profile.latitude, data.profile.longitude)
                            ? 'A location pin is saved but not confirmed. Confirm and save it from the map before submitting or activating listings.'
                            : 'Set your pickup pin on the map and save it to confirm the collection point before submitting or activating listings.',
                    status: stepStatus(
                        hasValidSavedPickupLocation(data.profile),
                        data.profile.latitude !== null || data.profile.longitude !== null,
                    ),
                    actionLabel: 'Open pickup location',
                    onAction: () => onOpenSection('pickup'),
                },
                {
                    id: 'notifications-privacy',
                    title: 'Notifications & privacy',
                    description: data.preferencesReviewedAt
                        ? 'You reviewed your saved notification and privacy preferences.'
                        : 'Review your in-app notification and direct-message privacy preferences, then mark the review complete.',
                    status: stepStatus(Boolean(data.preferencesReviewedAt), false),
                    actionLabel: 'Review preferences',
                    onAction: () => onOpenSection('preferences'),
                    ...(!data.preferencesReviewedAt ? {
                        secondaryActionLabel: 'Mark reviewed',
                        onSecondaryAction: () => void markPreferencesReviewed(),
                        secondaryActionBusy: reviewBusy,
                    } : {}),
                },
                {
                    id: 'password-security',
                    title: 'Password & account security',
                    description: user.password_setup_complete
                        ? 'A password is set for this account. Update it here whenever needed.'
                        : 'Set or update a secure password for your account.',
                    status: stepStatus(Boolean(user.password_setup_complete), false),
                    actionLabel: 'Open password settings',
                    onAction: () => onOpenSection('password'),
                },
            ],
        },
    ];

    return <>
        <AccountSetupProgress
            id="seller-setup-progress"
            hidden={!progressVisible}
            onClose={onCloseProgress}
            title="Seller setup"
            groups={groups}
            loading={false}
            error=""
            onRetry={() => void refresh()}
            onReviewTutorial={() => setTourOpen(true)}
        />
        <GuidedWalkthrough
            open={tourOpen}
            steps={sellerTourSteps}
            onStepChange={(index) => onOpenSection(sellerTourSections[index], false)}
            onClose={() => setTourOpen(false)}
        />
    </>;
}
