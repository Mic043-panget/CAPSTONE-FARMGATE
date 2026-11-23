import React from 'react';
import { ViewDetailsAction } from '../../shared/components/Button';
import api, { initializeCsrf } from '../../lib/api';
import { LoadingSkeleton } from '../../shared/components/LoadingSkeleton';
import { Pagination } from '../../shared/components/Pagination';
import { TabNav } from '../../shared/components/TabNav';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { confirmAction, showSuccess } from '../../lib/alerts';
import { FarmgateDetailDialog } from '../shared/FarmgateDetailDialog';

type RiderDocument = {
    id: number;
    document_type: string;
    original_name: string;
    mime_type: string;
    size: number;
    view_url: string;
};
type History = {
    id: number;
    from_status: string | null;
    to_status: string;
    action: string;
    reason: string | null;
    actor?: string | null;
    created_at: string;
};
type Application = {
    id: number;
    application_reference: string;
    status: string;
    name: string;
    email: string;
    phone_number?: string;
    date_of_birth?: string;
    residential_address?: string;
    license_number?: string | null;
    plate_number?: string | null;
    vehicle_type?: string | null;
    vehicle_make_model?: string | null;
    vehicle_color?: string | null;
    license_expires_on?: string | null;
    vehicle_registration_expires_on?: string | null;
    decision_reason?: string | null;
    submitted_at: string | null;
    privacy_policy_version?: string;
    privacy_accepted_at?: string;
    terms_version?: string;
    terms_accepted_at?: string;
    safety_policy_version?: string;
    safety_policy_accepted_at?: string;
    retention_policy_version?: string | null;
    retention_policy_accepted_at?: string | null;
    optional_updates_consent?: boolean;
    optional_updates_consented_at?: string | null;
    documents?: RiderDocument[];
    history?: History[];
};
type VehicleChange = {
    id: number;
    vehicle_reference: string;
    user: { id: number; name: string; email: string; phone_number?: string };
    plate_number: string;
    status?: string;
    vehicle_type?: string;
    vehicle_make_model?: string;
    vehicle_color?: string;
    license_expires_on?: string;
    vehicle_registration_expires_on?: string;
    documents?: RiderDocument[];
    created_at: string;
    decision_reason?: string | null;
    reviewed_at?: string | null;
    reviewer?: { name: string } | null;
    audit_history?: { id: number; action: string; description?: string | null; created_at: string; actor?: { name: string; role?: string } | null }[];
};

const statuses = [
    { value: '', label: 'All statuses' },
    { value: 'DRAFT', label: 'Draft' },
    { value: 'SUBMITTED', label: 'Submitted' },
    { value: 'UNDER_REVIEW', label: 'Under Review' },
    { value: 'MORE_INFORMATION_REQUIRED', label: 'More info required' },
    { value: 'APPROVED', label: 'Approved' },
    { value: 'REJECTED', label: 'Rejected' },
];

function documentLabel(value: string): string {
    return value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusTone(value: string): string {
    return value.toLowerCase().replaceAll('_', '-');
}

function RiderStatusBadge({ status }: { status: string }) {
    return <span className={`rider-review-status rider-review-status--${statusTone(status)}`}>{documentLabel(status)}</span>;
}

function RiderFieldIcon({ type }: { type: 'person' | 'email' | 'date' | 'plate' }) {
    if (type === 'person') return <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>;
    if (type === 'email') return <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></svg>;
    if (type === 'date') return <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 10h18" /></svg>;
    return <svg viewBox="0 0 24 24"><path d="M4 7h16l1 12H3z" /><path d="M8 7V5a4 4 0 0 1 8 0v2m-8 5h8" /></svg>;
}

function DocumentList({ documents, onDelete }: { documents: RiderDocument[]; onDelete?: (id: number) => void }) {
    return <div className="rider-review-documents">{documents.map((document) => <article key={document.id}>
        <div><strong>{documentLabel(document.document_type)}</strong><small>{document.original_name} · {(document.size / 1024 / 1024).toFixed(1)} MB</small></div>
        <a href={document.view_url} target="_blank" rel="noreferrer">View (expires in 5 minutes)</a>
        {onDelete && <button type="button" className="seller-text-action" onClick={() => onDelete(document.id)}>Delete document</button>}
    </article>)}</div>;
}

export function RiderApplicationQueue({ onError, initialApplicationId, onInitialApplicationHandled, initialVehicleChangeId, onInitialVehicleChangeHandled }: {
    onError: (message: string) => void;
    initialApplicationId?: number;
    onInitialApplicationHandled?: () => void;
    initialVehicleChangeId?: number;
    onInitialVehicleChangeHandled?: () => void;
}) {
    const [tab, setTab] = React.useState<'applications' | 'vehicles'>('applications');
    const [status, setStatus] = React.useState('');
    const [search, setSearch] = React.useState('');
    const [vehicleSearch, setVehicleSearch] = React.useState('');
    const [vehicleStatus, setVehicleStatus] = React.useState('PENDING');
    const [sort, setSort] = React.useState<'newest' | 'oldest'>('newest');
    const [filtersOpen, setFiltersOpen] = React.useState(false);
    const [page, setPage] = React.useState(1);
    const [applications, setApplications] = React.useState<Application[]>([]);
    const [vehicleChanges, setVehicleChanges] = React.useState<VehicleChange[]>([]);
    const [total, setTotal] = React.useState(0);
    const [reasons, setReasons] = React.useState<Record<string, string>>({});
    const [busy, setBusy] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [loadError, setLoadError] = React.useState('');
    const [selectedApplication, setSelectedApplication] = React.useState<Application | null>(null);
    const [selectedVehicle, setSelectedVehicle] = React.useState<VehicleChange | null>(null);
    const debouncedSearch = useDebouncedValue(search);
    const debouncedVehicleSearch = useDebouncedValue(vehicleSearch);
    const requestId = React.useRef(0);

    const load = React.useCallback(async () => {
        const current = ++requestId.current;
        setLoading(true);
        setLoadError('');
        try {
            if (tab === 'applications') {
                const response = await api.get<{ applications: { data: Application[]; total: number } }>('/api/admin/rider-applications', {
                    params: { status: status || undefined, search: debouncedSearch || undefined, sort, page },
                });
                if (current !== requestId.current) return;
                setApplications(response.data.applications.data);
                setTotal(response.data.applications.total);
            } else {
                const response = await api.get<{ vehicle_changes: { data: VehicleChange[]; total: number } }>('/api/admin/rider-vehicle-changes', { params: { search: debouncedVehicleSearch || undefined, status: vehicleStatus || undefined, sort, page } });
                if (current !== requestId.current) return;
                setVehicleChanges(response.data.vehicle_changes.data);
                setTotal(response.data.vehicle_changes.total);
            }
        } catch (requestError: any) {
            if (current === requestId.current) {
                const message = requestError.userMessage ?? requestError.response?.data?.message ?? 'Rider records could not be loaded.';
                setLoadError(message);
                onError(message);
            }
        } finally {
            if (current === requestId.current) setLoading(false);
        }
    }, [debouncedSearch, debouncedVehicleSearch, onError, page, sort, status, tab, vehicleStatus]);

    React.useEffect(() => {
        void load();
        return () => { requestId.current += 1; };
    }, [load]);

    async function decide(id: number, decision: string, vehicle = false) {
        const reason = reasons[`${vehicle ? 'vehicle-' : ''}${id}`]?.trim();
        if (['REJECTED', 'MORE_INFORMATION_REQUIRED'].includes(decision) && !reason) {
            onError('Enter the reason before rejecting or requesting more information.');
            return;
        }
        setBusy(`${vehicle ? 'vehicle-' : ''}${id}`);
        try {
            await initializeCsrf();
            await api.patch(`/api/admin/${vehicle ? 'rider-vehicle-changes' : 'rider-applications'}/${id}`, { status: decision, reason: reason || undefined });
            showSuccess(vehicle ? 'Vehicle update decision recorded.' : 'Rider application decision recorded.');
            setReasons((current) => ({ ...current, [`${vehicle ? 'vehicle-' : ''}${id}`]: '' }));
            if (vehicle) setSelectedVehicle(null);
            else setSelectedApplication(null);
            await load();
        } catch (requestError: any) {
            onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'The rider review decision could not be saved.');
        } finally {
            setBusy(null);
        }
    }

    async function deleteDocument(documentId: number) {
        if (!await confirmAction({
            title: 'Delete this protected rider document?',
            text: 'Deletion is recorded in the application history.',
            confirmText: 'Delete document',
            danger: true,
        })) return;
        try {
            await initializeCsrf();
            await api.delete(`/api/admin/rider-documents/${documentId}`);
            showSuccess('Rider document deleted.');
            setSelectedApplication((current) => current ? { ...current, documents: current.documents?.filter((document) => document.id !== documentId) } : current);
            setSelectedVehicle((current) => current ? { ...current, documents: current.documents?.filter((document) => document.id !== documentId) } : current);
            await load();
        } catch (requestError: any) {
            onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'The document could not be deleted.');
        }
    }

    async function openApplication(id: number) {
        try {
            const response = await api.get<{ application: Application }>(`/api/admin/rider-applications/${id}`);
            setSelectedApplication(response.data.application);
        } catch (requestError: any) {
            onError(requestError.userMessage ?? 'The protected rider application details could not be loaded.');
        }
    }

    async function openVehicle(id: number) {
        try {
            const response = await api.get<{ vehicle_change: VehicleChange }>(`/api/admin/rider-vehicle-changes/${id}`);
            setSelectedVehicle(response.data.vehicle_change);
        } catch (requestError: any) {
            onError(requestError.userMessage ?? 'The protected vehicle update details could not be loaded.');
        }
    }

    React.useEffect(() => {
        if (initialApplicationId) {
            setTab('applications');
            onInitialApplicationHandled?.();
            void openApplication(initialApplicationId);
        }
    }, [initialApplicationId, onInitialApplicationHandled]);

    React.useEffect(() => {
        if (initialVehicleChangeId) {
            setTab('vehicles');
            onInitialVehicleChangeHandled?.();
            void openVehicle(initialVehicleChangeId);
        }
    }, [initialVehicleChangeId, onInitialVehicleChangeHandled]);

    const showingStart = total === 0 ? 0 : (page - 1) * 15 + 1;
    const showingEnd = Math.min(page * 15, total);
    const vehicleStatuses = [
        { value: '', label: 'All statuses' },
        { value: 'PENDING', label: 'Pending' },
        { value: 'APPROVED', label: 'Approved' },
        { value: 'REJECTED', label: 'Rejected' },
        { value: 'MORE_INFORMATION_REQUIRED', label: 'More info required' },
    ];
    const applicationDetailsButton = (application: Application) => <ViewDetailsAction
        className="rider-view-details"
        contextLabel={`rider application ${application.application_reference}`}
        onClick={() => void openApplication(application.id)}
    />;
    const vehicleDetailsButton = (change: VehicleChange) => <ViewDetailsAction
        className="rider-view-details"
        contextLabel={`vehicle update ${change.vehicle_reference}`}
        onClick={() => void openVehicle(change.id)}
    />;

    return <section className="rider-review-queue" aria-labelledby="rider-review-title">
        <header className="rider-review-heading">
            <div><p className="eyebrow">Restricted access · Admin reviewers only</p><h2 id="rider-review-title">Rider applications &amp; vehicles</h2></div>
            <button type="button" className="rider-review-refresh" onClick={() => void load()} disabled={loading}>Refresh</button>
        </header>
        <div className="rider-review-tabs" role="tablist" aria-label="Rider review queue">
            <button type="button" role="tab" aria-selected={tab === 'applications'} onClick={() => { setTab('applications'); setPage(1); setFiltersOpen(false); }}>Applications</button>
            <button type="button" role="tab" aria-selected={tab === 'vehicles'} onClick={() => { setTab('vehicles'); setPage(1); setFiltersOpen(false); }}>Vehicle updates</button>
        </div>
        {tab === 'applications' && <>
            <div className="rider-review-toolbar">
                <label className="rider-review-search"><span>Search applications</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Application reference, name, or email" /></label>
                <div className="rider-review-toolbar-controls">
                    <label className="rider-review-sort"><span>Sort by</span><select value={sort} onChange={(event) => { setSort(event.target.value as 'newest' | 'oldest'); setPage(1); }}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
                    <button className="rider-review-filter-toggle" type="button" aria-expanded={filtersOpen} aria-controls="rider-application-filters" onClick={() => setFiltersOpen((open) => !open)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16l-6.5 7.5v5L10 19v-6.5z" /></svg><span>Filter</span></button>
                </div>
            </div>
            <fieldset id="rider-application-filters" className={`rider-review-filter-group${filtersOpen ? ' is-open' : ''}`}>
                <legend>Application status</legend>
                <TabNav className="rider-review-status-tabs" label="Application status" value={status} onChange={(value) => { setStatus(value); setPage(1); }} options={statuses} />
            </fieldset>
            {loading ? <LoadingSkeleton variant="table" count={4} columns={6} label="Loading rider applications" />
                : loadError ? <p className="rider-review-state rider-review-error" role="alert">{loadError}<button type="button" onClick={() => void load()}>Try again</button></p>
                    : applications.length ? <div className="rider-review-table-wrap">
                        <table className="rider-review-table rider-review-desktop-table">
                            <thead><tr><th>Application reference</th><th>Applicant</th><th>Email</th><th>Status</th><th>Submitted</th><th>Details</th></tr></thead>
                            <tbody>{applications.map((application) => <tr key={application.id}>
                                <td><strong>{application.application_reference}</strong></td>
                                <td>{application.name}</td>
                                <td>{application.email}</td>
                                <td><RiderStatusBadge status={application.status} /></td>
                                <td>{application.submitted_at ? <time dateTime={application.submitted_at}>{new Date(application.submitted_at).toLocaleString()}</time> : 'Draft'}</td>
                                <td>{applicationDetailsButton(application)}</td>
                            </tr>)}</tbody>
                        </table>
                        <div className="rider-review-mobile-cards">
                            {applications.map((application) => <article className="rider-review-mobile-card" key={application.id}>
                                <details open>
                                    <summary><span><strong>{application.application_reference}</strong><small><RiderFieldIcon type="person" />{application.name}</small></span><RiderStatusBadge status={application.status} /></summary>
                                    <dl><div><dt><RiderFieldIcon type="email" />Email</dt><dd>{application.email}</dd></div><div><dt><RiderFieldIcon type="date" />Submitted</dt><dd>{application.submitted_at ? <time dateTime={application.submitted_at}>{new Date(application.submitted_at).toLocaleString()}</time> : 'Draft'}</dd></div></dl>
                                </details>
                                {applicationDetailsButton(application)}
                            </article>)}
                        </div>
                    </div>
                        : <p className="rider-review-state">No rider applications match this filter.</p>}
            {!loading && !loadError && <footer className="rider-review-footer"><p>Showing {showingStart}–{showingEnd} of {total.toLocaleString()} applications</p><Pagination page={page} lastPage={Math.max(1, Math.ceil(total / 15))} onChange={setPage} label="Rider application pages" /></footer>}
        </>}
        {tab === 'vehicles' && <>
            <div className="rider-review-toolbar">
                <label className="rider-review-search"><span>Search vehicle updates</span><input value={vehicleSearch} onChange={(event) => { setVehicleSearch(event.target.value); setPage(1); }} placeholder="Reference, rider, email, or plate" /></label>
                <div className="rider-review-toolbar-controls">
                    <label className="rider-review-sort"><span>Sort by</span><select value={sort} onChange={(event) => { setSort(event.target.value as 'newest' | 'oldest'); setPage(1); }}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
                    <button className="rider-review-filter-toggle" type="button" aria-expanded={filtersOpen} aria-controls="rider-vehicle-filters" onClick={() => setFiltersOpen((open) => !open)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16l-6.5 7.5v5L10 19v-6.5z" /></svg><span>Filter</span></button>
                </div>
            </div>
            <fieldset id="rider-vehicle-filters" className={`rider-review-filter-group${filtersOpen ? ' is-open' : ''}`}>
                <legend>Vehicle update status</legend>
                <TabNav className="rider-review-status-tabs" label="Vehicle update status" value={vehicleStatus} onChange={(value) => { setVehicleStatus(value); setPage(1); }} options={vehicleStatuses} />
            </fieldset>
            {loading ? <LoadingSkeleton variant="table" count={4} columns={7} label="Loading vehicle updates" />
                : loadError ? <p className="rider-review-state rider-review-error" role="alert">{loadError}<button type="button" onClick={() => void load()}>Try again</button></p>
                    : vehicleChanges.length ? <div className="rider-review-table-wrap">
                        <table className="rider-review-table rider-review-desktop-table">
                            <thead><tr><th>Vehicle update reference</th><th>Rider</th><th>Email</th><th>Plate number</th><th>Status</th><th>Submitted</th><th>Details</th></tr></thead>
                            <tbody>{vehicleChanges.map((change) => <tr key={change.id}>
                                <td><strong>{change.vehicle_reference}</strong></td>
                                <td>{change.user.name}</td>
                                <td>{change.user.email}</td>
                                <td>{change.plate_number}</td>
                                <td><RiderStatusBadge status={change.status ?? 'PENDING'} /></td>
                                <td><time dateTime={change.created_at}>{new Date(change.created_at).toLocaleString()}</time></td>
                                <td>{vehicleDetailsButton(change)}</td>
                            </tr>)}</tbody>
                        </table>
                        <div className="rider-review-mobile-cards">
                            {vehicleChanges.map((change) => <article className="rider-review-mobile-card" key={change.id}>
                                <details open>
                                    <summary><span><strong>{change.vehicle_reference}</strong><small><RiderFieldIcon type="person" />{change.user.name}</small></span><RiderStatusBadge status={change.status ?? 'PENDING'} /></summary>
                                    <dl><div><dt><RiderFieldIcon type="email" />Email</dt><dd>{change.user.email}</dd></div><div><dt><RiderFieldIcon type="plate" />Plate number</dt><dd>{change.plate_number}</dd></div><div><dt><RiderFieldIcon type="date" />Submitted</dt><dd><time dateTime={change.created_at}>{new Date(change.created_at).toLocaleString()}</time></dd></div></dl>
                                </details>
                                {vehicleDetailsButton(change)}
                            </article>)}
                        </div>
                    </div>
                        : <p className="rider-review-state">No vehicle updates match this search.</p>}
            {!loading && !loadError && <footer className="rider-review-footer"><p>Showing {showingStart}–{showingEnd} of {total.toLocaleString()} vehicle updates</p><Pagination page={page} lastPage={Math.max(1, Math.ceil(total / 15))} onChange={setPage} label="Vehicle update pages" /></footer>}
        </>}
        {selectedApplication && <FarmgateDetailDialog
            eyebrow="Restricted · Authorized admin reviewers"
            title={`${selectedApplication.name} · ${selectedApplication.application_reference}`}
            onClose={() => setSelectedApplication(null)}
            className="audit-modal rider-application-detail"
        >
            <section className="rider-detail-section"><h3>Applicant information</h3><dl><div><dt>Status</dt><dd><RiderStatusBadge status={selectedApplication.status} /></dd></div><div><dt>Email / phone</dt><dd>{selectedApplication.email} · {selectedApplication.phone_number ?? '-'}</dd></div><div><dt>Birthdate</dt><dd>{selectedApplication.date_of_birth ?? '-'}</dd></div><div><dt>Residential address</dt><dd>{selectedApplication.residential_address ?? '-'}</dd></div></dl></section>
            <section className="rider-detail-section"><h3>Vehicle information</h3><dl><div><dt>License</dt><dd>{selectedApplication.license_number ?? '-'} · expires {selectedApplication.license_expires_on ?? '-'}</dd></div><div><dt>Vehicle</dt><dd>{[selectedApplication.plate_number, selectedApplication.vehicle_type, selectedApplication.vehicle_make_model, selectedApplication.vehicle_color].filter(Boolean).join(' · ') || '-'}</dd></div><div><dt>OR/CR expiry</dt><dd>{selectedApplication.vehicle_registration_expires_on ?? '-'}</dd></div></dl></section>
            <section className="rider-review-acknowledgments" aria-label="Policy acknowledgments">
                <h3>Policy acknowledgments</h3>
                <ul>
                    <li>Privacy: {selectedApplication.privacy_policy_version ?? 'legacy'} · {selectedApplication.privacy_accepted_at ? new Date(selectedApplication.privacy_accepted_at).toLocaleString() : 'timestamp unavailable'}</li>
                    <li>Terms: {selectedApplication.terms_version ?? 'legacy'} · {selectedApplication.terms_accepted_at ? new Date(selectedApplication.terms_accepted_at).toLocaleString() : 'timestamp unavailable'}</li>
                    <li>Safety: {selectedApplication.safety_policy_version ?? 'legacy'} · {selectedApplication.safety_policy_accepted_at ? new Date(selectedApplication.safety_policy_accepted_at).toLocaleString() : 'timestamp unavailable'}</li>
                    <li>Retention: {selectedApplication.retention_policy_version ?? 'legacy'} · {selectedApplication.retention_policy_accepted_at ? new Date(selectedApplication.retention_policy_accepted_at).toLocaleString() : 'timestamp unavailable'}</li>
                    <li>Optional rider updates consent: {selectedApplication.optional_updates_consent ? `Yes · ${selectedApplication.optional_updates_consented_at ? new Date(selectedApplication.optional_updates_consented_at).toLocaleString() : 'timestamp unavailable'}` : 'No'}</li>
                </ul>
            </section>
            <section className="rider-detail-section"><h3>Submitted documents</h3><p className="rider-review-privacy-note">Sensitive information and private documents are shown only to authorized admin reviewers. Document links expire after five minutes.</p><DocumentList documents={selectedApplication.documents ?? []} onDelete={(id) => void deleteDocument(id)} /></section>
            {selectedApplication.decision_reason && <p className="rider-review-reason">Previous decision: {selectedApplication.decision_reason}</p>}
            <section className="rider-detail-section rider-detail-history"><h3>Review history</h3><ol className="rider-review-history">{(selectedApplication.history ?? []).map((entry) => <li key={entry.id}><strong>{documentLabel(entry.to_status)}</strong><span>{entry.actor ?? 'System'} · {new Date(entry.created_at).toLocaleString()}</span>{entry.reason && <p>{entry.reason}</p>}</li>)}</ol></section>
            {!['APPROVED', 'REJECTED'].includes(selectedApplication.status) && <section className="rider-detail-section"><h3>Review actions</h3><div className="rider-review-actions"><label>Reason for rejection or more information<textarea value={reasons[String(selectedApplication.id)] ?? ''} onChange={(event) => setReasons((current) => ({ ...current, [selectedApplication.id]: event.target.value }))} maxLength={2000} /></label>{selectedApplication.status === 'SUBMITTED' && <button type="button" disabled={busy !== null} onClick={() => void decide(selectedApplication.id, 'UNDER_REVIEW')}>Mark under review</button>}{selectedApplication.status !== 'DRAFT' && <><button type="button" disabled={busy !== null} onClick={() => void decide(selectedApplication.id, 'MORE_INFORMATION_REQUIRED')}>Request information</button><button type="button" disabled={busy !== null} onClick={() => void decide(selectedApplication.id, 'APPROVED')}>Approve rider</button><button type="button" className="danger" disabled={busy !== null} onClick={() => void decide(selectedApplication.id, 'REJECTED')}>Reject application</button></>}</div></section>}
        </FarmgateDetailDialog>}
        {selectedVehicle && <FarmgateDetailDialog
            eyebrow="Restricted · Authorized admin reviewers"
            title={`${selectedVehicle.user.name} · ${selectedVehicle.vehicle_reference}`}
            onClose={() => setSelectedVehicle(null)}
            className="audit-modal rider-application-detail"
        >
            <section className="rider-detail-section"><h3>Rider information</h3><dl><div><dt>Email / phone</dt><dd>{selectedVehicle.user.email} · {selectedVehicle.user.phone_number ?? '-'}</dd></div><div><dt>Status</dt><dd><RiderStatusBadge status={selectedVehicle.status ?? 'PENDING'} /></dd></div><div><dt>Decision</dt><dd>{selectedVehicle.reviewer?.name ?? 'Pending review'} · {selectedVehicle.reviewed_at ? new Date(selectedVehicle.reviewed_at).toLocaleString() : 'Not reviewed'}{selectedVehicle.decision_reason ? ` · ${selectedVehicle.decision_reason}` : ''}</dd></div></dl></section>
            <section className="rider-detail-section"><h3>Vehicle information</h3><dl><div><dt>Vehicle</dt><dd>{selectedVehicle.plate_number} · {selectedVehicle.vehicle_type} · {selectedVehicle.vehicle_make_model} · {selectedVehicle.vehicle_color}</dd></div><div><dt>License expiry</dt><dd>{selectedVehicle.license_expires_on ?? '-'}</dd></div><div><dt>OR/CR expiry</dt><dd>{selectedVehicle.vehicle_registration_expires_on ?? '-'}</dd></div></dl></section>
            <section className="rider-detail-section"><h3>Submitted documents</h3><p className="rider-review-privacy-note">Private vehicle documents are visible only to authorized admin reviewers. Document links expire after five minutes.</p><DocumentList documents={selectedVehicle.documents ?? []} onDelete={(id) => void deleteDocument(id)} /></section>
            {!!selectedVehicle.audit_history?.length && <section className="rider-detail-section rider-detail-history"><h3>Review history</h3><details><summary>Vehicle update audit history</summary><ol>{selectedVehicle.audit_history.map((entry) => <li key={entry.id}><strong>{entry.action}</strong> · {entry.actor?.name ?? 'System'} ({entry.actor?.role ?? '-'}) · {new Date(entry.created_at).toLocaleString()}<p>{entry.description}</p></li>)}</ol></details></section>}
            {selectedVehicle.status === 'PENDING' && <section className="rider-detail-section"><h3>Review actions</h3><div className="rider-review-actions"><label>Decision reason<input value={reasons[`vehicle-${selectedVehicle.id}`] ?? ''} onChange={(event) => setReasons((current) => ({ ...current, [`vehicle-${selectedVehicle.id}`]: event.target.value }))} maxLength={2000} /></label><button type="button" disabled={busy !== null} onClick={() => void decide(selectedVehicle.id, 'APPROVED', true)}>Approve vehicle update</button><button type="button" disabled={busy !== null} onClick={() => void decide(selectedVehicle.id, 'MORE_INFORMATION_REQUIRED', true)}>Request information</button><button type="button" className="danger" disabled={busy !== null} onClick={() => void decide(selectedVehicle.id, 'REJECTED', true)}>Reject vehicle update</button></div></section>}
        </FarmgateDetailDialog>}
    </section>;
}
