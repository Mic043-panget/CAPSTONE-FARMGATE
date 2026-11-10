import React from 'react';
import { ViewDetailsAction } from '../../shared/components/Button';
import { LoadingSkeleton } from '../../shared/components/LoadingSkeleton';
import api, { initializeCsrf } from '../../lib/api';
import { Pagination } from '../../shared/components/Pagination';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useAccessibleDialog } from '../../shared/hooks/useAccessibleDialog';

type Media = { id: number; mime_type: string; original_name: string; url: string };
type Message = { id: number; message: string; sender?: { name: string; role?: string }; created_at: string; media_files?: Media[] };
type Complaint = {
    id: number;
    case_reference: string;
    case_type: 'COMPLAINT' | 'RETURN_REFUND';
    reason: string;
    other_reason?: string | null;
    description: string;
    status: string;
    refund_status: string;
    requested_amount?: string | null;
    approved_refund_amount?: string | null;
    resolution_reason?: string | null;
    return_method?: string | null;
    requested_items?: { name: string; quantity: number; requested_amount: number }[];
    seller_response_deadline?: string | null;
    escalated_at?: string | null;
    opener?: { name: string };
    order?: { order_reference: string; total_amount?: string | null };
    messages?: Message[];
    evidence_media?: Media[];
    created_at: string;
};

const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });

function CaseMedia({ files }: { files?: Media[] }) {
    const [selected, setSelected] = React.useState<Media | null>(null);
    const previewRef = useAccessibleDialog<HTMLElement>(Boolean(selected), () => setSelected(null));
    if (!files?.length) return <p className="complaint-muted">No evidence attached.</p>;

    return <>
        <div className="case-saved-media complaint-evidence">{files.map((file) => file.mime_type.startsWith('video/')
            ? <figure key={file.id}><video src={file.url} controls preload="metadata" aria-label={file.original_name} /><figcaption>{file.original_name}</figcaption></figure>
            : <figure key={file.id}><button className="complaint-evidence-preview" type="button" onClick={() => setSelected(file)} aria-label={`View full-size image: ${file.original_name}`}><img src={file.url} alt={file.original_name} /></button><figcaption>{file.original_name}</figcaption></figure>)}</div>
        {selected && <div className="complaint-preview-backdrop" role="presentation" onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelected(null);
        }}><section ref={previewRef} className="complaint-preview-dialog" role="dialog" aria-modal="true" aria-labelledby={`seller-complaint-preview-${selected.id}`}>
            <header><h4 id={`seller-complaint-preview-${selected.id}`}>{selected.original_name}</h4><button type="button" onClick={() => setSelected(null)} aria-label="Close evidence preview">Close</button></header>
            <img src={selected.url} alt={selected.original_name} />
        </section></div>}
    </>;
}

export function ComplaintList({ onError, initialCaseReference, onInitialCaseHandled }: {
    onError: (message: string) => void;
    initialCaseReference?: string | null;
    onInitialCaseHandled?: () => void;
}) {
    const [complaints, setComplaints] = React.useState<Complaint[]>([]);
    const [search, setSearch] = React.useState(initialCaseReference ?? '');
    const [page, setPage] = React.useState(1);
    const [total, setTotal] = React.useState(0);
    const [replies, setReplies] = React.useState<Record<number, string>>({});
    const [expandedCases, setExpandedCases] = React.useState<Record<number, boolean>>({});
    const [feedback, setFeedback] = React.useState<Record<number, { type: 'success' | 'error'; message: string }>>({});
    const [busy, setBusy] = React.useState<number | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [loadError, setLoadError] = React.useState('');
    const debouncedSearch = useDebouncedValue(search);
    const requestId = React.useRef(0);
    const lastPage = Math.max(1, Math.ceil(total / 15));

    const load = React.useCallback(() => {
        const current = ++requestId.current;
        setLoading(true);
        setLoadError('');
        api.get<{ complaints: { data: Complaint[]; total: number } }>('/api/seller/complaints', { params: { search: debouncedSearch || undefined, page } }).then((response) => {
            if (current !== requestId.current) return;
            setComplaints(response.data.complaints.data);
            setTotal(response.data.complaints.total);
            if (initialCaseReference) {
                const target = response.data.complaints.data.find((item) => item.case_reference === initialCaseReference);
                if (target) {
                    setExpandedCases((currentCases) => ({ ...currentCases, [target.id]: true }));
                    onInitialCaseHandled?.();
                }
            }
        }).catch((requestError: any) => {
            if (current !== requestId.current) return;
            const message = requestError.userMessage ?? 'Seller cases could not be loaded.';
            setLoadError(message);
            onError(message);
        }).finally(() => {
            if (current === requestId.current) setLoading(false);
        });
    }, [debouncedSearch, initialCaseReference, onError, onInitialCaseHandled, page]);

    React.useEffect(() => {
        if (initialCaseReference) {
            setSearch(initialCaseReference);
            setPage(1);
        }
    }, [initialCaseReference]);

    React.useEffect(() => {
        if (search !== debouncedSearch) return undefined;
        load();
        return () => { requestId.current += 1; };
    }, [load, search, debouncedSearch]);

    async function reply(caseId: number) {
        const message = replies[caseId]?.trim();
        if (!message) {
            setFeedback((current) => ({ ...current, [caseId]: { type: 'error', message: 'Write a response before sending.' } }));
            return;
        }
        setBusy(caseId);
        setFeedback((current) => ({ ...current, [caseId]: { type: 'success', message: '' } }));
        try {
            await initializeCsrf();
            await api.post(`/api/cases/${caseId}/messages`, { message });
            setReplies((current) => ({ ...current, [caseId]: '' }));
            setFeedback((current) => ({
                ...current,
                [caseId]: { type: 'success', message: `Response sent for ${complaints.find((complaint) => complaint.id === caseId)?.case_reference ?? 'case'}.` },
            }));
            load();
        } catch (requestError: any) {
            setFeedback((current) => ({
                ...current,
                [caseId]: { type: 'error', message: requestError.userMessage ?? requestError.response?.data?.message ?? 'The case response could not be sent.' },
            }));
        } finally {
            setBusy(null);
        }
    }

    return <section className="complaint-queue seller-complaint-queue">
        <div className="section-heading"><div><p className="eyebrow">Seller response</p><h2>Complaints and return requests</h2></div><span className="record-count" aria-live="polite">{total} {total === 1 ? 'case' : 'cases'}</span></div>
        <p className="seller-complaint-guidance">You can respond or request information. Cases requiring a policy decision are handled by an admin.</p>
        <div className="list-tools"><label className="control-search"><span className="sr-only">Search cases</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Case reference, order, buyer, type, or reason" /></label></div>
        {loading ? <LoadingSkeleton variant="list" count={3} label="Loading complaint cases" /> : loadError ? <p className="complaint-queue-state" role="alert">{loadError}</p> : complaints.map((complaint) => {
            const expanded = Boolean(expandedCases[complaint.id]);
            const deadline = complaint.seller_response_deadline ? new Date(complaint.seller_response_deadline) : null;
            const deadlineOverdue = deadline !== null && deadline.getTime() < Date.now() && !['RESOLVED', 'REJECTED'].includes(complaint.status);
            const detailsId = `seller-complaint-details-${complaint.id}`;
            const reason = `${complaint.reason}${complaint.other_reason ? `: ${complaint.other_reason}` : ''}`;

            return <article className={`complaint-case-card seller-complaint-case${expanded ? ' expanded' : ''}`} key={complaint.id}>
                <div className="complaint-case-compact seller-complaint-compact" role="group" aria-label={`${complaint.case_reference}, ${complaint.case_type === 'RETURN_REFUND' ? 'return or refund' : 'complaint'}`}>
                    <span className="complaint-compact-field complaint-compact-reference" data-label="Case reference"><strong>{complaint.case_reference}</strong></span>
                    <span className="complaint-compact-field" data-label="Type">{complaint.case_type === 'RETURN_REFUND' ? 'Return / refund' : 'Complaint'}</span>
                    <span className="complaint-compact-field complaint-compact-reason" data-label="Reason">{reason}</span>
                    <span className="complaint-compact-field" data-label="Status"><span className={`complaint-status complaint-status-${complaint.status.toLowerCase()}`}>{complaint.status.replaceAll('_', ' ')}</span></span>
                    <span className="complaint-compact-field" data-label="Buyer">{complaint.opener?.name ?? 'Buyer'}</span>
                    <span className="complaint-compact-field" data-label="Requested amount">{complaint.requested_amount != null ? money.format(Number(complaint.requested_amount)) : '—'}</span>
                    <ViewDetailsAction className="complaint-expand-button" contextLabel={`case ${complaint.case_reference}`} expanded={expanded} controls={detailsId} onClick={() => setExpandedCases((current) => ({ ...current, [complaint.id]: !current[complaint.id] }))} />
                </div>
                <div id={detailsId} className="complaint-case-details seller-complaint-details" hidden={!expanded}>
                    <header className="complaint-case-header"><div><p className="eyebrow">{complaint.case_reference} · {complaint.case_type === 'RETURN_REFUND' ? 'Return / refund' : 'Complaint'}</p><h3>{reason}</h3>{complaint.order?.order_reference && <p className="seller-complaint-order">Order reference: <strong>{complaint.order.order_reference}</strong></p>}</div><span className={`complaint-status complaint-status-${complaint.status.toLowerCase()}`}>{complaint.status.replaceAll('_', ' ')}</span></header>
                    <div className="complaint-case-grid seller-complaint-grid">
                        <section className="complaint-case-section"><h4>Case summary</h4><p>{complaint.description}</p><dl>
                            <div><dt>Reported by</dt><dd>{complaint.opener?.name ?? 'Buyer'}</dd></div>
                            <div><dt>Case reference</dt><dd>{complaint.case_reference}</dd></div>
                            <div><dt>Response deadline</dt><dd className={deadlineOverdue ? 'complaint-deadline-overdue' : ''}>{deadline ? <time dateTime={deadline.toISOString()}>{deadline.toLocaleString()}</time> : 'Not set'}{deadlineOverdue && <strong> · Overdue</strong>}{complaint.escalated_at && <strong> · Escalated to admin</strong>}</dd></div>
                        </dl></section>
                        <section className="complaint-case-section"><h4>Order and items</h4>
                            <p>Order reference: <strong>{complaint.order?.order_reference ?? 'Not available'}</strong></p>
                            {complaint.order?.total_amount != null && <p>Order total: <strong>{money.format(Number(complaint.order.total_amount))}</strong></p>}
                        </section>
                        <section className="complaint-case-section"><h4>Requested resolution</h4>
                            {complaint.requested_amount != null ? <p>Requested refund amount: <strong>{money.format(Number(complaint.requested_amount))}</strong></p> : <p>No monetary amount requested.</p>}
                            {complaint.requested_items?.length ? <ul className="complaint-order-items">{complaint.requested_items.map((item) => <li key={`${item.name}-${item.quantity}`}>{item.quantity} × {item.name}<span>{money.format(Number(item.requested_amount))}</span></li>)}</ul> : null}
                            {complaint.approved_refund_amount != null && <p>Approved amount: <strong>{money.format(Number(complaint.approved_refund_amount))}</strong></p>}
                            <p>Refund / reimbursement state: <strong>{complaint.refund_status.replaceAll('_', ' ')}</strong></p>
                            {complaint.return_method && <p>Return method: <strong>{complaint.return_method.replaceAll('_', ' ')}</strong></p>}
                            {complaint.resolution_reason && <p>Admin decision: {complaint.resolution_reason}</p>}
                        </section>
                        <section className="complaint-case-section"><h4>Evidence</h4><CaseMedia files={complaint.evidence_media} /></section>
                        <section className="complaint-case-section complaint-case-conversation"><h4>Conversation</h4>
                            {complaint.messages?.length ? <ol className="complaint-message-list">{complaint.messages.map((message) => <li key={message.id}>
                                <header><strong>{message.sender?.name ?? 'Participant'}{message.sender?.role ? ` · ${message.sender.role}` : ''}</strong><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString()}</time></header>
                                <p>{message.message}</p><CaseMedia files={message.media_files} />
                            </li>)}</ol> : <p className="complaint-muted">No messages yet.</p>}
                            {!['RESOLVED', 'REJECTED'].includes(complaint.status) && <div className="order-case-reply seller-complaint-reply">
                                <label htmlFor={`seller-case-reply-${complaint.id}`}>Respond or request information<textarea id={`seller-case-reply-${complaint.id}`} value={replies[complaint.id] ?? ''} onChange={(event) => {
                                    setReplies((current) => ({ ...current, [complaint.id]: event.target.value }));
                                    setFeedback((current) => ({ ...current, [complaint.id]: { type: 'success', message: '' } }));
                                }} maxLength={5000} /></label>
                                <button type="button" disabled={busy !== null} onClick={() => void reply(complaint.id)}>{busy === complaint.id ? 'Sending…' : 'Send response'}</button>
                            </div>}
                            {feedback[complaint.id]?.message && <p className={`seller-complaint-feedback ${feedback[complaint.id].type === 'error' ? 'is-error' : 'is-success'}`} role={feedback[complaint.id].type === 'error' ? 'alert' : 'status'}>{feedback[complaint.id].message}</p>}
                        </section>
                    </div>
                </div>
            </article>;
        })}
        {!loading && !loadError && !complaints.length && <p className="empty-state">No complaints or return requests match your search.</p>}
        {!loading && !loadError && total > 0 && <Pagination page={page} lastPage={lastPage} onChange={setPage} />}
    </section>;
}
