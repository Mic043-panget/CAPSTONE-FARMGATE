import React from 'react';
import api from '../../lib/api';
import type { Category, Listing } from '../../shared/types';
import { Pagination } from '../../shared/components/Pagination';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';

type ShopReview = {
    reference: string;
    rating: number;
    comment: string | null;
    buyer_name: string;
    created_at: string;
};
type ShopPromotion = {
    id: number;
    name: string;
    description: string | null;
    image_url: string | null;
    discount_type: 'PERCENTAGE' | 'FIXED';
    discount_value: string;
    starts_at: string;
    ends_at: string;
    status: 'ACTIVE' | 'SCHEDULED';
};
type ShopResponse = {
    seller: { id: number; name: string; business_name: string | null; is_verified: boolean };
    listings: { data: Listing[]; current_page: number; last_page: number; total: number };
    categories: Category[];
    promotions: ShopPromotion[];
    rating_average: number;
    review_count: number;
    reviews: { data: ShopReview[]; current_page: number; last_page: number; total: number };
};

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 });

function listingPrice(listing: Listing): number {
    return Number(listing.current_price ?? (listing.pricing_type === 'PER_KILO' ? listing.price_per_kilo : listing.price_per_head));
}

export function SellerShopPage({ sellerId, onOpenListing, onMessageSeller, onBack, onError }: {
    sellerId: number;
    onOpenListing: (listingId: number) => void;
    onMessageSeller: (sellerId: number) => void;
    onBack: () => void;
    onError: (message: string) => void;
}) {
    const [shop, setShop] = React.useState<ShopResponse | null>(null);
    const [search, setSearch] = React.useState('');
    const [categoryId, setCategoryId] = React.useState('');
    const [sort, setSort] = React.useState('newest');
    const [page, setPage] = React.useState(1);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState('');
    const [retry, setRetry] = React.useState(0);
    const debouncedSearch = useDebouncedValue(search);
    const requestId = React.useRef(0);

    React.useEffect(() => {
        if (search !== debouncedSearch) return undefined;
        const current = ++requestId.current;
        setLoading(true);
        setError('');
        api.get<ShopResponse>(`/api/sellers/${sellerId}/shop`, {
            params: {
                search: debouncedSearch || undefined,
                category_id: categoryId || undefined,
                sort,
                page,
            },
        }).then(({ data }) => {
            if (current === requestId.current) setShop(data);
        }).catch((requestError: any) => {
            if (current !== requestId.current) return;
            const message = requestError.userMessage ?? 'This seller shop could not be loaded.';
            setError(message);
            onError(message);
        }).finally(() => {
            if (current === requestId.current) setLoading(false);
        });
        return () => { requestId.current += 1; };
    }, [categoryId, debouncedSearch, onError, page, retry, search, sellerId, sort]);

    function openPromotion(id: number) {
        window.history.pushState({}, '', `#promotions/all/promotion/${id}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    const sellerName = shop?.seller.business_name?.trim() || shop?.seller.name || 'Seller shop';

    return <main className="seller-shop-page" aria-labelledby="seller-shop-title">
        <button className="product-back-link" type="button" onClick={onBack}>← Back to livestock</button>
        {loading && (!shop || shop.seller.id !== sellerId) ? <p className="seller-shop-state" role="status">Loading seller shop…</p>
            : error && (!shop || shop.seller.id !== sellerId) ? <div className="seller-shop-state seller-shop-error" role="alert"><p>{error}</p><button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button></div>
                : shop && shop.seller.id === sellerId && <>
                    <header className="seller-shop-header">
                        <div className="seller-shop-avatar" aria-hidden="true">{sellerName.slice(0, 1).toUpperCase()}</div>
                        <div className="seller-shop-profile">
                            <p className="eyebrow">Farmgate seller shop</p>
                            <h1 id="seller-shop-title">{sellerName}</h1>
                            {shop.seller.business_name && shop.seller.name !== shop.seller.business_name && <p className="seller-shop-owner">Seller: {shop.seller.name}</p>}
                            {shop.seller.is_verified && <span className="seller-shop-verified">Verified seller</span>}
                            <p className="seller-shop-rating"><span aria-label={`${shop.rating_average} out of 5 stars`}>{'★'.repeat(Math.round(shop.rating_average))}{'☆'.repeat(5 - Math.round(shop.rating_average))}</span> <strong>{shop.rating_average.toFixed(1)}</strong> · {shop.review_count} {shop.review_count === 1 ? 'review' : 'reviews'}</p>
                        </div>
                        <button className="seller-shop-chat" type="button" onClick={() => onMessageSeller(sellerId)}>Chat with seller</button>
                    </header>

                    {!!shop.promotions.length && <section className="seller-shop-promotions" aria-labelledby="seller-shop-promotions-title">
                        <div className="seller-shop-section-heading"><div><p className="eyebrow">Upcoming and active</p><h2 id="seller-shop-promotions-title">Current promotions</h2></div></div>
                        <div className="seller-shop-promotion-grid">{shop.promotions.map((promotion) => <article className="seller-shop-promotion" key={promotion.id}>
                            {promotion.image_url && <img src={promotion.image_url} alt="" loading="lazy" />}
                            <div><span className={`status-pill status-${promotion.status.toLowerCase()}`}>{promotion.status === 'SCHEDULED' ? 'Upcoming' : 'Active'}</span><strong>{promotion.discount_type === 'PERCENTAGE' ? `${Number(promotion.discount_value)}% off` : `${peso.format(Number(promotion.discount_value))} off`}</strong></div>
                            <h3>{promotion.name}</h3>
                            {promotion.description && <p>{promotion.description}</p>}
                            <p>Starts {new Date(promotion.starts_at).toLocaleString()} · Ends {new Date(promotion.ends_at).toLocaleString()}</p>
                            <button type="button" onClick={() => openPromotion(promotion.id)}>View promotion</button>
                        </article>)}</div>
                    </section>}

                    <section className="seller-shop-listings" aria-labelledby="seller-shop-listings-title">
                        <div className="seller-shop-section-heading"><div><p className="eyebrow">Available from this seller</p><h2 id="seller-shop-listings-title">Livestock listings</h2></div><span aria-live="polite">{shop.listings.total} {shop.listings.total === 1 ? 'listing' : 'listings'}</span></div>
                        <div className="seller-shop-tools">
                            <label className="search-field"><span className="sr-only">Search seller listings</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search this shop" /></label>
                            <label>Category<select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setPage(1); }}><option value="">All categories</option>{shop.categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
                            <label>Sort by<select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="popular">Popular</option></select></label>
                        </div>
                        {error && <p className="seller-shop-inline-error" role="alert">{error}<button type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></p>}
                        {loading ? <p className="seller-shop-state" role="status">Updating listings…</p>
                            : shop.listings.data.length ? <div className="listing-grid seller-shop-listing-grid">{shop.listings.data.map((listing) => <article className="listing-card" key={listing.id}>
                                <button className="listing-image-wrap seller-shop-listing-image" type="button" onClick={() => onOpenListing(listing.id)} aria-label={`View ${listing.name}`}>
                                    {listing.images[0] ? <img src={listing.images[0].url} alt={listing.images[0].alt_text ?? listing.name} loading="lazy" /> : <span className="listing-image-placeholder" aria-hidden="true">{listing.name.slice(0, 1)}</span>}
                                    <span className="listing-type">{listing.pricing_type === 'PER_KILO' ? 'Per kilo' : 'Per head'}</span>
                                </button>
                                <div className="listing-card-body">
                                    <button className="seller-shop-listing-name" type="button" onClick={() => onOpenListing(listing.id)}>{listing.name}</button>
                                    <p>{listing.breed || listing.category.name} · {listing.quantity} {listing.pricing_type === 'PER_KILO' ? 'kg available' : 'head available'}</p>
                                    {listing.promotion && <span className="listing-promotion-badge">{listing.promotion.name}</span>}
                                    <div className={`listing-price${listing.promotion ? ' has-promotion' : ''}`}>
                                        {listing.promotion && <del>{peso.format(Number(listing.original_price))}</del>}
                                        <strong>{peso.format(listingPrice(listing))} <small>/ {listing.pricing_type === 'PER_KILO' ? 'kg' : 'head'}</small></strong>
                                    </div>
                                </div>
                            </article>)}</div>
                                : <div className="seller-shop-empty"><h3>No available listings</h3><p>This seller has no livestock matching your search right now.</p></div>}
                        {!loading && shop.listings.total > 0 && <Pagination page={shop.listings.current_page} lastPage={shop.listings.last_page} onChange={setPage} />}
                    </section>

                    <section className="seller-shop-reviews" aria-labelledby="seller-shop-reviews-title">
                        <div className="seller-shop-section-heading"><div><p className="eyebrow">Buyer feedback</p><h2 id="seller-shop-reviews-title">Ratings &amp; reviews</h2></div><span>{shop.review_count} total</span></div>
                        {shop.reviews.data.length ? <div className="seller-shop-review-list">{shop.reviews.data.map((review) => <article key={review.reference}>
                            <header><div><strong>{review.buyer_name}</strong><span className="product-review-stars" aria-label={`${review.rating} out of 5 stars`}>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</span></div><time dateTime={review.created_at}>{new Date(review.created_at).toLocaleDateString()}</time></header>
                            {review.comment && <p>{review.comment}</p>}
                        </article>)}</div> : <p className="seller-shop-empty">No published reviews yet.</p>}
                    </section>
                </>}
    </main>;
}
