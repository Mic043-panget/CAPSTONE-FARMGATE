import React from 'react';
import api, { initializeCsrf } from '../../lib/api';
import { showSuccess } from '../../lib/alerts';

type FeedbackForm = 'review' | 'complaint' | 'return' | null;
const caseReasons = [
    'Animal arrived injured or unwell',
    'Wrong animal or breed delivered',
    'Animal was not included in the delivery',
    'Animal’s description or listing was inaccurate',
    'Delivery issue',
    'Other',
];
const MAX_MEDIA_COUNT = 5;
const MAX_MEDIA_SIZE = 20 * 1024 * 1024;
const SUPPORTED_MEDIA_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/quicktime',
    'video/webm',
]);
const SUPPORTED_MEDIA_EXTENSIONS = /\.(jpe?g|png|webp|mp4|mov|webm)$/i;

type OrderCaseItem = {
    id: number;
    quantity: number;
    unit_price: string;
    pricing_type: 'PER_HEAD' | 'PER_KILO';
    listing?: { id: number; name: string } | null;
};

type CaseOrder = {
    id: number;
    order_reference: string;
    status: string;
    updated_at: string;
    status_history?: { to_status: string; created_at: string }[];
    items: OrderCaseItem[];
};

type Media = { id: number; mime_type: string; original_name: string; url: string };
type CaseMessage = { id: number; sender_id: number; sender?: { name: string }; message: string; created_at: string; media_files?: Media[] };
type OrderCase = {
    id: number;
    case_reference: string;
    case_type: 'COMPLAINT' | 'RETURN_REFUND';
    reason: string;
    other_reason?: string | null;
    description: string;
    status: string;
    refund_status: string;
    payout_evidence_url?: string | null;
    requested_amount?: string | null;
    approved_refund_amount?: string | null;
    resolution_reason?: string | null;
    return_method?: string | null;
    requested_items?: { name: string; quantity: number; requested_amount: number }[];
    seller_response_deadline?: string | null;
    escalated_at?: string | null;
    created_at: string;
    order?: { order_reference: string };
    status_history?: { to_status: string; reason?: string; created_at: string }[];
    evidence_media?: Media[];
    messages?: CaseMessage[];
};
type BuyerReview = { order_id: number; listing_id: number | null; status: string; rating: number; comment: string | null; media?: Media[] };

function MediaPicker({ label, files, onChange, onError }: { label: string; files: File[]; onChange: (files: File[]) => void; onError: (message: string) => void }) {
    const [previews, setPreviews] = React.useState<{ file: File; url: string }[]>([]);
    React.useEffect(() => {
        const next = files.map((file) => ({ file, url: URL.createObjectURL(file) }));
        setPreviews(next);
        return () => next.forEach((preview) => URL.revokeObjectURL(preview.url));
    }, [files]);

    return <div className="case-media-picker">
        <label>{label}<input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" multiple onChange={(event) => {
            const selected = Array.from(event.target.files ?? []);
            const invalidType = selected.find((file) => file.type
                ? !SUPPORTED_MEDIA_TYPES.has(file.type)
                : !SUPPORTED_MEDIA_EXTENSIONS.test(file.name));
            const tooLarge = selected.find((file) => file.size > MAX_MEDIA_SIZE);
            if (invalidType) {
                onError('Choose JPEG, PNG, WebP, MP4, QuickTime, or WebM files only.');
                event.currentTarget.value = '';
                return;
            }
            if (tooLarge) {
                onError('Each photo or video must be 20 MB or smaller.');
                event.currentTarget.value = '';
                return;
            }
            if (files.length + selected.length > MAX_MEDIA_COUNT) {
                onError('You can attach up to 5 photos or videos.');
                event.currentTarget.value = '';
                return;
            }
            onChange([...files, ...selected]);
            event.currentTarget.value = '';
        }} /></label>
        <div className="case-media-previews">{previews.map(({ file, url }, index) => <figure key={`${file.name}-${file.lastModified}-${index}`}>
            {file.type.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(file.name)
                ? <video src={url} controls aria-label={`Preview ${file.name}`} />
                : <img src={url} alt={`Preview ${file.name}`} />}
            <figcaption>{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</figcaption>
            <button type="button" onClick={() => onChange(files.filter((_, fileIndex) => fileIndex !== index))}>Remove</button>
        </figure>)}</div>
        <small>Optional; up to 5 photos or videos, 20 MB each. Remove a selection and choose another file to replace it.</small>
    </div>;
}

function SavedMedia({ files }: { files?: Media[] }) {
    if (!files?.length) return null;
    return <div className="case-saved-media">{files.map((file) => file.mime_type.startsWith('video/')
        ? <video key={file.id} src={file.url} controls aria-label={file.original_name} />
        : <a key={file.id} href={file.url} target="_blank" rel="noreferrer"><img src={file.url} alt={file.original_name} /></a>)}</div>;
}

export function OrderCasePanel({ order, onError }: { order: CaseOrder; onError: (message: string) => void }) {
    const [reviews, setReviews] = React.useState<BuyerReview[]>([]);
    const [cases, setCases] = React.useState<OrderCase[]>([]);
    const [listingId, setListingId] = React.useState('');
    const [rating, setRating] = React.useState('5');
    const [comment, setComment] = React.useState('');
    const [reviewMedia, setReviewMedia] = React.useState<File[]>([]);
    const [caseType, setCaseType] = React.useState<'COMPLAINT' | 'RETURN_REFUND'>('COMPLAINT');
    const [reason, setReason] = React.useState('');
    const [otherReason, setOtherReason] = React.useState('');
    const [description, setDescription] = React.useState('');
    const [returnMethod, setReturnMethod] = React.useState<'REFUND_ONLY' | 'RETURN_AND_REFUND'>('REFUND_ONLY');
    const [selectedItems, setSelectedItems] = React.useState<Record<number, number>>({});
    const [caseMedia, setCaseMedia] = React.useState<File[]>([]);
    const [reply, setReply] = React.useState<Record<number, string>>({});
    const [replyMedia, setReplyMedia] = React.useState<Record<number, File[]>>({});
    const [saving, setSaving] = React.useState(false);
    const [activeForm, setActiveForm] = React.useState<FeedbackForm>(null);
    const modalRef = React.useRef<HTMLElement>(null);
    const closeButtonRef = React.useRef<HTMLButtonElement>(null);
    const openerRef = React.useRef<HTMLElement | null>(null);
    const savingRef = React.useRef(saving);
    savingRef.current = saving;

    const openForm = (form: Exclude<FeedbackForm, null>, event: React.MouseEvent<HTMLButtonElement>) => {
        openerRef.current = event.currentTarget;
        if (form === 'complaint') setCaseType('COMPLAINT');
        if (form === 'return') setCaseType('RETURN_REFUND');
        setActiveForm(form);
    };

    const closeForm = () => {
        if (!saving) setActiveForm(null);
    };

    React.useEffect(() => {
        if (!activeForm) return undefined;
        closeButtonRef.current?.focus();
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                if (!savingRef.current) setActiveForm(null);
                return;
            }
            if (event.key !== 'Tab' || !modalRef.current) return;
            const focusable = Array.from(modalRef.current.querySelectorAll<HTMLElement>(
                'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
            ));
            if (!focusable.length) {
                event.preventDefault();
                modalRef.current.focus();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            openerRef.current?.focus();
        };
    }, [activeForm]);

    const load = React.useCallback(async () => {
        try {
            const [reviewResponse, caseResponse] = await Promise.all([
                api.get<{ reviews: BuyerReview[] }>('/api/buyer/reviews'),
                api.get<{ complaints: OrderCase[] }>('/api/buyer/complaints'),
            ]);
            setReviews(reviewResponse.data.reviews.filter((review) => review.order_id === order.id));
            setCases(caseResponse.data.complaints.filter((item) => item.order?.order_reference === order.order_reference));
        } catch (requestError: any) {
            onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'Order feedback and cases could not be loaded.');
        }
    }, [onError, order.id, order.order_reference]);

    React.useEffect(() => { void load(); }, [load]);

    const reviewedListings = new Set(reviews.map((review) => review.listing_id).filter((id): id is number => id !== null));
    const reviewableItems = order.items.filter((item) => item.listing && !reviewedListings.has(item.listing.id));
    const completedAt = order.status_history?.filter((item) => item.to_status === 'COMPLETED').map((item) => item.created_at).sort().at(-1) ?? order.updated_at;
    const returnWindowOpen = Date.now() <= new Date(completedAt).getTime() + 7 * 24 * 60 * 60 * 1000;
    const canSubmit = order.status === 'COMPLETED';

    async function submitReview(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!listingId) { onError('Choose a livestock listing from this order to review.'); return; }
        if (!rating || Number(rating) < 1 || Number(rating) > 5) { onError('Choose a rating from 1 to 5 stars.'); return; }
        const body = new FormData();
        body.append('listing_id', listingId);
        body.append('rating', rating);
        body.append('comment', comment);
        reviewMedia.forEach((file) => body.append('media[]', file));
        setSaving(true);
        try {
            await initializeCsrf();
            await api.post(`/api/orders/${order.id}/review`, body);
            setComment('');
            setReviewMedia([]);
            setListingId('');
            setRating('5');
            setActiveForm(null);
            showSuccess('Review submitted.');
            await load();
        } catch (requestError: any) { onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'The review could not be submitted.'); }
        finally { setSaving(false); }
    }

    async function submitCase(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!reason || description.trim().length < 5) { onError('Choose a reason and describe the issue in at least 5 characters.'); return; }
        if (reason === 'Other' && !otherReason.trim()) { onError('Explain the Other reason before submitting.'); return; }
        const selected = order.items.filter((item) => (selectedItems[item.id] ?? 0) > 0);
        if (caseType === 'RETURN_REFUND' && selected.length === 0) { onError('Choose at least one livestock listing and quantity for a return or refund request.'); return; }
        const body = new FormData();
        body.append('reason', reason);
        if (reason === 'Other') body.append('other_reason', otherReason);
        body.append('description', description);
        caseMedia.forEach((file) => body.append('media[]', file));
        const endpoint = caseType === 'RETURN_REFUND' ? `/api/orders/${order.id}/return-refund` : `/api/orders/${order.id}/complaint`;
        if (caseType === 'RETURN_REFUND') {
            body.append('return_method', returnMethod);
            selected.forEach((item, index) => {
                body.append(`items[${index}][order_item_id]`, String(item.id));
                body.append(`items[${index}][quantity]`, String(selectedItems[item.id]));
            });
        }
        setSaving(true);
        try {
            await initializeCsrf();
            await api.post(endpoint, body);
            setReason('');
            setOtherReason('');
            setDescription('');
            setCaseMedia([]);
            setSelectedItems({});
            setActiveForm(null);
            showSuccess(caseType === 'RETURN_REFUND' ? 'Return/refund request sent for seller response and admin review.' : 'Complaint submitted.');
            await load();
        } catch (requestError: any) { onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'The case could not be submitted.'); }
        finally { setSaving(false); }
    }

    async function sendMessage(caseId: number) {
        const message = reply[caseId]?.trim();
        if (!message) { onError('Enter a message before sending.'); return; }
        const body = new FormData();
        body.append('message', message);
        (replyMedia[caseId] ?? []).forEach((file) => body.append('media[]', file));
        try {
            await initializeCsrf();
            await api.post(`/api/cases/${caseId}/messages`, body);
            setReply((current) => ({ ...current, [caseId]: '' }));
            setReplyMedia((current) => ({ ...current, [caseId]: [] }));
            await load();
        } catch (requestError: any) { onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'The message could not be sent.'); }
    }

    return <section className="order-case-panel" aria-labelledby="order-case-title">
        <div className="section-heading"><div><p className="eyebrow">After purchase</p><h2 id="order-case-title">Reviews, complaints &amp; returns</h2></div></div>
        <div className="order-case-actions" aria-label="Order feedback actions">
            <button type="button" disabled={!canSubmit || reviewableItems.length === 0} onClick={(event) => openForm('review', event)}>
                Write a Review{reviewableItems.length === 0 && canSubmit ? ' (already reviewed)' : ''}
            </button>
            <button type="button" disabled={!canSubmit} onClick={(event) => openForm('complaint', event)}>Make a Complaint</button>
            <button type="button" disabled={!canSubmit || !returnWindowOpen} onClick={(event) => openForm('return', event)}>
                Request a Refund or Return{canSubmit && !returnWindowOpen ? ' (7-day window ended)' : ''}
            </button>
        </div>
        {!canSubmit && <p className="order-case-policy-note">Reviews and complaint/return requests are available after the order is completed.</p>}
        {activeForm && <div className="order-case-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeForm(); }}>
            <section className="order-case-modal" ref={modalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="order-case-modal-title">
                <header className="order-case-modal-heading">
                    <div><p className="eyebrow">Order {order.order_reference}</p><h2 id="order-case-modal-title">{activeForm === 'review' ? 'Write a Review' : activeForm === 'complaint' ? 'Make a Complaint' : 'Request a Refund or Return'}</h2></div>
                    <button ref={closeButtonRef} type="button" aria-label="Close form" disabled={saving} onClick={closeForm}>×</button>
                </header>
                {activeForm === 'review' ? <form onSubmit={submitReview}>
                    <label>Livestock listing<select value={listingId} onChange={(event) => setListingId(event.target.value)} required><option value="">Choose a livestock listing</option>{reviewableItems.map((item) => <option key={item.id} value={item.listing?.id}>{item.listing?.name}</option>)}</select></label>
                    <label>Rating<select value={rating} onChange={(event) => setRating(event.target.value)} required>{[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} - {value === 5 ? 'Excellent' : value === 4 ? 'Good' : value === 3 ? 'Fair' : value === 2 ? 'Poor' : 'Very poor'}</option>)}</select></label>
                    <label>Written review<textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={2000} rows={4} /></label>
                    <MediaPicker label="Optional photos or videos" files={reviewMedia} onChange={setReviewMedia} onError={onError} />
                    <footer className="order-case-modal-footer"><button type="button" disabled={saving} onClick={closeForm}>Cancel</button><button type="submit" disabled={saving}>{saving ? 'Submitting…' : 'Submit review'}</button></footer>
                </form> : <form onSubmit={submitCase}>
                <label>Reason<select value={reason} onChange={(event) => setReason(event.target.value)} required><option value="">Choose a reason</option>{caseReasons.map((caseReason) => <option key={caseReason}>{caseReason}</option>)}</select></label>
                {reason === 'Other' && <label>Explain the reason<textarea value={otherReason} onChange={(event) => setOtherReason(event.target.value)} maxLength={500} required /></label>}
                <label>Explain what happened<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={5000} minLength={5} rows={4} required /></label>
                {activeForm === 'return' && <>
                    <fieldset><legend>Affected livestock and quantities</legend>{order.items.map((item) => <label key={item.id}>{item.listing?.name ?? 'Livestock listing'} ({item.pricing_type === 'PER_KILO' ? 'kg' : 'head'}) <input type="number" min={0} max={item.quantity} value={selectedItems[item.id] ?? 0} onChange={(event) => setSelectedItems((current) => ({ ...current, [item.id]: Math.max(0, Math.min(item.quantity, Number(event.target.value))) }))} /></label>)}</fieldset>
                    <label>Resolution requested<select value={returnMethod} onChange={(event) => setReturnMethod(event.target.value as 'REFUND_ONLY' | 'RETURN_AND_REFUND')}><option value="REFUND_ONLY">Refund only</option><option value="RETURN_AND_REFUND">Return the livestock and request a refund (subject to approval)</option></select></label>
                    <p className="order-case-policy-note">Requests must be submitted within 7 days after completion. Livestock amounts are shown to admins for review; shipping/fees and exceptions require admin policy review. No refund is automatic.</p>
                </>}
                <MediaPicker label="Optional supporting photos/videos" files={caseMedia} onChange={setCaseMedia} onError={onError} />
                <footer className="order-case-modal-footer"><button type="button" disabled={saving} onClick={closeForm}>Cancel</button><button type="submit" disabled={saving}>{saving ? 'Submitting…' : activeForm === 'return' ? 'Submit request' : 'Submit complaint'}</button></footer>
            </form>}
            </section>
        </div>}
        {reviews.map((review, index) => <article className="order-case-review" key={`${review.listing_id}-${index}`}>
            <div><strong>{order.items.find((item) => item.listing?.id === review.listing_id)?.listing?.name ?? 'Livestock review'}</strong><span>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)} · {review.status.replaceAll('_', ' ')}</span></div>
            <p>{review.comment || 'No written comment.'}</p><SavedMedia files={review.media} />
        </article>)}
        <div className="order-case-list">{cases.map((item) => <article className="order-case-card" key={item.id}>
            <header><strong>{item.case_type === 'RETURN_REFUND' ? 'Return/refund' : 'Complaint'} · {item.case_reference}</strong><span>{item.status.replaceAll('_', ' ')}{item.escalated_at ? ' · Escalated to admin' : ''}</span></header>
            <p><strong>{item.reason}{item.other_reason ? `: ${item.other_reason}` : ''}</strong> — {item.description}</p>
            {item.requested_amount && <p>Requested livestock amount: PHP {Number(item.requested_amount).toFixed(2)} · Refund: {item.refund_status.replaceAll('_', ' ')}{item.approved_refund_amount ? ` · Approved PHP ${Number(item.approved_refund_amount).toFixed(2)}` : ''}</p>}
            {!!item.requested_items?.length && <ul>{item.requested_items.map((selected) => <li key={`${selected.name}-${selected.quantity}`}>{selected.quantity} × {selected.name} · requested PHP {Number(selected.requested_amount).toFixed(2)}</li>)}</ul>}
            {item.resolution_reason && <p>Resolution: {item.resolution_reason}</p>}
            {item.payout_evidence_url && <a href={item.payout_evidence_url} target="_blank" rel="noreferrer">View COD payout evidence</a>}
            <SavedMedia files={item.evidence_media} />
            <ol className="order-case-messages">{item.messages?.map((message) => <li key={message.id}><strong>{message.sender?.name ?? 'Participant'}</strong><time>{new Date(message.created_at).toLocaleString()}</time><p>{message.message}</p><SavedMedia files={message.media_files} /></li>)}</ol>
            {!['RESOLVED', 'REJECTED'].includes(item.status) && <div className="order-case-reply">
                <label>Reply to this case<textarea value={reply[item.id] ?? ''} onChange={(event) => setReply((current) => ({ ...current, [item.id]: event.target.value }))} maxLength={5000} /></label>
                <MediaPicker label="Attach evidence" files={replyMedia[item.id] ?? []} onChange={(files) => setReplyMedia((current) => ({ ...current, [item.id]: files }))} onError={onError} />
                <button type="button" onClick={() => void sendMessage(item.id)}>Send reply</button>
            </div>}
            <small>Seller response due: {item.seller_response_deadline ? new Date(item.seller_response_deadline).toLocaleString() : 'Not set'}</small>
        </article>)}</div>
        {canSubmit && reviewableItems.length === 0 && !reviews.length && <p className="order-case-policy-note">Every livestock listing in this order already has a review.</p>}
    </section>;
}
