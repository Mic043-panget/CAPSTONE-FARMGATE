import React from 'react';
import api, { initializeCsrf } from '../../lib/api';
import { Pagination } from '../../shared/components/Pagination';
import { confirmAction, showSuccess } from '../../lib/alerts';

type Review = {
    id: number;
    review_reference: string;
    status: string;
    rating: number;
    comment: string | null;
    listing?: { name: string } | null;
    buyer?: { name: string } | null;
    seller?: { name: string } | null;
    order?: { order_reference: string } | null;
    open_reports_count: number;
    reports: {
        id: number;
        reporter_role: string;
        reason: string;
        explanation: string | null;
        status: string;
        reporter?: { name: string } | null;
        media_files?: { id: number; mime_type: string; original_name: string; url: string }[];
    }[];
    media_files?: { id: number; mime_type: string; original_name: string; url: string }[];
    moderation_history?: { id: number; action: string; description?: string | null; created_at: string; actor?: { name: string; role?: string } | null }[];
};

const sellerReportReasons: Record<string, string> = {
    HARASSMENT: 'Harassment or abusive content',
    SPAM: 'Spam or promotional content',
    FAKE_OR_UNRELATED: 'Fake or unrelated content',
    PERSONAL_INFORMATION: 'Personal information',
    OTHER_POLICY_CONCERN: 'Another policy concern',
};

export function ReviewQueue({ onError, initialReviewId, onInitialReviewHandled }: {
    onError: (message: string) => void;
    initialReviewId?: number;
    onInitialReviewHandled?: () => void;
}) {
    const [reviews, setReviews] = React.useState<Review[]>([]);
    const [page, setPage] = React.useState(1);
    const [lastPage, setLastPage] = React.useState(1);
    const [targetReviewId, setTargetReviewId] = React.useState<number | undefined>();
    const load = React.useCallback(() => {
        api.get<{ reviews: { data: Review[]; last_page: number } }>('/api/admin/reviews/reports', { params: { page, review_id: targetReviewId } })
            .then((response) => { setReviews(response.data.reviews.data); setLastPage(response.data.reviews.last_page); })
            .catch((requestError: any) => onError(requestError.userMessage ?? 'Review reports could not be loaded.'));
    }, [onError, page, targetReviewId]);
    React.useEffect(() => { load(); }, [load]);
    React.useEffect(() => {
        if (!initialReviewId) return;
        setPage(1);
        setTargetReviewId(initialReviewId);
        onInitialReviewHandled?.();
    }, [initialReviewId, onInitialReviewHandled]);

    async function moderate(review: Review, status: 'PUBLISHED' | 'HIDDEN') {
        const reason = status === 'HIDDEN' ? 'Hidden after admin review of submitted report(s).' : 'Restored after admin review of submitted report(s).';
        if (!await confirmAction({ title: `${status === 'HIDDEN' ? 'Hide' : 'Restore'} this review?`, text: `${review.review_reference} will be ${status.toLowerCase()}.`, confirmText: status === 'HIDDEN' ? 'Hide review' : 'Restore review' })) return;
        try {
            await initializeCsrf();
            await api.patch(`/api/admin/reviews/${review.id}/moderation`, { status, reason });
            showSuccess(`${review.review_reference} ${status === 'HIDDEN' ? 'hidden' : 'restored'}.`);
            load();
        } catch (requestError: any) { onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'Review moderation failed.'); }
    }

    return <section className="complaint-queue">
        <div className="section-heading"><div><p className="eyebrow">Admin moderation</p><h2>Reported reviews</h2></div><span className="record-count">{reviews.length} on this page</span></div>
        {reviews.map((review) => <article className="complaint-item" key={review.id}>
            <strong>{review.review_reference} · {review.listing?.name ?? 'Livestock listing'} · {'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</strong>
            <span>Order {review.order?.order_reference ?? '—'} · Buyer {review.buyer?.name ?? '—'} · Seller {review.seller?.name ?? '—'} · {review.open_reports_count} open report(s)</span>
            <p>{review.comment || 'No written comment.'}</p>
            {review.media_files?.length ? <div className="case-saved-media">{review.media_files.map((media) => media.mime_type.startsWith('video/')
                ? <video key={media.id} src={media.url} controls aria-label={media.original_name} />
                : <a key={media.id} href={media.url} target="_blank" rel="noreferrer"><img src={media.url} alt={media.original_name} /></a>)}</div> : null}
            <div className="admin-review-reports">
                {review.reports.map((report) => <article key={report.id}>
                    <strong>{report.reporter_role === 'SELLER' ? 'Seller report' : 'Buyer report'}{report.reporter?.name ? ` · ${report.reporter.name}` : ''} · {report.status}</strong>
                    <p><b>Reason:</b> {report.reporter_role === 'SELLER' ? sellerReportReasons[report.reason] ?? report.reason : report.reason}</p>
                    {report.explanation && <p><b>Explanation:</b> {report.explanation}</p>}
                    {report.media_files?.length ? <div className="case-saved-media">{report.media_files.map((media) => <a key={media.id} href={media.url} target="_blank" rel="noreferrer"><img src={media.url} alt={media.original_name} /></a>)}</div> : null}
                </article>)}
            </div>
            <details><summary>Moderation history</summary>{review.moderation_history?.length ? <ol>{review.moderation_history.map((entry) => <li key={entry.id}><strong>{entry.action}</strong> · {entry.actor?.name ?? 'System'} ({entry.actor?.role ?? '-'}) · {new Date(entry.created_at).toLocaleString()}<p>{entry.description ?? 'No additional details recorded.'}</p></li>)}</ol> : <p>No moderation actions are recorded for this review.</p>}</details>
            <div className="review-moderation-actions">
                {review.status !== 'HIDDEN' && <button type="button" onClick={() => void moderate(review, 'HIDDEN')}>Hide review</button>}
                {review.status !== 'PUBLISHED' && <button type="button" onClick={() => void moderate(review, 'PUBLISHED')}>Restore review</button>}
            </div>
        </article>)}
        {!reviews.length && <p className="empty-state">No reviews are waiting for moderation.</p>}
        <Pagination page={page} lastPage={lastPage} onChange={setPage} />
    </section>;
}
