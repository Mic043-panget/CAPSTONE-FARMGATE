import React from 'react';
import api from '../../lib/api';
import { AccountSetupProgress, type AccountSetupGroup, type AccountSetupStatus } from '../../shared/components/AccountSetupChecklist';
import { GuidedWalkthrough, type GuidedWalkthroughStep } from '../../shared/components/GuidedWalkthrough';
import type { User } from '../../shared/types';

type RiderApplication = {
    status: string;
    name: string;
    email: string;
    phone_number: string | null;
    date_of_birth: string | null;
    residential_address: string | null;
    plate_number: string | null;
    vehicle_type: string | null;
    vehicle_make_model: string | null;
    vehicle_color: string | null;
    license_expires_on: string | null;
    vehicle_registration_expires_on: string | null;
    documents: { document_type: string }[];
} | null;
type RiderSettings = {
    is_verified: boolean;
    vehicle_type: string | null;
    plate_number: string | null;
    vehicle_make_model: string | null;
    vehicle_color: string | null;
    license_expires_on: string | null;
    vehicle_registration_expires_on: string | null;
    pending_vehicle_change: { status: string } | null;
};
type RiderPayoutDestination = {
    destination_type: 'BANK' | 'GCASH';
    account_number_masked: string | null;
    wallet_number_masked: string | null;
    status: string;
} | null;
type SetupData = {
    application: RiderApplication;
    settings: RiderSettings;
    payoutEnabled: boolean;
    payoutDestination: RiderPayoutDestination;
    preferencesReviewedAt: string | null;
};
type SettingsSection = 'profile' | 'password' | 'delivery' | 'vehicle' | 'payout' | 'notifications' | 'location';

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

function payoutStatus(destination: RiderPayoutDestination): AccountSetupStatus {
    if (!destination) return 'Not started';
    if (destination.status === 'VERIFIED') return 'Complete';
    if (destination.status === 'PENDING_VERIFICATION') return 'Waiting for review';
    if (destination.status === 'REJECTED') return 'In progress';

    return 'In progress';
}

function applicationReviewLabel(status: string | undefined, verified: boolean): string {
    if (status === 'APPROVED' || verified) return 'Approved by an administrator';
    if (status === 'SUBMITTED' || status === 'UNDER_REVIEW') return 'Waiting for administrator review';
    if (status === 'MORE_INFORMATION_REQUIRED') return 'Administrator requested more information';
    if (status === 'REJECTED') return 'Application rejected';
    if (status === 'DRAFT') return 'Application draft';

    return 'No application record';
}

function applicationReviewMessage(status: string | undefined, verified: boolean): string {
    if (status === 'APPROVED' || verified) {
        return 'Applicant review is complete. The floating progress control tracks account settings separately.';
    }
    if (status === 'SUBMITTED' || status === 'UNDER_REVIEW') {
        return 'Your documents and eligibility are under admin review. Application review is separate from account setup.';
    }
    if (status === 'MORE_INFORMATION_REQUIRED') {
        return 'Check the rider application for requested updates. Admin approval is required before delivery assignments.';
    }
    if (status === 'REJECTED') {
        return 'The rider application was not approved. Contact Farmgate support if you need help.';
    }
    if (status === 'DRAFT') {
        return 'Finish and submit the application before an administrator can review it.';
    }

    return 'Your verified rider account is active. Account setup progress is available in the floating progress control.';
}

export function RiderSetupGuide({ user, refreshKey, onOpenSection, onReviewTutorial }: {
    user: User;
    refreshKey: number;
    onOpenSection: (section: SettingsSection, focusTarget?: boolean, targetId?: string) => void;
    onReviewTutorial: () => void;
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
            const [applicationResponse, settingsResponse, preferencesResponse, earningsResponse] = await Promise.all([
                api.get<{ application: RiderApplication }>('/api/rider/application'),
                api.get<{ settings: RiderSettings }>('/api/riders/settings'),
                api.get<{ preferences_reviewed_at: string | null }>('/api/profile/settings'),
                api.get<{ configuration_status: 'CONFIGURED' | 'NOT_CONFIGURED' }>('/api/rider/earnings', { params: { page: 1 } }),
            ]);
            const configurationStatus = earningsResponse.data.configuration_status;
            if (configurationStatus !== 'CONFIGURED' && configurationStatus !== 'NOT_CONFIGURED') {
                throw new Error('Rider payout availability could not be determined.');
            }
            const payoutEnabled = configurationStatus === 'CONFIGURED';
            const payoutResponse = payoutEnabled
                ? await api.get<{ destination: RiderPayoutDestination }>('/api/rider/payout-destination')
                : null;

            setData({
                application: applicationResponse.data.application,
                settings: settingsResponse.data.settings,
                payoutEnabled,
                payoutDestination: payoutResponse?.data.destination ?? null,
                preferencesReviewedAt: preferencesResponse.data.preferences_reviewed_at,
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

    if (loading || error || !data) return <AccountSetupProgress
        title="Rider setup"
        groups={[]}
        loading={loading}
        error={error || (!data ? 'Saved setup data is unavailable. Try again.' : '')}
        onRetry={() => void refresh()}
        onReviewTutorial={() => setTourOpen(true)}
    />;

    const application = data.application;
    const hasLegalProfile = application
        ? Boolean(application.name.trim() && application.email.trim() && application.phone_number?.trim()
            && application.date_of_birth && application.residential_address?.trim())
        : Boolean(data.settings.is_verified && user.name.trim() && user.email.trim() && user.phone_number?.trim());
    const legalStarted = Boolean(application?.name || application?.date_of_birth || application?.residential_address);
    const documentTypes = new Set(application?.documents.map((document) => document.document_type) ?? []);
    const documentsComplete = data.settings.is_verified || (
        documentTypes.has('DRIVER_LICENSE')
        && documentTypes.has('VEHICLE_REGISTRATION')
        && documentTypes.has('VEHICLE_PHOTO')
    );
    const applicationWaiting = application?.status === 'SUBMITTED' || application?.status === 'UNDER_REVIEW';
    const documentStarted = documentTypes.size > 0;
    const documentsStatus = documentsComplete && data.settings.is_verified
        ? 'Complete'
        : documentsComplete && applicationWaiting
            ? 'Waiting for review'
            : stepStatus(false, documentStarted || Boolean(application));
    const hasVehicleDetails = Boolean(
        data.settings.vehicle_type
        && data.settings.plate_number
        && data.settings.vehicle_make_model
        && data.settings.vehicle_color
        && data.settings.license_expires_on
        && data.settings.vehicle_registration_expires_on,
    );
    const vehicleStatus = stepStatus(
        data.settings.is_verified && hasVehicleDetails,
        hasVehicleDetails || Boolean(application?.plate_number || application?.vehicle_type),
        Boolean(data.settings.pending_vehicle_change?.status === 'PENDING' && !hasVehicleDetails),
    );
    const maskedDestination = data.payoutDestination
        ? data.payoutDestination.destination_type === 'BANK'
            ? data.payoutDestination.account_number_masked
            : data.payoutDestination.wallet_number_masked
        : null;

    const groups: AccountSetupGroup[] = [
        {
            title: 'Rider account',
            steps: [
                {
                    id: 'legal-profile',
                    title: 'Legal profile & contact details',
                    description: 'Keep your legal name, birth date, residential address, email, and contact number current. Values are checked from your saved rider application.',
                    status: stepStatus(hasLegalProfile, legalStarted),
                    actionLabel: 'Open profile',
                    onAction: () => onOpenSection('profile'),
                },
                {
                    id: 'verified-phone',
                    title: 'Verified phone',
                    description: user.phone_verified_at
                        ? 'Your account phone number is verified.'
                        : user.phone_number
                            ? 'Verify your saved phone number with a one-time code.'
                            : 'Add a phone number and verify it with a one-time code.',
                    status: stepStatus(Boolean(user.phone_number && user.phone_verified_at), Boolean(user.phone_number)),
                    actionLabel: 'Open phone settings',
                    onAction: () => onOpenSection('profile', true, 'rider-phone-settings'),
                },
                {
                    id: 'identity-documents',
                    title: 'Identity & vehicle documents',
                    description: 'Driver license, OR/CR, and vehicle photos are private, encrypted, and available only to you and authorized admin reviewers. Submission is not approval; an administrator must approve your rider application.',
                    status: documentsStatus,
                    actionLabel: 'Review vehicle records',
                    onAction: () => onOpenSection('vehicle'),
                },
                {
                    id: 'vehicle-details',
                    title: 'Vehicle & plate details',
                    description: data.settings.pending_vehicle_change?.status === 'PENDING'
                        ? 'Your vehicle update is waiting for admin review; approved vehicle details remain active meanwhile.'
                        : 'Keep your approved vehicle type, make and model, color, plate, and document expiry dates current.',
                    status: vehicleStatus,
                    actionLabel: 'Open vehicle information',
                    onAction: () => onOpenSection('vehicle'),
                },
                ...(data.payoutEnabled ? [{
                    id: 'payout-destination',
                    title: 'Verified payout destination',
                    description: data.payoutDestination
                        ? `${data.payoutDestination.destination_type === 'BANK' ? 'Bank' : 'GCash'} · ${maskedDestination ?? 'masked details unavailable'} · ${data.payoutDestination.status.replaceAll('_', ' ').toLowerCase()}. Admin verification is required before payouts.`
                        : 'Add bank or GCash details securely. Admin verification is required before payouts.',
                    status: payoutStatus(data.payoutDestination),
                    actionLabel: 'Open payout destination',
                    onAction: () => onOpenSection('payout'),
                }] : []),
                {
                    id: 'notifications-privacy',
                    title: 'Notifications & privacy',
                    description: data.preferencesReviewedAt
                        ? 'You reviewed your saved notification and privacy preferences.'
                        : 'Review your in-app notification and direct-message privacy preferences, then mark the review complete.',
                    status: stepStatus(Boolean(data.preferencesReviewedAt), false),
                    actionLabel: 'Review preferences',
                    onAction: () => onOpenSection('notifications'),
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

    const riderTourItems: { section: SettingsSection; step: GuidedWalkthroughStep }[] = [
        {
            section: 'profile',
            step: {
                title: 'Profile & contact',
                description: 'Keep your account contact details current. Add a phone number and verify it with a one-time code in the profile section.',
                targetSelectors: ['#rider-settings-panel-profile', '#rider-settings-tab-profile'],
            },
        },
        {
            section: 'delivery',
            step: {
                title: 'Delivery preferences',
                description: 'Manage your availability for offers and review the delivery-specific preferences available to your rider account.',
                targetSelectors: ['#rider-settings-panel-delivery', '#rider-settings-tab-delivery'],
            },
        },
        {
            section: 'vehicle',
            step: {
                title: 'Vehicle & required documents',
                description: 'Review your vehicle details and required documents. Submitted application documents are private; admin approval is separate from changing your account settings.',
                targetSelectors: ['#rider-settings-panel-vehicle', '#rider-settings-tab-vehicle'],
            },
        },
        ...(data.payoutEnabled ? [{
            section: 'payout' as const,
            step: {
                title: 'Payout destination',
                description: 'Manage your bank or GCash destination here. The destination must be verified before payouts can be made.',
                targetSelectors: ['#rider-settings-panel-payout', '#rider-settings-tab-payout'],
            },
        }] : []),
        {
            section: 'notifications',
            step: {
                title: 'Notifications & privacy',
                description: 'Choose which in-app updates you receive and whether other users can start or continue direct messages.',
                targetSelectors: ['#rider-settings-panel-notifications', '#rider-settings-tab-notifications'],
            },
        },
        {
            section: 'password',
            step: {
                title: 'Password & account security',
                description: 'Set a password for password sign-in or update your current password without changing your other account details.',
                targetSelectors: ['#rider-settings-panel-password', '#rider-settings-tab-password'],
            },
        },
        {
            section: 'location',
            step: {
                title: 'Location permissions',
                description: 'Review the browser location permission used by rider features. You can change a blocked permission in your browser settings.',
                targetSelectors: ['#rider-settings-panel-location', '#rider-settings-tab-location'],
            },
        },
    ];

    return <div className="rider-setup-guide">
        <section className="rider-application-review" aria-label="Rider application review status">
            <div>
                <p className="eyebrow">Applicant review · separate from account setup</p>
                <strong>{applicationReviewLabel(application?.status, data.settings.is_verified)}</strong>
                <p>{applicationReviewMessage(application?.status, data.settings.is_verified)}</p>
            </div>
        </section>
        <div className="rider-guide-actions">
            <button type="button" className="seller-text-action" onClick={onReviewTutorial}>Review delivery tutorial</button>
        </div>
        <AccountSetupProgress
            title="Rider setup"
            groups={groups}
            loading={false}
            error=""
            onRetry={() => void refresh()}
            onReviewTutorial={() => setTourOpen(true)}
        />
        <GuidedWalkthrough
            open={tourOpen}
            steps={riderTourItems.map((item) => item.step)}
            onStepChange={(index) => onOpenSection(riderTourItems[index].section, false)}
            onClose={() => setTourOpen(false)}
        />
    </div>;
}
