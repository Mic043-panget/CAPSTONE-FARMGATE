import React from 'react';
import api, { initializeCsrf } from '../../lib/api';
import { ValidatedField } from '../../shared/components/ValidatedField';
import { required } from '../../shared/validation';
import { confirmAction, showSuccess } from '../../lib/alerts';

type Order = { id: number; order_reference: string; status: string; total_amount: string };

export function FeedbackPanel({ onError }: { onError: (message: string) => void }) {
    const [orders, setOrders] = React.useState<Order[]>([]);
    const [orderId, setOrderId] = React.useState('');
    const [rating, setRating] = React.useState('5');
    const [comment, setComment] = React.useState('');
    const [reason, setReason] = React.useState('');
    const [description, setDescription] = React.useState('');
    const [evidence, setEvidence] = React.useState('');
    const [message, setMessage] = React.useState('');
    const [reviewAttempt, setReviewAttempt] = React.useState(0);
    const [complaintAttempt, setComplaintAttempt] = React.useState(0);

    React.useEffect(() => {
        api.get<{ orders: Order[] }>('/api/orders').then((response) => setOrders(response.data.orders.filter((order) => order.status === 'COMPLETED'))).catch(() => onError('Completed orders could not be loaded.'));
    }, [onError]);

    async function submitReview(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setReviewAttempt((attempt) => attempt + 1);
        if (!orderId) { onError('Choose a completed order first.'); return; }
        if (!await confirmAction({ title: 'Submit this review?', text: 'Your rating and comment will be shared with the seller.', confirmText: 'Submit review' })) return;
        try {
            await initializeCsrf();
            await api.post(`/api/orders/${orderId}/review`, { rating: Number(rating), comment });
            setMessage('Review submitted.');
            setComment('');
            showSuccess('Review submitted.');
        } catch (requestError: any) { onError(requestError.response?.data?.message ?? 'The review could not be submitted.'); }
    }

    async function submitComplaint(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setComplaintAttempt((attempt) => attempt + 1);
        const validationError = !orderId ? 'Choose a completed order first.' : required(reason, 'Reason') ?? required(description, 'Description');
        if (validationError) { onError(validationError); return; }
        if (!await confirmAction({ title: 'Submit this complaint?', text: 'The FARMGATE team will review the complaint details.', confirmText: 'Submit complaint' })) return;
        try {
            await initializeCsrf();
            await api.post(`/api/orders/${orderId}/complaint`, { reason, description, evidence });
            setMessage('Complaint opened for review.');
            setReason(''); setDescription(''); setEvidence('');
            showSuccess('Complaint submitted for review.');
        } catch (requestError: any) { onError(requestError.response?.data?.message ?? 'The complaint could not be submitted.'); }
    }

    return <section className="feedback-panel"><p className="eyebrow">After purchase</p><h2>Reviews and complaints</h2><ValidatedField validationTrigger={Math.max(reviewAttempt, complaintAttempt)} as="select" label="Completed order" value={orderId} onChange={setOrderId} validate={(value) => required(value, 'Order')}><option value="">Choose an order</option>{orders.map((order) => <option key={order.id} value={order.id}>Order {order.order_reference} · PHP {order.total_amount}</option>)}</ValidatedField><div className="feedback-grid"><form noValidate onSubmit={submitReview}><h3>Leave a review</h3><ValidatedField as="select" label="Rating" value={rating} onChange={setRating}><option value="5">5 - Excellent</option><option value="4">4 - Good</option><option value="3">3 - Fair</option><option value="2">2 - Poor</option><option value="1">1 - Very poor</option></ValidatedField><ValidatedField as="textarea" label="Comment" value={comment} onChange={setComment} maxLength={2000} /><button type="submit" disabled={!orderId}>Submit review</button></form><form noValidate onSubmit={submitComplaint}><h3>Open a complaint</h3><ValidatedField validationTrigger={complaintAttempt} label="Reason" value={reason} onChange={setReason} validate={(value) => required(value, 'Reason')} maxLength={120} /><ValidatedField validationTrigger={complaintAttempt} as="textarea" label="Description" value={description} onChange={setDescription} validate={(value) => required(value, 'Description')} maxLength={5000} /><ValidatedField as="textarea" label="Evidence" value={evidence} onChange={setEvidence} maxLength={5000} /><button type="submit" disabled={!orderId}>Submit complaint</button></form></div>{message && <p className="success" role="status">{message}</p>}</section>;
}
