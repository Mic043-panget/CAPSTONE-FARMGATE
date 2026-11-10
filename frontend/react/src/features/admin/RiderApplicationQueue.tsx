import React from 'react';
import { ViewDetailsAction } from '../../shared/components/Button';
import api, { initializeCsrf } from '../../lib/api';
import { Pagination } from '../../shared/components/Pagination';
import { TabNav } from '../../shared/components/TabNav';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { showSuccess } from '../../lib/alerts';
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
    { value: '', label: 'All applications' },
    { value: 'DRAFT', label: 'Draft' },
    { value: 'SUBMITTED', label: 'Submitted' },
    { value: 'UNDER_REVIEW', label: 'Under Review' },
    { value: 'MORE_INFORMATION_REQUIRED', label: 'More Information Required' },
    { value: 'APPROVED', label: 'Approved' },
    { value: 'REJECTED', label: 'Rejected' },
];

function documentLabel(value: string): string {
    return value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
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
    const [page, setPage] = React.useState(1);
    const [applications, setApplications] = React.useState<Application[]>([]);
    const [vehicleChanges, setVehicleChanges] = React.useState<VehicleChange[]>([]);
    const [total, setTotal] = React.useState(0);
    const [reasons, setReasons] = React.useState<Record<string, string>>({});
    const [busy, setBusy] = React.useState<string | null>(null);
    const [selectedApplication, setSelectedApplication] = React.useState<Application | null>(null);
    const [selectedVehicle, setSelectedVehicle] = React.useState<VehicleChange | null>(null);
    const debouncedSearch = useDebouncedValue(search);
    const debouncedVehicleSearch = useDebouncedValue(vehicleSearch);
    const requestId = React.useRef(0);

    const load = React.useCallback(async () => {
        const current = ++requestId.current;
        try {
            if (tab === 'applications') {
                const response = await api.get<{ applications: { data: Application[]; total: number } }>('/api/admin/rider-applications', {
                    params: { status: status || undefined, search: debouncedSearch || undefined, page },
                });
                if (current !== requestId.current) return;
                setApplications(response.data.applications.data);
                setTotal(response.data.applications.total);
            } else {
                const response = await api.get<{ vehicle_changes: { data: VehicleChange[]; total: number } }>('/api/admin/rider-vehicle-changes', { params: { search: debouncedVehicleSearch || undefined, status: vehicleStatus || undefined, page } });
                if (current !== requestId.current) return;
                setVehicleChanges(response.data.vehicle_changes.data);
                setTotal(response.data.vehicle_changes.total);
            }
        } catch (requestError: any) {
            if (current === requestId.current) onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'Rider applications could not be loaded.');
        }
    }, [debouncedSearch, debouncedVehicleSearch, onError, page, status, tab, vehicleStatus]);

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
        if (!window.confirm('Delete this protected rider document? Deletion is recorded in the application history.')) return;
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

    return <section className="rider-review-queue">
        <div className="section-heading">
            <div><p className="eyebrow">Restricted access · Admin reviewers only</p><h2>Rider applications &amp; vehicles</h2></div>
            <button type="button" className="seller-inline-action" onClick={() => void load()}>Refresh</button>
        </div>
        <div className="rider-review-tabs" role="tablist" aria-label="Rider review queue">
            <button type="button" role="tab" aria-selected={tab === 'applications'} onClick={() => { setTab('applications'); setPage(1); }}>Applications</button>
            <button type="button" role="tab" aria-selected={tab === 'vehicles'} onClick={() => { setTab('vehicles'); setPage(1); }}>Vehicle updates</button>
        </div>
        {tab === 'applications' && <>
            <TabNav label="Application status" value={status} onChange={(value) => { setStatus(value); setPage(1); }} options={statuses} />
            <label className="rider-review-search">Search applicant<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Application reference, name, or email" /></label>
            {applications.length ? <div className="data-table-wrap"><table><thead><tr><th>Application reference</th><th>Applicant</th><th>Email</th><th>Status</th><th>Submitted</th><th>Details</th></tr></thead><tbody>{applications.map((application) => <tr key={application.id}><td>{application.application_reference}</td><td>{application.name}</td><td>{application.email}</td><td>{documentLabel(application.status)}</td><td>{application.submitted_at ? new Date(application.submitted_at).toLocaleString() : 'Draft'}</td><td><ViewDetailsAction contextLabel={`rider application ${application.application_reference}`} onClick={() => void openApplication(application.id)} /></td></tr>)}</tbody></table></div> : <p className="empty-state">No rider applications match this filter.</p>}
        </>}
        {tab === 'vehicles' && <><label className="rider-review-search">Search rider or plate<input value={vehicleSearch} onChange={(event) => { setVehicleSearch(event.target.value); setPage(1); }} placeholder="Reference, name, email, or plate" /></label><label className="rider-review-search">Vehicle update status<select value={vehicleStatus} onChange={(event) => { setVehicleStatus(event.target.value); setPage(1); }}><option value="">All statuses</option><option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="MORE_INFORMATION_REQUIRED">More information required</option></select></label>
            {vehicleChanges.length ? <div className="data-table-wrap"><table><thead><tr><th>Vehicle update reference</th><th>Rider</th><th>Email</th><th>Plate number</th><th>Status</th><th>Submitted</th><th>Details</th></tr></thead><tbody>{vehicleChanges.map((change) => <tr key={change.id}><td>{change.vehicle_reference}</td><td>{change.user.name}</td><td>{change.user.email}</td><td>{change.plate_number}</td><td>{documentLabel(change.status ?? 'PENDING')}</td><td>{new Date(change.created_at).toLocaleString()}</td><td><ViewDetailsAction contextLabel={`vehicle change ${change.vehicle_reference}`} onClick={() => void openVehicle(change.id)} /></td></tr>)}</tbody></table></div> : <p className="empty-state">No vehicle changes match this search.</p>}
        </>}
        {total === 0 && <p className="empty-state">No rider records in this queue.</p>}
        <Pagination page={page} lastPage={Math.max(1, Math.ceil(total / 15))} onChange={setPage} />
        {selectedApplication && <FarmgateDetailDialog
            eyebrow="Restricted · Authorized admin reviewers"
            title={`${selectedApplication.name} · ${selectedApplication.application_reference}`}
            onClose={() => setSelectedApplication(null)}
            className="audit-modal rider-application-detail"
        >
            <dl><div><dt>Status</dt><dd>{documentLabel(selectedApplication.status)}</dd></div><div><dt>Email / phone</dt><dd>{selectedApplication.email} · {selectedApplication.phone_number ?? '-'}</dd></div><div><dt>Birthdate</dt><dd>{selectedApplication.date_of_birth ?? '-'}</dd></div><div><dt>Residential address</dt><dd>{selectedApplication.residential_address ?? '-'}</dd></div><div><dt>License</dt><dd>{selectedApplication.license_number ?? '-'} · expires {selectedApplication.license_expires_on ?? '-'}</dd></div><div><dt>Vehicle</dt><dd>{[selectedApplication.plate_number, selectedApplication.vehicle_type, selectedApplication.vehicle_make_model, selectedApplication.vehicle_color].filter(Boolean).join(' · ') || '-'}</dd></div><div><dt>OR/CR expiry</dt><dd>{selectedApplication.vehicle_registration_expires_on ?? '-'}</dd></div></dl>
            <section className="rider-review-acknowledgments" aria-label="Policy acknowledgments">
                <h4>Policy acknowledgments</h4>
                <ul>
                    <li>Privacy: {selectedApplication.privacy_policy_version ?? 'legacy'} · {selectedApplication.privacy_accepted_at ? new Date(selectedApplication.privacy_accepted_at).toLocaleString() : 'timestamp unavailable'}</li>
                    <li>Terms: {selectedApplication.terms_version ?? 'legacy'} · {selectedApplication.terms_accepted_at ? new Date(selectedApplication.terms_accepted_at).toLocaleString() : 'timestamp unavailable'}</li>
                    <li>Safety: {selectedApplication.safety_policy_version ?? 'legacy'} · {selectedApplication.safety_policy_accepted_at ? new Date(selectedApplication.safety_policy_accepted_at).toLocaleString() : 'timestamp unavailable'}</li>
                    <li>Retention: {selectedApplication.retention_policy_version ?? 'legacy'} · {selectedApplication.retention_policy_accepted_at ? new Date(selectedApplication.retention_policy_accepted_at).toLocaleString() : 'timestamp unavailable'}</li>
                    <li>Optional rider updates consent: {selectedApplication.optional_updates_consent ? `Yes · ${selectedApplication.optional_updates_consented_at ? new Date(selectedApplication.optional_updates_consented_at).toLocaleString() : 'timestamp unavailable'}` : 'No'}</li>
                </ul>
            </section>
            <p className="rider-review-privacy-note">Sensitive information and private documents are shown only to authorized admin reviewers. Document links expire after five minutes.</p>
            <DocumentList documents={selectedApplication.documents ?? []} onDelete={(id) => void deleteDocument(id)} />
            {selectedApplication.decision_reason && <p className="rider-review-reason">Previous decision: {selectedApplication.decision_reason}</p>}
            <ol className="rider-review-history">{(selectedApplication.history ?? []).map((entry) => <li key={entry.id}><strong>{documentLabel(entry.to_status)}</strong><span>{entry.actor ?? 'System'} · {new Date(entry.created_at).toLocaleString()}</span>{entry.reason && <p>{entry.reason}</p>}</li>)}</ol>
            {!['APPROVED', 'REJECTED'].includes(selectedApplication.status) && <div className="rider-review-actions"><label>Reason for rejection or more information<textarea value={reasons[String(selectedApplication.id)] ?? ''} onChange={(event) => setReasons((current) => ({ ...current, [selectedApplication.id]: event.target.value }))} maxLength={2000} /></label>{selectedApplication.status === 'SUBMITTED' && <button type="button" disabled={busy !== null} onClick={() => void decide(selectedApplication.id, 'UNDER_REVIEW')}>Mark under review</button>}{selectedApplication.status !== 'DRAFT' && <><button type="button" disabled={busy !== null} onClick={() => void decide(selectedApplication.id, 'MORE_INFORMATION_REQUIRED')}>Request information</button><button type="button" disabled={busy !== null} onClick={() => void decide(selectedApplication.id, 'APPROVED')}>Approve rider</button><button type="button" className="danger" disabled={busy !== null} onClick={() => void decide(selectedApplication.id, 'REJECTED')}>Reject application</button></>}</div>}
        </FarmgateDetailDialog>}
        {selectedVehicle && <FarmgateDetailDialog
            eyebrow="Restricted · Authorized admin reviewers"
            title={`${selectedVehicle.user.name} · ${selectedVehicle.vehicle_reference}`}
            onClose={() => setSelectedVehicle(null)}
            className="audit-modal rider-application-detail"
        >
            <dl><div><dt>Rider / contact</dt><dd>{selectedVehicle.user.email} · {selectedVehicle.user.phone_number ?? '-'}</dd></div><div><dt>Vehicle</dt><dd>{selectedVehicle.plate_number} · {selectedVehicle.vehicle_type} · {selectedVehicle.vehicle_make_model} · {selectedVehicle.vehicle_color}</dd></div><div><dt>License expiry</dt><dd>{selectedVehicle.license_expires_on ?? '-'}</dd></div><div><dt>OR/CR expiry</dt><dd>{selectedVehicle.vehicle_registration_expires_on ?? '-'}</dd></div><div><dt>Status</dt><dd>{documentLabel(selectedVehicle.status ?? 'PENDING')}</dd></div><div><dt>Decision</dt><dd>{selectedVehicle.reviewer?.name ?? 'Pending review'} · {selectedVehicle.reviewed_at ? new Date(selectedVehicle.reviewed_at).toLocaleString() : 'Not reviewed'}{selectedVehicle.decision_reason ? ` · ${selectedVehicle.decision_reason}` : ''}</dd></div></dl>
            <DocumentList documents={selectedVehicle.documents ?? []} onDelete={(id) => void deleteDocument(id)} />
            {!!selectedVehicle.audit_history?.length && <details><summary>Vehicle change history</summary><ol>{selectedVehicle.audit_history.map((entry) => <li key={entry.id}><strong>{entry.action}</strong> · {entry.actor?.name ?? 'System'} ({entry.actor?.role ?? '-'}) · {new Date(entry.created_at).toLocaleString()}<p>{entry.description}</p></li>)}</ol></details>}
            {selectedVehicle.status === 'PENDING' && <div className="rider-review-actions"><label>Decision reason<input value={reasons[`vehicle-${selectedVehicle.id}`] ?? ''} onChange={(event) => setReasons((current) => ({ ...current, [`vehicle-${selectedVehicle.id}`]: event.target.value }))} maxLength={2000} /></label><button type="button" disabled={busy !== null} onClick={() => void decide(selectedVehicle.id, 'APPROVED', true)}>Approve vehicle update</button><button type="button" disabled={busy !== null} onClick={() => void decide(selectedVehicle.id, 'MORE_INFORMATION_REQUIRED', true)}>Request information</button><button type="button" className="danger" disabled={busy !== null} onClick={() => void decide(selectedVehicle.id, 'REJECTED', true)}>Reject vehicle update</button></div>}
        </FarmgateDetailDialog>}
    </section>;
}
