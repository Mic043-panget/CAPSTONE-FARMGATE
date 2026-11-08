import React from 'react';
import api, { initializeCsrf } from '../../lib/api';
import { Pagination } from '../../shared/components/Pagination';
import { TabNav } from '../../shared/components/TabNav';
import { confirmAction, showSuccess } from '../../lib/alerts';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';

type Media = { id: number; mime_type: string; original_name: string; url: string };
type Message = { id: number; message: string; sender?: { name: string }; created_at: string; media_files?: Media[] };
type Complaint = {
    id: number;
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
    order?: { order_reference: string; total_amount?: string; payment_method?: string; payment_status?: string };
    evidence_media?: Media[];
    messages?: Message[];
};

function CaseMedia({ files }: { files?: Media[] }) {
    if (!files?.length) return null;
    return <div className="case-saved-media">{files.map((file) => file.mime_type.startsWith('video/')
        ? <video key={file.id} src={file.url} controls aria-label={file.original_name} />
        : <a key={file.id} href={file.url} target="_blank" rel="noreferrer"><img src={file.url} alt={file.original_name} /></a>)}</div>;
}

export function ComplaintQueue({ onError }: { onError: (message: string) => void }) {
    const [complaints, setComplaints] = React.useState<Complaint[]>([]);
    const [reason, setReason] = React.useState<Record<number, string>>({});
    const [refundAmount, setRefundAmount] = React.useState<Record<number, string>>({});
    const [replies, setReplies] = React.useState<Record<number, string>>({});
    const [payoutReference, setPayoutReference] = React.useState<Record<number, string>>({});
    const [providerRefundId, setProviderRefundId] = React.useState<Record<number, string>>({});
    const [caseType, setCaseType] = React.useState('');
    const [status, setStatus] = React.useState('');
    const [search, setSearch] = React.useState('');
    const [page, setPage] = React.useState(1);
    const [total, setTotal] = React.useState(0);
    const [busy, setBusy] = React.useState<number | null>(null);
    const debouncedSearch = useDebouncedValue(search);
    const requestId = React.useRef(0);

    const load = React.useCallback(() => {
        const currentRequestId = ++requestId.current;
        api.get<{ complaints: { data: Complaint[]; total: number } }>('/api/admin/complaints', { params: { search: debouncedSearch || undefined, status: status || undefined, case_type: caseType || undefined, page } }).then((response) => {
            if (currentRequestId !== requestId.current) return;
            setComplaints(response.data.complaints.data);
            setTotal(response.data.complaints.total);
            setRefundAmount((current) => Object.fromEntries(response.data.complaints.data.map((item) => [item.id, current[item.id] ?? item.requested_amount ?? ''])));
        }).catch((requestError: any) => { if (currentRequestId === requestId.current) onError(requestError.userMessage ?? 'Cases could not be loaded.'); });
    }, [caseType, debouncedSearch, onError, page, status]);
    React.useEffect(() => {
        if (search !== debouncedSearch) { requestId.current += 1; return undefined; }
        load();
        return () => { requestId.current += 1; };
    }, [load, search, debouncedSearch]);

    async function updateStatus(item: Complaint, nextStatus: string) {
        const reasonText = reason[item.id]?.trim();
        if (!reasonText) { onError('Enter an explanation before changing a case status.'); return; }
        if (!await confirmAction({ title: `Set case #${item.id} to ${nextStatus.replaceAll('_', ' ').toLowerCase()}?`, text: 'The buyer and seller will see the decision and reason.', confirmText: 'Update case' })) return;
        setBusy(item.id);
        try {
            await initializeCsrf();
            await api.patch(`/api/admin/complaints/${item.id}`, { status: nextStatus, reason: reasonText });
            showSuccess(`Case #${item.id} updated.`);
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
            showSuccess(`Message added to case #${caseId}.`);
            load();
        } catch (requestError: any) { onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'The message could not be sent.'); }
        finally { setBusy(null); }
    }

    async function approveRefund(item: Complaint) {
        const amount = Number(refundAmount[item.id]);
        if (!Number.isFinite(amount) || amount <= 0) { onError('Enter a valid approved refund amount.'); return; }
        if (!await confirmAction({ title: `Approve PHP ${amount.toFixed(2)} for case #${item.id}?`, text: 'The amount will be sent to PayMongo for paid online orders, or queued as a manual COD reimbursement.', confirmText: 'Approve refund' })) return;
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
        <div className="section-heading"><div><p className="eyebrow">Admin review</p><h2>Complaints, returns &amp; refunds</h2></div><span className="record-count">{total} records</span></div>
        <TabNav label="Case type" value={caseType} onChange={(value) => { setCaseType(value); setPage(1); }} options={[{ value: '', label: 'All cases' }, { value: 'COMPLAINT', label: 'Complaints' }, { value: 'RETURN_REFUND', label: 'Returns/refunds' }]} />
        <TabNav label="Case status" value={status} onChange={(value) => { setStatus(value); setPage(1); }} options={[{ value: '', label: 'All statuses' }, { value: 'OPEN', label: 'Open' }, { value: 'UNDER_REVIEW', label: 'Under review' }, { value: 'RESOLVED', label: 'Resolved' }, { value: 'REJECTED', label: 'Rejected' }]} />
        <div className="list-tools"><label className="control-search"><span className="sr-only">Search cases</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search cases" /></label></div>
        {complaints.map((item) => <article className="complaint-item" key={item.id}>
            <strong>#{item.id} · {item.case_type === 'RETURN_REFUND' ? 'Return/refund' : 'Complaint'} · {item.reason}{item.other_reason ? `: ${item.other_reason}` : ''}</strong>
            <span>{item.status.replaceAll('_', ' ')} · {item.order?.order_reference ?? 'Order'} · {item.opened_by?.name ?? 'Buyer'}{item.escalated_at ? ' · Seller response overdue; escalated' : ''}</span>
            <p>{item.description}</p>
            {item.requested_amount && <p>Requested item amount PHP {Number(item.requested_amount).toFixed(2)} · {item.order?.payment_method ?? 'payment unknown'} · {item.order?.payment_status ?? 'payment status unknown'}</p>}
            {!!item.requested_items?.length && <ul>{item.requested_items.map((selected) => <li key={`${selected.name}-${selected.quantity}`}>{selected.quantity} × {selected.name} · PHP {Number(selected.requested_amount).toFixed(2)}</li>)}</ul>}
            {item.approved_refund_amount && <p>Approved PHP {Number(item.approved_refund_amount).toFixed(2)} · refund state {item.refund_status.replaceAll('_', ' ')}{item.payout_reference ? ` · payout ${item.payout_reference}` : ''}</p>}
            {item.payout_evidence_url && <a href={item.payout_evidence_url} target="_blank" rel="noreferrer">View COD payout evidence</a>}
            {item.resolution_reason && <p>Resolution: {item.resolution_reason}</p>}
            <CaseMedia files={item.evidence_media} />
            <ol className="order-case-messages">{item.messages?.map((message) => <li key={message.id}><strong>{message.sender?.name ?? 'Participant'}</strong><time>{new Date(message.created_at).toLocaleString()}</time><p>{message.message}</p><CaseMedia files={message.media_files} /></li>)}</ol>
            {!['RESOLVED', 'REJECTED'].includes(item.status) && <div className="order-case-reply">
                <label>Send a case update<textarea value={replies[item.id] ?? ''} onChange={(event) => setReplies((current) => ({ ...current, [item.id]: event.target.value }))} maxLength={5000} /></label>
                <button type="button" disabled={busy !== null} onClick={() => void sendMessage(item.id)}>Send update</button>
            </div>}
            {item.case_type === 'RETURN_REFUND' && item.refund_status === 'REQUESTED' && <div className="refund-admin-actions">
                <label>Approved amount (PHP)<input type="number" min="0.01" max={item.order?.total_amount ?? undefined} step="0.01" value={refundAmount[item.id] ?? ''} onChange={(event) => setRefundAmount((current) => ({ ...current, [item.id]: event.target.value }))} /></label>
                <button type="button" disabled={busy !== null} onClick={() => void approveRefund(item)}>Approve refund / manual reimbursement</button>
            </div>}
            {item.refund_status === 'AWAITING_RETURN' && <button type="button" disabled={busy !== null} onClick={() => void caseAction(item, 'return-received')}>Confirm returned livestock received</button>}
            {item.refund_status === 'MANUAL_ACTION_REQUIRED' && <div className="refund-admin-actions">
                <label>COD payout reference<input value={payoutReference[item.id] ?? ''} onChange={(event) => setPayoutReference((current) => ({ ...current, [item.id]: event.target.value }))} /></label>
                <button type="button" disabled={busy !== null} onClick={() => void caseAction(item, 'manual-payout')}>Record payout as paid</button>
            </div>}
            {(item.refund_status === 'PENDING_PROVIDER' || item.refund_status === 'FAILED' || item.refund_status === 'ACTION_REQUIRED' && item.order?.payment_method !== 'COD') && <div className="refund-admin-actions">
                {item.refund_status === 'ACTION_REQUIRED' && !item.has_provider_refund && <label>PayMongo refund ID for reconciliation<input value={providerRefundId[item.id] ?? ''} onChange={(event) => setProviderRefundId((current) => ({ ...current, [item.id]: event.target.value }))} /></label>}
                <button type="button" disabled={busy !== null} onClick={() => void caseAction(item, 'refund-sync')}>{item.refund_status === 'ACTION_REQUIRED' ? 'Reconcile PayMongo refund' : item.refund_status === 'FAILED' ? 'Recheck failed PayMongo refund' : 'Refresh PayMongo refund status'}</button>
                {item.refund_status === 'ACTION_REQUIRED' && <small>Enter the refund ID from PayMongo if it is not already saved. Farmgate verifies the payment and amount; do not submit another refund.</small>}
            </div>}
            <label>Admin status decision reason<input placeholder="Required for resolve/reject" value={reason[item.id] ?? ''} onChange={(event) => setReason((current) => ({ ...current, [item.id]: event.target.value }))} /></label>
            <div><button type="button" disabled={busy !== null} onClick={() => void updateStatus(item, 'UNDER_REVIEW')}>Review</button><button type="button" disabled={busy !== null} onClick={() => void updateStatus(item, 'RESOLVED')}>Resolve</button><button type="button" disabled={busy !== null} onClick={() => void updateStatus(item, 'REJECTED')}>Reject</button></div>
            <small>Seller response due {item.seller_response_deadline ? new Date(item.seller_response_deadline).toLocaleString() : '—'} · Case decisions require admin action.</small>
        </article>)}
        {!complaints.length && <p className="empty-state">No cases are waiting.</p>}
        <Pagination page={page} lastPage={Math.ceil(total / 15)} onChange={setPage} />
    </section>;
}
