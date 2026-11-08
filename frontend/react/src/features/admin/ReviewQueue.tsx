import React from 'react';
import api, { initializeCsrf } from '../../lib/api';
import { Pagination } from '../../shared/components/Pagination';
import { confirmAction, showSuccess } from '../../lib/alerts';

type Review = {
    id: number;
    status: string;
    rating: number;
    comment: string | null;
    listing?: { name: string } | null;
    buyer?: { name: string } | null;
    seller?: { name: string } | null;
    order?: { order_reference: string } | null;
    open_reports_count: number;
    reports: { id: number; reason: string; reporter?: { name: string } | null }[];
    media_files?: { id: number; mime_type: string; original_name: string; url: string }[];
};

export function ReviewQueue({ onError }: { onError: (message: string) => void }) {
    const [reviews, setReviews] = React.useState<Review[]>([]);
    const [page, setPage] = React.useState(1);
    const [lastPage, setLastPage] = React.useState(1);
    const load = React.useCallback(() => {
        api.get<{ reviews: { data: Review[]; last_page: number } }>('/api/admin/reviews/reports', { params: { page } })
            .then((response) => { setReviews(response.data.reviews.data); setLastPage(response.data.reviews.last_page); })
            .catch((requestError: any) => onError(requestError.userMessage ?? 'Review reports could not be loaded.'));
    }, [onError, page]);
    React.useEffect(() => { load(); }, [load]);

    async function moderate(review: Review, status: 'PUBLISHED' | 'HIDDEN') {
        const reason = status === 'HIDDEN' ? 'Hidden after admin review of buyer report.' : 'Restored after admin review of buyer report.';
        if (!await confirmAction({ title: `${status === 'HIDDEN' ? 'Hide' : 'Restore'} this review?`, text: `Review #${review.id} will be ${status.toLowerCase()}.`, confirmText: status === 'HIDDEN' ? 'Hide review' : 'Restore review' })) return;
        try {
            await initializeCsrf();
            await api.patch(`/api/admin/reviews/${review.id}/moderation`, { status, reason });
            showSuccess(`Review #${review.id} ${status === 'HIDDEN' ? 'hidden' : 'restored'}.`);
            load();
        } catch (requestError: any) { onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'Review moderation failed.'); }
    }

    return <section className="complaint-queue">
        <div className="section-heading"><div><p className="eyebrow">Admin moderation</p><h2>Reported reviews</h2></div><span className="record-count">{reviews.length} on this page</span></div>
        {reviews.map((review) => <article className="complaint-item" key={review.id}>
            <strong>{review.listing?.name ?? 'Product'} · {'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</strong>
            <span>Order {review.order?.order_reference ?? '—'} · Buyer {review.buyer?.name ?? '—'} · Seller {review.seller?.name ?? '—'} · {review.open_reports_count} open report(s)</span>
            <p>{review.comment || 'No written comment.'}</p>
            {review.media_files?.length ? <div className="case-saved-media">{review.media_files.map((media) => media.mime_type.startsWith('video/')
                ? <video key={media.id} src={media.url} controls aria-label={media.original_name} />
                : <a key={media.id} href={media.url} target="_blank" rel="noreferrer"><img src={media.url} alt={media.original_name} /></a>)}</div> : null}
            <ul>{review.reports.filter((report) => report.reason).map((report) => <li key={report.id}>{report.reporter?.name ?? 'Buyer'}: {report.reason}</li>)}</ul>
            <div className="review-moderation-actions">
                {review.status !== 'HIDDEN' && <button type="button" onClick={() => void moderate(review, 'HIDDEN')}>Hide review</button>}
                {review.status !== 'PUBLISHED' && <button type="button" onClick={() => void moderate(review, 'PUBLISHED')}>Restore review</button>}
            </div>
        </article>)}
        {!reviews.length && <p className="empty-state">No reviews are waiting for moderation.</p>}
        <Pagination page={page} lastPage={lastPage} onChange={setPage} />
    </section>;
}
