import React from 'react';
import api, { initializeCsrf } from '../../lib/api';
import { Pagination } from '../../shared/components/Pagination';
import { FileDropzone } from '../../shared/components/FileDropzone';

type Review = {
    id: number;
    review_reference: string;
    status: 'PUBLISHED' | 'HIDDEN';
    rating: number;
    comment: string | null;
    listing?: { name: string } | null;
    buyer?: { name: string } | null;
    order?: { order_reference: string } | null;
    created_at: string;
    seller_report_status: 'OPEN' | 'REVIEWED' | null;
    media?: { id: number; mime_type: string; original_name: string }[];
};

const reportReasons = [
    ['HARASSMENT', 'Harassment or abusive content'],
    ['SPAM', 'Spam or promotional content'],
    ['FAKE_OR_UNRELATED', 'Fake or unrelated content'],
    ['PERSONAL_INFORMATION', 'Personal information'],
    ['OTHER_POLICY_CONCERN', 'Another policy concern'],
] as const;

export function ReviewList({ onError }: { onError: (message: string) => void }) {
    const [reviews, setReviews] = React.useState<Review[]>([]);
    const [page, setPage] = React.useState(1);
    const [lastPage, setLastPage] = React.useState(1);
    const [loading, setLoading] = React.useState(true);
    const [loadError, setLoadError] = React.useState<string | null>(null);
    const [reloadKey, setReloadKey] = React.useState(0);
    const [reportingReview, setReportingReview] = React.useState<Review | null>(null);
    const [reason, setReason] = React.useState<(typeof reportReasons)[number][0]>('HARASSMENT');
    const [explanation, setExplanation] = React.useState('');
    const [evidence, setEvidence] = React.useState<File[]>([]);
    const [submitting, setSubmitting] = React.useState(false);
    const [reportError, setReportError] = React.useState<string | null>(null);
    const [success, setSuccess] = React.useState<string | null>(null);

    React.useEffect(() => {
        let active = true;
        setLoading(true);
        setLoadError(null);
        api.get<{ reviews: { data: Review[]; last_page: number } }>('/api/seller/reviews', { params: { page } })
            .then((response) => {
                if (!active) return;
                setReviews(response.data.reviews.data);
                setLastPage(response.data.reviews.last_page);
            })
            .catch((requestError: any) => {
                if (!active) return;
                const message = requestError.response?.data?.message ?? requestError.userMessage ?? 'Seller reviews could not be loaded.';
                setLoadError(message);
                onError(message);
            })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [onError, page, reloadKey]);

    function openReport(review: Review) {
        setReportingReview(review);
        setReason('HARASSMENT');
        setExplanation('');
        setEvidence([]);
        setReportError(null);
    }

    async function submitReport(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!reportingReview) return;
        setSubmitting(true);
        setReportError(null);
        try {
            await initializeCsrf();
            const formData = new FormData();
            formData.append('reason', reason);
            if (explanation.trim()) formData.append('explanation', explanation.trim());
            evidence.forEach((file) => formData.append('evidence[]', file));
            await api.post(`/api/seller/reviews/${reportingReview.id}/reports`, formData);
            setReviews((current) => current.map((review) => review.id === reportingReview.id
                ? { ...review, seller_report_status: 'OPEN' }
                : review));
            setReportingReview(null);
            setSuccess(`Your report for ${reportingReview.review_reference} was submitted.`);
        } catch (requestError: any) {
            const existingStatus = requestError.response?.data?.report?.status;
            if (requestError.response?.status === 409 && (existingStatus === 'OPEN' || existingStatus === 'REVIEWED')) {
                const submittedReview = reportingReview;
                setReviews((current) => current.map((review) => review.id === submittedReview.id
                    ? { ...review, seller_report_status: existingStatus }
                    : review));
                setReportingReview(null);
                setSuccess(`A report for ${submittedReview.review_reference} already exists.`);
                return;
            }
            setReportError(requestError.userMessage ?? requestError.response?.data?.message ?? 'Your report could not be submitted. Please try again.');
        } finally {
            setSubmitting(false);
        }
    }

    function selectEvidence(selected: File[]) {
        if (selected.length > 3) {
            setEvidence([]);
            setReportError('Choose no more than 3 images.');
            return;
        }
        if (selected.some((file) => file.size > 5 * 1024 * 1024)) {
            setEvidence([]);
            setReportError('Each evidence image must be 5 MB or smaller.');
            return;
        }
        setEvidence(selected);
        setReportError(null);
    }

    return <section className="seller-work-section complaint-queue seller-review-list">
        <div className="section-heading"><div><p className="eyebrow">Buyer feedback</p><h2>Reviews for your livestock</h2></div><span className="record-count">{reviews.length} on this page</span></div>
        {success && <p className="seller-review-report-success" role="status">{success}</p>}
        {loading && <p className="empty-state" role="status">Loading reviews…</p>}
        {loadError && <div className="seller-review-load-error" role="alert"><p>{loadError}</p><button type="button" onClick={() => setReloadKey((key) => key + 1)}>Try again</button></div>}
        {!loading && !loadError && reviews.map((review) => <article className="complaint-item" key={review.id}>
            <strong>{review.review_reference} · {review.listing?.name ?? 'Order livestock'} · {'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</strong>
            <span>{review.buyer?.name ?? 'Buyer'} · {new Date(review.created_at).toLocaleDateString()}</span>
            {review.status === 'HIDDEN' && <span className="seller-review-report-status">Hidden by moderators</span>}
            <p>{review.comment || 'No written comment.'}</p>
            {review.media?.length ? <div className="case-saved-media">{review.media.map((media) => media.mime_type.startsWith('video/')
                ? <video key={media.id} src={`/api/review-media/${media.id}`} controls aria-label={media.original_name} />
                : <a key={media.id} href={`/api/review-media/${media.id}`} target="_blank" rel="noreferrer"><img src={`/api/review-media/${media.id}`} alt={media.original_name} /></a>)}</div> : null}
            {review.seller_report_status
                ? <span className="seller-review-report-status" role="status">Reported · {review.seller_report_status === 'OPEN' ? 'Under moderator review' : 'Moderation decision recorded'}</span>
                : <button className="seller-review-report-action" type="button" onClick={() => openReport(review)}>Report review</button>}
        </article>)}
        {!loading && !loadError && !reviews.length && <p className="empty-state">No published reviews yet.</p>}
        {!loading && !loadError && <Pagination page={page} lastPage={lastPage} onChange={setPage} />}

        {reportingReview && <div className="order-case-modal-backdrop" onMouseDown={(event) => {
            if (event.target === event.currentTarget && !submitting) setReportingReview(null);
        }}>
            <section className="order-case-modal seller-review-report-modal" role="dialog" aria-modal="true" aria-labelledby="seller-review-report-title">
                <header className="order-case-modal-heading"><div><p className="eyebrow">{reportingReview.review_reference}</p><h2 id="seller-review-report-title">Report this review</h2></div><button type="button" aria-label="Close report form" disabled={submitting} onClick={() => setReportingReview(null)}>×</button></header>
                <form onSubmit={(event) => void submitReport(event)}>
                    <p className="order-case-policy-note">Reports are private and reviewed by Farmgate moderators. Reporting will not change or hide the review.</p>
                    <label>Reason
                        <select value={reason} onChange={(event) => setReason(event.target.value as (typeof reportReasons)[number][0])}>
                            {reportReasons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                    </label>
                    <label>Explanation <span className="seller-review-report-optional">(optional, up to 500 characters)</span>
                        <textarea value={explanation} maxLength={500} rows={4} onChange={(event) => setExplanation(event.target.value)} placeholder="Briefly explain why this review should be investigated." />
                    </label>
                    <label>Supporting images <span className="seller-review-report-optional">(optional, up to 3 images, 5 MB each)</span>
                        <FileDropzone label="Choose supporting images" accept="image/jpeg,image/png,image/webp" multiple onFiles={selectEvidence} />
                    </label>
                    {evidence.length > 0 && <ul className="seller-review-report-files">{evidence.map((file) => <li key={`${file.name}-${file.lastModified}`}>{file.name}</li>)}</ul>}
                    {reportError && <p className="seller-review-report-error" role="alert">{reportError}</p>}
                    <div className="order-case-modal-footer">
                        <button type="button" disabled={submitting} onClick={() => setReportingReview(null)}>Cancel</button>
                        <button type="submit" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit report'}</button>
                    </div>
                </form>
            </section>
        </div>}
    </section>;
}
