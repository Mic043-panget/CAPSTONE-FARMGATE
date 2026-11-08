import React from 'react';
import api, { initializeCsrf } from '../../lib/api';
import { Pagination } from '../../shared/components/Pagination';
import { TabNav } from '../../shared/components/TabNav';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { showSuccess } from '../../lib/alerts';

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
    documents: RiderDocument[];
    history: History[];
};
type VehicleChange = {
    id: number;
    user: { id: number; name: string; email: string; phone_number: string };
    plate_number: string;
    vehicle_type: string;
    vehicle_make_model: string;
    vehicle_color: string;
    license_expires_on: string;
    vehicle_registration_expires_on: string;
    documents: RiderDocument[];
    created_at: string;
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

export function RiderApplicationQueue({ onError }: { onError: (message: string) => void }) {
    const [tab, setTab] = React.useState<'applications' | 'vehicles'>('applications');
    const [status, setStatus] = React.useState('');
    const [search, setSearch] = React.useState('');
    const [page, setPage] = React.useState(1);
    const [applications, setApplications] = React.useState<Application[]>([]);
    const [vehicleChanges, setVehicleChanges] = React.useState<VehicleChange[]>([]);
    const [total, setTotal] = React.useState(0);
    const [reasons, setReasons] = React.useState<Record<string, string>>({});
    const [busy, setBusy] = React.useState<string | null>(null);
    const debouncedSearch = useDebouncedValue(search);
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
                const response = await api.get<{ vehicle_changes: { data: VehicleChange[]; total: number } }>('/api/admin/rider-vehicle-changes', { params: { page } });
                if (current !== requestId.current) return;
                setVehicleChanges(response.data.vehicle_changes.data);
                setTotal(response.data.vehicle_changes.total);
            }
        } catch (requestError: any) {
            if (current === requestId.current) onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'Rider applications could not be loaded.');
        }
    }, [debouncedSearch, onError, page, status, tab]);

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
            await load();
        } catch (requestError: any) {
            onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'The document could not be deleted.');
        }
    }

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
            <label className="rider-review-search">Search applicant<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Name or email" /></label>
            {applications.map((application) => <article className="rider-review-card" key={application.id}>
                <header><div><strong>{application.name}</strong><span>Application #{application.id} · {documentLabel(application.status)}</span></div><time>{application.submitted_at ? new Date(application.submitted_at).toLocaleString() : 'Draft'}</time></header>
                <dl>
                    <div><dt>Email</dt><dd>{application.email}</dd></div>
                    <div><dt>Phone</dt><dd>{application.phone_number}</dd></div>
                    <div><dt>Birthdate</dt><dd>{application.date_of_birth}</dd></div>
                    <div><dt>Residential address</dt><dd>{application.residential_address}</dd></div>
                    <div><dt>License number</dt><dd>{application.license_number ?? 'Not submitted'}</dd></div>
                    <div><dt>License expiry</dt><dd>{application.license_expires_on ?? 'Not submitted'}</dd></div>
                    <div><dt>Vehicle</dt><dd>{[application.plate_number, application.vehicle_type, application.vehicle_make_model, application.vehicle_color].filter(Boolean).join(' · ') || 'Not submitted'}</dd></div>
                    <div><dt>OR/CR expiry</dt><dd>{application.vehicle_registration_expires_on ?? 'Not submitted'}</dd></div>
                </dl>
                <p className="rider-review-privacy-note">Documents are private, encrypted at rest, and only visible to this applicant and authorized admin reviewers. Links expire after five minutes. Retention schedule is awaiting policy; delete records only as authorized.</p>
                <DocumentList documents={application.documents} onDelete={(id) => void deleteDocument(id)} />
                {application.decision_reason && <p className="rider-review-reason">Previous decision: {application.decision_reason}</p>}
                <ol className="rider-review-history">{application.history.map((entry) => <li key={entry.id}><strong>{documentLabel(entry.to_status)}</strong><span>{entry.actor ?? 'System'} · {new Date(entry.created_at).toLocaleString()}</span>{entry.reason && <p>{entry.reason}</p>}</li>)}</ol>
                {!['APPROVED', 'REJECTED'].includes(application.status) && <div className="rider-review-actions">
                    <label>Reason for rejection or more information (required for those decisions)<textarea value={reasons[String(application.id)] ?? ''} onChange={(event) => setReasons((current) => ({ ...current, [application.id]: event.target.value }))} maxLength={2000} /></label>
                    {application.status === 'SUBMITTED' && <button type="button" disabled={busy !== null} onClick={() => void decide(application.id, 'UNDER_REVIEW')}>Mark under review</button>}
                    {application.status !== 'DRAFT' && <>
                        <button type="button" disabled={busy !== null} onClick={() => void decide(application.id, 'MORE_INFORMATION_REQUIRED')}>Request information</button>
                        <button type="button" disabled={busy !== null} onClick={() => void decide(application.id, 'APPROVED')}>Approve rider</button>
                        <button type="button" className="danger" disabled={busy !== null} onClick={() => void decide(application.id, 'REJECTED')}>Reject application</button>
                    </>}
                </div>}
            </article>)}
        </>}
        {tab === 'vehicles' && vehicleChanges.map((change) => <article className="rider-review-card" key={change.id}>
            <header><div><strong>{change.user.name}</strong><span>Vehicle update #{change.id} · {change.user.email}</span></div><time>{new Date(change.created_at).toLocaleString()}</time></header>
            <p>{change.user.phone_number}</p>
            <p>{change.plate_number} · {change.vehicle_type} · {change.vehicle_make_model} · {change.vehicle_color}</p>
            <p>License expiry {change.license_expires_on} · OR/CR expiry {change.vehicle_registration_expires_on}</p>
            <DocumentList documents={change.documents} onDelete={(id) => void deleteDocument(id)} />
            <div className="rider-review-actions">
                <label>Decision reason<input value={reasons[`vehicle-${change.id}`] ?? ''} onChange={(event) => setReasons((current) => ({ ...current, [`vehicle-${change.id}`]: event.target.value }))} maxLength={2000} /></label>
                <button type="button" disabled={busy !== null} onClick={() => void decide(change.id, 'APPROVED', true)}>Approve vehicle update</button>
                <button type="button" disabled={busy !== null} onClick={() => void decide(change.id, 'MORE_INFORMATION_REQUIRED', true)}>Request information</button>
                <button type="button" className="danger" disabled={busy !== null} onClick={() => void decide(change.id, 'REJECTED', true)}>Reject vehicle update</button>
            </div>
        </article>)}
        {total === 0 && <p className="empty-state">No rider records in this queue.</p>}
        <Pagination page={page} lastPage={Math.max(1, Math.ceil(total / 15))} onChange={setPage} />
    </section>;
}
