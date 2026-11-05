import React from 'react';
import api, { initializeCsrf } from '../../lib/api';
import { Pagination } from '../../shared/components/Pagination';
import { showSuccess } from '../../lib/alerts';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';

type ModerationAttempt = { attempt_number: number; status: string; recommendation?: string | null; confidence?: string | number | null; reasons?: string[] | null; flags?: string[] | null; model?: string | null; error_code?: string | null; response_summary?: string | null; created_at?: string; completed_at?: string | null; applied_automatically?: boolean; admin_override_by?: number | null; admin_override_reason?: string | null };
type Listing = { id: number; name: string; breed?: string; quantity: number; status: string; seller?: { name: string; email: string }; category?: { name: string }; latest_moderation_attempt?: ModerationAttempt | null };
type Category = { id: number; name: string };

type ListingResponse = { listings: { data: Listing[]; total: number; current_page: number } };

export function ListingQueue({ onError }: { onError: (message: string) => void }) {
    const [status, setStatus] = React.useState('PENDING_REVIEW');
    const [listings, setListings] = React.useState<Listing[]>([]);
    const [total, setTotal] = React.useState(0);
    const [loading, setLoading] = React.useState(true);
    const [page, setPage] = React.useState(1);
    const [search, setSearch] = React.useState('');
    const [categoryId, setCategoryId] = React.useState('');
    const [moderationStatus, setModerationStatus] = React.useState('');
    const [categories, setCategories] = React.useState<Category[]>([]);
    const debouncedSearch = useDebouncedValue(search);
    const requestId = React.useRef(0);

    function loadListings() {
        const currentRequestId = ++requestId.current;
        setLoading(true);
        api.get<ListingResponse>('/api/admin/listings', { params: { status, page, search: debouncedSearch || undefined, category_id: categoryId || undefined, moderation_status: moderationStatus || undefined } }).then((response) => {
            if (currentRequestId !== requestId.current) return;
            setListings(response.data.listings.data);
            setTotal(response.data.listings.total);
            setPage(response.data.listings.current_page);
        }).catch((requestError: any) => { if (currentRequestId === requestId.current) onError(requestError.userMessage ?? 'Admin livestock listings could not be loaded.'); }).finally(() => { if (currentRequestId === requestId.current) setLoading(false); });
    }

    React.useEffect(() => {
        if (search !== debouncedSearch) {
            requestId.current += 1;
            return undefined;
        }
        loadListings();
        return () => { requestId.current += 1; };
    }, [status, page, search, debouncedSearch, categoryId, moderationStatus]);

    React.useEffect(() => {
        api.get<{ categories: Category[] }>('/api/categories').then((response) => setCategories(response.data.categories)).catch((requestError: any) => onError(requestError.userMessage ?? 'Listing categories could not be loaded.'));
    }, [onError]);

    async function review(id: number, nextStatus: 'ACTIVE' | 'REJECTED') {
        const action = nextStatus === 'ACTIVE' ? 'approve' : 'reject';
        const pastTense = action === 'approve' ? 'approved' : 'rejected';
        const { default: Swal } = await import('sweetalert2');
        const result = await Swal.fire({
            title: `${action === 'approve' ? 'Approve' : 'Reject'} this listing?`,
            text: `Listing #${id} will be ${pastTense}.`,
            input: 'textarea',
            inputLabel: 'Review reason (optional)',
            inputAttributes: { maxlength: '500' },
            showCancelButton: true,
            confirmButtonText: `${action === 'approve' ? 'Approve' : 'Reject'} listing`,
            cancelButtonText: 'Cancel',
            reverseButtons: true,
            focusCancel: true,
            buttonsStyling: false,
            customClass: {
                popup: 'farmgate-swal-popup',
                title: 'farmgate-swal-title',
                htmlContainer: 'farmgate-swal-text',
                actions: 'farmgate-swal-actions',
                confirmButton: action === 'reject' ? 'farmgate-swal-confirm danger' : 'farmgate-swal-confirm',
                cancelButton: 'farmgate-swal-cancel',
            },
        });
        if (!result.isConfirmed) return;
        try {
            await initializeCsrf();
            await api.post(`/api/admin/listings/${id}/review`, { status: nextStatus, reason: result.value || undefined });
            showSuccess(`Listing ${pastTense}.`);
            loadListings();
        } catch (requestError: any) { onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'The listing review could not be completed.'); }
    }

    async function retryModeration(id: number) {
        try {
            await initializeCsrf();
            await api.post(`/api/admin/listings/${id}/moderation-retry`);
            showSuccess('AI moderation retry queued.');
            loadListings();
        } catch (requestError: any) {
            onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'AI moderation could not be retried.');
        }
    }

    return <section className="admin-section listing-queue">
        <div className="admin-section-heading"><div><p className="eyebrow">Moderation</p><h2>Livestock listings</h2></div><span className="record-count">{total} records</span></div>
        <div className="listing-queue-filters">
            <label>Category<select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setPage(1); }}><option value="">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            <label>Listing status<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="ALL">All statuses</option><option value="PENDING_REVIEW">Pending review</option><option value="ACTIVE">Active</option><option value="REJECTED">Rejected</option></select></label>
            <label>AI result<select value={moderationStatus} onChange={(event) => { const value = event.target.value; setModerationStatus(value); if (value) setStatus(''); setPage(1); }}><option value="">All AI results</option><option value="PROCESSING">Processing</option><option value="AUTO_APPROVED">Auto-approved</option><option value="AUTO_REJECTED">Auto-rejected</option><option value="MANUAL_REVIEW">Needs review</option><option value="FLAGGED">Flagged / rejected suggestion</option><option value="FAILED">AI unavailable/error</option></select></label>
        </div>
        <div className="list-tools"><label className="control-search"><span className="sr-only">Search livestock listings</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search listings" /></label></div>
        {loading ? <div className="admin-loading">Loading livestock listings...</div> : <>
            {listings.length ? <div className="admin-list-table">{listings.map((listing) => {
                const attempt = listing.latest_moderation_attempt;
                return <article className="admin-list-row" key={listing.id}>
                    <div><strong>{listing.name}</strong><span>{listing.category?.name ?? 'Uncategorized'} · {listing.quantity} available</span></div>
                    <div><strong>{listing.seller?.name ?? 'Unknown seller'}</strong><span>{listing.seller?.email}</span></div>
                    <span className={`status-pill status-${listing.status.toLowerCase()}`}>{listing.status.replace('_', ' ')}</span>
                    {attempt && <div className="listing-ai-summary">
                        <strong>AI attempt {attempt.attempt_number}: {attempt.status.replace('_', ' ')}</strong>
                        <span>{attempt.recommendation ? `${attempt.recommendation} · ${attempt.confidence === null ? 'confidence unavailable' : `${Math.round(Number(attempt.confidence) * 100)}% confidence`}` : 'No model recommendation'}</span>
                        {attempt.reasons?.length ? <span>{attempt.reasons.join(' · ')}</span> : null}
                        {attempt.flags?.length ? <span>Flags: {attempt.flags.join(' · ')}</span> : null}
                        {attempt.response_summary && <span>{attempt.response_summary}</span>}
                        {(attempt.completed_at || attempt.created_at) && <span>Processed: {new Date(attempt.completed_at || attempt.created_at || '').toLocaleString()}</span>}
                        {attempt.error_code && <span>Issue: {attempt.error_code}</span>}
                        {attempt.model && <span>Model: {attempt.model}</span>}
                        {attempt.applied_automatically && <span>Approved automatically</span>}
                        {attempt.admin_override_by && <span>Reviewed by an administrator</span>}
                        {attempt.admin_override_reason && <span>Admin review reason: {attempt.admin_override_reason}</span>}
                    </div>}
                    {listing.status === 'PENDING_REVIEW' && <div className="row-actions"><button type="button" onClick={() => review(listing.id, 'ACTIVE')}>Approve</button><button className="danger-button" type="button" onClick={() => review(listing.id, 'REJECTED')}>Reject</button>{attempt?.status === 'FAILED' && <button type="button" onClick={() => void retryModeration(listing.id)}>Retry AI moderation</button>}</div>}
                </article>;
            })}</div> : <p className="admin-empty">No listings match these filters.</p>}
            <Pagination page={page} lastPage={Math.ceil(total / 15)} onChange={setPage} />
        </>}
    </section>;
}
