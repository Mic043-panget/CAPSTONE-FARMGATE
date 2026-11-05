import React from 'react';
import api from '../../lib/api';
import { Pagination } from '../../shared/components/Pagination';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';

type Complaint = { id: number; reason: string; description: string; status: string; opener?: { name: string } };

export function ComplaintList({ onError }: { onError: (message: string) => void }) {
    const [complaints, setComplaints] = React.useState<Complaint[]>([]);
    const [search, setSearch] = React.useState('');
    const [page, setPage] = React.useState(1);
    const [total, setTotal] = React.useState(0);
    const debouncedSearch = useDebouncedValue(search);
    React.useEffect(() => {
        if (search !== debouncedSearch) return undefined;
        let active = true;
        api.get<{ complaints: { data: Complaint[]; total: number } }>('/api/seller/complaints', { params: { search: debouncedSearch || undefined, page } }).then((response) => {
            if (active) {
                setComplaints(response.data.complaints.data);
                setTotal(response.data.complaints.total);
            }
        }).catch(() => { if (active) onError('Seller complaints could not be loaded.'); });
        return () => { active = false; };
    }, [onError, page, search, debouncedSearch]);
    return <section className="complaint-queue"><div className="section-heading"><div><p className="eyebrow">Seller response</p><h2>Complaints about your livestock</h2></div><span className="record-count">{total} records</span></div><div className="list-tools"><label className="control-search"><span className="sr-only">Search complaints</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search complaints" /></label></div>{complaints.map((complaint) => <article className="complaint-item" key={complaint.id}><strong>#{complaint.id} · {complaint.reason}</strong><span>{complaint.status} · {complaint.opener?.name ?? 'buyer'}</span><p>{complaint.description}</p></article>)}{!complaints.length && <p className="empty-state">No complaints have been filed.</p>}<Pagination page={page} lastPage={Math.ceil(total / 15)} onChange={setPage} /></section>;
}
