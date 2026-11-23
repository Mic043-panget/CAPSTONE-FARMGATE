import React from 'react';
import { LoadingSkeleton } from '../../shared/components/LoadingSkeleton';
import api, { initializeCsrf } from '../../lib/api';
import { Pagination } from '../../shared/components/Pagination';
import { TabNav } from '../../shared/components/TabNav';
import { confirmAction, showSuccess } from '../../lib/alerts';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useAccessibleDialog } from '../../shared/hooks/useAccessibleDialog';
import { ViewDetailsAction } from '../../shared/components/Button';

type Media = { id: number; mime_type: string; original_name: string; url: string };
type Message = { id: number; message: string; sender?: { name: string; role?: string }; created_at: string; media_files?: Media[] };
type CaseStatus = 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'REJECTED';
type CaseCounts = { total: number; statuses: Record<CaseStatus, number> };
type CaseStatusHistory = {
    from_status?: string | null;
    to_status: string;
    reason?: string | null;
    created_at: string;
    actor?: { name: string } | null;
};
type Complaint = {
    id: number;
    case_reference: string;
    case_type: 'COMPLAINT' | 'RETURN_REFUND';
    reason: string;
    other_reason?: string | null;
    description: string;
    status: string;
    resolution_reason?: string | null;
    refund_status: string;
    requested_amount?: string | null;
    approved_refund_amount?: string | null;
    return_method?: string | null;
    payout_reference?: string | null;
    payout_evidence_url?: string | null;
    has_provider_refund?: boolean;
    requested_items?: { name: string; quantity: number; requested_amount: number }[];
    seller_response_deadline?: string | null;
    escalated_at?: string | null;
    opened_by?: { name: string };
    respondent?: { name: string };
    status_history?: CaseStatusHistory[];
    order?: {
        order_reference: string; total_amount?: string; delivery_fee?: string; payment_method?: string;
        payment_status?: string; items?: { id: number; listing?: { name: string }; quantity: number; total_amount: string | number }[];
    };
    evidence_media?: Media[];
    messages?: Message[];
    created_at: string;
};

const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
const CASE_STATUSES: { value: CaseStatus; label: string }[] = [
    { value: 'OPEN', label: 'Open' },
    { value: 'UNDER_REVIEW', label: 'Under review' },
    { value: 'RESOLVED', label: 'Resolved' },
    { value: 'REJECTED', label: 'Rejected' },
];

function ComplaintSummaryIcon({ status }: { status?: CaseStatus }) {
    if (!status) return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h6l2 2h10v10H3z" /></svg>;
    if (status === 'OPEN') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v12H9l-5 4z" /><path d="M8 10h8" /></svg>;
    if (status === 'UNDER_REVIEW') return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    if (status === 'RESOLVED') return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></svg>;
    return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6m0-6-6 6" /></svg>;
}

function ComplaintFieldIcon({ type }: { type: 'reason' | 'order' | 'party' | 'date' }) {
    if (type === 'reason') return <svg viewBox="0 0 24 24"><path d="M20 13 13 20l-9-9V4h7z" /><circle cx="8" cy="8" r="1" /></svg>;
    if (type === 'order') return <svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 12h6M9 16h6" /></svg>;
    if (type === 'party') return <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>;
    return <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 10h18" /></svg>;
}

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
        }}><section ref={previewRef} className="complaint-preview-dialog" role="dialog" aria-modal="true" aria-labelledby={`complaint-preview-title-${selected.id}`}>
            <header><h4 id={`complaint-preview-title-${selected.id}`}>{selected.original_name}</h4><button type="button" onClick={() => setSelected(null)} aria-label="Close evidence preview">Close</button></header>
            <img src={selected.url} alt={selected.original_name} />
        </section></div>}
    </>;
}

export function ComplaintQueue({ onError, initialCaseId, onInitialCaseHandled }: {
    onError: (message: string) => void;
    initialCaseId?: number;
    onInitialCaseHandled?: () => void;
}) {
    const [complaints, setComplaints] = React.useState<Complaint[]>([]);
    const [reason, setReason] = React.useState<Record<number, string>>({});
    const [refundAmount, setRefundAmount] = React.useState<Record<number, string>>({});
    const [replies, setReplies] = React.useState<Record<number, string>>({});
    const [payoutReference, setPayoutReference] = React.useState<Record<number, string>>({});
    const [providerRefundId, setProviderRefundId] = React.useState<Record<number, string>>({});
    const [decisionErrors, setDecisionErrors] = React.useState<Record<number, string>>({});
    const [caseType, setCaseType] = React.useState('');
    const [status, setStatus] = React.useState('');
    const [sort, setSort] = React.useState('newest');
    const [search, setSearch] = React.useState('');
    const [page, setPage] = React.useState(1);
    const [targetCaseId, setTargetCaseId] = React.useState<number | undefined>();
    const [expandedCases, setExpandedCases] = React.useState<Record<number, boolean>>({});
    const [total, setTotal] = React.useState(0);
    const [caseCounts, setCaseCounts] = React.useState<CaseCounts | null>(null);
    const [countsLoading, setCountsLoading] = React.useState(true);
    const [countsError, setCountsError] = React.useState('');
    const [loadError, setLoadError] = React.useState('');
    const [busy, setBusy] = React.useState<number | null>(null);
    const [loading, setLoading] = React.useState(true);
    const debouncedSearch = useDebouncedValue(search);
    const requestId = React.useRef(0);
    const countsRequestId = React.useRef(0);

    const load = React.useCallback(() => {
        const currentRequestId = ++requestId.current;
        setLoading(true);
        setLoadError('');
        api.get<{ complaints: { data: Complaint[]; total: number } }>('/api/admin/complaints', { params: { search: debouncedSearch || undefined, status: status || undefined, case_type: caseType || undefined, case_id: targetCaseId, sort, page } }).then((response) => {
            if (currentRequestId !== requestId.current) return;
            setComplaints(response.data.complaints.data);
            setTotal(response.data.complaints.total);
            setRefundAmount((current) => Object.fromEntries(response.data.complaints.data.map((item) => [item.id, current[item.id] ?? item.requested_amount ?? ''])));
        }).catch((requestError: any) => {
            if (currentRequestId !== requestId.current) return;
            const message = requestError.userMessage ?? (requestError.response?.status === 403 ? 'You do not have permission to review these cases.' : 'Cases could not be loaded.');
            setLoadError(message);
            onError(message);
        })
            .finally(() => { if (currentRequestId === requestId.current) setLoading(false); });
    }, [caseType, debouncedSearch, onError, page, sort, status, targetCaseId]);
    React.useEffect(() => {
        if (search !== debouncedSearch) { requestId.current += 1; return undefined; }
        load();
        return () => { requestId.current += 1; };
    }, [load, search, debouncedSearch]);

    const loadCounts = React.useCallback(async () => {
        const currentRequestId = ++countsRequestId.current;
        setCountsLoading(true);
        setCaseCounts(null);
        setCountsError('');
        try {
            const response = await api.get<{ case_counts: CaseCounts }>('/api/admin/complaints', {
                params: { search: debouncedSearch || undefined, case_type: caseType || undefined, summary: true },
            });
            if (currentRequestId !== countsRequestId.current) return;
            setCaseCounts(response.data.case_counts);
        } catch (requestError: any) {
            if (currentRequestId !== countsRequestId.current) return;
            const message = requestError.userMessage ?? (requestError.response?.status === 403 ? 'You do not have permission to load case counts.' : 'Case status counts could not be loaded.');
            setCountsError(message);
            onError(message);
        } finally {
            if (currentRequestId === countsRequestId.current) setCountsLoading(false);
        }
    }, [caseType, debouncedSearch, onError]);

    React.useEffect(() => {
        if (search !== debouncedSearch) {
            countsRequestId.current += 1;
            setCountsLoading(true);
            setCaseCounts(null);
            return undefined;
        }
        void loadCounts();
        return () => { countsRequestId.current += 1; };
    }, [loadCounts, search, debouncedSearch]);

    React.useEffect(() => {
        if (!initialCaseId) return;
        setTargetCaseId(initialCaseId);
        setExpandedCases((current) => ({ ...current, [initialCaseId]: true }));
        setPage(1);
        onInitialCaseHandled?.();
    }, [initialCaseId, onInitialCaseHandled]);

    async function updateStatus(item: Complaint, nextStatus: string) {
        const reasonText = reason[item.id]?.trim();
        if (!reasonText) {
            setDecisionErrors((current) => ({ ...current, [item.id]: 'An explanation is required for case status decisions.' }));
            return;
        }
        if (!await confirmAction({ title: `Set ${item.case_reference} to ${nextStatus.replaceAll('_', ' ').toLowerCase()}?`, text: 'The buyer and seller will see the decision and reason.', confirmText: 'Update case' })) return;
        setBusy(item.id);
        try {
            await initializeCsrf();
            await api.patch(`/api/admin/complaints/${item.id}`, { status: nextStatus, reason: reasonText });
            setDecisionErrors((current) => ({ ...current, [item.id]: '' }));
            showSuccess(`${item.case_reference} updated.`);
            load();
        } catch (requestError: any) { onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'The case could not be updated.'); }
        finally { setBusy(null); }
    }

    async function sendMessage(caseId: number) {
        if (!replies[caseId]?.trim()) { onError('Write a message before sending.'); return; }
        setBusy(caseId);
        try {
            await initializeCsrf();
            await api.post(`/api/cases/${caseId}/messages`, { message: replies[caseId] });
            setReplies((current) => ({ ...current, [caseId]: '' }));
            showSuccess(`Message added to case ${complaints.find((item) => item.id === caseId)?.case_reference ?? ''}.`);
            load();
        } catch (requestError: any) { onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'The message could not be sent.'); }
        finally { setBusy(null); }
    }

    async function approveRefund(item: Complaint) {
        const amount = Number(refundAmount[item.id]);
        if (!Number.isFinite(amount) || amount <= 0) { onError('Enter a valid approved refund amount.'); return; }
        if (!await confirmAction({ title: `Approve PHP ${amount.toFixed(2)} for ${item.case_reference}?`, text: 'The amount will be sent to PayMongo for paid online orders, or queued as a manual COD reimbursement.', confirmText: 'Approve refund' })) return;
        setBusy(item.id);
        try {
            await initializeCsrf();
            await api.post(`/api/admin/complaints/${item.id}/refund-approval`, { amount });
            showSuccess('Refund decision recorded. Provider confirmation is still required for PayMongo.');
            load();
        } catch (requestError: any) { onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'The refund could not be approved.'); }
        finally { setBusy(null); }
    }

    async function caseAction(item: Complaint, action: 'return-received' | 'manual-payout' | 'refund-sync') {
        const body = action === 'manual-payout'
            ? { payout_reference: payoutReference[item.id] }
            : action === 'refund-sync' ? { paymongo_refund_id: providerRefundId[item.id] || undefined } : {};
        if (action === 'manual-payout' && !payoutReference[item.id]?.trim()) { onError('Enter the manual payout reference before marking it paid.'); return; }
        const confirmation = action === 'manual-payout'
            ? { title: `Record the manual COD reimbursement for ${item.case_reference}?`, text: 'This records a reimbursement paid outside PayMongo. Ensure the payout reference is correct.', confirmText: 'Record reimbursement' }
            : action === 'return-received'
                ? { title: `Confirm the returned livestock for ${item.case_reference} was received?`, text: 'This updates the return workflow.', confirmText: 'Confirm receipt' }
                : null;
        if (confirmation && !await confirmAction(confirmation)) return;
        setBusy(item.id);
        try {
            await initializeCsrf();
            await api.post(`/api/admin/complaints/${item.id}/${action}`, body);
            showSuccess(action === 'refund-sync' ? 'PayMongo refund status refreshed.' : action === 'return-received' ? 'Return receipt recorded.' : 'Manual COD payout recorded.');
            load();
        } catch (requestError: any) { onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'The case action failed.'); }
        finally { setBusy(null); }
    }

    return <section className="complaint-queue" aria-labelledby="admin-complaints-title">
        <header className="complaint-queue-heading"><div><p className="eyebrow">Farmgate control room</p><h2 id="admin-complaints-title">Complaints &amp; Disputes</h2><p>Review buyer cases, evidence, and resolutions.</p></div><strong className="complaint-count" aria-live="polite">{total.toLocaleString()} matching {total === 1 ? 'case' : 'cases'}</strong></header>
        <section className="complaint-summary-grid" aria-label="Case status totals" aria-busy={countsLoading}>
            <article className="complaint-summary-card complaint-summary-all"><span className="complaint-summary-icon"><ComplaintSummaryIcon /></span><div><span>All cases</span><strong>{caseCounts?.total.toLocaleString() ?? (countsLoading ? '…' : '—')}</strong></div></article>
            {CASE_STATUSES.map(({ value, label }) => <article className={`complaint-summary-card complaint-summary-${value.toLowerCase()}`} key={value}>
                <span className="complaint-summary-icon"><ComplaintSummaryIcon status={value} /></span>
                <div><span>{label}</span><strong>{caseCounts?.statuses[value].toLocaleString() ?? (countsLoading ? '…' : '—')}</strong></div>
            </article>)}
        </section>
        {countsError && <p className="complaint-count-error" role="alert">{countsError}<button type="button" onClick={() => void loadCounts()}>Retry counts</button></p>}
        <div className="complaint-filters">
            <fieldset className="complaint-filter-group"><legend>Case type</legend><TabNav className="complaint-filter-tabs" label="Filter cases by type" value={caseType} onChange={(value) => { setCaseType(value); setPage(1); }} options={[{ value: '', label: 'All cases' }, { value: 'COMPLAINT', label: 'Complaints' }, { value: 'RETURN_REFUND', label: 'Returns / refunds' }]} /></fieldset>
            <fieldset className="complaint-filter-group"><legend>Case status</legend><TabNav className="complaint-filter-tabs" label="Filter cases by status" value={status} onChange={(value) => { setStatus(value); setPage(1); }} options={[{ value: '', label: 'All statuses' }, { value: 'OPEN', label: 'Open' }, { value: 'UNDER_REVIEW', label: 'Under review' }, { value: 'RESOLVED', label: 'Resolved' }, { value: 'REJECTED', label: 'Rejected' }]} /></fieldset>
        </div>
        <div className="complaint-queue-tools"><label className="control-search"><span>Search cases</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Case reference, order, reason, or party" /></label><label>Sort by<select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label></div>
        {loading ? <LoadingSkeleton variant="table" count={5} columns={8} label="Loading complaint cases" />
            : loadError ? <p className="complaint-queue-state complaint-queue-error" role="alert">{loadError}<button type="button" onClick={load}>Try again</button></p>
                : complaints.length > 0 ? <div className="data-table-wrap complaint-table-wrap">
                    <table className="data-table complaint-cases-table">
                        <thead><tr><th>Case reference</th><th>Type</th><th>Reason</th><th>Order reference</th><th>Reporting party</th><th>Status</th><th>Date</th><th>Action</th></tr></thead>
                        <tbody>{complaints.map((item) => {
            const deadline = item.seller_response_deadline ? new Date(item.seller_response_deadline) : null;
            const deadlineOverdue = deadline !== null && deadline.getTime() < Date.now() && !item.escalated_at;
            const expanded = Boolean(expandedCases[item.id]);
            return <React.Fragment key={item.id}>
                <tr className="complaint-case-row">
                    <td data-label="Case reference"><strong>{item.case_reference}</strong></td>
                    <td data-label="Type"><span className={`complaint-type-badge${item.case_type === 'RETURN_REFUND' ? ' is-return' : ''}`}><svg viewBox="0 0 24 24" aria-hidden="true">{item.case_type === 'RETURN_REFUND' ? <><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 8 9 5 9-5m-18 0v9l9 5 9-5V8m-9 5v9" /></> : <><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H7l-4 2v-5.2A7.5 7.5 0 1 1 20 11.5Z" /><path d="M8 11h.01M12 11h.01M16 11h.01" /></>}</svg>{item.case_type === 'RETURN_REFUND' ? 'Return / refund' : 'Complaint'}</span></td>
                    <td className="complaint-case-reason" data-label="Reason"><span className="complaint-mobile-field"><span className="complaint-mobile-field-icon"><ComplaintFieldIcon type="reason" /></span><span className="complaint-mobile-field-label">Reason:</span><span className="complaint-mobile-field-value">{item.reason}{item.other_reason ? `: ${item.other_reason}` : ''}</span></span></td>
                    <td data-label="Order reference"><span className="complaint-mobile-field"><span className="complaint-mobile-field-icon"><ComplaintFieldIcon type="order" /></span><span className="complaint-mobile-field-label">Order ref.:</span><span className="complaint-mobile-field-value">{item.order?.order_reference ?? 'Unavailable'}</span></span></td>
                    <td data-label="Reporting party"><span className="complaint-mobile-field"><span className="complaint-mobile-field-icon"><ComplaintFieldIcon type="party" /></span><span className="complaint-mobile-field-label">Party:</span><span className="complaint-mobile-field-value">{item.opened_by?.name ?? 'Buyer'}</span></span></td>
                    <td data-label="Status"><span className={`complaint-status complaint-status-${item.status.toLowerCase()}`}>{item.status.replaceAll('_', ' ')}</span></td>
                    <td data-label="Date"><span className="complaint-mobile-field"><span className="complaint-mobile-field-icon"><ComplaintFieldIcon type="date" /></span><span className="complaint-mobile-field-label">Date:</span><span className="complaint-mobile-field-value"><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleDateString()}</time></span></span></td>
                    <td data-label="Action"><ViewDetailsAction className="complaint-expand-button" contextLabel={`case ${item.case_reference}`} expanded={expanded} controls={`complaint-details-${item.id}`} onClick={() => setExpandedCases((current) => ({ ...current, [item.id]: !current[item.id] }))} /></td>
                </tr>
                <tr className="complaint-details-row" hidden={!expanded}><td colSpan={8}>
                <div id={`complaint-details-${item.id}`} className="complaint-case-details">
                {expanded && <>
                <header className="complaint-case-header"><div><p className="eyebrow">{item.case_reference} · {item.case_type === 'RETURN_REFUND' ? 'Return / refund' : 'Complaint'}</p><h3>{item.reason}{item.other_reason ? `: ${item.other_reason}` : ''}</h3><a href={`/admin/orders?search=${encodeURIComponent(item.order?.order_reference ?? '')}`} className="complaint-order-reference">Order {item.order?.order_reference ?? 'reference unavailable'}</a></div><span className={`complaint-status complaint-status-${item.status.toLowerCase()}`}>{item.status.replaceAll('_', ' ')}</span></header>
                <div className="complaint-case-grid">
                    <section className="complaint-case-section complaint-case-summary"><h4>Case summary</h4><p>{item.description}</p><dl><div><dt>Reported by</dt><dd>{item.opened_by?.name ?? 'Buyer'}</dd></div><div><dt>Responding party</dt><dd>{item.respondent?.name ?? 'Seller'}</dd></div><div><dt>Case status</dt><dd>{item.status.replaceAll('_', ' ')}</dd></div><div><dt>Seller response due</dt><dd className={deadlineOverdue || item.escalated_at ? 'complaint-deadline-overdue' : ''}>{deadline ? <time dateTime={deadline.toISOString()}>{deadline.toLocaleString()}</time> : 'Not set'}{(deadlineOverdue || item.escalated_at) && <strong> Overdue{item.escalated_at ? ' · escalated' : ''}</strong>}</dd></div></dl></section>
                    <section className="complaint-case-section"><h4>Order and items</h4><dl><div><dt>Order reference</dt><dd>{item.order?.order_reference ?? 'Not available'}</dd></div><div><dt>Order total</dt><dd>{item.order?.total_amount != null ? money.format(Number(item.order.total_amount)) : 'Not available'}</dd></div><div><dt>Delivery fee</dt><dd>{item.order?.delivery_fee != null ? money.format(Number(item.order.delivery_fee)) : 'Not available'}</dd></div><div><dt>Payment</dt><dd>{item.order?.payment_method ?? 'Unknown'} · {item.order?.payment_status ?? 'status unknown'}</dd></div></dl>{item.order?.items?.length ? <ul className="complaint-order-items">{item.order.items.map((orderItem) => <li key={orderItem.id}>{orderItem.quantity} × {orderItem.listing?.name ?? 'Livestock item'} <span>{money.format(Number(orderItem.total_amount))}</span></li>)}</ul> : <p className="complaint-muted">Order item details unavailable.</p>}</section>
                    <section className="complaint-case-section"><h4>Requested resolution</h4>{item.requested_amount ? <p>Requested amount <strong>{money.format(Number(item.requested_amount))}</strong></p> : <p>No monetary amount requested.</p>}{item.requested_items?.length ? <ul className="complaint-order-items">{item.requested_items.map((selected) => <li key={`${selected.name}-${selected.quantity}`}>{selected.quantity} × {selected.name} <span>{money.format(Number(selected.requested_amount))}</span></li>)}</ul> : null}{item.approved_refund_amount && <p>Approved amount: <strong>{money.format(Number(item.approved_refund_amount))}</strong></p>}<p>Refund / reimbursement state: <strong>{item.refund_status.replaceAll('_', ' ')}</strong></p>{item.payout_reference && <p>Payout reference: {item.payout_reference}</p>}{item.resolution_reason && <p>Decision reason: {item.resolution_reason}</p>}{item.payout_evidence_url && <a href={item.payout_evidence_url} target="_blank" rel="noreferrer">View protected COD payout evidence</a>}</section>
                    <section className="complaint-case-section"><h4>Evidence</h4><CaseMedia files={item.evidence_media} /></section>
                    <section className="complaint-case-section complaint-case-conversation"><h4>Conversation</h4>{item.messages?.length ? <ol className="complaint-message-list">{item.messages.map((message) => <li key={message.id}><header><strong>{message.sender?.name ?? 'Participant'}{message.sender?.role ? ` · ${message.sender.role}` : ''}</strong><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString()}</time></header><p>{message.message}</p>{message.media_files?.length ? <CaseMedia files={message.media_files} /> : null}</li>)}</ol> : <p className="complaint-muted">No messages yet.</p>}
                        {!['RESOLVED', 'REJECTED'].includes(item.status) && <div className="order-case-reply"><label htmlFor={`case-reply-${item.id}`}>Send a case update<textarea id={`case-reply-${item.id}`} value={replies[item.id] ?? ''} onChange={(event) => setReplies((current) => ({ ...current, [item.id]: event.target.value }))} maxLength={5000} /></label><button type="button" disabled={busy !== null} onClick={() => void sendMessage(item.id)}>{busy === item.id ? 'Sending…' : 'Send update'}</button></div>}
                    </section>
                    <section className="complaint-case-section complaint-case-history"><h4>Decision history</h4>{item.status_history?.length ? <ol>{item.status_history.map((entry, index) => <li key={`${entry.to_status}-${entry.created_at}-${index}`}><strong>{entry.from_status ? entry.from_status.replaceAll('_', ' ') : 'Case created'} → {entry.to_status.replaceAll('_', ' ')}</strong><span>{entry.actor?.name ?? 'Unknown admin'} · {new Date(entry.created_at).toLocaleString()}</span><p>{entry.reason ?? 'No reason recorded.'}</p></li>)}</ol> : <p className="complaint-muted">No status changes recorded.</p>}</section>
                    <section className="complaint-case-section complaint-admin-decision"><h4>Admin decision</h4>
                        <div className="complaint-decision-actions"><strong>Case status</strong><p>Review the case or record a final decision. A reason is required.</p><label htmlFor={`case-reason-${item.id}`}>Decision reason <span>(required)</span><textarea id={`case-reason-${item.id}`} value={reason[item.id] ?? ''} onChange={(event) => { setReason((current) => ({ ...current, [item.id]: event.target.value })); setDecisionErrors((current) => ({ ...current, [item.id]: '' })); }} aria-describedby={decisionErrors[item.id] ? `case-reason-error-${item.id}` : undefined} aria-invalid={Boolean(decisionErrors[item.id])} /></label>{decisionErrors[item.id] && <small id={`case-reason-error-${item.id}`} className="complaint-field-error" role="alert">{decisionErrors[item.id]}</small>}<div className="complaint-action-buttons"><button type="button" disabled={busy !== null || item.status === 'UNDER_REVIEW'} onClick={() => void updateStatus(item, 'UNDER_REVIEW')}>Review</button><button type="button" disabled={busy !== null || item.status === 'RESOLVED'} onClick={() => void updateStatus(item, 'RESOLVED')}>Resolve</button><button className="complaint-reject-button" type="button" disabled={busy !== null || item.status === 'REJECTED'} onClick={() => void updateStatus(item, 'REJECTED')}>Reject</button></div></div>
                        {item.case_type === 'RETURN_REFUND' && <div className="complaint-financial-actions"><strong>Refund / reimbursement</strong>{item.order?.payment_method === 'COD' && <p className="complaint-cod-note">COD case: reimbursement is handled manually outside PayMongo.</p>}{item.refund_status === 'REQUESTED' && <><label htmlFor={`refund-amount-${item.id}`}>Approved refund amount (PHP)<input id={`refund-amount-${item.id}`} type="number" min="0.01" max={item.order?.total_amount ?? undefined} step="0.01" value={refundAmount[item.id] ?? ''} onChange={(event) => setRefundAmount((current) => ({ ...current, [item.id]: event.target.value }))} /></label><button type="button" disabled={busy !== null} onClick={() => void approveRefund(item)}>{item.order?.payment_method === 'COD' ? 'Approve manual reimbursement' : 'Approve refund'}</button></>}
                            {item.refund_status === 'AWAITING_RETURN' && <button type="button" disabled={busy !== null} onClick={() => void caseAction(item, 'return-received')}>Confirm returned livestock received</button>}
                            {item.refund_status === 'MANUAL_ACTION_REQUIRED' && <><p>Manual reimbursement state: <strong>Action required</strong></p><label htmlFor={`payout-reference-${item.id}`}>Manual payout reference<input id={`payout-reference-${item.id}`} value={payoutReference[item.id] ?? ''} onChange={(event) => setPayoutReference((current) => ({ ...current, [item.id]: event.target.value }))} /></label><button type="button" disabled={busy !== null} onClick={() => void caseAction(item, 'manual-payout')}>{busy === item.id ? 'Recording…' : 'Record manual reimbursement as paid'}</button></>}
                            {(item.refund_status === 'PENDING_PROVIDER' || item.refund_status === 'FAILED' || item.refund_status === 'ACTION_REQUIRED' && item.order?.payment_method !== 'COD') && <><p>PayMongo refund state: <strong>{item.refund_status.replaceAll('_', ' ')}</strong></p>{item.refund_status === 'ACTION_REQUIRED' && !item.has_provider_refund && <label htmlFor={`provider-refund-${item.id}`}>PayMongo refund ID for reconciliation<input id={`provider-refund-${item.id}`} value={providerRefundId[item.id] ?? ''} onChange={(event) => setProviderRefundId((current) => ({ ...current, [item.id]: event.target.value }))} /></label>}<button type="button" disabled={busy !== null} onClick={() => void caseAction(item, 'refund-sync')}>{item.refund_status === 'ACTION_REQUIRED' ? 'Reconcile PayMongo refund' : item.refund_status === 'FAILED' ? 'Recheck failed PayMongo refund' : 'Refresh PayMongo refund status'}</button>{item.refund_status === 'ACTION_REQUIRED' && <small>Farmgate verifies the payment and amount; do not submit another refund.</small>}</>}
                        </div>}
                    </section>
                </div>
                </>}
                </div>
                </td></tr>
            </React.Fragment>;
        })}</tbody>
                    </table>
                </div>
                : <p className="complaint-queue-state" role="status">{total === 0 ? 'No cases match the current search and filters.' : 'No cases on this page.'}</p>}
        {!loading && !loadError && <footer className="complaint-table-footer"><p aria-live="polite">Showing {total === 0 ? 0 : Math.min((page - 1) * 15 + 1, total)}–{Math.min(page * 15, total)} of {total.toLocaleString()} {total === 1 ? 'case' : 'cases'}</p><Pagination page={page} lastPage={Math.max(1, Math.ceil(total / 15))} onChange={setPage} label="Complaint case pages" /></footer>}
    </section>;
}
