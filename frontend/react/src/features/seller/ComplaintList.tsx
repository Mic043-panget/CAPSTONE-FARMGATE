import React from 'react';
import api, { initializeCsrf } from '../../lib/api';
import { Pagination } from '../../shared/components/Pagination';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { showSuccess } from '../../lib/alerts';

type Media = { id: number; mime_type: string; original_name: string; url: string };
type Message = { id: number; message: string; sender?: { name: string }; created_at: string; media_files?: Media[] };
type Complaint = {
    id: number;
    case_type: 'COMPLAINT' | 'RETURN_REFUND';
    reason: string;
    other_reason?: string | null;
    description: string;
    status: string;
    refund_status: string;
    requested_amount?: string | null;
    seller_response_deadline?: string | null;
    escalated_at?: string | null;
    opener?: { name: string };
    messages?: Message[];
    evidence_media?: Media[];
};

function CaseMedia({ files }: { files?: Media[] }) {
    if (!files?.length) return null;
    return <div className="case-saved-media">{files.map((file) => file.mime_type.startsWith('video/')
        ? <video key={file.id} src={file.url} controls aria-label={file.original_name} />
        : <a key={file.id} href={file.url} target="_blank" rel="noreferrer"><img src={file.url} alt={file.original_name} /></a>)}</div>;
}

export function ComplaintList({ onError }: { onError: (message: string) => void }) {
    const [complaints, setComplaints] = React.useState<Complaint[]>([]);
    const [search, setSearch] = React.useState('');
    const [page, setPage] = React.useState(1);
    const [total, setTotal] = React.useState(0);
    const [replies, setReplies] = React.useState<Record<number, string>>({});
    const [busy, setBusy] = React.useState<number | null>(null);
    const debouncedSearch = useDebouncedValue(search);
    const requestId = React.useRef(0);

    const load = React.useCallback(() => {
        const current = ++requestId.current;
        api.get<{ complaints: { data: Complaint[]; total: number } }>('/api/seller/complaints', { params: { search: debouncedSearch || undefined, page } }).then((response) => {
            if (current !== requestId.current) return;
            setComplaints(response.data.complaints.data);
            setTotal(response.data.complaints.total);
        }).catch((requestError: any) => { if (current === requestId.current) onError(requestError.userMessage ?? 'Seller cases could not be loaded.'); });
    }, [debouncedSearch, onError, page]);

    React.useEffect(() => {
        if (search !== debouncedSearch) return undefined;
        load();
        return () => { requestId.current += 1; };
    }, [load, search, debouncedSearch]);

    async function reply(caseId: number) {
        const message = replies[caseId]?.trim();
        if (!message) { onError('Write a response before sending.'); return; }
        setBusy(caseId);
        try {
            await initializeCsrf();
            await api.post(`/api/cases/${caseId}/messages`, { message });
            setReplies((current) => ({ ...current, [caseId]: '' }));
            showSuccess(`Response sent for case #${caseId}.`);
            load();
        } catch (requestError: any) { onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'The case response could not be sent.'); }
        finally { setBusy(null); }
    }

    return <section className="complaint-queue">
        <div className="section-heading"><div><p className="eyebrow">Seller response</p><h2>Complaints and return requests</h2></div><span className="record-count">{total} records</span></div>
        <div className="list-tools"><label className="control-search"><span className="sr-only">Search cases</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search cases" /></label></div>
        {complaints.map((complaint) => <article className="complaint-item" key={complaint.id}>
            <strong>#{complaint.id} · {complaint.case_type === 'RETURN_REFUND' ? 'Return/refund' : 'Complaint'} · {complaint.reason}{complaint.other_reason ? `: ${complaint.other_reason}` : ''}</strong>
            <span>{complaint.status.replaceAll('_', ' ')} · {complaint.opener?.name ?? 'Buyer'}{complaint.escalated_at ? ' · Escalated to admin' : ''}</span>
            <p>{complaint.description}</p>
            {complaint.requested_amount && <p>Requested item amount PHP {Number(complaint.requested_amount).toFixed(2)} · refund state {complaint.refund_status.replaceAll('_', ' ')}</p>}
            <CaseMedia files={complaint.evidence_media} />
            <ol className="order-case-messages">{complaint.messages?.map((message) => <li key={message.id}><strong>{message.sender?.name ?? 'Participant'}</strong><time>{new Date(message.created_at).toLocaleString()}</time><p>{message.message}</p><CaseMedia files={message.media_files} /></li>)}</ol>
            {!['RESOLVED', 'REJECTED'].includes(complaint.status) && <div className="order-case-reply">
                <label>Respond or request information<textarea value={replies[complaint.id] ?? ''} onChange={(event) => setReplies((current) => ({ ...current, [complaint.id]: event.target.value }))} maxLength={5000} /></label>
                <button type="button" disabled={busy !== null} onClick={() => void reply(complaint.id)}>{busy === complaint.id ? 'Sending…' : 'Send response'}</button>
            </div>}
            <small>Respond by {complaint.seller_response_deadline ? new Date(complaint.seller_response_deadline).toLocaleString() : '—'}. Cases needing a policy decision are handled by admin.</small>
        </article>)}
        {!complaints.length && <p className="empty-state">No complaints or return requests have been filed.</p>}
        <Pagination page={page} lastPage={Math.ceil(total / 15)} onChange={setPage} />
    </section>;
}
