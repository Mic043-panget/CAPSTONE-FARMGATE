import React from 'react';
import api from '../../lib/api';
import { Pagination } from '../../shared/components/Pagination';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';

type VerificationStatus = 'NOT_SUBMITTED' | 'PENDING' | 'VERIFIED' | 'REJECTED' | 'ALL';
type VerificationRow = {
    id: number;
    name: string;
    shop_name: string | null;
    verification_status: Exclude<VerificationStatus, 'ALL'>;
    submitted_at: string | null;
    reviewed_at: string | null;
};
type VerificationDetail = VerificationRow & {
    business_name: string | null;
    verification_rejection_reason: string | null;
    document: {
        mime_type: string;
        size: number;
        uploaded_at: string;
        view_url: string;
        viewed_by_current_admin: boolean;
        reviewed_by_current_admin: boolean;
    } | null;
    audit_history: { action: string; description: string; actor: string; created_at: string }[];
};
type Paginated<T> = { data: T[]; current_page: number; last_page: number; total: number };

function requestErrorMessage(error: unknown, fallback: string): string {
    if (typeof error === 'object' && error !== null && 'userMessage' in error && typeof error.userMessage === 'string') {
        return error.userMessage;
    }

    return fallback;
}

const statusLabels: Record<VerificationStatus, string> = {
    ALL: 'All statuses',
    NOT_SUBMITTED: 'Not submitted',
    PENDING: 'Pending review',
    VERIFIED: 'Verified',
    REJECTED: 'Rejected',
};

export function AdminSellerVerificationPage() {
    const [sellers, setSellers] = React.useState<Paginated<VerificationRow> | null>(null);
    const [selected, setSelected] = React.useState<VerificationDetail | null>(null);
    const [search, setSearch] = React.useState('');
    const [status, setStatus] = React.useState<VerificationStatus>('PENDING');
    const [page, setPage] = React.useState(1);
    const [loading, setLoading] = React.useState(true);
    const [detailLoading, setDetailLoading] = React.useState(false);
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState('');
    const [decisionError, setDecisionError] = React.useState('');
    const [notice, setNotice] = React.useState('');
    const [rejectionReason, setRejectionReason] = React.useState('');
    const [revision, setRevision] = React.useState(0);
    const debouncedSearch = useDebouncedValue(search);
    const requestId = React.useRef(0);

    React.useEffect(() => {
        if (search !== debouncedSearch) return undefined;
        const current = ++requestId.current;
        setLoading(true);
        setError('');
        api.get<{ sellers: Paginated<VerificationRow> }>('/api/admin/seller-verifications', {
            params: { status, search: debouncedSearch || undefined, page },
        }).then(({ data }) => {
            if (current === requestId.current) setSellers(data.sellers);
        }).catch((requestError: unknown) => {
            if (current === requestId.current) setError(requestErrorMessage(requestError, 'Seller verification records could not be loaded.'));
        }).finally(() => {
            if (current === requestId.current) setLoading(false);
        });

        return () => { requestId.current += 1; };
    }, [debouncedSearch, page, revision, search, status]);

    async function openDetails(sellerId: number) {
        setSelected(null);
        setDetailLoading(true);
        setDecisionError('');
        setNotice('');
        try {
            const { data } = await api.get<{ seller: VerificationDetail }>(`/api/admin/seller-verifications/${sellerId}`);
            setSelected(data.seller);
        } catch (requestError: unknown) {
            setDecisionError(requestErrorMessage(requestError, 'Seller verification details could not be loaded.'));
        } finally {
            setDetailLoading(false);
        }
    }

    async function decide(status: 'VERIFIED' | 'REJECTED') {
        if (!selected || saving) return;
        const reason = rejectionReason.trim();
        if (status === 'REJECTED' && reason.length < 8) {
            setDecisionError('Enter a rejection reason of at least 8 characters so the seller can correct and resubmit.');
            return;
        }

        setSaving(true);
        setDecisionError('');
        setNotice('');
        try {
            await api.post(`/api/admin/seller-verifications/${selected.id}/decision`, {
                status,
                ...(status === 'REJECTED' ? { rejection_reason: reason } : {}),
            });
            setNotice(status === 'VERIFIED' ? 'Seller identity verification approved.' : 'Seller identity verification rejected; the reason was sent to the seller.');
            setSelected(null);
            setRejectionReason('');
            setRevision((value) => value + 1);
        } catch (requestError: unknown) {
            setDecisionError(requestErrorMessage(requestError, 'The verification decision could not be saved.'));
        } finally {
            setSaving(false);
        }
    }

    async function confirmDocumentReviewed() {
        if (!selected || saving) return;
        setSaving(true);
        setDecisionError('');
        try {
            const { data } = await api.post<{ seller: VerificationDetail }>(`/api/admin/seller-verifications/${selected.id}/document/reviewed`);
            setSelected(data.seller);
            setNotice('Document review has been recorded in the audit history.');
        } catch (requestError: unknown) {
            setDecisionError(requestErrorMessage(requestError, 'Document review could not be recorded.'));
        } finally {
            setSaving(false);
        }
    }

    return <section className="admin-seller-verification" aria-labelledby="admin-seller-verification-title">
        <header className="seller-work-heading">
            <div><p className="eyebrow">Seller governance</p><h2 id="admin-seller-verification-title">Seller identity verification</h2><p>Review submitted identity documents privately. A public Verified badge appears only after approval.</p></div>
        </header>
        <div className="seller-verification-controls">
            <label className="search-field"><span className="sr-only">Search seller verifications</span><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search farm or seller name" /></label>
            <label>Status<select value={status} onChange={(event) => { setStatus(event.target.value as VerificationStatus); setPage(1); }} aria-label="Filter by verification status">{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <button type="button" className="seller-inline-action" disabled={loading} onClick={() => setRevision((value) => value + 1)}>{loading ? 'Refreshing...' : 'Refresh'}</button>
        </div>
        {error && <p className="seller-shop-settings-error" role="alert">{error}<button type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button></p>}
        {notice && <p className="seller-notice" role="status">{notice}</p>}
        {decisionError && <p className="seller-shop-settings-error" role="alert">{decisionError}</p>}
        {loading ? <p className="seller-loading" role="status">Loading seller verifications...</p>
            : sellers?.data.length ? <div className="seller-verification-results">
                <p className="seller-verification-count" aria-live="polite">{sellers.total} seller {sellers.total === 1 ? 'record' : 'records'}</p>
                <div className="seller-verification-list">
                    {sellers.data.map((seller) => <article className="seller-verification-row" key={seller.id}>
                        <div className="seller-verification-row-copy"><strong>{seller.shop_name || seller.name}</strong><span>Seller: {seller.name}</span><small>{seller.submitted_at ? `Submitted ${new Date(seller.submitted_at).toLocaleString()}` : 'No identity document submitted'}</small></div>
                        <span className={`status-pill status-${seller.verification_status.toLowerCase()}`}>{statusLabels[seller.verification_status]}</span>
                        <button className="seller-inline-action" type="button" onClick={() => void openDetails(seller.id)}>View details</button>
                    </article>)}
                </div>
                <Pagination page={sellers.current_page} lastPage={sellers.last_page} onChange={setPage} />
            </div> : !error && <div className="seller-empty"><h3>No matching seller records</h3><p>Try a different search or status filter.</p></div>}

        {detailLoading && <p className="seller-loading" role="status">Loading private review details...</p>}
        {selected && <section className="seller-verification-detail" aria-labelledby="seller-verification-detail-title">
            <div className="seller-verification-detail-heading"><div><p className="eyebrow">Private review</p><h3 id="seller-verification-detail-title">{selected.shop_name || selected.business_name || selected.name}</h3><p>Seller: {selected.name}</p></div><button className="seller-quiet-action" type="button" onClick={() => setSelected(null)}>Close details</button></div>
            <dl className="seller-verification-facts">
                <div><dt>Status</dt><dd>{statusLabels[selected.verification_status]}</dd></div>
                <div><dt>Submitted</dt><dd>{selected.submitted_at ? new Date(selected.submitted_at).toLocaleString() : 'Not submitted'}</dd></div>
                <div><dt>Last reviewed</dt><dd>{selected.reviewed_at ? new Date(selected.reviewed_at).toLocaleString() : 'Not reviewed'}</dd></div>
            </dl>
            <div className="seller-verification-document">
                <h4>Identity document</h4>
                {selected.document ? <><p>{selected.document.mime_type} · {(selected.document.size / 1024).toFixed(0)} KB · uploaded {new Date(selected.document.uploaded_at).toLocaleString()}</p><a className="seller-inline-action" href={selected.document.view_url} target="_blank" rel="noopener noreferrer">View private document</a>{selected.document.reviewed_by_current_admin ? <p className="seller-verification-help">You confirmed that you reviewed this document.</p> : <><p>After opening the document, return here and refresh its review status before confirming your review.</p><button className="seller-quiet-action" type="button" disabled={detailLoading} onClick={() => void openDetails(selected.id)}>Refresh review status</button>{selected.document.viewed_by_current_admin && <button className="seller-inline-action" type="button" disabled={saving} onClick={() => void confirmDocumentReviewed()}>{saving ? 'Recording review...' : 'Confirm document reviewed'}</button>}</>}</>
                    : <p>No identity document is available for this seller.</p>}
            </div>
            {!!selected.audit_history.length && <section className="seller-verification-audit" aria-labelledby="seller-verification-audit-title">
                <h4 id="seller-verification-audit-title">Verification audit history</h4>
                <ol>{selected.audit_history.map((item, index) => <li key={`${item.created_at}-${index}`}><strong>{item.description}</strong><span>{item.actor} · {new Date(item.created_at).toLocaleString()}</span></li>)}</ol>
            </section>}
            {selected.verification_status === 'PENDING' && <div className="seller-verification-decision">
                <button className="seller-inline-action" type="button" disabled={saving || !selected.document?.reviewed_by_current_admin} onClick={() => void decide('VERIFIED')}>{saving ? 'Saving decision...' : 'Approve verification'}</button>
                <label>Reason for rejection<textarea minLength={8} maxLength={255} value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} placeholder="Explain what the seller should correct before resubmitting." /></label>
                <button className="seller-destructive-action" type="button" disabled={saving || !selected.document?.reviewed_by_current_admin || rejectionReason.trim().length < 8} onClick={() => void decide('REJECTED')}>{saving ? 'Saving decision...' : 'Reject and request resubmission'}</button>
            </div>}
        </section>}
    </section>;
}
