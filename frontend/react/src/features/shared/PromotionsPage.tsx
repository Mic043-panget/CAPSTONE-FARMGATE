import React from 'react';
import api from '../../lib/api';
import { Pagination } from '../../shared/components/Pagination';
import { LoadingSkeleton } from '../../shared/components/LoadingSkeleton';
import { SystemCalendar } from './SystemCalendar';

type PromotionTab = 'all' | 'discounts' | 'special-deals' | 'events';
type PublicPromotion = {
    id: number;
    name: string;
    description: string | null;
    image_url: string | null;
    discount_type: 'PERCENTAGE' | 'FIXED';
    discount_value: string;
    starts_at: string;
    ends_at: string;
    status: 'SCHEDULED' | 'ACTIVE';
    seller: { id: number; name: string };
};
type PromotionDetail = PublicPromotion & {
    applies_to_all: boolean;
    listings: {
        id: number;
        name: string;
        description: string | null;
        images: { url: string; alt_text: string | null }[];
        pricing_type: 'PER_HEAD' | 'PER_KILO';
        original_price: string;
        current_price: string;
    }[];
};
type FarmgateEvent = {
    id: number;
    title: string;
    description: string;
    location: string;
    starts_at: string;
    ends_at: string;
    organizer: { name: string };
};
type PageResponse<T> = { data: T[]; current_page: number; last_page: number; total: number };

const tabs: { id: PromotionTab; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'discounts', label: 'Discounts' },
    { id: 'special-deals', label: 'Special Deals' },
    { id: 'events', label: 'Events' },
];
const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });

function formatDate(value: string): string {
    return new Date(value).toLocaleString('en-PH', {
        dateStyle: 'medium',
        timeStyle: 'short',
    });
}

function promotionDetailUrl(tab: PromotionTab, id: number): string {
    return `#promotions/${tab}/promotion/${id}`;
}

function promotionDetailIdFromHash(hash: string): number | null {
    const match = /^#promotions\/(?:all|discounts|special-deals)\/promotion\/(\d+)$/.exec(hash);
    return match ? Number(match[1]) : null;
}

function PromotionCard({ promotion, tab, onOpen, onOpenSeller }: {
    promotion: PublicPromotion;
    tab: PromotionTab;
    onOpen: (id: number) => void;
    onOpenSeller: (sellerId: number) => void;
}) {
    const href = promotionDetailUrl(tab, promotion.id);
    return <article className="listing-card public-promotion-card">
        <a className="listing-image-link" href={href} aria-label={`View promotion: ${promotion.name}`} onClick={(event) => {
            event.preventDefault();
            onOpen(promotion.id);
        }}>
            <div className="listing-image-wrap public-promotion-image-wrap">
                {promotion.image_url ? <img src={promotion.image_url} alt="" loading="lazy" />
                    : <div className="listing-image-placeholder" aria-hidden="true">%</div>}
                <span className={`status-pill status-${promotion.status.toLowerCase()}`}>{promotion.status === 'SCHEDULED' ? 'Upcoming' : 'Active'}</span>
            </div>
        </a>
        <div className="listing-card-body public-promotion-body">
            <a className="public-promotion-main-link" href={href} onClick={(event) => {
                event.preventDefault();
                onOpen(promotion.id);
            }}>
                <p className="eyebrow">{promotion.status === 'SCHEDULED' ? 'Scheduled offer' : 'Seller promotion'}</p>
                <h2>{promotion.name}</h2>
                <strong className="public-promotion-discount">
                    {promotion.discount_type === 'PERCENTAGE'
                        ? `${Number(promotion.discount_value)}% off`
                        : `${peso.format(Number(promotion.discount_value))} off`}
                </strong>
                {promotion.description && <p className="public-promotion-description">{promotion.description}</p>}
                <p className="public-promotion-dates"><strong>{promotion.status === 'SCHEDULED' ? 'Starts' : 'Started'}:</strong> {formatDate(promotion.starts_at)}<br /><strong>Ends:</strong> {formatDate(promotion.ends_at)}</p>
                <span className="public-promotion-action">View promotion <span aria-hidden="true">→</span></span>
            </a>
            <a className="public-promotion-seller" href={`#shop/${promotion.seller.id}`} onClick={(event) => {
                event.preventDefault();
                onOpenSeller(promotion.seller.id);
            }}>Offered by {promotion.seller.name} · Visit shop</a>
        </div>
    </article>;
}

function PromotionDetails({ promotion, onOpenListing, onOpenSeller, onBack }: {
    promotion: PromotionDetail;
    onOpenListing: (listingId: number) => void;
    onOpenSeller: (sellerId: number) => void;
    onBack: () => void;
}) {
    const isScheduled = promotion.status === 'SCHEDULED';
    const discountTerms = promotion.discount_type === 'PERCENTAGE'
        ? `${Number(promotion.discount_value)}% off eligible listing prices`
        : `${peso.format(Number(promotion.discount_value))} off per eligible pricing unit`;

    return <div className="public-promotion-detail">
        <button className="promotions-back-link public-promotion-detail-back" type="button" onClick={onBack}>← Back to promotions</button>
        <header className="public-promotion-detail-header">
            {promotion.image_url && <img src={promotion.image_url} alt={`${promotion.name} promotion`} />}
            <div>
                <span className={`status-pill status-${promotion.status.toLowerCase()}`}>{isScheduled ? 'Upcoming' : 'Active'}</span>
                <h2>{promotion.name}</h2>
                <strong className="public-promotion-discount">{discountTerms}</strong>
                <p>Offered by <button className="seller-shop-inline-link" type="button" onClick={() => onOpenSeller(promotion.seller.id)}>{promotion.seller.name} · Visit shop</button></p>
            </div>
        </header>
        <section className="public-promotion-detail-section">
            <h3>About this promotion</h3>
            <p>{promotion.description?.trim() || 'The seller has not added a longer description.'}</p>
            <dl className="public-promotion-detail-facts">
                <div><dt>Discount terms</dt><dd>{discountTerms}</dd></div>
                <div><dt>Schedule</dt><dd><time dateTime={promotion.starts_at}>{formatDate(promotion.starts_at)}</time> – <time dateTime={promotion.ends_at}>{formatDate(promotion.ends_at)}</time></dd></div>
                <div><dt>Status</dt><dd>{isScheduled ? 'Upcoming' : 'Active'}</dd></div>
                <div><dt>Eligible listings</dt><dd>{promotion.applies_to_all ? 'All eligible active listings from this seller' : 'Selected livestock listings'}</dd></div>
            </dl>
            {isScheduled && <p className="public-promotion-note" role="note">This offer begins {formatDate(promotion.starts_at)}. Listing prices stay at their current prices until then; the promotion discount is not applied early.</p>}
        </section>
        <section className="public-promotion-detail-section">
            <div className="public-promotion-listing-heading"><div><p className="eyebrow">Included by this seller</p><h3>Eligible livestock</h3></div><span>{promotion.listings.length} {promotion.listings.length === 1 ? 'listing' : 'listings'}</span></div>
            {promotion.listings.length ? <div className="listing-grid public-promotion-eligible-grid">{promotion.listings.map((listing) => {
                const unit = listing.pricing_type === 'PER_KILO' ? 'kg' : 'head';
                return <article className="listing-card public-promotion-eligible-card" key={listing.id}>
                    <button className="listing-image-wrap public-promotion-eligible-image" type="button" onClick={() => onOpenListing(listing.id)} aria-label={`Open livestock listing ${listing.name}`}>
                        {listing.images[0] ? <img src={listing.images[0].url} alt={listing.images[0].alt_text ?? listing.name} loading="lazy" />
                            : <span className="listing-image-placeholder" aria-hidden="true">🐄</span>}
                    </button>
                    <div className="listing-card-body">
                        <button className="public-promotion-listing-title" type="button" onClick={() => onOpenListing(listing.id)}>{listing.name}</button>
                        {listing.description && <p>{listing.description}</p>}
                        <div className={`listing-price${Number(listing.current_price) < Number(listing.original_price) ? ' has-promotion' : ''}`}>
                            {Number(listing.current_price) < Number(listing.original_price)
                                ? <><del>{peso.format(Number(listing.original_price))}</del><strong>{peso.format(Number(listing.current_price))}</strong></>
                                : <strong>{peso.format(Number(listing.current_price))}</strong>}
                            <small>/ {unit}</small>
                        </div>
                        {isScheduled && <p className="public-promotion-listing-schedule">Current price; offer begins {formatDate(promotion.starts_at)}.</p>}
                        <button className="public-promotion-open-listing" type="button" onClick={() => onOpenListing(listing.id)}>View livestock</button>
                    </div>
                </article>;
            })}</div> : <p className="promotions-empty">No eligible livestock listings are currently available.</p>}
        </section>
    </div>;
}

export function PromotionsPage({ initialTab, onTabChange, onOpenListing, onOpenSeller, showCalendar = false }: {
    initialTab: PromotionTab;
    onTabChange: (tab: PromotionTab) => void;
    onOpenListing: (listingId: number) => void;
    onOpenSeller: (sellerId: number) => void;
    showCalendar?: boolean;
}) {
    const [promotions, setPromotions] = React.useState<PublicPromotion[]>([]);
    const [events, setEvents] = React.useState<FarmgateEvent[]>([]);
    const [page, setPage] = React.useState(1);
    const [lastPage, setLastPage] = React.useState(1);
    const [total, setTotal] = React.useState(0);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState('');
    const [retry, setRetry] = React.useState(0);
    const [selectedPromotionId, setSelectedPromotionId] = React.useState<number | null>(() => promotionDetailIdFromHash(window.location.hash));
    const [selectedPromotion, setSelectedPromotion] = React.useState<PromotionDetail | null>(null);
    const [detailLoading, setDetailLoading] = React.useState(false);
    const [detailError, setDetailError] = React.useState('');

    React.useEffect(() => {
        function syncDetailFromHash() {
            setSelectedPromotionId(promotionDetailIdFromHash(window.location.hash));
        }
        window.addEventListener('hashchange', syncDetailFromHash);
        window.addEventListener('popstate', syncDetailFromHash);
        return () => {
            window.removeEventListener('hashchange', syncDetailFromHash);
            window.removeEventListener('popstate', syncDetailFromHash);
        };
    }, []);

    React.useEffect(() => {
        let current = true;
        if (selectedPromotionId !== null) return () => { current = false; };
        const isEvents = initialTab === 'events';
        if (isEvents && showCalendar) {
            setLoading(false);
            setError('');
            return () => { current = false; };
        }
        const load = (showSpinner: boolean) => {
            if (showSpinner) setLoading(true);
            setError('');
            const request = isEvents
                ? api.get<{ events: PageResponse<FarmgateEvent> }>('/api/events', { params: { page } }).then((response) => {
                    if (!current) return;
                    const result = response.data.events;
                    setEvents(result.data);
                    setLastPage(result.last_page);
                    setTotal(result.total);
                })
                : api.get<PageResponse<PublicPromotion>>('/api/promotions', { params: {
                    page,
                    category: initialTab === 'discounts' || initialTab === 'special-deals' ? initialTab : undefined,
                } }).then((response) => {
                    if (!current) return;
                    const result = response.data;
                    setPromotions(result.data);
                    setLastPage(result.last_page);
                    setTotal(result.total);
                });
            request.catch((requestError: any) => {
                if (current) setError(requestError.userMessage ?? 'Promotions could not be loaded. Check your connection and try again.');
            }).finally(() => { if (current) setLoading(false); });
        };
        load(true);
        const refreshTimer = window.setInterval(() => load(false), 60_000);
        const refreshOnFocus = () => load(false);
        window.addEventListener('focus', refreshOnFocus);
        return () => {
            current = false;
            window.clearInterval(refreshTimer);
            window.removeEventListener('focus', refreshOnFocus);
        };
    }, [initialTab, page, retry, selectedPromotionId, showCalendar]);

    React.useEffect(() => {
        let current = true;
        if (selectedPromotionId === null) {
            setSelectedPromotion(null);
            setDetailError('');
            return () => { current = false; };
        }
        setDetailLoading(true);
        setDetailError('');
        api.get<{ promotion: PromotionDetail }>(`/api/promotions/${selectedPromotionId}`)
            .then(({ data }) => {
                if (current) setSelectedPromotion(data.promotion);
            })
            .catch((requestError: any) => {
                if (current) setDetailError(requestError.userMessage ?? 'This promotion could not be loaded. It may have ended or is no longer available.');
            })
            .finally(() => {
                if (current) setDetailLoading(false);
            });
        return () => { current = false; };
    }, [selectedPromotionId, retry]);

    function openPromotion(id: number) {
        const href = promotionDetailUrl(initialTab, id);
        window.history.pushState({}, '', href);
        setSelectedPromotionId(id);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function closePromotion() {
        const href = initialTab === 'all' ? '#promotions' : `#promotions/${initialTab}`;
        window.history.pushState({}, '', href);
        setSelectedPromotionId(null);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function selectTab(tab: PromotionTab) {
        setPage(1);
        setSelectedPromotionId(null);
        onTabChange(tab);
    }

    return <section className="promotions-page" aria-labelledby="promotions-page-title">
        <a className="promotions-back-link" href="#marketplace">← Marketplace</a>
        <p className="eyebrow">Farmgate offers and community</p>
        <h1 id="promotions-page-title">Promotions</h1>
        <p className="promotions-intro">Explore seller discounts, special deals, and approved community events.</p>
        <div className="promotions-tabs" role="group" aria-label="Promotions categories">
            {tabs.map((tab) => <button key={tab.id} type="button" aria-pressed={initialTab === tab.id} className={initialTab === tab.id ? 'active' : ''} onClick={() => selectTab(tab.id)}>{tab.label}</button>)}
        </div>
        {selectedPromotionId !== null ? detailLoading
            ? <p className="promotions-message" role="status">Loading promotion details…</p>
            : detailError ? <div className="promotions-error" role="alert"><p>{detailError}</p><button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button><button type="button" onClick={closePromotion}>Back to promotions</button></div>
            : selectedPromotion ? <PromotionDetails promotion={selectedPromotion} onOpenListing={onOpenListing} onOpenSeller={onOpenSeller} onBack={closePromotion} />
                : <div className="promotions-empty"><h2>Promotion unavailable</h2><p>This promotion is no longer visible.</p><button type="button" onClick={closePromotion}>Back to promotions</button></div>
            : initialTab === 'events' && showCalendar ? <SystemCalendar role="BUYER" onError={setError} />
            : loading ? <LoadingSkeleton variant="cards" count={4} label="Loading promotions" />
            : error ? <div className="promotions-error" role="alert"><p>{error}</p><button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button></div>
                : initialTab === 'events' ? events.length
                    ? <><p className="promotions-count">{total} approved {total === 1 ? 'event' : 'events'}</p><div className="public-event-list">{events.map((event) => <article className="public-event-card" key={event.id}>
                        <span className="status-pill status-active">Approved event</span>
                        <h2>{event.title}</h2>
                        <p>{event.description}</p>
                        <dl><div><dt>When</dt><dd>{formatDate(event.starts_at)} – {formatDate(event.ends_at)}</dd></div><div><dt>Where</dt><dd>{event.location}</dd></div><div><dt>Organizer</dt><dd>{event.organizer.name}</dd></div></dl>
                    </article>)}</div><Pagination page={page} lastPage={lastPage} onChange={setPage} /></>
                    : <div className="promotions-empty"><h2>No upcoming approved events yet</h2><p>Events will appear here after Farmgate reviews and approves them.</p></div>
                    : promotions.length
                        ? <><p className="promotions-count">{total} {total === 1 ? 'promotion' : 'promotions'} available</p><div className="listing-grid public-promotion-list">{promotions.map((promotion) => <PromotionCard key={promotion.id} promotion={promotion} tab={initialTab} onOpen={openPromotion} onOpenSeller={onOpenSeller} />)}</div><Pagination page={page} lastPage={lastPage} onChange={setPage} /></>
                        : <div className="promotions-empty"><h2>No upcoming or active promotions</h2><p>Seller offers will appear here when they are scheduled or active.</p></div>}
    </section>;
}
