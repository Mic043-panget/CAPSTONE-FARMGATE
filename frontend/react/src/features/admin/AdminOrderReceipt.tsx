import React from 'react';
import api, { initializeCsrf } from '../../lib/api';
import { useAccessibleDialog } from '../../shared/hooks/useAccessibleDialog';
import { DeliveryProofSummary } from '../shared/DeliveryProofSummary';

type AdminReceiptOrder = {
    id: number;
    order_reference: string;
    payment_reference?: string;
    status: string;
    display_status?: string;
    total_amount: string | number;
    subtotal_amount?: string | number;
    delivery_fee?: string | number;
    platform_fee?: string | number;
    order_processing_fee?: string | number;
    transaction_fee?: string | number;
    payment_processing_fee?: string | number;
    buyer_service_fee?: string | number;
    discount_amount?: string | number;
    payment_method?: string | null;
    payment_status?: string | null;
    delivery_method?: string | null;
    delivery_reconciliation_required?: boolean;
    cod_reconciliation_evidence?: {
        collection_status: string;
        expected_amount_cents: number;
        collected_amount_cents?: number | null;
        collected_at?: string | null;
        remittance?: {
            reference: string;
            status: string;
            method_type: string;
            expected_amount_cents: number;
            received_amount_cents?: number | null;
            submitted_at?: string | null;
            reconciled_at?: string | null;
            history: { action: string; expected_amount_cents: number; received_amount_cents?: number | null; reason?: string | null; created_at: string; actor?: { name: string; role?: string } | null }[];
        } | null;
    } | null;
    created_at: string;
    activities?: { id: number; activity_key: string; details: string; created_at: string; actor?: { name: string } | null }[];
    status_history?: { id: number; from_status?: string | null; to_status: string; reason?: string | null; created_at: string; actor?: { name: string } | null }[];
    delivery?: {
        id: number; delivery_reference: string; status: string; has_delivery_proof: boolean; recipient_confirmed?: boolean; delivery_recipient_name?: string | null; proof_captured_at?: string | null; proof_recorded_at?: string | null;
        assigned_at?: string | null; pickup_verified_at?: string | null; delivery_verified_at?: string | null;
        rider?: { name: string; email?: string } | null;
        status_history?: { id: number; from_status?: string | null; to_status: string; reason?: string | null; created_at: string; actor?: { name: string } | null }[];
        proof_corrections?: { id: number; reason: string; created_at: string; corrected_by?: { name: string } | null }[];
    } | null;
    complaints?: {
        id: number; case_reference: string; case_type: string; reason: string; description: string; status: string; refund_status: string;
        resolution_reason?: string | null; requested_amount?: string | null; approved_refund_amount?: string | null;
        return_method?: string | null; payout_reference?: string | null; payout_evidence_url?: string | null;
        evidence_media?: { id: number; mime_type: string; original_name: string; url: string }[];
        status_history?: { id: number; from_status?: string | null; to_status: string; reason?: string | null; created_at: string; actor?: { name: string } | null }[];
        messages?: { id: number; message: string; created_at: string; sender?: { name: string } | null; media_files?: { id: number; mime_type: string; original_name: string; url: string }[] }[];
    }[];
    review?: { status: string; rating: number; comment?: string | null; listing?: { name: string } | null } | null;
    audit_history?: { id: number; action: string; description?: string | null; created_at: string; actor?: { name: string; role?: string } | null }[];
    buyer?: { name: string; email?: string; phone_number?: string } | null;
    seller?: {
        name: string;
        seller_profile?: { business_name?: string | null; phone?: string | null; address?: string | null } | null;
    } | null;
    shipping_address?: {
        recipient_name?: string;
        phone_number?: string;
        street_address?: string;
        address_line2?: string | null;
        barangay?: string;
        city_municipality?: string;
        province?: string;
        postal_code?: string;
    } | null;
    items: { id: number; quantity: number; pricing_type: string; unit_price: string | number; total_amount: string | number; listing?: { name: string } | null }[];
};

function money(value: string | number | null | undefined): string {
    return `PHP ${Number(value ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusLabel(status: string): string {
    return status.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function addressText(order: AdminReceiptOrder): string {
    const address = order.shipping_address;
    return [
        address?.street_address,
        address?.address_line2,
        address?.barangay,
        address?.city_municipality,
        address?.province,
        address?.postal_code,
    ].filter(Boolean).join(', ') || (order.delivery_method === 'SELF_PICKUP' ? 'Buyer will pick up' : 'Address not provided');
}

export function AdminOrderReceipt({ orderId, reference, onError, openInitially = false, onOpenStarted }: {
    orderId: number;
    reference: string;
    onError: (message: string) => void;
    openInitially?: boolean;
    onOpenStarted?: () => void;
}) {
    const [order, setOrder] = React.useState<AdminReceiptOrder | null>(null);
    const [open, setOpen] = React.useState(false);
    const [loading, setLoading] = React.useState(false);
    const [correctionReason, setCorrectionReason] = React.useState('');
    const [evidenceReviewed, setEvidenceReviewed] = React.useState(false);
    const [savingCorrection, setSavingCorrection] = React.useState(false);
    const [correctionMessage, setCorrectionMessage] = React.useState('');
    const initialOpenHandled = React.useRef(false);
    const receiptDialogRef = useAccessibleDialog<HTMLElement>(open, () => setOpen(false));

    React.useEffect(() => {
        setCorrectionReason('');
        setEvidenceReviewed(false);
        setCorrectionMessage('');
    }, [orderId]);

    React.useEffect(() => {
        if (!openInitially || initialOpenHandled.current) return;
        initialOpenHandled.current = true;
        setOrder(null);
        setOpen(true);
        onOpenStarted?.();
    }, [onOpenStarted, openInitially]);

    React.useEffect(() => {
        if (!open) return undefined;
        let active = true;
        setLoading(true);
        api.get<{ order: AdminReceiptOrder }>(`/api/admin/orders/${orderId}`)
            .then((response) => {
                if (active) setOrder(response.data.order);
            })
            .catch((requestError: any) => {
                if (active) onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'Order receipt could not be loaded.');
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => { active = false; };
    }, [onError, open, orderId]);

    function printReceipt() {
        document.body.classList.add('printing-admin-order-receipt');
        window.print();
        document.body.classList.remove('printing-admin-order-receipt');
    }

    async function correctPrematureCompletion(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!order || !evidenceReviewed || correctionReason.trim().length < 10) return;
        setSavingCorrection(true);
        setCorrectionMessage('');
        try {
            await initializeCsrf();
            await api.post(`/api/admin/orders/${order.id}/reconciliation`, {
                decision: 'restore_to_fulfilling',
                reason: correctionReason.trim(),
                evidence_reviewed: true,
            });
            const response = await api.get<{ order: AdminReceiptOrder }>(`/api/admin/orders/${order.id}`);
            setOrder(response.data.order);
            setCorrectionReason('');
            setEvidenceReviewed(false);
            setCorrectionMessage('Correction recorded. Payment status was not changed.');
        } catch (requestError: any) {
            onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'The reconciliation correction could not be recorded.');
        } finally {
            setSavingCorrection(false);
        }
    }

    const shopName = order?.seller?.seller_profile?.business_name || order?.seller?.name || 'Farmgate Seller';

    return <>
        <button className="admin-order-reference" type="button" onClick={() => { setOrder(null); setOpen(true); }}>{reference}</button>
        {open && <div className="buyer-order-receipt-backdrop" role="presentation" onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
        }}>
            <section ref={receiptDialogRef} className="buyer-order-receipt admin-order-receipt" role="dialog" aria-modal="true" aria-labelledby="admin-order-receipt-title">
                <button className="buyer-order-receipt-close admin-order-receipt-close" type="button" aria-label="Close order receipt" onClick={() => setOpen(false)}>×</button>
                {loading ? <p role="status">Loading order receipt…</p> : !order ? <p role="alert">Order receipt is unavailable.</p> : <>
                    <header className="seller-receipt-brand">
                        <span className="seller-receipt-brand-mark">FARM<span>GATE</span></span>
                        <p className="eyebrow">Order receipt</p>
                        <h2 id="admin-order-receipt-title">{shopName}</h2>
                        <p>{order.seller?.name ?? 'Seller'}{order.seller?.seller_profile?.phone ? ` · ${order.seller.seller_profile.phone}` : ''}</p>
                        {order.seller?.seller_profile?.address && <p>{order.seller.seller_profile.address}</p>}
                        <p className="seller-receipt-document-label">Farmgate order receipt · Not a BIR-registered invoice or official receipt</p>
                    </header>
                    <p className="buyer-order-receipt-meta"><strong>{order.order_reference}</strong><br />Payment reference: {order.payment_reference ?? 'Not available'}<br />{new Date(order.created_at).toLocaleString()}</p>
                    <div className="buyer-order-receipt-parties">
                        <div><strong>Buyer</strong><span>{order.shipping_address?.recipient_name ?? order.buyer?.name ?? 'Buyer'}</span>{(order.shipping_address?.phone_number || order.buyer?.phone_number) && <span>{order.shipping_address?.phone_number ?? order.buyer?.phone_number}</span>}{order.buyer?.email && <span>{order.buyer.email}</span>}</div>
                        <div><strong>{order.delivery_method === 'SELF_PICKUP' ? 'Pickup' : 'Delivery'}</strong><span>{order.delivery_method?.replaceAll('_', ' ') ?? 'Not specified'}</span><span>{addressText(order)}</span></div>
                    </div>
                    <dl className="buyer-order-receipt-payment">
                        <div><dt>Payment method</dt><dd>{order.payment_method?.replaceAll('_', ' ') ?? 'Not specified'}</dd></div>
                        <div><dt>Payment status</dt><dd>{order.payment_status?.replaceAll('_', ' ') ?? 'Status unavailable'}</dd></div>
                        <div><dt>Current order status</dt><dd>{statusLabel(order.display_status ?? order.status)}</dd></div>
                    </dl>
                    <table className="buyer-order-receipt-items">
                        <thead><tr><th scope="col">Livestock</th><th scope="col">Unit price</th><th scope="col">Line total</th></tr></thead>
                        <tbody>{order.items.map((item) => <tr key={item.id}>
                            <td>{item.quantity} {item.pricing_type === 'PER_KILO' ? 'kg' : 'head'} × {item.listing?.name ?? 'Removed listing'}</td>
                            <td>{money(item.unit_price)}</td>
                            <td>{money(item.total_amount)}</td>
                        </tr>)}</tbody>
                    </table>
                    <dl className="buyer-order-receipt-totals">
                        <div><dt>Livestock total</dt><dd>{money(order.subtotal_amount)}</dd></div>
                        <div><dt>{order.delivery_method === 'SELF_PICKUP' ? 'Pickup fee' : 'Delivery fee'}</dt><dd>{money(order.delivery_fee)}</dd></div>
                        {Number(order.platform_fee ?? 0) > 0 && <div><dt>Platform fee</dt><dd>{money(order.platform_fee)}</dd></div>}
                        {Number(order.order_processing_fee ?? 0) > 0 && <div><dt>Order processing fee</dt><dd>{money(order.order_processing_fee)}</dd></div>}
                        {Number(order.transaction_fee ?? 0) > 0 && <div><dt>Transaction fee</dt><dd>{money(order.transaction_fee)}</dd></div>}
                        {Number(order.payment_processing_fee ?? 0) > 0 && <div><dt>Payment processing fee</dt><dd>{money(order.payment_processing_fee)}</dd></div>}
                        {Number(order.buyer_service_fee ?? 0) > 0 && <div><dt>Buyer service fee</dt><dd>{money(order.buyer_service_fee)}</dd></div>}
                        {Number(order.discount_amount ?? 0) > 0 && <div><dt>Discount</dt><dd>− {money(order.discount_amount)}</dd></div>}
                        <div className="buyer-order-grand-total"><dt>Total</dt><dd>{money(order.total_amount)}</dd></div>
                    </dl>
                    <section className="admin-order-investigation"><h3>Delivery and rider assignment</h3>{order.delivery ? <>
                        <p><strong>Delivery reference:</strong> {order.delivery.delivery_reference} · <strong>Status:</strong> {statusLabel(order.delivery.status)} · <strong>Rider:</strong> {order.delivery.rider?.name ?? 'Unassigned'}{order.delivery.rider?.email ? ` (${order.delivery.rider.email})` : ''}</p>
                        <p><strong>Assigned:</strong> {order.delivery.assigned_at ? new Date(order.delivery.assigned_at).toLocaleString() : 'Not assigned'} · <strong>Pickup verified:</strong> {order.delivery.pickup_verified_at ? new Date(order.delivery.pickup_verified_at).toLocaleString() : 'No'} · <strong>Delivery verified:</strong> {order.delivery.delivery_verified_at ? new Date(order.delivery.delivery_verified_at).toLocaleString() : 'No'}</p>
                        <p><strong>Proof:</strong> {order.delivery.has_delivery_proof ? 'Saved' : 'Not recorded'}{order.delivery.proof_captured_at && ` · captured ${new Date(order.delivery.proof_captured_at).toLocaleString()}`}{order.delivery.proof_recorded_at && ` · recorded ${new Date(order.delivery.proof_recorded_at).toLocaleString()}`}</p>
                        {order.delivery.has_delivery_proof && <DeliveryProofSummary deliveryId={order.delivery.id} hasProof recipientConfirmed={order.delivery.recipient_confirmed} recipientName={order.delivery.delivery_recipient_name} capturedAt={order.delivery.proof_captured_at} recordedAt={order.delivery.proof_recorded_at} />}
                        {!!order.delivery.status_history?.length && <ol>{order.delivery.status_history.map((entry) => <li key={entry.id}><strong>{statusLabel(entry.to_status)}</strong> · {entry.actor?.name ?? 'System'} · {new Date(entry.created_at).toLocaleString()}{entry.reason && <p>{entry.reason}</p>}</li>)}</ol>}
                        {!!order.delivery.proof_corrections?.length && <div><h4>Proof corrections</h4><ul>{order.delivery.proof_corrections.map((entry) => <li key={entry.id}>{entry.corrected_by?.name ?? 'Admin'} · {new Date(entry.created_at).toLocaleString()} · {entry.reason}</li>)}</ul></div>}
                    </> : <p>No rider delivery record exists.</p>}</section>
                    {order.payment_method === 'COD' && <section className="admin-order-investigation">
                        <h3>COD collection and remittance evidence</h3>
                        {order.cod_reconciliation_evidence ? <>
                            <p><strong>Collection:</strong> {statusLabel(order.cod_reconciliation_evidence.collection_status)} · expected {money(order.cod_reconciliation_evidence.expected_amount_cents / 100)} · collected {order.cod_reconciliation_evidence.collected_amount_cents == null ? 'Not recorded' : money(order.cod_reconciliation_evidence.collected_amount_cents / 100)} · {order.cod_reconciliation_evidence.collected_at ? new Date(order.cod_reconciliation_evidence.collected_at).toLocaleString() : 'No collection timestamp'}</p>
                            {order.cod_reconciliation_evidence.remittance ? <>
                                <p><strong>Remittance:</strong> {order.cod_reconciliation_evidence.remittance.reference} · {statusLabel(order.cod_reconciliation_evidence.remittance.status)} · {statusLabel(order.cod_reconciliation_evidence.remittance.method_type)} · expected {money(order.cod_reconciliation_evidence.remittance.expected_amount_cents / 100)} · received {order.cod_reconciliation_evidence.remittance.received_amount_cents == null ? 'Not recorded' : money(order.cod_reconciliation_evidence.remittance.received_amount_cents / 100)}</p>
                                {!!order.cod_reconciliation_evidence.remittance.history.length && <ol>{order.cod_reconciliation_evidence.remittance.history.map((entry, index) => <li key={`${entry.action}-${entry.created_at}-${index}`}><strong>{statusLabel(entry.action)}</strong> · {entry.actor?.name ?? 'Unknown admin'} · {new Date(entry.created_at).toLocaleString()} · expected {money(entry.expected_amount_cents / 100)} · received {entry.received_amount_cents == null ? 'Not recorded' : money(entry.received_amount_cents / 100)}{entry.reason && <p>{entry.reason}</p>}</li>)}</ol>}
                            </> : <p>No associated remittance record exists.</p>}
                        </> : <p>No COD collection record exists. Payment remains {statusLabel(order.payment_status ?? 'unknown')}.</p>}
                        <p>Delivery completion and payment confirmation are separate. COD is only marked paid after receipt is reconciled.</p>
                    </section>}
                    {order.delivery_reconciliation_required && <section className="admin-order-investigation" role="alert">
                        <h3>Admin review required: completed before verified delivery</h3>
                        <p>Order {order.order_reference} is marked {statusLabel(order.status)}, but delivery {order.delivery?.delivery_reference ?? 'has no delivery record'} is {statusLabel(order.delivery?.status ?? 'not recorded')} and is not QR-verified. Existing order, delivery, payment, proof, status-history and audit evidence is shown above.</p>
                        <form onSubmit={(event) => void correctPrematureCompletion(event)}>
                            <label htmlFor={`reconciliation-reason-${order.id}`}>Reason for restoring the order to Fulfilling</label>
                            <textarea id={`reconciliation-reason-${order.id}`} value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} minLength={10} maxLength={2000} required />
                            <label><input type="checkbox" checked={evidenceReviewed} onChange={(event) => setEvidenceReviewed(event.target.checked)} required /> I reviewed the order and delivery evidence and authorize this status correction.</label>
                            <button type="submit" disabled={!evidenceReviewed || correctionReason.trim().length < 10 || savingCorrection}>{savingCorrection ? 'Recording correction…' : 'Restore to Fulfilling'}</button>
                        </form>
                        {correctionMessage && <p role="status">{correctionMessage}</p>}
                        <p>This action preserves the original Completed value in status and audit history. It does not change payment status.</p>
                    </section>}
                    {!!order.complaints?.length && <section className="admin-order-investigation"><h3>Complaints, returns and refunds</h3>{order.complaints.map((item) => <article key={item.id}>
                        <h4>{item.case_reference} · {statusLabel(item.case_type)} · {statusLabel(item.status)}</h4><p><strong>Reason:</strong> {item.reason} · <strong>Refund status:</strong> {statusLabel(item.refund_status)}</p><p>{item.description}</p>
                        {item.requested_amount && <p>Requested {money(item.requested_amount)} · approved {money(item.approved_refund_amount)} · {item.return_method ? `return ${statusLabel(item.return_method)}` : ''}</p>}
                        {item.resolution_reason && <p><strong>Resolution:</strong> {item.resolution_reason}</p>}
                        {item.payout_reference && <p>Manual payout reference: {item.payout_reference}</p>}
                        {item.payout_evidence_url && <p><a href={item.payout_evidence_url} target="_blank" rel="noreferrer">View protected payout evidence</a></p>}
                        {item.evidence_media?.map((file) => file.mime_type.startsWith('video/') ? <video key={file.id} src={file.url} controls aria-label={file.original_name} /> : <a key={file.id} href={file.url} target="_blank" rel="noreferrer">{file.original_name}</a>)}
                        {!!item.status_history?.length && <ol>{item.status_history.map((entry) => <li key={entry.id}><strong>{statusLabel(entry.to_status)}</strong> · {entry.actor?.name ?? 'System'} · {new Date(entry.created_at).toLocaleString()}{entry.reason && <p>{entry.reason}</p>}</li>)}</ol>}
                        {!!item.messages?.length && <ul>{item.messages.map((message) => <li key={message.id}>{message.sender?.name ?? 'Participant'} · {new Date(message.created_at).toLocaleString()}: {message.message}{message.media_files?.map((file) => <a key={file.id} href={file.url} target="_blank" rel="noreferrer"> {file.original_name}</a>)}</li>)}</ul>}
                    </article>)}</section>}
                    {order.review && <section className="admin-order-investigation"><h3>Buyer review</h3><p>{order.review.listing?.name ?? 'Livestock listing'} · {'★'.repeat(order.review.rating)} · {statusLabel(order.review.status)}</p><p>{order.review.comment ?? 'No written review.'}</p></section>}
                    {!!order.status_history?.length && <section className="admin-order-investigation"><h3>Order status timeline</h3><ol>{order.status_history.map((entry) => <li key={entry.id}><strong>{statusLabel(entry.to_status)}</strong> · {entry.actor?.name ?? 'System'} · {new Date(entry.created_at).toLocaleString()}{entry.reason && <p>{entry.reason}</p>}</li>)}</ol></section>}
                    {!!order.activities?.length && <section className="seller-order-history admin-order-activity"><h3>Order and case activity</h3><ol>{order.activities.map((activity) => <li key={activity.id}><strong>{activity.activity_key.replaceAll('_', ' ')}</strong><span>{activity.actor?.name ? ` · ${activity.actor.name}` : ''} · {new Date(activity.created_at).toLocaleString()}</span><p>{activity.details}</p></li>)}</ol></section>}
                    {!!order.audit_history?.length && <section className="admin-order-investigation"><h3>Related audit history</h3><ol>{order.audit_history.map((event) => <li key={event.id}><strong>{event.action}</strong> · {event.actor?.name ?? 'Guest'} ({event.actor?.role ?? '-'}) · {new Date(event.created_at).toLocaleString()}<p>{event.description}</p></li>)}</ol></section>}
                    <div className="buyer-order-receipt-actions admin-order-receipt-actions">
                        <button className="buyer-order-receipt-done" type="button" onClick={printReceipt}>Print receipt</button>
                        <button className="buyer-order-receipt-done" type="button" onClick={() => setOpen(false)}>Close</button>
                    </div>
                </>}
            </section>
        </div>}
    </>;
}
