import React from 'react';
import api, { initializeCsrf } from '../../lib/api';
import { showSuccess } from '../../lib/alerts';
import type { User } from '../../shared/types';
import { email as validateEmail } from '../../shared/validation';
import { RiderDashboard } from './RiderDashboard';

type Policy = {
    minimum_password_length: number;
    policy_version: string | null;
    effective_date: string | null;
    privacy_contact: string | null;
    documents: { privacy: string; terms: string; safety: string; retention: string } | null;
    registration_open: boolean;
    registration_status: string;
    missing_documents: string[];
    status_message: string | null;
};
type RiderDocument = { id: number; document_type: string; original_name: string; mime_type: string; size: number; view_url: string };
type ApplicationHistory = { id: number; from_status: string | null; to_status: string; action: string; reason: string | null; actor: string | null; created_at: string };
type Application = {
    id: number;
    application_reference: string;
    status: string;
    name: string;
    email: string;
    phone_number: string;
    date_of_birth: string;
    residential_address: string;
    license_number: string | null;
    plate_number: string | null;
    vehicle_type: string | null;
    vehicle_make_model: string | null;
    vehicle_color: string | null;
    license_expires_on: string | null;
    vehicle_registration_expires_on: string | null;
    decision_reason: string | null;
    submitted_at: string | null;
    privacy_policy_version: string;
    privacy_accepted_at: string;
    terms_version: string;
    terms_accepted_at: string;
    safety_policy_version: string;
    safety_policy_accepted_at: string;
    retention_policy_version: string | null;
    retention_policy_accepted_at: string | null;
    optional_updates_consent: boolean;
    optional_updates_consented_at: string | null;
    documents: RiderDocument[];
    history: ApplicationHistory[];
};
type Fields = {
    name: string;
    date_of_birth: string;
    residential_address: string;
    email: string;
    phone_number: string;
    password: string;
    password_confirmation: string;
    license_number: string;
    plate_number: string;
    vehicle_type: string;
    vehicle_make_model: string;
    vehicle_color: string;
    license_expires_on: string;
    vehicle_registration_expires_on: string;
};
type Uploads = { driver_license: File | null; vehicle_registration: File | null; vehicle_photos: File[] };
type FieldKey = keyof Fields | keyof Uploads;
type ValidationStep = 'account' | 'vehicle';

const initialFields: Fields = {
    name: '', date_of_birth: '', residential_address: '', email: '', phone_number: '',
    password: '', password_confirmation: '', license_number: '', plate_number: '',
    vehicle_type: '', vehicle_make_model: '', vehicle_color: '', license_expires_on: '',
    vehicle_registration_expires_on: '',
};
const emptyUploads: Uploads = { driver_license: null, vehicle_registration: null, vehicle_photos: [] };
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const allowedExtensions = /\.(jpe?g|png|webp|pdf)$/i;
const allowedImages = new Set(['image/jpeg', 'image/png', 'image/webp']);

function localToday(): string {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function validateAccountField(field: keyof Fields, fields: Fields, minimumPasswordLength = 8): string | null {
    const value = fields[field];
    switch (field) {
        case 'name':
            return value.trim().length < 2 ? 'Enter your full legal name (at least 2 characters).' : value.trim().length > 120 ? 'Name must be 120 characters or fewer.' : null;
        case 'date_of_birth':
            return !value ? 'Birthdate is required.' : value > localToday() ? 'Birthdate cannot be in the future.' : null;
        case 'residential_address':
            return value.trim().length < 8 ? 'Enter a residential address with at least 8 characters.' : value.trim().length > 1000 ? 'Address must be 1,000 characters or fewer.' : null;
        case 'email':
            return validateEmail(value.trim()) ?? (value.length > 255 ? 'Email must be 255 characters or fewer.' : null);
        case 'phone_number':
            return /^(09\d{9}|\+639\d{9})$/.test(value.replace(/[\s().-]/g, '')) ? null : 'Enter a valid Philippine mobile number (09XXXXXXXXX or +639XXXXXXXXX).';
        case 'password':
            return !value ? 'Password is required.' : value.length < minimumPasswordLength ? `Use at least ${minimumPasswordLength} characters.` : null;
        case 'password_confirmation':
            return !value ? 'Password confirmation is required.' : value !== fields.password ? 'Passwords do not match.' : null;
        default:
            return null;
    }
}

function validateVehicleField(field: keyof Fields, fields: Fields): string | null {
    const value = fields[field];
    switch (field) {
        case 'name':
            return value.trim().length < 2 ? 'Enter your full legal name (at least 2 characters).' : value.trim().length > 120 ? 'Name must be 120 characters or fewer.' : null;
        case 'date_of_birth':
            return !value ? 'Birthdate is required.' : value > localToday() ? 'Birthdate cannot be in the future.' : null;
        case 'residential_address':
            return value.trim().length < 8 ? 'Enter a residential address with at least 8 characters.' : value.trim().length > 1000 ? 'Address must be 1,000 characters or fewer.' : null;
        case 'license_number':
            return value.trim().length < 4 ? 'License number must contain at least 4 characters.' : value.trim().length > 80 ? 'License number must be 80 characters or fewer.' : null;
        case 'plate_number':
            return /^[A-Za-z0-9][A-Za-z0-9 -]{1,15}$/.test(value.trim()) ? null : 'Enter a plate number using 2–16 letters, numbers, spaces, or hyphens.';
        case 'vehicle_type':
            return !value.trim() ? 'Choose a vehicle type.' : value.length > 80 ? 'Vehicle type must be 80 characters or fewer.' : null;
        case 'vehicle_make_model':
            return !value.trim() ? 'Make and model is required.' : value.length > 120 ? 'Make and model must be 120 characters or fewer.' : null;
        case 'vehicle_color':
            return !value.trim() ? 'Vehicle color is required.' : value.length > 60 ? 'Vehicle color must be 60 characters or fewer.' : null;
        case 'license_expires_on':
            return !value ? 'Driver license expiry is required.' : value <= localToday() ? 'Driver license must not be expired.' : null;
        case 'vehicle_registration_expires_on':
            return !value ? 'Vehicle registration expiry is required.' : value <= localToday() ? 'Vehicle registration must not be expired.' : null;
        default:
            return null;
    }
}

function serverFieldErrors(error: any): Partial<Record<FieldKey, string>> {
    const errors = error.response?.data?.errors;
    if (!errors || typeof errors !== 'object') return {};
    const mapped: Partial<Record<FieldKey, string>> = {};
    Object.entries(errors).forEach(([key, messages]) => {
        const normalizedKey = (key.replace(/\.\d+$/, '') === 'license_number_hash' ? 'license_number' : key.replace(/\.\d+$/, ''));
        if (['name', 'date_of_birth', 'residential_address', 'email', 'phone_number', 'password', 'password_confirmation',
            'license_number', 'plate_number', 'vehicle_type', 'vehicle_make_model', 'vehicle_color', 'license_expires_on',
            'vehicle_registration_expires_on', 'driver_license', 'vehicle_registration', 'vehicle_photos'].includes(normalizedKey)) {
            const message = Array.isArray(messages) ? messages[0] : messages;
            if (typeof message === 'string') mapped[normalizedKey as FieldKey] = message;
        }
    });
    return mapped;
}

function getRequestError(error: any, fallback: string): string {
    const validationMessage = Object.values(error.response?.data?.errors ?? {}).flat()[0];
    return error.userMessage ?? (typeof validationMessage === 'string' ? validationMessage : null) ?? error.response?.data?.message ?? fallback;
}

function statusLabel(status: string): string {
    return status.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function imageHasSufficientDetail(file: File): Promise<boolean> {
    return new Promise((resolve) => {
        const source = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
            URL.revokeObjectURL(source);
            resolve(Math.min(image.naturalWidth, image.naturalHeight) >= 360);
        };
        image.onerror = () => {
            URL.revokeObjectURL(source);
            resolve(false);
        };
        image.src = source;
    });
}

function FilePreview({ files, remove }: { files: File[]; remove: (index: number) => void }) {
    const [previews, setPreviews] = React.useState<{ name: string; url: string; type: string }[]>([]);
    React.useEffect(() => {
        const next = files.map((file) => ({ name: file.name, url: URL.createObjectURL(file), type: file.type }));
        setPreviews(next);
        return () => next.forEach((preview) => URL.revokeObjectURL(preview.url));
    }, [files]);
    if (!files.length) return null;

    return <div className="rider-upload-previews">{previews.map((preview, index) => <figure key={`${preview.name}-${index}`}>
        {preview.type === 'application/pdf' || /\.pdf$/i.test(preview.name)
            ? <span className="rider-pdf-preview" aria-hidden="true">PDF</span>
            : <img src={preview.url} alt={`Preview of ${preview.name}`} />}
        <figcaption>{preview.name} · {(files[index].size / 1024 / 1024).toFixed(1)} MB</figcaption>
        <button type="button" onClick={() => remove(index)}>Remove / replace</button>
    </figure>)}</div>;
}

function ApplicantStatus({ application, onRefresh, refreshing }: { application: Application; onRefresh: () => void; refreshing: boolean }) {
    return <section className="rider-application-status" aria-labelledby="rider-application-status-title">
        <p className="eyebrow">Step {['DRAFT', 'MORE_INFORMATION_REQUIRED'].includes(application.status) ? '3' : '5'} of 5 · Rider application · {application.application_reference}</p>
        <h1 id="rider-application-status-title" tabIndex={-1} data-rider-step-heading>{statusLabel(application.status)}</h1>
        <p>{application.status === 'APPROVED'
            ? 'Your rider application has been approved. Your rider delivery workspace is now available.'
            : application.status === 'REJECTED'
                ? 'Your application was not approved. Review the reason below and contact Farmgate support if you believe a correction is needed.'
                : application.status === 'MORE_INFORMATION_REQUIRED'
                    ? 'An admin reviewer requested a correction. Update the requested details and submit your application again.'
                    : application.status === 'DRAFT'
                        ? 'Your application is saved as a draft. Complete your vehicle and document details to submit it.'
                        : 'Your application is saved. Only authorized Farmgate admin reviewers can see your protected documents.'}</p>
        {application.decision_reason && <p className="rider-application-decision"><strong>Admin note:</strong> {application.decision_reason}</p>}
        {application.status === 'SUBMITTED' && <p className="rider-registration-note" role="status">Application received. Your reference is <strong>{application.application_reference}</strong>. Keep it for your records.</p>}
        {application.submitted_at && <p>Submitted {new Date(application.submitted_at).toLocaleString()}</p>}
        <button type="button" className="rider-status-refresh" onClick={onRefresh} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh application status'}</button>
        {!!application.documents.length && <div><h2>Submitted documents</h2><ul className="rider-applicant-documents">{application.documents.map((document) => <li key={document.id}><span>{statusLabel(document.document_type)} · {document.original_name}</span><a href={document.view_url} target="_blank" rel="noreferrer">View protected document</a></li>)}</ul><small>These private links expire after five minutes. Do not share them.</small></div>}
        <section><h2>Application history</h2><ol className="rider-application-history">{application.history.map((entry) => <li key={entry.id}><strong>{statusLabel(entry.to_status)}</strong><span>{entry.actor ?? 'Farmgate'} · {new Date(entry.created_at).toLocaleString()}</span>{entry.reason && <p>{entry.reason}</p>}</li>)}</ol></section>
        <p className="rider-registration-note">Policy acknowledgments recorded: privacy {application.privacy_policy_version}, terms {application.terms_version}, safety {application.safety_policy_version}, retention {application.retention_policy_version ?? 'legacy'} · {new Date(application.privacy_accepted_at).toLocaleString()}.</p>
        {application.optional_updates_consent && <p className="rider-registration-note">You opted in to optional rider updates on {application.optional_updates_consented_at ? new Date(application.optional_updates_consented_at).toLocaleString() : 'the application date'}.</p>}
    </section>;
}

function RiderOnboardingProgress({ step }: { step: number }) {
    const steps = ['Policies', 'Account', 'Vehicle & documents', 'Review', 'Status'];

    return <nav className="rider-onboarding-progress" aria-label={`Rider registration progress, step ${step} of 5`}>
        <ol className="rider-onboarding-steps">
            {steps.map((label, index) => {
                const stepNumber = index + 1;
                return <li key={label} aria-current={stepNumber === step ? 'step' : undefined} className={stepNumber < step ? 'is-complete' : undefined}>
                    <span aria-hidden="true">{stepNumber < step ? '✓' : stepNumber}</span>
                    <span>{label}</span>
                </li>;
            })}
        </ol>
        <span className="sr-only" role="status" aria-live="polite">Step {step} of 5: {steps[step - 1]}.</span>
    </nav>;
}

export function RiderRegistrationPage({ initialUser, onError, onLogout }: {
    initialUser?: User;
    onError?: (message: string) => void;
    onLogout?: () => void;
}) {
    const [user, setUser] = React.useState<User | null>(initialUser ?? null);
    const [policy, setPolicy] = React.useState<Policy | null>(null);
    const [application, setApplication] = React.useState<Application | null>(null);
    const [reviewApplicationSnapshot, setReviewApplicationSnapshot] = React.useState<Application | null>(null);
    const [fields, setFields] = React.useState<Fields>(initialFields);
    const [uploads, setUploads] = React.useState<Uploads>(emptyUploads);
    const [consents, setConsents] = React.useState({ privacy: false, terms: false, safety: false, retention: false, optional_updates: false });
    const [consentReady, setConsentReady] = React.useState(false);
    const [reviewStep, setReviewStep] = React.useState(false);
    const [stepTransitioning, setStepTransitioning] = React.useState(false);
    const [touchedFields, setTouchedFields] = React.useState<Partial<Record<FieldKey, boolean>>>({});
    const [validationAttempted, setValidationAttempted] = React.useState<Record<ValidationStep, boolean>>({ account: false, vehicle: false });
    const [fieldErrors, setFieldErrors] = React.useState<Partial<Record<FieldKey, string>>>({});
    const [consentError, setConsentError] = React.useState('');
    const [consentAttempted, setConsentAttempted] = React.useState(false);
    const [loading, setLoading] = React.useState(true);
    const [saving, setSaving] = React.useState(false);
    const [refreshing, setRefreshing] = React.useState(false);
    const [error, setError] = React.useState('');
    const [saveMessage, setSaveMessage] = React.useState('');
    const stepContainerRef = React.useRef<HTMLDivElement>(null);
    const transitionLockedRef = React.useRef(false);

    React.useEffect(() => {
        let mounted = true;
        Promise.all([
            api.get<{ user?: User }>('/api/auth/user').catch(() => null),
            api.get<Policy>('/api/rider-registration/policy'),
        ]).then(([authResponse, policyResponse]) => {
            if (!mounted) return;
            const currentUser = initialUser ?? authResponse?.data.user ?? null;
            setUser(currentUser);
            setPolicy(policyResponse.data);
            if (currentUser?.role === 'RIDER') {
                api.get<{ application: Application | null }>('/api/rider/application').then((response) => {
                    if (!mounted || !response.data.application) return;
                    setApplication(response.data.application);
                    setFields((current) => ({
                        ...current,
                        name: response.data.application?.name ?? current.name,
                        date_of_birth: response.data.application?.date_of_birth ?? current.date_of_birth,
                        residential_address: response.data.application?.residential_address ?? current.residential_address,
                        email: response.data.application?.email ?? current.email,
                        phone_number: response.data.application?.phone_number ?? current.phone_number,
                        license_number: response.data.application?.license_number ?? current.license_number,
                        plate_number: response.data.application?.plate_number ?? current.plate_number,
                        vehicle_type: response.data.application?.vehicle_type ?? current.vehicle_type,
                        vehicle_make_model: response.data.application?.vehicle_make_model ?? current.vehicle_make_model,
                        vehicle_color: response.data.application?.vehicle_color ?? current.vehicle_color,
                        license_expires_on: response.data.application?.license_expires_on ?? current.license_expires_on,
                        vehicle_registration_expires_on: response.data.application?.vehicle_registration_expires_on ?? current.vehicle_registration_expires_on,
                    }));
                }).catch((loadError: any) => {
                    if (mounted) setError(getRequestError(loadError, 'Your rider application could not be loaded.'));
                }).finally(() => { if (mounted) setLoading(false); });
            } else {
                setLoading(false);
            }
        }).catch((loadError: any) => {
            if (mounted) setError(getRequestError(loadError, 'Rider registration details could not be loaded.'));
            setLoading(false);
        });
        return () => { mounted = false; };
    }, [initialUser]);

    function transitionStep(changeStep: () => void, focusSelector?: string) {
        if (transitionLockedRef.current) return;
        transitionLockedRef.current = true;
        const container = stepContainerRef.current;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !container) {
            changeStep();
            window.requestAnimationFrame(() => {
                (focusSelector ? container?.querySelector<HTMLElement>(focusSelector) : container?.querySelector<HTMLElement>('[data-rider-step-heading]'))?.focus({ preventScroll: true });
                transitionLockedRef.current = false;
            });
            return;
        }
        container.style.height = `${container.getBoundingClientRect().height}px`;
        container.style.overflow = 'hidden';
        container.getBoundingClientRect();
        setStepTransitioning(true);
        window.setTimeout(() => {
            changeStep();
            window.requestAnimationFrame(() => {
                container.style.height = `${container.scrollHeight}px`;
                window.setTimeout(() => {
                    setStepTransitioning(false);
                    window.setTimeout(() => {
                        container.style.height = '';
                        container.style.overflow = '';
                        (focusSelector ? container.querySelector<HTMLElement>(focusSelector) : container.querySelector<HTMLElement>('[data-rider-step-heading]'))?.focus({ preventScroll: true });
                        transitionLockedRef.current = false;
                    }, 180);
                }, 45);
            });
        }, 145);
    }

    function fieldError(key: FieldKey, step: ValidationStep): string | null {
        if (fieldErrors[key]) return fieldErrors[key] ?? null;
        if (!touchedFields[key] && !validationAttempted[step]) return null;
        if (key in initialFields) {
            return step === 'account'
                ? validateAccountField(key as keyof Fields, fields, policy?.minimum_password_length ?? 8)
                : validateVehicleField(key as keyof Fields, fields);
        }
        if (key === 'driver_license' && validationAttempted.vehicle
            && !uploads.driver_license && !application?.documents.some((document) => document.document_type === 'DRIVER_LICENSE')) {
            return 'Upload a driver license image or PDF.';
        }
        if (key === 'vehicle_registration' && validationAttempted.vehicle
            && !uploads.vehicle_registration && !application?.documents.some((document) => document.document_type === 'VEHICLE_REGISTRATION')) {
            return 'Upload an OR/CR image or PDF.';
        }
        if (key === 'vehicle_photos' && validationAttempted.vehicle
            && !uploads.vehicle_photos.length && !application?.documents.some((document) => document.document_type === 'VEHICLE_PHOTO')) {
            return 'Upload at least one vehicle photo.';
        }
        return null;
    }

    function markTouched(key: FieldKey) {
        setTouchedFields((current) => ({ ...current, [key]: true }));
    }

    function updateField(key: keyof Fields, value: string) {
        setFields((current) => ({ ...current, [key]: value }));
        setFieldErrors((current) => {
            if (!current[key] && (key !== 'password' || !current.password_confirmation)) return current;
            const next = { ...current };
            delete next[key];
            if (key === 'password') delete next.password_confirmation;
            return next;
        });
        setSaveMessage('');
    }

    function validateStep(step: ValidationStep): boolean {
        setValidationAttempted((current) => ({ ...current, [step]: true }));
        const keys: (keyof Fields)[] = step === 'account'
            ? ['name', 'date_of_birth', 'residential_address', 'phone_number', 'email', 'password', 'password_confirmation']
            : ['name', 'date_of_birth', 'residential_address', 'license_number', 'license_expires_on', 'vehicle_registration_expires_on', 'plate_number', 'vehicle_type', 'vehicle_make_model', 'vehicle_color'];
        const firstInvalid = keys.find((key) => (step === 'account'
            ? validateAccountField(key, fields, policy?.minimum_password_length ?? 8)
            : validateVehicleField(key, fields)) !== null);
        if (firstInvalid) {
            window.setTimeout(() => stepContainerRef.current?.querySelector<HTMLElement>(`[data-rider-field="${firstInvalid}"]`)?.focus(), 0);
            return false;
        }
        if (step === 'vehicle') {
            const missingFiles = [
                !uploads.driver_license && !application?.documents.some((document) => document.document_type === 'DRIVER_LICENSE') ? 'driver_license' : null,
                !uploads.vehicle_registration && !application?.documents.some((document) => document.document_type === 'VEHICLE_REGISTRATION') ? 'vehicle_registration' : null,
                !uploads.vehicle_photos.length && !application?.documents.some((document) => document.document_type === 'VEHICLE_PHOTO') ? 'vehicle_photos' : null,
            ];
            const firstMissing = missingFiles.find(Boolean);
            if (firstMissing) {
                window.setTimeout(() => stepContainerRef.current?.querySelector<HTMLElement>(`[data-rider-field="${firstMissing}"]`)?.focus(), 0);
                return false;
            }
        }
        return true;
    }

    function applyServerValidation(requestError: any, fallback: string) {
        const errors = serverFieldErrors(requestError);
        if (Object.keys(errors).length) {
            setFieldErrors((current) => ({ ...current, ...errors }));
            setError('');
            const firstInvalid = ['name', 'date_of_birth', 'residential_address', 'phone_number', 'email', 'password',
                'password_confirmation', 'license_number', 'license_expires_on', 'vehicle_registration_expires_on',
                'driver_license', 'vehicle_registration', 'plate_number', 'vehicle_type', 'vehicle_make_model',
                'vehicle_color', 'vehicle_photos'].find((key) => key in errors);
            if (firstInvalid) {
                window.setTimeout(() => stepContainerRef.current?.querySelector<HTMLElement>(`[data-rider-field="${firstInvalid}"]`)?.focus(), 0);
            }
        } else {
            const message = getRequestError(requestError, fallback);
            setError(message);
            onError?.(message);
        }
    }

    async function createDraft(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError('');
        if (!policy?.registration_open) return;
        if (saving || transitionLockedRef.current || !validateStep('account')) return;
        setSaving(true);
        try {
            await initializeCsrf();
            const response = await api.post<{ application: Application; user: User }>('/api/rider-registration', {
                name: fields.name.trim(),
                date_of_birth: fields.date_of_birth,
                residential_address: fields.residential_address.trim(),
                email: fields.email.trim(),
                phone_number: fields.phone_number.trim(),
                password: fields.password,
                password_confirmation: fields.password_confirmation,
                policy_version: policy.policy_version,
                privacy_consent: consents.privacy,
                terms_consent: consents.terms,
                safety_consent: consents.safety,
                retention_consent: consents.retention,
                optional_updates_consent: consents.optional_updates,
            });
            transitionStep(() => {
                setUser(response.data.user);
                setApplication(response.data.application);
                setFields((current) => ({ ...current, password: '', password_confirmation: '' }));
                setFieldErrors({});
            });
            showSuccess('Rider application draft created. Continue with vehicle and document details.');
        } catch (requestError: any) {
            applyServerValidation(requestError, 'Your rider application draft could not be created.');
        } finally {
            setSaving(false);
        }
    }

    async function chooseFiles(field: keyof Uploads, fileList: FileList | null, input: HTMLInputElement) {
        const selected = Array.from(fileList ?? []);
        input.value = '';
        if (!selected.length) return;
        const isImageCollection = field === 'vehicle_photos';
        const invalidType = selected.find((file) => {
            if (isImageCollection) return file.type ? !allowedImages.has(file.type) : !/\.(jpe?g|png|webp)$/i.test(file.name);
            return file.type ? !allowedTypes.has(file.type) : !allowedExtensions.test(file.name);
        });
        if (invalidType) {
            setFieldErrors((current) => ({ ...current, [field]: isImageCollection ? 'Choose a JPEG, PNG, or WebP image.' : 'Choose a JPEG, PNG, WebP, or PDF file.' }));
            return;
        }
        if (selected.some((file) => file.size > 10 * 1024 * 1024)) {
            setFieldErrors((current) => ({ ...current, [field]: 'Each file must be 10 MB or smaller.' }));
            return;
        }
        if (field === 'vehicle_photos' && selected.length + uploads.vehicle_photos.length > 5) {
            setFieldErrors((current) => ({ ...current, vehicle_photos: 'Upload 1 to 5 clear vehicle photos.' }));
            return;
        }
        if (isImageCollection) {
            for (const file of selected) {
                if (!(await imageHasSufficientDetail(file))) {
                    setFieldErrors((current) => ({ ...current, [field]: 'Use clear images with at least 360 pixels on the shortest side.' }));
                    return;
                }
            }
        }
        setError('');
        setFieldErrors((current) => {
            const next = { ...current };
            delete next[field];
            return next;
        });
        if (field === 'vehicle_photos') {
            setUploads((current) => ({ ...current, vehicle_photos: [...current.vehicle_photos, ...selected] }));
        } else {
            setUploads((current) => ({ ...current, [field]: selected[0] }));
        }
    }

    function applicationDraftBody(): FormData {
        const body = new FormData();
        body.append('name', fields.name.trim());
        body.append('date_of_birth', fields.date_of_birth);
        body.append('residential_address', fields.residential_address.trim());
        body.append('license_number', fields.license_number.trim());
        body.append('plate_number', fields.plate_number.trim().toUpperCase());
        body.append('vehicle_type', fields.vehicle_type);
        body.append('vehicle_make_model', fields.vehicle_make_model.trim());
        body.append('vehicle_color', fields.vehicle_color.trim());
        body.append('license_expires_on', fields.license_expires_on);
        body.append('vehicle_registration_expires_on', fields.vehicle_registration_expires_on);
        if (uploads.driver_license) body.append('driver_license', uploads.driver_license);
        if (uploads.vehicle_registration) body.append('vehicle_registration', uploads.vehicle_registration);
        uploads.vehicle_photos.forEach((file) => body.append('vehicle_photos[]', file));
        return body;
    }

    async function saveApplicationDraft(): Promise<Application | null> {
        if (!application || saving) return null;
        setError('');
        setSaveMessage('');
        setSaving(true);
        try {
            await initializeCsrf();
            const response = await api.post<{ application: Application }>('/api/rider/application/draft', applicationDraftBody());
            setApplication(response.data.application);
            setUploads(emptyUploads);
            setFields((current) => ({
                ...current,
                name: response.data.application.name,
                date_of_birth: response.data.application.date_of_birth ?? current.date_of_birth,
                residential_address: response.data.application.residential_address ?? current.residential_address,
                license_number: response.data.application.license_number ?? current.license_number,
                plate_number: response.data.application.plate_number ?? current.plate_number,
                vehicle_type: response.data.application.vehicle_type ?? current.vehicle_type,
                vehicle_make_model: response.data.application.vehicle_make_model ?? current.vehicle_make_model,
                vehicle_color: response.data.application.vehicle_color ?? current.vehicle_color,
                license_expires_on: response.data.application.license_expires_on ?? current.license_expires_on,
                vehicle_registration_expires_on: response.data.application.vehicle_registration_expires_on ?? current.vehicle_registration_expires_on,
            }));
            setSaveMessage('Draft saved securely. You can sign in later to continue.');
            return response.data.application;
        } catch (requestError: any) {
            applyServerValidation(requestError, 'Your draft could not be saved. Your entries and selected files are still here; check them and retry.');
            return null;
        } finally {
            setSaving(false);
        }
    }

    async function reviewApplication(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError('');
        if (saving || transitionLockedRef.current || !validateStep('vehicle')) return;
        const savedApplication = await saveApplicationDraft();
        if (!savedApplication) return;
        setReviewApplicationSnapshot(savedApplication);
        transitionStep(() => setReviewStep(true));
    }

    async function submitApplication() {
        if (!application || saving) return;
        setError('');
        setSaving(true);
        const body = new FormData();
        body.append('name', fields.name.trim());
        body.append('date_of_birth', fields.date_of_birth);
        body.append('residential_address', fields.residential_address.trim());
        body.append('license_number', fields.license_number.trim());
        body.append('plate_number', fields.plate_number.trim().toUpperCase());
        body.append('vehicle_type', fields.vehicle_type);
        body.append('vehicle_make_model', fields.vehicle_make_model.trim());
        body.append('vehicle_color', fields.vehicle_color.trim());
        body.append('license_expires_on', fields.license_expires_on);
        body.append('vehicle_registration_expires_on', fields.vehicle_registration_expires_on);
        if (uploads.driver_license) body.append('driver_license', uploads.driver_license);
        if (uploads.vehicle_registration) body.append('vehicle_registration', uploads.vehicle_registration);
        uploads.vehicle_photos.forEach((file) => body.append('vehicle_photos[]', file));
        try {
            await initializeCsrf();
            const response = await api.post<{ application: Application }>('/api/rider/application/submit', body);
            transitionStep(() => {
                setApplication(response.data.application);
                setReviewStep(false);
                setUploads(emptyUploads);
            });
            showSuccess('Rider application submitted. You can track its status here.');
        } catch (submitError: any) {
            const errors = serverFieldErrors(submitError);
            if (Object.keys(errors).length) {
                setFieldErrors((current) => ({ ...current, ...errors }));
                setError('');
                transitionStep(() => setReviewStep(false));
                const firstInvalid = ['name', 'date_of_birth', 'residential_address', 'license_number', 'license_expires_on',
                    'vehicle_registration_expires_on', 'driver_license', 'vehicle_registration', 'plate_number', 'vehicle_type',
                    'vehicle_make_model', 'vehicle_color', 'vehicle_photos'].find((key) => key in errors);
                if (firstInvalid) transitionStep(() => setReviewStep(false), `[data-rider-field="${firstInvalid}"]`);
                else transitionStep(() => setReviewStep(false));
            } else {
                const message = getRequestError(submitError, 'Your rider application could not be submitted. Your entries are still here; check the files and retry.');
                setError(message);
                onError?.(message);
            }
        } finally {
            setSaving(false);
        }

    }

    async function refreshApplication() {
        setRefreshing(true);
        try {
            const response = await api.get<{ application: Application | null }>('/api/rider/application');
            if (response.data.application) setApplication(response.data.application);
        } catch (requestError: any) {
            const message = getRequestError(requestError, 'Application status could not be refreshed.');
            setError(message);
            onError?.(message);
        } finally {
            setRefreshing(false);
        }

    }

    const requiredAcknowledgmentsComplete = consents.privacy && consents.terms && consents.safety && consents.retention;
    const currentStep = !user
        ? consentReady ? 2 : 1
        : application && ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'].includes(application.status)
            ? 5
            : reviewStep ? 4 : 3;
    const showProgress = (!user && policy?.registration_open) || (user?.role === 'RIDER' && !!application);
    const formShowsError = reviewStep
        ? user?.role === 'RIDER' && !!application && ['DRAFT', 'MORE_INFORMATION_REQUIRED'].includes(application.status)
        : user?.role === 'RIDER' && !!application && ['DRAFT', 'MORE_INFORMATION_REQUIRED'].includes(application.status)
            || !user && policy?.registration_open && consentReady;
    const reviewedApplication = reviewApplicationSnapshot ?? application;

    if (user?.role === 'RIDER' && application?.status === 'APPROVED') {
        return <RiderDashboard user={user} onUserUpdated={setUser} onError={onError ?? (() => undefined)} onLogout={onLogout ?? (() => undefined)} />;
    }

    return <main className="rider-registration-shell">
        <header className="rider-registration-header"><a className="brand" href="/">FARM<span>GATE</span></a><a href="/">Back to Farmgate</a></header>
        {loading ? <p role="status">Loading rider registration…</p> : user && user.role !== 'RIDER' ? <section className="rider-registration-message"><h1>Rider account required</h1><p>Sign out of this account before continuing with rider registration.</p><a href="/">Return to Farmgate</a></section> : <>
            <section className="rider-registration-intro"><p className="eyebrow">Rider onboarding</p><h1>Rider registration</h1><p>Applications are reviewed by authorized Farmgate administrators. Only approved riders can receive delivery assignments.</p></section>
            {showProgress && <RiderOnboardingProgress step={currentStep} />}
            {error && !formShowsError && <p role="alert" className="rider-registration-error">{error}</p>}
            {!user && !policy?.registration_open && <section className="rider-registration-message" role="status">
                <p className="eyebrow">Registration status · {statusLabel(policy?.registration_status ?? 'POLICY_NOT_PUBLISHED')}</p>
                <h2>Rider applications are currently closed</h2>
                <p>{policy?.status_message ?? 'Farmgate has not published complete, effective rider policies yet.'}</p>
                {!!policy?.missing_documents.length && <p>Still required: {policy.missing_documents.join(', ')}.</p>}
                <p>No application form is shown and no applicant information is collected while registration is closed. For an existing application, <a href="/">sign in to Farmgate</a> with your rider account to check its status.</p>
            </section>}
            {user?.role === 'RIDER' && !application && <section className="rider-registration-message" role="alert"><h2>No application record found</h2><p>Your rider account does not have an onboarding record. Delivery features remain unavailable. Contact Farmgate support for assistance.</p></section>}
            {showProgress && <div ref={stepContainerRef} className={`rider-step-container${stepTransitioning ? ' is-transitioning' : ''}`}>
            {user?.role === 'RIDER' && application && !['DRAFT', 'MORE_INFORMATION_REQUIRED'].includes(application.status) && <ApplicantStatus application={application} onRefresh={() => void refreshApplication()} refreshing={refreshing} />}
            {!user && policy?.registration_open && !consentReady && <section className="rider-registration-consent" aria-labelledby="rider-policy-title">
                    <h2 id="rider-policy-title" tabIndex={-1} data-rider-step-heading>Review the effective rider policies</h2>
                    <p>Read each published policy before providing any personal information. Policy version {policy.policy_version} · Effective {policy.effective_date} · Privacy contact: {policy.privacy_contact}.</p>
                    <div className="rider-policy-documents">
                        {policy.documents && Object.entries({
                            privacy: ['Privacy notice', policy.documents.privacy],
                            terms: ['Rider terms', policy.documents.terms],
                            safety: ['Safety policy', policy.documents.safety],
                            retention: ['Retention and secure disposal schedule', policy.documents.retention],
                        }).map(([key, [title, content]]) => <details key={key}>
                            <summary>{title}</summary><div className="rider-policy-content">{content}</div>
                        </details>)}
                    </div>
                    <label><input data-policy-consent="privacy" type="checkbox" checked={consents.privacy} aria-invalid={Boolean(consentAttempted && !consents.privacy)} aria-describedby={consentError && !consents.privacy ? 'rider-policy-error' : undefined} onChange={(event) => { const next = { ...consents, privacy: event.target.checked }; setConsents(next); if (next.privacy && next.terms && next.safety && next.retention) { setConsentError(''); setConsentAttempted(false); } }} /><span><strong>Required:</strong> I acknowledge that I have read the privacy notice.</span></label>
                    <label><input data-policy-consent="terms" type="checkbox" checked={consents.terms} aria-invalid={Boolean(consentAttempted && !consents.terms)} aria-describedby={consentError && !consents.terms ? 'rider-policy-error' : undefined} onChange={(event) => { const next = { ...consents, terms: event.target.checked }; setConsents(next); if (next.privacy && next.terms && next.safety && next.retention) { setConsentError(''); setConsentAttempted(false); } }} /><span><strong>Required:</strong> I agree to the rider terms.</span></label>
                    <label><input data-policy-consent="safety" type="checkbox" checked={consents.safety} aria-invalid={Boolean(consentAttempted && !consents.safety)} aria-describedby={consentError && !consents.safety ? 'rider-policy-error' : undefined} onChange={(event) => { const next = { ...consents, safety: event.target.checked }; setConsents(next); if (next.privacy && next.terms && next.safety && next.retention) { setConsentError(''); setConsentAttempted(false); } }} /><span><strong>Required:</strong> I acknowledge and agree to follow the safety policy.</span></label>
                    <label><input data-policy-consent="retention" type="checkbox" checked={consents.retention} aria-invalid={Boolean(consentAttempted && !consents.retention)} aria-describedby={consentError && !consents.retention ? 'rider-policy-error' : undefined} onChange={(event) => { const next = { ...consents, retention: event.target.checked }; setConsents(next); if (next.privacy && next.terms && next.safety && next.retention) { setConsentError(''); setConsentAttempted(false); } }} /><span><strong>Required:</strong> I acknowledge the retention and secure disposal schedule.</span></label>
                    <label className="rider-optional-consent"><input type="checkbox" checked={consents.optional_updates} onChange={(event) => setConsents((current) => ({ ...current, optional_updates: event.target.checked }))} /><span><strong>Optional:</strong> I agree to receive rider program updates. This choice is not required to apply.</span></label>
                    {consentError && <p className="field-error" id="rider-policy-error" role="alert">{consentError}</p>}
                    <button type="button" disabled={stepTransitioning} onClick={() => {
                        if (!requiredAcknowledgmentsComplete) {
                            setConsentAttempted(true);
                            setConsentError('Acknowledge all four required rider policies before continuing.');
                            window.setTimeout(() => stepContainerRef.current?.querySelector<HTMLInputElement>('[data-policy-consent]:not(:checked)')?.focus(), 0);
                            return;
                        }
                        transitionStep(() => { setConsentError(''); setConsentAttempted(false); setConsentReady(true); });
                    }}>
                        Continue to account details
                    </button>
                </section>}
            {!user && policy?.registration_open && consentReady && <form className="rider-registration-form" noValidate onSubmit={(event) => void createDraft(event)}>
                    <p className="eyebrow">Step 2 of 5</p><h2 tabIndex={-1} data-rider-step-heading>Personal and account details</h2>
                    <button type="button" className="rider-step-back" disabled={stepTransitioning || saving} onClick={() => transitionStep(() => setConsentReady(false))}>Edit policy acknowledgments</button>
                    <label>Full legal name<input data-rider-field="name" autoComplete="name" maxLength={120} aria-required="true" aria-invalid={Boolean(fieldError('name', 'account'))} aria-describedby={fieldError('name', 'account') ? 'rider-error-name' : undefined} value={fields.name} onBlur={() => markTouched('name')} onChange={(event) => updateField('name', event.target.value)} /></label>
                    {fieldError('name', 'account') && <span className="field-error" id="rider-error-name" role="alert">{fieldError('name', 'account')}</span>}
                    <label>Birthdate<input data-rider-field="date_of_birth" type="date" autoComplete="bday" max={localToday()} aria-required="true" aria-invalid={Boolean(fieldError('date_of_birth', 'account'))} aria-describedby={fieldError('date_of_birth', 'account') ? 'rider-error-date_of_birth' : undefined} value={fields.date_of_birth} onBlur={() => markTouched('date_of_birth')} onChange={(event) => updateField('date_of_birth', event.target.value)} /></label>
                    {fieldError('date_of_birth', 'account') && <span className="field-error" id="rider-error-date_of_birth" role="alert">{fieldError('date_of_birth', 'account')}</span>}
                    <label>Residential address<textarea data-rider-field="residential_address" autoComplete="street-address" maxLength={1000} aria-required="true" aria-invalid={Boolean(fieldError('residential_address', 'account'))} aria-describedby={fieldError('residential_address', 'account') ? 'rider-error-residential_address' : undefined} value={fields.residential_address} onBlur={() => markTouched('residential_address')} onChange={(event) => updateField('residential_address', event.target.value)} /></label>
                    {fieldError('residential_address', 'account') && <span className="field-error" id="rider-error-residential_address" role="alert">{fieldError('residential_address', 'account')}</span>}
                    <p className="rider-registration-note">Enter your address manually. Identity and vehicle documents are reviewed manually by authorized administrators only. No OCR, face matching, or selfie is collected.</p>
                    <label>Phone number<input data-rider-field="phone_number" type="tel" autoComplete="tel" inputMode="tel" maxLength={30} placeholder="09XXXXXXXXX or +639XXXXXXXXX" aria-required="true" aria-invalid={Boolean(fieldError('phone_number', 'account'))} aria-describedby={fieldError('phone_number', 'account') ? 'rider-error-phone_number' : undefined} value={fields.phone_number} onBlur={() => markTouched('phone_number')} onChange={(event) => updateField('phone_number', event.target.value)} /></label>
                    {fieldError('phone_number', 'account') && <span className="field-error" id="rider-error-phone_number" role="alert">{fieldError('phone_number', 'account')}</span>}
                    <label>Email address<input data-rider-field="email" type="email" autoComplete="email" maxLength={255} aria-required="true" aria-invalid={Boolean(fieldError('email', 'account'))} aria-describedby={fieldError('email', 'account') ? 'rider-error-email' : undefined} value={fields.email} onBlur={() => markTouched('email')} onChange={(event) => updateField('email', event.target.value)} /></label>
                    {fieldError('email', 'account') && <span className="field-error" id="rider-error-email" role="alert">{fieldError('email', 'account')}</span>}
                    <label>Password<input data-rider-field="password" type="password" autoComplete="new-password" aria-required="true" aria-invalid={Boolean(fieldError('password', 'account'))} aria-describedby={fieldError('password', 'account') ? 'rider-error-password' : undefined} value={fields.password} onBlur={() => markTouched('password')} onChange={(event) => updateField('password', event.target.value)} /></label>
                    {fieldError('password', 'account') && <span className="field-error" id="rider-error-password" role="alert">{fieldError('password', 'account')}</span>}
                    <label>Confirm password<input data-rider-field="password_confirmation" type="password" autoComplete="new-password" aria-required="true" aria-invalid={Boolean(fieldError('password_confirmation', 'account'))} aria-describedby={fieldError('password_confirmation', 'account') ? 'rider-error-password_confirmation' : undefined} value={fields.password_confirmation} onBlur={() => markTouched('password_confirmation')} onChange={(event) => updateField('password_confirmation', event.target.value)} /></label>
                    {fieldError('password_confirmation', 'account') && <span className="field-error" id="rider-error-password_confirmation" role="alert">{fieldError('password_confirmation', 'account')}</span>}
                    <p className="rider-registration-note">Submitting these details saves an application draft, lets you sign back in to continue, and records the policy versions and acceptance times.</p>
                    {error && <p role="alert" className="rider-registration-error">{error}</p>}
                    <button type="submit" disabled={saving || stepTransitioning}>{saving ? 'Saving draft…' : 'Save draft and continue'}</button>
                </form>}
            {user?.role === 'RIDER' && application && ['DRAFT', 'MORE_INFORMATION_REQUIRED'].includes(application.status) && !reviewStep && <form className="rider-registration-form rider-vehicle-application-form" noValidate onSubmit={(event) => void reviewApplication(event)}>
                <h2 tabIndex={-1} data-rider-step-heading>{application.status === 'DRAFT' ? 'Vehicle and identity details' : 'Update requested information'}</h2>
                <p>Driver license and OR/CR documents support manual identity and vehicle review. Vehicle photos help admins check the registered vehicle. Only you and authorized admin reviewers can access these files.</p>
                <label>Full legal name<input data-rider-field="name" autoComplete="name" maxLength={120} aria-required="true" aria-invalid={Boolean(fieldError('name', 'vehicle'))} aria-describedby={fieldError('name', 'vehicle') ? 'rider-error-name' : undefined} value={fields.name} onBlur={() => markTouched('name')} onChange={(event) => updateField('name', event.target.value)} /></label>
                {fieldError('name', 'vehicle') && <span className="field-error" id="rider-error-name" role="alert">{fieldError('name', 'vehicle')}</span>}
                <label>Birthdate<input data-rider-field="date_of_birth" type="date" max={localToday()} aria-required="true" aria-invalid={Boolean(fieldError('date_of_birth', 'vehicle'))} aria-describedby={fieldError('date_of_birth', 'vehicle') ? 'rider-error-date_of_birth' : undefined} value={fields.date_of_birth} onBlur={() => markTouched('date_of_birth')} onChange={(event) => updateField('date_of_birth', event.target.value)} /></label>
                {fieldError('date_of_birth', 'vehicle') && <span className="field-error" id="rider-error-date_of_birth" role="alert">{fieldError('date_of_birth', 'vehicle')}</span>}
                <label>Residential address<textarea data-rider-field="residential_address" maxLength={1000} aria-required="true" aria-invalid={Boolean(fieldError('residential_address', 'vehicle'))} aria-describedby={fieldError('residential_address', 'vehicle') ? 'rider-error-residential_address' : undefined} value={fields.residential_address} onBlur={() => markTouched('residential_address')} onChange={(event) => updateField('residential_address', event.target.value)} /></label>
                {fieldError('residential_address', 'vehicle') && <span className="field-error" id="rider-error-residential_address" role="alert">{fieldError('residential_address', 'vehicle')}</span>}
                <label>Driver license number<input data-rider-field="license_number" autoComplete="off" maxLength={80} aria-required="true" aria-invalid={Boolean(fieldError('license_number', 'vehicle'))} aria-describedby={fieldError('license_number', 'vehicle') ? 'rider-error-license_number' : undefined} value={fields.license_number} onBlur={() => markTouched('license_number')} onChange={(event) => updateField('license_number', event.target.value)} /></label>
                {fieldError('license_number', 'vehicle') && <span className="field-error" id="rider-error-license_number" role="alert">{fieldError('license_number', 'vehicle')}</span>}
                <label>Driver license expiry<input data-rider-field="license_expires_on" type="date" aria-required="true" aria-invalid={Boolean(fieldError('license_expires_on', 'vehicle'))} aria-describedby={fieldError('license_expires_on', 'vehicle') ? 'rider-error-license_expires_on' : undefined} value={fields.license_expires_on} onBlur={() => markTouched('license_expires_on')} onChange={(event) => updateField('license_expires_on', event.target.value)} /></label>
                {fieldError('license_expires_on', 'vehicle') && <span className="field-error" id="rider-error-license_expires_on" role="alert">{fieldError('license_expires_on', 'vehicle')}</span>}
                <label>Driver license image or PDF<input data-rider-field="driver_license" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" aria-invalid={Boolean(fieldError('driver_license', 'vehicle'))} aria-describedby={fieldError('driver_license', 'vehicle') ? 'rider-error-driver_license' : undefined} onBlur={() => markTouched('driver_license')} onChange={(event) => void chooseFiles('driver_license', event.target.files, event.currentTarget)} /><small>Why required: manual identity and license review. JPG, PNG, WebP, or PDF, up to 10 MB.</small>{uploads.driver_license && <FilePreview files={[uploads.driver_license]} remove={() => setUploads((current) => ({ ...current, driver_license: null }))} />}</label>
                {fieldError('driver_license', 'vehicle') && <span className="field-error" id="rider-error-driver_license" role="alert">{fieldError('driver_license', 'vehicle')}</span>}
                <label>Vehicle registration certificate (OR/CR) expiry<input data-rider-field="vehicle_registration_expires_on" type="date" aria-required="true" aria-invalid={Boolean(fieldError('vehicle_registration_expires_on', 'vehicle'))} aria-describedby={fieldError('vehicle_registration_expires_on', 'vehicle') ? 'rider-error-vehicle_registration_expires_on' : undefined} value={fields.vehicle_registration_expires_on} onBlur={() => markTouched('vehicle_registration_expires_on')} onChange={(event) => updateField('vehicle_registration_expires_on', event.target.value)} /></label>
                {fieldError('vehicle_registration_expires_on', 'vehicle') && <span className="field-error" id="rider-error-vehicle_registration_expires_on" role="alert">{fieldError('vehicle_registration_expires_on', 'vehicle')}</span>}
                <label>OR/CR image or PDF<input data-rider-field="vehicle_registration" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" aria-invalid={Boolean(fieldError('vehicle_registration', 'vehicle'))} aria-describedby={fieldError('vehicle_registration', 'vehicle') ? 'rider-error-vehicle_registration' : undefined} onBlur={() => markTouched('vehicle_registration')} onChange={(event) => void chooseFiles('vehicle_registration', event.target.files, event.currentTarget)} /><small>Why required: verify current vehicle registration. JPG, PNG, WebP, or PDF, up to 10 MB.</small>{uploads.vehicle_registration && <FilePreview files={[uploads.vehicle_registration]} remove={() => setUploads((current) => ({ ...current, vehicle_registration: null }))} />}</label>
                {fieldError('vehicle_registration', 'vehicle') && <span className="field-error" id="rider-error-vehicle_registration" role="alert">{fieldError('vehicle_registration', 'vehicle')}</span>}
                <label>Plate number<input data-rider-field="plate_number" autoComplete="off" maxLength={16} aria-required="true" aria-invalid={Boolean(fieldError('plate_number', 'vehicle'))} aria-describedby={fieldError('plate_number', 'vehicle') ? 'rider-error-plate_number' : undefined} value={fields.plate_number} onBlur={() => markTouched('plate_number')} onChange={(event) => updateField('plate_number', event.target.value.toUpperCase())} /><small>Use 2–16 letters, numbers, spaces, or hyphens.</small></label>
                {fieldError('plate_number', 'vehicle') && <span className="field-error" id="rider-error-plate_number" role="alert">{fieldError('plate_number', 'vehicle')}</span>}
                <label>Vehicle type<select data-rider-field="vehicle_type" aria-required="true" aria-invalid={Boolean(fieldError('vehicle_type', 'vehicle'))} aria-describedby={fieldError('vehicle_type', 'vehicle') ? 'rider-error-vehicle_type' : undefined} value={fields.vehicle_type} onBlur={() => markTouched('vehicle_type')} onChange={(event) => updateField('vehicle_type', event.target.value)}><option value="">Choose vehicle type</option><option>Motorcycle</option><option>Tricycle</option><option>Car</option><option>Van</option><option>Pickup</option><option>Truck</option><option>Other</option></select></label>
                {fieldError('vehicle_type', 'vehicle') && <span className="field-error" id="rider-error-vehicle_type" role="alert">{fieldError('vehicle_type', 'vehicle')}</span>}
                <label>Make and model<input data-rider-field="vehicle_make_model" maxLength={120} aria-required="true" aria-invalid={Boolean(fieldError('vehicle_make_model', 'vehicle'))} aria-describedby={fieldError('vehicle_make_model', 'vehicle') ? 'rider-error-vehicle_make_model' : undefined} value={fields.vehicle_make_model} onBlur={() => markTouched('vehicle_make_model')} onChange={(event) => updateField('vehicle_make_model', event.target.value)} /></label>
                {fieldError('vehicle_make_model', 'vehicle') && <span className="field-error" id="rider-error-vehicle_make_model" role="alert">{fieldError('vehicle_make_model', 'vehicle')}</span>}
                <label>Vehicle color<input data-rider-field="vehicle_color" maxLength={60} aria-required="true" aria-invalid={Boolean(fieldError('vehicle_color', 'vehicle'))} aria-describedby={fieldError('vehicle_color', 'vehicle') ? 'rider-error-vehicle_color' : undefined} value={fields.vehicle_color} onBlur={() => markTouched('vehicle_color')} onChange={(event) => updateField('vehicle_color', event.target.value)} /></label>
                {fieldError('vehicle_color', 'vehicle') && <span className="field-error" id="rider-error-vehicle_color" role="alert">{fieldError('vehicle_color', 'vehicle')}</span>}
                <label>Vehicle photos<input data-rider-field="vehicle_photos" type="file" accept="image/jpeg,image/png,image/webp" multiple aria-invalid={Boolean(fieldError('vehicle_photos', 'vehicle'))} aria-describedby={fieldError('vehicle_photos', 'vehicle') ? 'rider-error-vehicle_photos' : undefined} onBlur={() => markTouched('vehicle_photos')} onChange={(event) => void chooseFiles('vehicle_photos', event.target.files, event.currentTarget)} /><small>Why required: admin visual check of the vehicle used for deliveries. 1–5 clear JPEG, PNG, or WebP photos, up to 10 MB each.</small><FilePreview files={uploads.vehicle_photos} remove={(index) => setUploads((current) => ({ ...current, vehicle_photos: current.vehicle_photos.filter((_, fileIndex) => fileIndex !== index) }))} /></label>
                {fieldError('vehicle_photos', 'vehicle') && <span className="field-error" id="rider-error-vehicle_photos" role="alert">{fieldError('vehicle_photos', 'vehicle')}</span>}
                <p className="eyebrow">Step 3 of 5</p>
                <p className="rider-registration-note">Files are encrypted at rest and visible only to you and authorized admin reviewers. No selfie, OCR, or face matching is used. Retention follows the published schedule.</p>
                {saveMessage && <p className="rider-registration-note" role="status" aria-live="polite">{saveMessage}</p>}
                {error && <p role="alert" className="rider-registration-error">{error}</p>}
                <div className="rider-registration-actions">
                    <button type="button" className="rider-registration-secondary-action" disabled={saving || stepTransitioning} onClick={() => void saveApplicationDraft()}>{saving ? 'Saving draft…' : 'Save draft'}</button>
                    <button type="submit" disabled={saving || stepTransitioning}>{saving ? 'Saving draft…' : 'Save and review application'}</button>
                </div>
            </form>}
            {user?.role === 'RIDER' && application && ['DRAFT', 'MORE_INFORMATION_REQUIRED'].includes(application.status) && reviewStep && <section className="rider-registration-review">
                <p className="eyebrow">Step 4 of 5</p><h2 tabIndex={-1} data-rider-step-heading>Review your application</h2>
                <dl>
                    <div><dt>Applicant</dt><dd>{fields.name} · {fields.date_of_birth}</dd></div>
                    <div><dt>Contact</dt><dd>{fields.email} · {fields.phone_number}</dd></div>
                    <div><dt>Address</dt><dd>{fields.residential_address}</dd></div>
                    <div><dt>License</dt><dd>{fields.license_number} · expires {fields.license_expires_on}</dd></div>
                    <div><dt>Vehicle</dt><dd>{fields.plate_number} · {fields.vehicle_type} · {fields.vehicle_make_model} · {fields.vehicle_color}</dd></div>
                    <div><dt>OR/CR expiry</dt><dd>{fields.vehicle_registration_expires_on}</dd></div>
                </dl>
                <ul>{[['Driver license', uploads.driver_license, 'DRIVER_LICENSE'], ['Vehicle registration', uploads.vehicle_registration, 'VEHICLE_REGISTRATION']].map(([label, file, type]) => <li key={String(label)}>{String(label)}: {file instanceof File ? file.name : reviewedApplication?.documents.find((document) => document.document_type === type)?.original_name ?? 'Missing'}</li>)}{uploads.vehicle_photos.length ? uploads.vehicle_photos.map((file, index) => <li key={`${file.name}-${index}`}>Vehicle photo: {file.name}</li>) : reviewedApplication?.documents.filter((document) => document.document_type === 'VEHICLE_PHOTO').map((document) => <li key={document.id}>Vehicle photo: {document.original_name}</li>)}</ul>
                {error && <p role="alert" className="rider-registration-error">{error}</p>}
                <div className="rider-registration-review-actions"><button type="button" disabled={saving || stepTransitioning} onClick={() => transitionStep(() => setReviewStep(false))}>Back to edit</button><button type="button" disabled={saving || stepTransitioning} onClick={() => void submitApplication()}>{saving ? 'Submitting…' : 'Submit application'}</button></div>
            </section>}
            </div>}
            {user?.role === 'RIDER' && application?.status === 'REJECTED' && <p className="rider-registration-note">Your rider delivery access remains disabled. Contact Farmgate support using the official contact listed in the published privacy notice.</p>}
            {user?.role === 'RIDER' && <button className="rider-registration-logout" type="button" onClick={onLogout ?? (() => { void api.post('/api/auth/logout').then(() => window.location.assign('/')); })}>Log out</button>}
        </>}
    </main>;
}
