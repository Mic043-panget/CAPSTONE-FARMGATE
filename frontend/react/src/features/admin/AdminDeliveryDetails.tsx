import React from 'react';
import api from '../../lib/api';
import { FarmgateDetailDialog } from '../shared/FarmgateDetailDialog';
import { AdminDeliveryProofActions } from './AdminDeliveryProofActions';
import { ViewDetailsAction } from '../../shared/components/Button';

type Delivery = {
    id: number;
    delivery_reference: string;
    status: string;
    created_at: string;
    assigned_at?: string | null;
    pickup_verified_at?: string | null;
    delivery_verified_at?: string | null;
    has_delivery_proof: boolean;
    recipient_confirmed?: boolean;
    delivery_recipient_name?: string | null;
    proof_captured_at?: string | null;
    proof_recorded_at?: string | null;
    proof_corrections_count?: number;
    rider?: { name: string; email: string } | null;
    order?: {
        order_reference: string;
        status: string;
        total_amount: string;
        delivery_fee: string;
        payment_method: string;
        payment_status: string;
        payment_reference?: string;
        buyer?: { name: string; email: string };
        seller?: { name: string; email: string };
        items?: { id: number; quantity: number; total_amount: string; listing?: { name: string } | null }[];
    };
    status_history?: { id: number; from_status?: string | null; to_status: string; reason?: string | null; created_at: string; actor?: { name: string } | null }[];
    proof_corrections?: { id: number; reason: string; created_at: string; corrected_by?: { name: string } | null; old_recipient_name?: string | null; new_recipient_name?: string | null }[];
};

function formatDate(value?: string | null): string {
    return value ? new Date(value).toLocaleString() : 'Not recorded';
}

export function AdminDeliveryDetails({ deliveryId, onError, onCorrected }: {
    deliveryId: number;
    onError: (message: string) => void;
    onCorrected: () => void;
}) {
    const [open, setOpen] = React.useState(false);
    const [loading, setLoading] = React.useState(false);
    const [revision, setRevision] = React.useState(0);
    const [delivery, setDelivery] = React.useState<Delivery | null>(null);
    React.useEffect(() => {
        if (!open) return;
        let current = true;
        setLoading(true);
        api.get<{ delivery: Delivery }>(`/api/admin/deliveries/${deliveryId}`).then(({ data }) => {
            if (current) setDelivery(data.delivery);
        }).catch((requestError: any) => {
            if (current) {
                onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'Delivery details could not be loaded.');
                setOpen(false);
            }
        }).finally(() => { if (current) setLoading(false); });
        return () => { current = false; };
    }, [deliveryId, onError, open, revision]);

    return <>
        <ViewDetailsAction contextLabel={`delivery ${deliveryId}`} className="admin-inline-action" onClick={() => setOpen(true)} />
        {open && <FarmgateDetailDialog
            eyebrow="Delivery details"
            title={delivery?.delivery_reference ?? 'Delivery'}
            onClose={() => setOpen(false)}
            className="admin-delivery-detail-modal"
            contentClassName="admin-delivery-detail-content"
        >
                {loading || !delivery ? <p role="status">Loading delivery details...</p> : <>
                    <p><strong>Status:</strong> {delivery.status.replaceAll('_', ' ')}</p>
                    <div className="admin-delivery-detail-grid">
                        <section><h3>Order and participants</h3>
                            <p><strong>Order:</strong> {delivery.order?.order_reference ?? 'Unavailable'} · {delivery.order?.status ?? 'Unknown'}</p>
                            <p><strong>Buyer:</strong> {delivery.order?.buyer?.name ?? 'Unavailable'}{delivery.order?.buyer?.email ? ` (${delivery.order.buyer.email})` : ''}</p>
                            <p><strong>Seller:</strong> {delivery.order?.seller?.name ?? 'Unavailable'}{delivery.order?.seller?.email ? ` (${delivery.order.seller.email})` : ''}</p>
                            <p><strong>Rider:</strong> {delivery.rider?.name ?? 'Unassigned'}{delivery.rider?.email ? ` (${delivery.rider.email})` : ''}</p>
                            <p><strong>Payment:</strong> {delivery.order?.payment_method ?? 'Unknown'} · {delivery.order?.payment_status ?? 'Unknown'} · {delivery.order?.payment_reference ?? 'Reference unavailable'}</p>
                            <ul>{delivery.order?.items?.map((item) => <li key={item.id}>{item.quantity} × {item.listing?.name ?? 'Livestock'} · PHP {Number(item.total_amount).toFixed(2)}</li>)}</ul>
                        </section>
                        <section><h3>Verification timeline</h3>
                            <p><strong>Created:</strong> {formatDate(delivery.created_at)}</p>
                            <p><strong>Rider assigned:</strong> {formatDate(delivery.assigned_at)}</p>
                            <p><strong>Pickup verified:</strong> {formatDate(delivery.pickup_verified_at)}</p>
                            <p><strong>Delivery verified:</strong> {formatDate(delivery.delivery_verified_at)}</p>
                            {delivery.status_history?.length ? <ol>{delivery.status_history.map((item) => <li key={item.id}><strong>{item.to_status.replaceAll('_', ' ')}</strong> · {item.actor?.name ?? 'System'} · {formatDate(item.created_at)}{item.reason ? <p>{item.reason}</p> : null}</li>)}</ol> : <p>No status history recorded.</p>}
                        </section>
                    </div>
                    <section className="admin-delivery-proof-detail">
                        <h3>Proof and recipient confirmation</h3>
                        <p>{delivery.has_delivery_proof ? 'Proof saved' : 'Not submitted'}{delivery.proof_corrections?.length ? ' · Correction recorded' : ''}</p>
                        <p><strong>Recipient confirmed:</strong> {delivery.recipient_confirmed ? 'Yes' : 'No'}{delivery.delivery_recipient_name ? ` · ${delivery.delivery_recipient_name}` : ''}</p>
                        <p><strong>Photo captured:</strong> {formatDate(delivery.proof_captured_at)} · <strong>Proof recorded:</strong> {formatDate(delivery.proof_recorded_at)}</p>
                        <AdminDeliveryProofActions row={delivery} onCorrected={() => { onCorrected(); setRevision((value) => value + 1); }} />
                    </section>
                    {!!delivery.proof_corrections?.length && <section><h3>Proof correction history</h3><ol>{delivery.proof_corrections.map((item) => <li key={item.id}><strong>{item.corrected_by?.name ?? 'Admin'}</strong> · {formatDate(item.created_at)}<p>{item.reason}</p><p>{item.old_recipient_name ?? 'No previous recipient'} → {item.new_recipient_name ?? 'No recipient recorded'}</p></li>)}</ol></section>}
                </>}
        </FarmgateDetailDialog>}
    </>;
}
