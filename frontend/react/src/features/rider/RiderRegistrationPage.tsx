import React from 'react';
import api, { initializeCsrf } from '../../lib/api';
import { showSuccess } from '../../lib/alerts';
import type { User } from '../../shared/types';
import { RiderDashboard } from './RiderDashboard';

type Policy = {
    policy_version: string | null;
    effective_date: string | null;
    privacy_contact: string | null;
    documents: { privacy: string | null; terms: string | null; safety: string | null; draft_package: string };
    selfie_collection_enabled: boolean;
    registration_open: boolean;
    status_message: string | null;
};
type RiderDocument = { id: number; document_type: string; original_name: string; mime_type: string; size: number; view_url: string };
type ApplicationHistory = { id: number; from_status: string | null; to_status: string; action: string; reason: string | null; actor: string | null; created_at: string };
type Application = {
    id: number;
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
type Uploads = { driver_license: File | null; vehicle_registration: File | null; selfie: File | null; vehicle_photos: File[] };

const initialFields: Fields = {
    name: '', date_of_birth: '', residential_address: '', email: '', phone_number: '',
    password: '', password_confirmation: '', license_number: '', plate_number: '',
    vehicle_type: '', vehicle_make_model: '', vehicle_color: '', license_expires_on: '',
    vehicle_registration_expires_on: '',
};
const emptyUploads: Uploads = { driver_license: null, vehicle_registration: null, selfie: null, vehicle_photos: [] };
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const allowedExtensions = /\.(jpe?g|png|webp|pdf)$/i;
const allowedImages = new Set(['image/jpeg', 'image/png', 'image/webp']);

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

function ApplicantStatus({ application }: { application: Application }) {
    return <section className="rider-application-status" aria-labelledby="rider-application-status-title">
        <p className="eyebrow">Rider application · FG-RIDER-{String(application.id).padStart(6, '0')}</p>
        <h1 id="rider-application-status-title">{statusLabel(application.status)}</h1>
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
        {application.submitted_at && <p>Submitted {new Date(application.submitted_at).toLocaleString()}</p>}
        {!!application.documents.length && <div><h2>Submitted documents</h2><ul className="rider-applicant-documents">{application.documents.map((document) => <li key={document.id}><span>{statusLabel(document.document_type)} · {document.original_name}</span><a href={document.view_url} target="_blank" rel="noreferrer">View protected document</a></li>)}</ul><small>These private links expire after five minutes. Do not share them.</small></div>}
        <section><h2>Application history</h2><ol className="rider-application-history">{application.history.map((entry) => <li key={entry.id}><strong>{statusLabel(entry.to_status)}</strong><span>{entry.actor ?? 'Farmgate'} · {new Date(entry.created_at).toLocaleString()}</span>{entry.reason && <p>{entry.reason}</p>}</li>)}</ol></section>
        <p className="rider-registration-note">Accepted rider policy version {application.privacy_policy_version} on {new Date(application.privacy_accepted_at).toLocaleString()}.</p>
    </section>;
}

export function RiderRegistrationPage({ initialUser, onError, onLogout }: {
    initialUser?: User;
    onError?: (message: string) => void;
    onLogout?: () => void;
}) {
    const [user, setUser] = React.useState<User | null>(initialUser ?? null);
    const [policy, setPolicy] = React.useState<Policy | null>(null);
    const [application, setApplication] = React.useState<Application | null>(null);
    const [fields, setFields] = React.useState<Fields>(initialFields);
    const [uploads, setUploads] = React.useState<Uploads>(emptyUploads);
    const [consents, setConsents] = React.useState({ privacy: false, terms: false, safety: false });
    const [consentReady, setConsentReady] = React.useState(false);
    const [reviewStep, setReviewStep] = React.useState(false);
    const [loading, setLoading] = React.useState(true);
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState('');

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

    function updateField(key: keyof Fields, value: string) {
        setFields((current) => ({ ...current, [key]: value }));
    }

    async function createDraft(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError('');
        if (!policy?.registration_open) return;
        if (fields.password !== fields.password_confirmation) {
            setError('Passwords do not match.');
            return;
        }
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
            });
            setUser(response.data.user);
            setApplication(response.data.application);
            setFields((current) => ({ ...current, password: '', password_confirmation: '' }));
            showSuccess('Rider application draft created. Continue with vehicle and document details.');
        } catch (requestError: any) {
            const message = getRequestError(requestError, 'Your rider application draft could not be created.');
            setError(message);
            onError?.(message);
        } finally {
            setSaving(false);
        }
    }

    async function chooseFiles(field: keyof Uploads, fileList: FileList | null, input: HTMLInputElement) {
        const selected = Array.from(fileList ?? []);
        input.value = '';
        if (!selected.length) return;
        const isImageCollection = field === 'selfie' || field === 'vehicle_photos';
        const invalidType = selected.find((file) => {
            if (isImageCollection) return file.type ? !allowedImages.has(file.type) : !/\.(jpe?g|png|webp)$/i.test(file.name);
            return file.type ? !allowedTypes.has(file.type) : !allowedExtensions.test(file.name);
        });
        if (invalidType) {
            setError(isImageCollection ? 'Choose a JPEG, PNG, or WebP image.' : 'Choose a JPEG, PNG, WebP, or PDF file.');
            return;
        }
        if (selected.some((file) => file.size > 10 * 1024 * 1024)) {
            setError('Each file must be 10 MB or smaller.');
            return;
        }
        if (field === 'vehicle_photos' && selected.length + uploads.vehicle_photos.length > 5) {
            setError('Upload 1 to 5 clear vehicle photos.');
            return;
        }
        if (isImageCollection) {
            for (const file of selected) {
                if (!(await imageHasSufficientDetail(file))) {
                    setError('Use clear images with at least 360 pixels on the shortest side.');
                    return;
                }
            }
        }
        setError('');
        if (field === 'vehicle_photos') {
            setUploads((current) => ({ ...current, vehicle_photos: [...current.vehicle_photos, ...selected] }));
        } else {
            setUploads((current) => ({ ...current, [field]: selected[0] }));
        }
    }

    function reviewApplication(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError('');
        const hasDocument = (type: string) => application?.documents.some((document) => document.document_type === type) ?? false;
        if ((!uploads.driver_license && !hasDocument('DRIVER_LICENSE'))
            || (!uploads.vehicle_registration && !hasDocument('VEHICLE_REGISTRATION'))
            || (!uploads.selfie && !hasDocument('SELFIE'))
            || (!uploads.vehicle_photos.length && !hasDocument('VEHICLE_PHOTO'))) {
            setError('Upload a driver license, OR/CR, identity selfie, and at least one vehicle photo.');
            return;
        }
        setReviewStep(true);
        document.getElementById('rider-review-submission')?.focus();
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
        if (uploads.selfie) body.append('selfie', uploads.selfie);
        uploads.vehicle_photos.forEach((file) => body.append('vehicle_photos[]', file));
        try {
            await initializeCsrf();
            const response = await api.post<{ application: Application }>('/api/rider/application/submit', body);
            setApplication(response.data.application);
            setReviewStep(false);
            setUploads(emptyUploads);
            showSuccess('Rider application submitted. You can track its status here.');
        } catch (submitError: any) {
            const message = getRequestError(submitError, 'Your rider application could not be submitted. Your entries are still here; check the files and retry.');
            setError(message);
            onError?.(message);
        } finally {
            setSaving(false);
        }
    }

    if (user?.role === 'RIDER' && application?.status === 'APPROVED') {
        return <RiderDashboard user={user} onUserUpdated={setUser} onError={onError ?? (() => undefined)} onLogout={onLogout ?? (() => undefined)} />;
    }

    return <main className="rider-registration-shell">
        <header className="rider-registration-header"><a className="brand" href="/">FARM<span>GATE</span></a><a href="/">Back to Farmgate</a></header>
        {loading ? <p role="status">Loading rider registration…</p> : user && user.role !== 'RIDER' ? <section className="rider-registration-message"><h1>Rider account required</h1><p>Sign out of this account before continuing with rider registration.</p><a href="/">Return to Farmgate</a></section> : <>
            <section className="rider-registration-intro"><p className="eyebrow">Rider onboarding</p><h1>Rider registration</h1><p>Applications are reviewed by authorized Farmgate administrators. Only approved riders can receive delivery assignments.</p></section>
            {!user && !policy?.registration_open && <section className="rider-registration-message" role="status">
                <h2>Applications are not open yet</h2>
                <p>{policy?.status_message ?? 'Farmgate is preparing the rider policy package. No personal information is collected on this page until registration is enabled.'}</p>
                {policy?.documents.draft_package && <a href={policy.documents.draft_package} target="_blank" rel="noreferrer">View the rider policy package draft</a>}
                <p>The current policy package has no effective date. Registration stays disabled until the privacy, rider terms, safety, and retention policies are adopted and published.</p>
            </section>}
            {!user && policy?.registration_open && <>
                <section className="rider-registration-consent">
                    <h2>Privacy and rider agreements</h2>
                    <p>Read Farmgate’s published policies before entering personal information. Documents are used for rider onboarding, identity and vehicle review, safety, and delivery operations. Access is limited to you and authorized admin reviewers.</p>
                    <p>Documents are encrypted at rest and served through short-lived private links. The retention schedule is set by the adopted policy. Do not upload documents until you have read the notices.</p>
                    <div className="rider-policy-links">
                        {policy.documents.privacy && <a href={policy.documents.privacy} target="_blank" rel="noreferrer">Rider privacy notice</a>}
                        {policy.documents.terms && <a href={policy.documents.terms} target="_blank" rel="noreferrer">Rider terms</a>}
                        {policy.documents.safety && <a href={policy.documents.safety} target="_blank" rel="noreferrer">Rider safety policy</a>}
                    </div>
                    <strong>Version {policy.policy_version} · Effective {policy.effective_date} · Privacy contact: {policy.privacy_contact}</strong>
                    <label><input type="checkbox" checked={consents.privacy} onChange={(event) => setConsents((current) => ({ ...current, privacy: event.target.checked }))} /> I have read and agree to the privacy notice.</label>
                    <label><input type="checkbox" checked={consents.terms} onChange={(event) => setConsents((current) => ({ ...current, terms: event.target.checked }))} /> I agree to the rider terms.</label>
                    <label><input type="checkbox" checked={consents.safety} onChange={(event) => setConsents((current) => ({ ...current, safety: event.target.checked }))} /> I agree to follow the rider safety policy.</label>
                    <button type="button" onClick={() => setConsentReady((ready) => !ready)} disabled={!consents.privacy || !consents.terms || !consents.safety}>
                        {consentReady ? 'Edit agreement selections' : 'Continue after agreeing'}
                    </button>
                </section>
                {consentReady && <form className="rider-registration-form" onSubmit={(event) => void createDraft(event)}>
                    <h2>Personal and account details</h2>
                    <label>Full legal name<input autoComplete="name" minLength={2} maxLength={120} required value={fields.name} onChange={(event) => updateField('name', event.target.value)} /></label>
                    <label>Birthdate<input type="date" autoComplete="bday" max={new Date().toISOString().slice(0, 10)} required value={fields.date_of_birth} onChange={(event) => updateField('date_of_birth', event.target.value)} /></label>
                    <label>Residential address<textarea autoComplete="street-address" minLength={8} maxLength={1000} required value={fields.residential_address} onChange={(event) => updateField('residential_address', event.target.value)} /></label>
                    <p className="rider-registration-note">Enter your address manually. ID-reading/OCR is not available or approved. Your ID image is requested separately for manual admin review.</p>
                    <label>Phone number<input type="tel" autoComplete="tel" inputMode="tel" pattern="(09[0-9]{9}|\\+639[0-9]{9})" placeholder="09XXXXXXXXX or +639XXXXXXXXX" required value={fields.phone_number} onChange={(event) => updateField('phone_number', event.target.value)} /></label>
                    <label>Email address<input type="email" autoComplete="email" maxLength={255} required value={fields.email} onChange={(event) => updateField('email', event.target.value)} /></label>
                    <label>Password<input type="password" autoComplete="new-password" minLength={8} required value={fields.password} onChange={(event) => updateField('password', event.target.value)} /></label>
                    <label>Confirm password<input type="password" autoComplete="new-password" minLength={8} required value={fields.password_confirmation} onChange={(event) => updateField('password_confirmation', event.target.value)} /></label>
                    <p className="rider-registration-note">Submitting these details saves an application draft, lets you sign back in to continue, and records the policy versions and acceptance times.</p>
                    {error && <p role="alert" className="rider-registration-error">{error}</p>}
                    <button type="submit" disabled={saving}>{saving ? 'Saving draft…' : 'Save draft and continue'}</button>
                </form>}
            </>}
            {user?.role === 'RIDER' && !application && <section className="rider-registration-message" role="alert"><h2>No application record found</h2><p>Your rider account does not have an onboarding record. Delivery features remain unavailable. Contact Farmgate support for assistance.</p></section>}
            {user?.role === 'RIDER' && application && <ApplicantStatus application={application} />}
            {user?.role === 'RIDER' && application && ['DRAFT', 'MORE_INFORMATION_REQUIRED'].includes(application.status) && !reviewStep && <form className="rider-registration-form rider-vehicle-application-form" onSubmit={reviewApplication}>
                <h2>{application.status === 'DRAFT' ? 'Vehicle and identity details' : 'Update requested information'}</h2>
                <p>Driver license and OR/CR documents support manual identity and vehicle review. Vehicle photos help admins check the registered vehicle. Only you and authorized admin reviewers can access these files.</p>
                <label>Full legal name<input autoComplete="name" minLength={2} maxLength={120} required value={fields.name} onChange={(event) => updateField('name', event.target.value)} /></label>
                <label>Birthdate<input type="date" max={new Date().toISOString().slice(0, 10)} required value={fields.date_of_birth} onChange={(event) => updateField('date_of_birth', event.target.value)} /></label>
                <label>Residential address<textarea minLength={8} maxLength={1000} required value={fields.residential_address} onChange={(event) => updateField('residential_address', event.target.value)} /></label>
                <label>Driver license number<input autoComplete="off" minLength={4} maxLength={80} required value={fields.license_number} onChange={(event) => updateField('license_number', event.target.value)} /></label>
                <label>Driver license expiry<input type="date" min={new Date().toISOString().slice(0, 10)} required value={fields.license_expires_on} onChange={(event) => updateField('license_expires_on', event.target.value)} /></label>
                <label>Driver license image or PDF<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => void chooseFiles('driver_license', event.target.files, event.currentTarget)} /><small>Why required: manual identity and license review. JPG, PNG, WebP, or PDF, up to 10 MB.</small>{uploads.driver_license && <FilePreview files={[uploads.driver_license]} remove={() => setUploads((current) => ({ ...current, driver_license: null }))} />}</label>
                <label>Vehicle registration certificate (OR/CR) expiry<input type="date" min={new Date().toISOString().slice(0, 10)} required value={fields.vehicle_registration_expires_on} onChange={(event) => updateField('vehicle_registration_expires_on', event.target.value)} /></label>
                <label>OR/CR image or PDF<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => void chooseFiles('vehicle_registration', event.target.files, event.currentTarget)} /><small>Why required: verify current vehicle registration. JPG, PNG, WebP, or PDF, up to 10 MB.</small>{uploads.vehicle_registration && <FilePreview files={[uploads.vehicle_registration]} remove={() => setUploads((current) => ({ ...current, vehicle_registration: null }))} />}</label>
                <label>Plate number<input autoComplete="off" pattern="[A-Za-z0-9][A-Za-z0-9 -]{1,15}" maxLength={16} required value={fields.plate_number} onChange={(event) => updateField('plate_number', event.target.value.toUpperCase())} /><small>Use 2–16 letters, numbers, spaces, or hyphens.</small></label>
                <label>Vehicle type<select required value={fields.vehicle_type} onChange={(event) => updateField('vehicle_type', event.target.value)}><option value="">Choose vehicle type</option><option>Motorcycle</option><option>Tricycle</option><option>Car</option><option>Van</option><option>Pickup</option><option>Truck</option><option>Other</option></select></label>
                <label>Make and model<input maxLength={120} required value={fields.vehicle_make_model} onChange={(event) => updateField('vehicle_make_model', event.target.value)} /></label>
                <label>Vehicle color<input maxLength={60} required value={fields.vehicle_color} onChange={(event) => updateField('vehicle_color', event.target.value)} /></label>
                <label>Vehicle photos<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => void chooseFiles('vehicle_photos', event.target.files, event.currentTarget)} /><small>Why required: admin visual check of the vehicle used for deliveries. 1–5 clear JPEG, PNG, or WebP photos, up to 10 MB each.</small><FilePreview files={uploads.vehicle_photos} remove={(index) => setUploads((current) => ({ ...current, vehicle_photos: current.vehicle_photos.filter((_, fileIndex) => fileIndex !== index) }))} /></label>
                {policy?.selfie_collection_enabled && <label>Identity selfie<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void chooseFiles('selfie', event.target.files, event.currentTarget)} /><small>Why required: applicant identity review by authorized admins only. JPEG, PNG, or WebP, up to 10 MB. Do not use a group photo.</small>{uploads.selfie && <FilePreview files={[uploads.selfie]} remove={() => setUploads((current) => ({ ...current, selfie: null }))} />}</label>}
                <p className="rider-registration-note">Files are encrypted at rest and not visible to buyers or sellers. Their retention schedule remains governed by the published rider policy.</p>
                {error && <p role="alert" className="rider-registration-error">{error}</p>}
                <button type="submit">Review application</button>
            </form>}
            {user?.role === 'RIDER' && application && ['DRAFT', 'MORE_INFORMATION_REQUIRED'].includes(application.status) && reviewStep && <section id="rider-review-submission" className="rider-registration-review" tabIndex={-1}>
                <h2>Review your application</h2>
                <dl>
                    <div><dt>Applicant</dt><dd>{fields.name} · {fields.date_of_birth}</dd></div>
                    <div><dt>Contact</dt><dd>{fields.email} · {fields.phone_number}</dd></div>
                    <div><dt>Address</dt><dd>{fields.residential_address}</dd></div>
                    <div><dt>License</dt><dd>{fields.license_number} · expires {fields.license_expires_on}</dd></div>
                    <div><dt>Vehicle</dt><dd>{fields.plate_number} · {fields.vehicle_type} · {fields.vehicle_make_model} · {fields.vehicle_color}</dd></div>
                    <div><dt>OR/CR expiry</dt><dd>{fields.vehicle_registration_expires_on}</dd></div>
                </dl>
                <ul>{[['Driver license', uploads.driver_license], ['Vehicle registration', uploads.vehicle_registration], ['Identity selfie', uploads.selfie]].map(([label, file]) => <li key={String(label)}>{String(label)}: {file instanceof File ? file.name : application.documents.find((document) => document.document_type === (label === 'Driver license' ? 'DRIVER_LICENSE' : label === 'Vehicle registration' ? 'VEHICLE_REGISTRATION' : 'SELFIE'))?.original_name ?? 'Missing'}</li>)}{uploads.vehicle_photos.map((file, index) => <li key={`${file.name}-${index}`}>Vehicle photo: {file.name}</li>)}</ul>
                {error && <p role="alert" className="rider-registration-error">{error}</p>}
                <div className="rider-registration-review-actions"><button type="button" disabled={saving} onClick={() => setReviewStep(false)}>Back to edit</button><button type="button" disabled={saving} onClick={() => void submitApplication()}>{saving ? 'Submitting…' : 'Submit application'}</button></div>
            </section>}
            {user?.role === 'RIDER' && application?.status === 'REJECTED' && <p className="rider-registration-note">Your rider delivery access remains disabled. Contact Farmgate support using the official contact listed in the published privacy notice.</p>}
            {user?.role === 'RIDER' && <button className="rider-registration-logout" type="button" onClick={onLogout ?? (() => { void api.post('/api/auth/logout').then(() => window.location.assign('/')); })}>Log out</button>}
        </>}
    </main>;
}
