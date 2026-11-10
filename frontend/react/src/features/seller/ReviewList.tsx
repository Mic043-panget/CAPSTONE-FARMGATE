import React from 'react';
import api from '../../lib/api';
import { Pagination } from '../../shared/components/Pagination';

type Review = {
    id: number;
    review_reference: string;
    rating: number;
    comment: string | null;
    listing?: { name: string } | null;
    buyer?: { name: string } | null;
    order?: { order_reference: string } | null;
    created_at: string;
    media?: { id: number; mime_type: string; original_name: string }[];
};

export function ReviewList({ onError }: { onError: (message: string) => void }) {
    const [reviews, setReviews] = React.useState<Review[]>([]);
    const [page, setPage] = React.useState(1);
    const [lastPage, setLastPage] = React.useState(1);
    React.useEffect(() => {
        let active = true;
        api.get<{ reviews: { data: Review[]; last_page: number } }>('/api/seller/reviews', { params: { page } })
            .then((response) => {
                if (!active) return;
                setReviews(response.data.reviews.data);
                setLastPage(response.data.reviews.last_page);
            })
            .catch((requestError: any) => { if (active) onError(requestError.userMessage ?? 'Seller reviews could not be loaded.'); });
        return () => { active = false; };
    }, [onError, page]);

    return <section className="seller-work-section complaint-queue">
        <div className="section-heading"><div><p className="eyebrow">Buyer feedback</p><h2>Reviews for your livestock</h2></div><span className="record-count">{reviews.length} on this page</span></div>
        {reviews.map((review) => <article className="complaint-item" key={review.id}>
            <strong>{review.review_reference} · {review.listing?.name ?? 'Order livestock'} · {'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</strong>
            <span>{review.buyer?.name ?? 'Buyer'} · {new Date(review.created_at).toLocaleDateString()}</span>
            <p>{review.comment || 'No written comment.'}</p>
            {review.media?.length ? <div className="case-saved-media">{review.media.map((media) => media.mime_type.startsWith('video/')
                ? <video key={media.id} src={`/api/review-media/${media.id}`} controls aria-label={media.original_name} />
                : <a key={media.id} href={`/api/review-media/${media.id}`} target="_blank" rel="noreferrer"><img src={`/api/review-media/${media.id}`} alt={media.original_name} /></a>)}</div> : null}
        </article>)}
        {!reviews.length && <p className="empty-state">No published reviews yet.</p>}
        <Pagination page={page} lastPage={lastPage} onChange={setPage} />
    </section>;
}
