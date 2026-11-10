import React from 'react';
import api, { initializeCsrf } from '../../lib/api';
import type { Listing } from '../../shared/types';
import { showSuccess } from '../../lib/alerts';

type DetailedListing = Listing & {
    description?: string | null;
    sex?: string | null;
    age_months?: number | null;
    pickup_location?: string | null;
    health_information?: string | null;
    vaccination_information?: string | null;
};

type ListingReview = {
    id: number;
    rating: number;
    comment: string | null;
    buyer_name: string;
    created_at: string;
    media?: { id: number; mime_type: string; url: string }[];
};

type ListingDetailsResponse = {
    listing: DetailedListing;
    related: Listing[];
    rating_average: number;
    review_count: number;
    reviews: ListingReview[];
};

type ListingDetailsProps = {
    listingId: number;
    canPurchase: boolean;
    canReport?: boolean;
    onBack: () => void;
    onOpenListing: (listingId: number) => void;
    onOpenSeller: (sellerId: number) => void;
    onAddToCart: (listingId: number, quantity: number) => Promise<boolean | void>;
    onBuyNow: (listingId: number, quantity: number) => Promise<string | null>;
    onChatWithSeller?: (listingId: number, sellerId: number) => void;
    onError: (message: string) => void;
};

function listingPrice(listing: Listing): number {
    return Number(listing.current_price ?? (listing.pricing_type === 'PER_KILO' ? listing.price_per_kilo : listing.price_per_head));
}

const pesoPrice = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ListingDetails({ listingId, canPurchase, canReport = false, onBack, onOpenListing, onOpenSeller, onAddToCart, onBuyNow, onChatWithSeller, onError }: ListingDetailsProps) {
    const [details, setDetails] = React.useState<ListingDetailsResponse | null>(null);
    const [activeImage, setActiveImage] = React.useState(0);
    const [quantity, setQuantity] = React.useState(1);
    const [loading, setLoading] = React.useState(true);
    const [reportingReviewId, setReportingReviewId] = React.useState<number | null>(null);
    const [reportReason, setReportReason] = React.useState('');
    const [busy, setBusy] = React.useState<'cart' | 'buy' | null>(null);
    const [notice, setNotice] = React.useState('');

    React.useEffect(() => {
        let current = true;
        setLoading(true);
        setDetails(null);
        setActiveImage(0);
        api.get<ListingDetailsResponse>(`/api/listings/${listingId}`)
            .then((response) => {
                if (current) setDetails(response.data);
            })
            .catch((requestError: any) => {
                if (current) onError(requestError.userMessage ?? 'This listing could not be loaded.');
            })
            .finally(() => {
                if (current) setLoading(false);
            });
        return () => { current = false; };
    }, [listingId, onError]);

    async function addToCart() {
        if (!details) return;
        setBusy('cart');
        setNotice('');
        try {
            const added = await onAddToCart(listingId, quantity);
            if (added !== false) setNotice('Added to your cart.');
        } catch (requestError: any) {
            onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'The livestock listing could not be added to your cart.');
        } finally {
            setBusy(null);
        }
    }

    async function buyNow() {
        if (!details) return;
        setBusy('buy');
        setNotice('');
        try {
            const result = await onBuyNow(listingId, quantity);
            if (result) setNotice(result);
        } catch (requestError: any) {
            onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'The order could not be placed.');
        } finally {
            setBusy(null);
        }
    }

    function messageSeller(listing: DetailedListing) {
        if (onChatWithSeller) {
            onChatWithSeller(listing.id, listing.seller.id);
            return;
        }
        sessionStorage.setItem('farmgate.chat_listing_context', JSON.stringify({
            listing_id: listing.id,
            recipient_id: listing.seller.id,
        }));
        window.location.hash = '#chats';
    }

    async function reportReview(reviewId: number) {
        if (reportReason.trim().length < 5) { onError('Explain why this review should be checked (at least 5 characters).'); return; }
        try {
            await initializeCsrf();
            await api.post(`/api/buyer/reviews/${reviewId}/reports`, { reason: reportReason });
            setReportingReviewId(null);
            setReportReason('');
            showSuccess('Review report sent to admin moderation.');
        } catch (requestError: any) {
            onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'The review could not be reported.');
        }
    }

    if (loading) return <section className="product-detail-page"><button className="product-back-link" type="button" onClick={onBack}>Back to livestock</button><p className="product-loading">Loading listing...</p></section>;
    if (!details) return <section className="product-detail-page"><button className="product-back-link" type="button" onClick={onBack}>Back to livestock</button><div className="empty-state"><strong>Listing unavailable</strong><p>This listing may have been removed or is no longer active.</p></div></section>;

    const { listing, related, rating_average: ratingAverage, review_count: reviewCount, reviews } = details;
    const photos = listing.images.length ? listing.images : [{ url: '', alt_text: listing.name }];
    const price = listingPrice(listing);

    return (
        <section className="product-detail-page" aria-labelledby="product-title">
            <button className="product-back-link" type="button" onClick={onBack}>← Back to livestock</button>
            <div className="product-detail-layout">
                <div className="product-gallery">
                    <div className="product-main-image">
                        {photos[activeImage]?.url ? <img src={photos[activeImage].url} alt={photos[activeImage].alt_text ?? listing.name} /> : <span>{listing.name.slice(0, 1)}</span>}
                        <span className="listing-type">{listing.pricing_type === 'PER_KILO' ? 'Per kilo' : 'Per head'}</span>
                    </div>
                    {listing.images.length > 1 && <div className="product-thumbnails" aria-label="Listing photos">{listing.images.map((image, index) => <button type="button" key={`${image.url}-${index}`} className={activeImage === index ? 'active' : ''} onClick={() => setActiveImage(index)} aria-label={`Show photo ${index + 1}`} aria-pressed={activeImage === index}><img src={image.url} alt="" /></button>)}</div>}
                </div>
                <div className="product-information">
                    <p className="eyebrow">{listing.category.name} / <button type="button" className="seller-shop-inline-link" onClick={() => onOpenSeller(listing.seller.id)}>{listing.seller.name} shop</button></p>
                    <h1 id="product-title">{listing.name}</h1>
                    {listing.breed && <p className="product-breed">{listing.breed}{listing.sex ? ` · ${listing.sex.toLowerCase()}` : ''}</p>}
                    <div className="product-rating"><span aria-label={`${ratingAverage} out of 5 stars`}>{'★'.repeat(Math.round(ratingAverage))}{'☆'.repeat(5 - Math.round(ratingAverage))}</span><strong>{ratingAverage.toFixed(1)}</strong><a href="#product-reviews">{reviewCount} {reviewCount === 1 ? 'review' : 'reviews'}</a></div>
                    <p className={`product-price${listing.promotion ? ' has-promotion' : ''}`}>{listing.promotion && <del>{pesoPrice.format(Number(listing.original_price))}</del>} {pesoPrice.format(price)} <small>/ {listing.pricing_type === 'PER_KILO' ? 'kg' : 'head'}</small></p>
                    {listing.promotion?.image_url && <img className="product-promotion-image" src={listing.promotion.image_url} alt={`${listing.promotion.name} promotion`} />}
                    {listing.promotion && <p className="product-promotion-note">{listing.promotion.name} · Save {pesoPrice.format(Number(listing.original_price) - price)} per unit · {listing.promotion.discount_type === 'PERCENTAGE' ? `${Number(listing.promotion.discount_value)}% off` : `${pesoPrice.format(Number(listing.promotion.discount_value))} off`}</p>}
                    {listing.promotion?.description && <p className="product-promotion-description">{listing.promotion.description}</p>}
                    <p className="product-stock">{listing.quantity > 0 ? `${listing.quantity} ${listing.pricing_type === 'PER_KILO' ? 'kg' : 'head'} available` : 'Currently unavailable'}</p>
                    <p className="product-description">{listing.description || 'The seller has not added a description yet.'}</p>
                    {(listing.age_months != null || listing.estimated_weight_kg || listing.pickup_location) && <dl className="product-facts">
                        {listing.age_months != null && <div><dt>Age</dt><dd>{listing.age_months} months</dd></div>}
                        {listing.estimated_weight_kg && <div><dt>Estimated weight per animal</dt><dd>{listing.estimated_weight_kg} kg</dd></div>}
                        {listing.pickup_location && <div><dt>Pickup location</dt><dd>{listing.pickup_location}</dd></div>}
                    </dl>}
                    {(listing.health_information || listing.vaccination_information) && <div className="product-care-information">
                        {listing.health_information && <p><strong>Health information</strong>{listing.health_information}</p>}
                        {listing.vaccination_information && <p><strong>Vaccination information</strong>{listing.vaccination_information}</p>}
                    </div>}
                    <div className="product-purchase">
                        <label htmlFor="product-quantity">{listing.pricing_type === 'PER_KILO' ? 'Kilograms to buy' : 'Number of animals'}</label>
                        <input id="product-quantity" type="number" min={1} max={listing.quantity} step={1} value={quantity} disabled={listing.quantity < 1} onChange={(event) => setQuantity(Math.min(listing.quantity, Math.max(1, Number(event.target.value) || 1)))} />
                        {listing.pricing_type === 'PER_KILO' && <p className="product-quantity-hint">Estimated weight per animal is for reference only. Your total uses the kilograms you select: {quantity} kg × {price.toLocaleString()} PHP/kg = {(quantity * price).toLocaleString()} PHP.</p>}
                        <button type="button" className="product-add-button" disabled={busy !== null || listing.quantity < 1} onClick={addToCart}>{busy === 'cart' ? 'Adding...' : canPurchase ? 'Add to cart' : 'Sign in to add to cart'}</button>
                        <button type="button" className="product-buy-button" disabled={busy !== null || listing.quantity < 1} onClick={buyNow}>{busy === 'buy' ? 'Placing order...' : canPurchase ? 'Buy now' : 'Sign in to buy'}</button>
                        {canPurchase && <button type="button" className="product-add-button" onClick={() => messageSeller(listing)}>Chat about this livestock</button>}
                        {canPurchase && <small className="listing-chat-hint">Farmgate AI can answer listing questions any time. The seller is notified when a personal reply is needed.</small>}
                    </div>
                    {notice && <p className="product-notice" role="status">{notice}</p>}
                </div>
            </div>
            <section className="product-reviews" id="product-reviews" aria-labelledby="product-reviews-title">
                <div className="product-section-heading"><div><p className="eyebrow">Completed orders</p><h2 id="product-reviews-title">Ratings &amp; buyer feedback</h2></div><span>{reviewCount ? `${ratingAverage.toFixed(1)} average · ${reviewCount} reviews` : 'No reviews yet'}</span></div>
                <p className="product-review-context">Reviews are from completed orders that included this listing.</p>
                {reviews.length ? <div className="product-review-list">{reviews.map((review) => <article className="product-review" key={review.id}><div><strong>{review.buyer_name}</strong><span className="product-review-stars" aria-label={`${review.rating} out of 5 stars`}>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</span></div><time dateTime={review.created_at}>{new Date(review.created_at).toLocaleDateString()}</time>{review.comment && <p>{review.comment}</p>}{review.media?.length ? <div className="case-saved-media">{review.media.map((media) => media.mime_type.startsWith('video/') ? <video key={media.id} src={media.url} controls aria-label="Review video" /> : <a key={media.id} href={media.url} target="_blank" rel="noreferrer"><img src={media.url} alt="Review photo" /></a>)}</div> : null}{canReport && <div className="review-report-control">{reportingReviewId === review.id ? <><label>Why should this be reviewed?<textarea value={reportReason} onChange={(event) => setReportReason(event.target.value)} minLength={5} maxLength={1200} /></label><button type="button" onClick={() => void reportReview(review.id)}>Send report</button><button type="button" onClick={() => { setReportingReviewId(null); setReportReason(''); }}>Cancel</button></> : <button type="button" onClick={() => setReportingReviewId(review.id)}>Report review</button>}</div>}</article>)}</div> : <p className="product-empty-reviews">There is no buyer feedback for this listing yet.</p>}
            </section>
            <section className="product-related" aria-labelledby="product-related-title">
                <div className="product-section-heading"><div><p className="eyebrow">From the same category</p><h2 id="product-related-title">Similar livestock</h2></div></div>
                {related.length ? <div className="product-related-grid">{related.map((item) => <button type="button" className="product-related-card" key={item.id} onClick={() => onOpenListing(item.id)}><span className="product-related-image">{item.images[0] ? <img src={item.images[0].url} alt={item.images[0].alt_text ?? item.name} /> : item.name.slice(0, 1)}</span><span className="product-related-category">{item.category.name}</span><strong>{item.name}</strong><span className="product-related-price">{item.promotion && <del>{pesoPrice.format(Number(item.original_price))} </del>}{pesoPrice.format(listingPrice(item))} / {item.pricing_type === 'PER_KILO' ? 'kg' : 'head'}</span>{item.promotion && <small>Save {pesoPrice.format(Number(item.original_price) - listingPrice(item))} per unit</small>}</button>)}</div> : <p className="product-empty-reviews">No similar listings are available right now.</p>}
            </section>
        </section>
    );
}