import React from 'react';
import api, { initializeCsrf } from '../../lib/api';
import { Pagination } from '../../shared/components/Pagination';
import { TabNav } from '../../shared/components/TabNav';
import { confirmAction, showSuccess } from '../../lib/alerts';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';

type Complaint = { id: number; reason: string; description: string; status: string; opened_by?: { name: string } };

export function ComplaintQueue({ onError }: { onError: (message: string) => void }) {
    const [complaints, setComplaints] = React.useState<Complaint[]>([]);
    const [reason, setReason] = React.useState<Record<number, string>>({});
    const [status, setStatus] = React.useState('');
    const [search, setSearch] = React.useState('');
    const [page, setPage] = React.useState(1);
    const [total, setTotal] = React.useState(0);
    const debouncedSearch = useDebouncedValue(search);
    const requestId = React.useRef(0);

    function load() {
        const currentRequestId = ++requestId.current;
        api.get<{ complaints: { data: Complaint[]; total: number } }>('/api/admin/complaints', { params: { search: debouncedSearch || undefined, status: status || undefined, page } }).then((response) => {
            if (currentRequestId !== requestId.current) return;
            setComplaints(response.data.complaints.data);
            setTotal(response.data.complaints.total);
        }).catch(() => { if (currentRequestId === requestId.current) onError('Complaints could not be loaded.'); });
    }
    React.useEffect(() => {
        if (search !== debouncedSearch) {
            requestId.current += 1;
            return undefined;
        }
        load();
        return () => { requestId.current += 1; };
    }, [onError, page, search, debouncedSearch, status]);

    async function resolve(id: number, status: string) {
        if (!await confirmAction({ title: `Set complaint #${id} to ${status.replaceAll('_', ' ').toLowerCase()}?`, text: 'The buyer will see the updated complaint status.', confirmText: 'Update complaint' })) return;
        try { await initializeCsrf(); await api.patch(`/api/admin/complaints/${id}`, { status, reason: reason[id] }); showSuccess(`Complaint #${id} updated.`); load(); } catch (requestError: any) { onError(requestError.response?.data?.message ?? 'The complaint could not be updated.'); }
    }

    return <section className="complaint-queue"><div className="section-heading"><div><p className="eyebrow">Admin review</p><h2>Complaint queue</h2></div><span className="record-count">{total} records</span></div><TabNav label="Complaint status" value={status} onChange={(value) => { setStatus(value); setPage(1); }} options={[{ value: '', label: 'All' }, { value: 'OPEN', label: 'Open' }, { value: 'UNDER_REVIEW', label: 'Under review' }, { value: 'RESOLVED', label: 'Resolved' }, { value: 'REJECTED', label: 'Rejected' }]} /><div className="list-tools"><label className="control-search"><span className="sr-only">Search complaints</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search complaints" /></label></div>{complaints.map((complaint) => <article className="complaint-item" key={complaint.id}><strong>#{complaint.id} · {complaint.reason}</strong><span>{complaint.status} · opened by {complaint.opened_by?.name ?? 'user'}</span><p>{complaint.description}</p><input placeholder="Resolution reason" value={reason[complaint.id] ?? ''} onChange={(event) => setReason((current) => ({ ...current, [complaint.id]: event.target.value }))} /><div><button type="button" onClick={() => resolve(complaint.id, 'UNDER_REVIEW')}>Review</button><button type="button" onClick={() => resolve(complaint.id, 'RESOLVED')}>Resolve</button><button type="button" onClick={() => resolve(complaint.id, 'REJECTED')}>Reject</button></div></article>)}{!complaints.length && <p className="empty-state">No complaints are waiting.</p>}<Pagination page={page} lastPage={Math.ceil(total / 15)} onChange={setPage} /></section>;
}
