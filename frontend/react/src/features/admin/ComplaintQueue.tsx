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
    order?: {
        order_reference: string; total_amount?: string; delivery_fee?: string; payment_method?: string;
        payment_status?: string; items?: { id: number; listing?: { name: string }; quantity: number; total_amount: string | number }[];
    };
    evidence_media?: Media[];
    messages?: Message[];
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
    const [busy, setBusy] = React.useState<number | null>(null);
    const [loading, setLoading] = React.useState(true);
    const debouncedSearch = useDebouncedValue(search);
    const requestId = React.useRef(0);

    const load = React.useCallback(() => {
        const currentRequestId = ++requestId.current;
        setLoading(true);
        api.get<{ complaints: { data: Complaint[]; total: number } }>('/api/admin/complaints', { params: { search: debouncedSearch || undefined, status: status || undefined, case_type: caseType || undefined, case_id: targetCaseId, sort, page } }).then((response) => {
            if (currentRequestId !== requestId.current) return;
            setComplaints(response.data.complaints.data);
            setTotal(response.data.complaints.total);
            setRefundAmount((current) => Object.fromEntries(response.data.complaints.data.map((item) => [item.id, current[item.id] ?? item.requested_amount ?? ''])));
        }).catch((requestError: any) => { if (currentRequestId === requestId.current) onError(requestError.userMessage ?? (requestError.response?.status === 403 ? 'You do not have permission to review these cases.' : 'Cases could not be loaded.')); })
            .finally(() => { if (currentRequestId === requestId.current) setLoading(false); });
    }, [caseType, debouncedSearch, onError, page, sort, status, targetCaseId]);
    React.useEffect(() => {
        if (search !== debouncedSearch) { requestId.current += 1; return undefined; }
        load();
        return () => { requestId.current += 1; };
    }, [load, search, debouncedSearch]);

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

    return <section className="complaint-queue">
        <header className="complaint-queue-heading"><div><p className="eyebrow">Admin review</p><h2>Complaints &amp; Disputes</h2><p>Review buyer cases, evidence, and requested resolutions.</p></div><strong className="complaint-count" aria-live="polite">{total} matching {total === 1 ? 'case' : 'cases'}</strong></header>
        <div className="complaint-filters">
            <fieldset className="complaint-filter-group"><legend>Case type</legend><TabNav className="complaint-filter-tabs" label="Filter cases by type" value={caseType} onChange={(value) => { setCaseType(value); setPage(1); }} options={[{ value: '', label: 'All cases' }, { value: 'COMPLAINT', label: 'Complaints' }, { value: 'RETURN_REFUND', label: 'Returns / refunds' }]} /></fieldset>
            <fieldset className="complaint-filter-group"><legend>Case status</legend><TabNav className="complaint-filter-tabs" label="Filter cases by status" value={status} onChange={(value) => { setStatus(value); setPage(1); }} options={[{ value: '', label: 'All statuses' }, { value: 'OPEN', label: 'Open' }, { value: 'UNDER_REVIEW', label: 'Under review' }, { value: 'RESOLVED', label: 'Resolved' }, { value: 'REJECTED', label: 'Rejected' }]} /></fieldset>
            <div className="complaint-queue-tools"><label className="control-search"><span>Search cases</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Case number, order, reason, or party" /></label><label>Sort by<select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label></div>
        </div>
        {loading ? <LoadingSkeleton variant="table" count={5} columns={8} label="Loading complaint cases" /> : complaints.map((item) => {
            const deadline = item.seller_response_deadline ? new Date(item.seller_response_deadline) : null;
            const deadlineOverdue = deadline !== null && deadline.getTime() < Date.now() && !item.escalated_at;
            const expanded = Boolean(expandedCases[item.id]);
            return <article className={`complaint-case-card${expanded ? ' expanded' : ''}`} key={item.id}>
                <div className="complaint-case-compact" role="group" aria-label={`${item.case_reference}, ${item.case_type === 'RETURN_REFUND' ? 'return or refund' : 'complaint'}`}>
                    <span className="complaint-compact-field complaint-compact-reference" data-label="Case reference"><strong>{item.case_reference}</strong></span>
                    <span className="complaint-compact-field" data-label="Type">{item.case_type === 'RETURN_REFUND' ? 'Return / refund' : 'Complaint'}</span>
                    <span className="complaint-compact-field complaint-compact-reason" data-label="Reason">{item.reason}{item.other_reason ? `: ${item.other_reason}` : ''}</span>
                    <span className="complaint-compact-field" data-label="Order reference">{item.order?.order_reference ?? 'Unavailable'}</span>
                    <span className="complaint-compact-field" data-label="Reported by">{item.opened_by?.name ?? 'Buyer'}</span>
                    <span className="complaint-compact-field" data-label="Status"><span className={`complaint-status complaint-status-${item.status.toLowerCase()}`}>{item.status.replaceAll('_', ' ')}</span></span>
                    <time className="complaint-compact-field" data-label="Submitted" dateTime={item.created_at}>{new Date(item.created_at).toLocaleDateString()}</time>
                    <ViewDetailsAction className="complaint-expand-button" contextLabel={`case ${item.case_reference}`} expanded={expanded} controls={`complaint-details-${item.id}`} onClick={() => setExpandedCases((current) => ({ ...current, [item.id]: !current[item.id] }))} />
                </div>
                <div id={`complaint-details-${item.id}`} className="complaint-case-details" hidden={!expanded}>
                <header className="complaint-case-header"><div><p className="eyebrow">{item.case_reference} · {item.case_type === 'RETURN_REFUND' ? 'Return / refund' : 'Complaint'}</p><h3>{item.reason}{item.other_reason ? `: ${item.other_reason}` : ''}</h3><a href={`/admin/orders?search=${encodeURIComponent(item.order?.order_reference ?? '')}`} className="complaint-order-reference">Order {item.order?.order_reference ?? 'reference unavailable'}</a></div><span className={`complaint-status complaint-status-${item.status.toLowerCase()}`}>{item.status.replaceAll('_', ' ')}</span></header>
                <div className="complaint-case-grid">
                    <section className="complaint-case-section complaint-case-summary"><h4>Case summary</h4><p>{item.description}</p><dl><div><dt>Reported by</dt><dd>{item.opened_by?.name ?? 'Buyer'}</dd></div><div><dt>Responding party</dt><dd>{item.respondent?.name ?? 'Seller'}</dd></div><div><dt>Case status</dt><dd>{item.status.replaceAll('_', ' ')}</dd></div><div><dt>Seller response due</dt><dd className={deadlineOverdue || item.escalated_at ? 'complaint-deadline-overdue' : ''}>{deadline ? <time dateTime={deadline.toISOString()}>{deadline.toLocaleString()}</time> : 'Not set'}{(deadlineOverdue || item.escalated_at) && <strong> Overdue{item.escalated_at ? ' · escalated' : ''}</strong>}</dd></div></dl></section>
                    <section className="complaint-case-section"><h4>Order and items</h4><dl><div><dt>Order reference</dt><dd>{item.order?.order_reference ?? 'Not available'}</dd></div><div><dt>Order total</dt><dd>{item.order?.total_amount != null ? money.format(Number(item.order.total_amount)) : 'Not available'}</dd></div><div><dt>Delivery fee</dt><dd>{item.order?.delivery_fee != null ? money.format(Number(item.order.delivery_fee)) : 'Not available'}</dd></div><div><dt>Payment</dt><dd>{item.order?.payment_method ?? 'Unknown'} · {item.order?.payment_status ?? 'status unknown'}</dd></div></dl>{item.order?.items?.length ? <ul className="complaint-order-items">{item.order.items.map((orderItem) => <li key={orderItem.id}>{orderItem.quantity} × {orderItem.listing?.name ?? 'Livestock item'} <span>{money.format(Number(orderItem.total_amount))}</span></li>)}</ul> : <p className="complaint-muted">Order item details unavailable.</p>}</section>
                    <section className="complaint-case-section"><h4>Requested resolution</h4>{item.requested_amount ? <p>Requested amount <strong>{money.format(Number(item.requested_amount))}</strong></p> : <p>No monetary amount requested.</p>}{item.requested_items?.length ? <ul className="complaint-order-items">{item.requested_items.map((selected) => <li key={`${selected.name}-${selected.quantity}`}>{selected.quantity} × {selected.name} <span>{money.format(Number(selected.requested_amount))}</span></li>)}</ul> : null}{item.approved_refund_amount && <p>Approved amount: <strong>{money.format(Number(item.approved_refund_amount))}</strong></p>}<p>Refund / reimbursement state: <strong>{item.refund_status.replaceAll('_', ' ')}</strong></p>{item.payout_reference && <p>Payout reference: {item.payout_reference}</p>}{item.resolution_reason && <p>Decision reason: {item.resolution_reason}</p>}{item.payout_evidence_url && <a href={item.payout_evidence_url} target="_blank" rel="noreferrer">View protected COD payout evidence</a>}</section>
                    <section className="complaint-case-section"><h4>Evidence</h4><CaseMedia files={item.evidence_media} /></section>
                    <section className="complaint-case-section complaint-case-conversation"><h4>Conversation</h4>{item.messages?.length ? <ol className="complaint-message-list">{item.messages.map((message) => <li key={message.id}><header><strong>{message.sender?.name ?? 'Participant'}{message.sender?.role ? ` · ${message.sender.role}` : ''}</strong><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString()}</time></header><p>{message.message}</p>{message.media_files?.length ? <CaseMedia files={message.media_files} /> : null}</li>)}</ol> : <p className="complaint-muted">No messages yet.</p>}
                        {!['RESOLVED', 'REJECTED'].includes(item.status) && <div className="order-case-reply"><label htmlFor={`case-reply-${item.id}`}>Send a case update<textarea id={`case-reply-${item.id}`} value={replies[item.id] ?? ''} onChange={(event) => setReplies((current) => ({ ...current, [item.id]: event.target.value }))} maxLength={5000} /></label><button type="button" disabled={busy !== null} onClick={() => void sendMessage(item.id)}>{busy === item.id ? 'Sending…' : 'Send update'}</button></div>}
                    </section>
                    <section className="complaint-case-section complaint-admin-decision"><h4>Admin decision</h4>
                        <div className="complaint-decision-actions"><strong>Case status</strong><p>Review the case or record a final decision. A reason is required.</p><label htmlFor={`case-reason-${item.id}`}>Decision reason <span>(required)</span><textarea id={`case-reason-${item.id}`} value={reason[item.id] ?? ''} onChange={(event) => { setReason((current) => ({ ...current, [item.id]: event.target.value })); setDecisionErrors((current) => ({ ...current, [item.id]: '' })); }} aria-describedby={decisionErrors[item.id] ? `case-reason-error-${item.id}` : undefined} aria-invalid={Boolean(decisionErrors[item.id])} /></label>{decisionErrors[item.id] && <small id={`case-reason-error-${item.id}`} className="complaint-field-error" role="alert">{decisionErrors[item.id]}</small>}<div className="complaint-action-buttons"><button type="button" disabled={busy !== null || item.status === 'UNDER_REVIEW'} onClick={() => void updateStatus(item, 'UNDER_REVIEW')}>Review</button><button type="button" disabled={busy !== null || item.status === 'RESOLVED'} onClick={() => void updateStatus(item, 'RESOLVED')}>Resolve</button><button className="complaint-reject-button" type="button" disabled={busy !== null || item.status === 'REJECTED'} onClick={() => void updateStatus(item, 'REJECTED')}>Reject</button></div></div>
                        {item.case_type === 'RETURN_REFUND' && <div className="complaint-financial-actions"><strong>Refund / reimbursement</strong>{item.order?.payment_method === 'COD' && <p className="complaint-cod-note">COD case: reimbursement is handled manually outside PayMongo.</p>}{item.refund_status === 'REQUESTED' && <><label htmlFor={`refund-amount-${item.id}`}>Approved refund amount (PHP)<input id={`refund-amount-${item.id}`} type="number" min="0.01" max={item.order?.total_amount ?? undefined} step="0.01" value={refundAmount[item.id] ?? ''} onChange={(event) => setRefundAmount((current) => ({ ...current, [item.id]: event.target.value }))} /></label><button type="button" disabled={busy !== null} onClick={() => void approveRefund(item)}>{item.order?.payment_method === 'COD' ? 'Approve manual reimbursement' : 'Approve refund'}</button></>}
                            {item.refund_status === 'AWAITING_RETURN' && <button type="button" disabled={busy !== null} onClick={() => void caseAction(item, 'return-received')}>Confirm returned livestock received</button>}
                            {item.refund_status === 'MANUAL_ACTION_REQUIRED' && <><p>Manual reimbursement state: <strong>Action required</strong></p><label htmlFor={`payout-reference-${item.id}`}>Manual payout reference<input id={`payout-reference-${item.id}`} value={payoutReference[item.id] ?? ''} onChange={(event) => setPayoutReference((current) => ({ ...current, [item.id]: event.target.value }))} /></label><button type="button" disabled={busy !== null} onClick={() => void caseAction(item, 'manual-payout')}>{busy === item.id ? 'Recording…' : 'Record manual reimbursement as paid'}</button></>}
                            {(item.refund_status === 'PENDING_PROVIDER' || item.refund_status === 'FAILED' || item.refund_status === 'ACTION_REQUIRED' && item.order?.payment_method !== 'COD') && <><p>PayMongo refund state: <strong>{item.refund_status.replaceAll('_', ' ')}</strong></p>{item.refund_status === 'ACTION_REQUIRED' && !item.has_provider_refund && <label htmlFor={`provider-refund-${item.id}`}>PayMongo refund ID for reconciliation<input id={`provider-refund-${item.id}`} value={providerRefundId[item.id] ?? ''} onChange={(event) => setProviderRefundId((current) => ({ ...current, [item.id]: event.target.value }))} /></label>}<button type="button" disabled={busy !== null} onClick={() => void caseAction(item, 'refund-sync')}>{item.refund_status === 'ACTION_REQUIRED' ? 'Reconcile PayMongo refund' : item.refund_status === 'FAILED' ? 'Recheck failed PayMongo refund' : 'Refresh PayMongo refund status'}</button>{item.refund_status === 'ACTION_REQUIRED' && <small>Farmgate verifies the payment and amount; do not submit another refund.</small>}</>}
                        </div>}
                    </section>
                </div>
                </div>
            </article>;
        })}
        {!loading && !complaints.length && <p className="complaint-queue-state" role="status">{total === 0 ? 'No cases match the current search and filters.' : 'No cases on this page.'}</p>}
        {!loading && <Pagination page={page} lastPage={Math.max(1, Math.ceil(total / 15))} onChange={setPage} />}
    </section>;
}
