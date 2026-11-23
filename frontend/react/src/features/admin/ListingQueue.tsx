import React from 'react';
import { ViewDetailsAction } from '../../shared/components/Button';
import api, { initializeCsrf } from '../../lib/api';
import { Pagination } from '../../shared/components/Pagination';
import { showSuccess } from '../../lib/alerts';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useAccessibleDialog } from '../../shared/hooks/useAccessibleDialog';
import { WorkspaceBannerArtwork } from '../shared/WorkspaceBannerArtwork';

type ModerationAttempt = { attempt_number: number; status: string; recommendation?: string | null; confidence?: string | number | null; reasons?: string[] | null; flags?: string[] | null; model?: string | null; error_code?: string | null; response_summary?: string | null; created_at?: string; completed_at?: string | null; applied_automatically?: boolean; admin_override_by?: number | null; admin_override_reason?: string | null };
type Listing = { id: number; name: string; breed?: string; sex?: string; age_months?: number; estimated_weight_kg?: string | number; quantity: number; description?: string; pickup_location?: string; health_information?: string; vaccination_information?: string; pricing_type?: string; price_per_kilo?: string | number; price_per_head?: string | number; status: string; seller?: { name: string; email: string; phone_number?: string }; category?: { name: string }; images?: { id: number; url: string; alt_text?: string | null }[]; moderation_attempts?: ModerationAttempt[]; latest_moderation_attempt?: ModerationAttempt | null };
type Category = { id: number; name: string };

type ListingResponse = { listings: { data: Listing[]; total: number; current_page: number } };

const listingCurrency = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });

function closeListingActionDisclosure(event: React.MouseEvent<HTMLButtonElement>) {
    const disclosure = event.currentTarget.closest('details');
    disclosure?.removeAttribute('open');
    disclosure?.querySelector('summary')?.focus();
}

export function ListingQueue({ onError, onOpenCategories, initialListingId, onInitialListingHandled }: {
    onError: (message: string) => void;
    onOpenCategories: () => void;
    initialListingId?: number;
    onInitialListingHandled?: () => void;
}) {
    const [status, setStatus] = React.useState('PENDING_REVIEW');
    const [listings, setListings] = React.useState<Listing[]>([]);
    const [total, setTotal] = React.useState(0);
    const [loading, setLoading] = React.useState(true);
    const [loadError, setLoadError] = React.useState(false);
    const [page, setPage] = React.useState(1);
    const [search, setSearch] = React.useState('');
    const [categoryId, setCategoryId] = React.useState('');
    const [moderationStatus, setModerationStatus] = React.useState('');
    const [sort, setSort] = React.useState('created_at');
    const [direction, setDirection] = React.useState<'asc' | 'desc'>('desc');
    const [selectedListing, setSelectedListing] = React.useState<Listing | null>(null);
    const [detailLoading, setDetailLoading] = React.useState(false);
    const listingDialogRef = useAccessibleDialog<HTMLElement>(Boolean(selectedListing), () => setSelectedListing(null));
    const [categories, setCategories] = React.useState<Category[]>([]);
    const debouncedSearch = useDebouncedValue(search);
    const requestId = React.useRef(0);

    function loadListings() {
        const currentRequestId = ++requestId.current;
        setLoading(true);
        setLoadError(false);
        api.get<ListingResponse>('/api/admin/listings', { params: { status, page, search: debouncedSearch || undefined, category_id: categoryId || undefined, moderation_status: moderationStatus || undefined, sort, direction } }).then((response) => {
            if (currentRequestId !== requestId.current) return;
            setListings(response.data.listings.data);
            setTotal(response.data.listings.total);
            setPage(response.data.listings.current_page);
        }).catch((requestError: any) => {
            if (currentRequestId !== requestId.current) return;
            setListings([]);
            setLoadError(true);
            onError(requestError.userMessage ?? 'Admin livestock listings could not be loaded.');
        }).finally(() => { if (currentRequestId === requestId.current) setLoading(false); });
    }

    React.useEffect(() => {
        if (search !== debouncedSearch) {
            requestId.current += 1;
            return undefined;
        }
        loadListings();
        return () => { requestId.current += 1; };
    }, [status, page, search, debouncedSearch, categoryId, moderationStatus, sort, direction]);

    React.useEffect(() => {
        api.get<{ categories: Category[] }>('/api/categories').then((response) => setCategories(response.data.categories)).catch((requestError: any) => onError(requestError.userMessage ?? 'Listing categories could not be loaded.'));
    }, [onError]);

    React.useEffect(() => {
        if (!initialListingId) return;
        onInitialListingHandled?.();
        void openDetails(initialListingId);
    }, [initialListingId, onInitialListingHandled]);

    async function review(listing: Listing, nextStatus: 'ACTIVE' | 'REJECTED') {
        const id = listing.id;
        const action = nextStatus === 'ACTIVE' ? 'approve' : 'reject';
        const pastTense = action === 'approve' ? 'approved' : 'rejected';
        const { default: Swal } = await import('sweetalert2');
        const result = await Swal.fire({
            title: `${action === 'approve' ? 'Approve' : 'Reject'} this listing?`,
            text: `${listing.name} will be ${pastTense}.`,
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

    async function openDetails(id: number) {
        setDetailLoading(true);
        try {
            const response = await api.get<{ listing: Listing }>(`/api/admin/listings/${id}`);
            setSelectedListing(response.data.listing);
        } catch (requestError: any) {
            onError(requestError.userMessage ?? 'The full listing details could not be loaded.');
        } finally {
            setDetailLoading(false);
        }
    }

    const firstRecord = total === 0 ? 0 : (page - 1) * 15 + 1;
    const lastRecord = Math.min(page * 15, total);

    return <section className="admin-section listing-queue admin-listings-panel" aria-labelledby="admin-listings-title">
        <div className="admin-section-heading"><div><p className="eyebrow">Moderation</p><h2 id="admin-listings-title">Livestock listings</h2></div><div className="listing-queue-heading-actions"><button className="listing-queue-categories-button" type="button" onClick={onOpenCategories}><span aria-hidden="true">▦</span>Categories</button><span className="record-count">{loading ? 'Loading…' : loadError ? 'Unavailable' : `${total} records`}</span></div></div>
        <div className="listing-queue-filters">
            <label>Category<select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setPage(1); }}><option value="">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            <label>Listing status<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="ALL">All statuses</option><option value="PENDING_REVIEW">Pending review</option><option value="ACTIVE">Active</option><option value="REJECTED">Rejected</option></select></label>
            <label>AI result<select value={moderationStatus} onChange={(event) => { const value = event.target.value; setModerationStatus(value); if (value) setStatus(''); setPage(1); }}><option value="">All AI results</option><option value="PROCESSING">Processing</option><option value="AUTO_APPROVED">Auto-approved</option><option value="AUTO_REJECTED">Auto-rejected</option><option value="MANUAL_REVIEW">Needs review</option><option value="FLAGGED">Flagged / rejected suggestion</option><option value="FAILED">AI unavailable/error</option></select></label>
            <label>Sort<select value={`${sort}:${direction}`} onChange={(event) => { const [nextSort, nextDirection] = event.target.value.split(':'); setSort(nextSort); setDirection(nextDirection as 'asc' | 'desc'); setPage(1); }}><option value="created_at:desc">Newest first</option><option value="created_at:asc">Oldest first</option><option value="name:asc">Name A–Z</option><option value="name:desc">Name Z–A</option><option value="status:asc">Status A–Z</option><option value="quantity:desc">Quantity high–low</option><option value="quantity:asc">Quantity low–high</option></select></label>
        </div>
        <div className="list-tools listing-queue-search-row">
            <label className="control-search"><span className="sr-only">Search livestock listings</span><svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><circle cx="10.8" cy="10.8" r="6.8" stroke="currentColor" strokeWidth="1.8" /><path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search listings..." /></label>
            <button className="listing-queue-mobile-categories listing-queue-categories-button" type="button" onClick={onOpenCategories}><span aria-hidden="true">▦</span>Categories</button>
            <span className="listing-queue-mobile-count" aria-live="polite">{loading ? 'Loading…' : loadError ? 'Unavailable' : `${total} records`}</span>
        </div>
        {loading ? <div className="admin-loading" role="status">Loading livestock listings...</div> : loadError ? <div className="listing-queue-error" role="alert"><p>Listings could not be loaded. Try again.</p><button type="button" onClick={loadListings}>Retry</button></div> : <>
            {listings.length ? <div className="listing-queue-table-wrap" role="region" aria-label="Livestock listings" tabIndex={0}>
                <table className="listing-queue-table">
                    <thead><tr><th scope="col">Listing</th><th scope="col">Category</th><th scope="col">Price</th><th scope="col">Status</th><th scope="col">AI result</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                    <tbody>{listings.map((listing) => {
                        const attempt = listing.latest_moderation_attempt;
                        const image = listing.images?.[0];
                        const price = listing.pricing_type === 'PER_KILO' ? listing.price_per_kilo : listing.pricing_type === 'PER_HEAD' ? listing.price_per_head : undefined;
                        const priceUnit = listing.pricing_type === 'PER_KILO' ? '/ kg' : listing.pricing_type === 'PER_HEAD' ? '/ head' : '';
                        const numericPrice = price == null ? null : Number(price);
                        return <tr key={listing.id}>
                            <td data-label="Image"><div className="listing-queue-thumbnail">{image ? <img className="listing-queue-thumb" src={image.url} alt={image.alt_text ?? `${listing.name} listing`} loading="lazy" /> : <span className="listing-queue-thumb listing-queue-thumb-empty" aria-label="No listing image">◇</span>}</div></td>
                            <td data-label="Title" className="listing-queue-title-cell"><div className="listing-queue-title-content"><strong>{listing.name}</strong><small>{listing.quantity} available{listing.breed ? ` · ${listing.breed}` : ''}</small></div></td>
                            <td data-label="Category"><span className="listing-queue-category">{listing.category?.name ?? 'Uncategorized'}</span></td>
                            <td data-label="Price">{numericPrice !== null && Number.isFinite(numericPrice) ? <><strong>{listingCurrency.format(numericPrice)}</strong>{priceUnit && <small className="listing-queue-price-unit"> {priceUnit}</small>}</> : <span className="listing-queue-muted">Price unavailable</span>}</td>
                            <td data-label="Status"><span className={`status-pill status-${listing.status.toLowerCase()}`}>{listing.status.replaceAll('_', ' ')}</span></td>
                            <td data-label="AI result">{attempt ? <span className={`listing-queue-ai-status listing-queue-ai-${attempt.status.toLowerCase().replaceAll('_', '-')}`}><strong>{(attempt.recommendation ?? attempt.status).replaceAll('_', ' ')}</strong>{attempt.confidence != null && Number.isFinite(Number(attempt.confidence)) && <small>{Math.round(Number(attempt.confidence) * 100)}% confidence</small>}</span> : <span className="listing-queue-muted">No AI result</span>}</td>
                            <td data-label="Actions"><div className="listing-queue-row-actions">
                                {listing.status === 'PENDING_REVIEW' && <div className="listing-queue-mobile-review-actions">
                                    <button type="button" className="listing-queue-approve" onClick={() => void review(listing, 'ACTIVE')}>Approve</button>
                                    <button type="button" className="listing-queue-reject" onClick={() => void review(listing, 'REJECTED')}>Reject</button>
                                </div>}
                                <ViewDetailsAction className="listing-queue-view-details" contextLabel={`listing ${listing.name}`} onClick={() => void openDetails(listing.id)} loading={detailLoading} />
                                {listing.status === 'PENDING_REVIEW' && <details className="listing-queue-action-disclosure" onKeyDown={(event) => {
                                        if (event.key === 'Escape') {
                                            event.preventDefault();
                                            event.currentTarget.open = false;
                                            event.currentTarget.querySelector('summary')?.focus();
                                        }
                                    }}>
                                    <summary aria-label={`More actions for ${listing.name}`} title="More actions"><span aria-hidden="true">⋮</span></summary>
                                    <div className="listing-queue-action-options" aria-label={`Actions for ${listing.name}`}>
                                        <button type="button" onClick={(event) => { closeListingActionDisclosure(event); void review(listing, 'ACTIVE'); }}>Approve</button>
                                        <button className="listing-queue-reject" type="button" onClick={(event) => { closeListingActionDisclosure(event); void review(listing, 'REJECTED'); }}>Reject</button>
                                        {attempt?.status === 'FAILED' && <button type="button" onClick={(event) => { closeListingActionDisclosure(event); void retryModeration(listing.id); }}>Retry AI moderation</button>}
                                    </div>
                                </details>}
                            </div></td>
                        </tr>;
                    })}</tbody>
                </table>
            </div> : <p className="admin-empty">{total === 0 ? 'No listings match these filters.' : 'No listings on this page.'}</p>}
            <div className="listing-queue-pagination"><span className="listing-queue-range" aria-live="polite">Showing {firstRecord}–{lastRecord} of {total} records</span><Pagination page={page} lastPage={Math.ceil(total / 15)} onChange={setPage} /></div>
        </>}
        {selectedListing && <div className="audit-modal-backdrop" role="presentation" onClick={() => setSelectedListing(null)}><article ref={listingDialogRef} className="audit-modal listing-detail-modal" role="dialog" aria-modal="true" aria-labelledby="admin-listing-detail-title" onClick={(event) => event.stopPropagation()}>
            <div className="audit-modal-heading farmgate-modal-banner"><div><p className="eyebrow">Admin investigation</p><h3 id="admin-listing-detail-title">{selectedListing.name}</h3></div><WorkspaceBannerArtwork /><button type="button" onClick={() => setSelectedListing(null)} aria-label="Close listing details">Close</button></div>
            <div className="audit-detail-grid">
                <div><strong>Seller</strong><span>{selectedListing.seller?.name ?? 'Unknown'} · {selectedListing.seller?.email ?? '-'}</span></div>
                <div><strong>Contact</strong><span>{selectedListing.seller?.phone_number ?? 'Not available'}</span></div>
                <div><strong>Category / breed</strong><span>{selectedListing.category?.name ?? 'Uncategorized'} · {selectedListing.breed ?? 'Not specified'}</span></div>
                <div><strong>Status / quantity</strong><span>{selectedListing.status.replaceAll('_', ' ')} · {selectedListing.quantity}</span></div>
                <div><strong>Animal details</strong><span>{selectedListing.sex ?? 'Sex not specified'} · {selectedListing.age_months ?? 'Age not specified'} months · {selectedListing.estimated_weight_kg ?? 'Weight not specified'} kg</span></div>
                <div><strong>Price</strong><span>{selectedListing.pricing_type ?? 'Not specified'} · {selectedListing.price_per_head ?? selectedListing.price_per_kilo ?? 'Not specified'} PHP</span></div>
                <div><strong>Pickup location</strong><span>{selectedListing.pickup_location ?? '-'}</span></div>
                <div><strong>Health information</strong><span>{selectedListing.health_information ?? '-'}</span></div>
                <div><strong>Vaccination information</strong><span>{selectedListing.vaccination_information ?? '-'}</span></div>
            </div>
            <p className="audit-description">{selectedListing.description ?? 'No listing description provided.'}</p>
            {!!selectedListing.images?.length && <div className="listing-detail-images" aria-label="Listing photos">{selectedListing.images.map((image) => <a key={image.id} href={image.url} target="_blank" rel="noreferrer"><img src={image.url} alt={image.alt_text ?? `${selectedListing.name} listing`} /></a>)}</div>}
            <h4>Moderation history</h4>
            {selectedListing.moderation_attempts?.length ? <ol className="listing-moderation-history">{selectedListing.moderation_attempts.map((attempt) => <li key={attempt.attempt_number}><strong>Attempt {attempt.attempt_number}: {attempt.status.replaceAll('_', ' ')}</strong><span>{attempt.recommendation ?? 'No recommendation'}{attempt.confidence == null ? '' : ` · ${Math.round(Number(attempt.confidence) * 100)}% confidence`}</span><p>{[...(attempt.reasons ?? []), ...(attempt.flags ?? [])].join(' · ') || attempt.response_summary || 'No moderation notes.'}</p>{attempt.admin_override_reason && <p>Admin review: {attempt.admin_override_reason}</p>}</li>)}</ol> : <p>No moderation attempts recorded.</p>}
        </article></div>}
    </section>;
}
