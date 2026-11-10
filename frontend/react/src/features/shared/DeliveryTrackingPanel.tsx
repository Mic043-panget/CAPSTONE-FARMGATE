import React from 'react';
import api from '../../lib/api';
import { DeliveryProofSummary } from './DeliveryProofSummary';

const OrderRouteMap = React.lazy(() => import('../buyer/OrderRouteMap').then((module) => ({ default: module.OrderRouteMap })));

type LiveDelivery = {
    id: number;
    delivery_reference: string;
    status: string;
    rider?: { name: string } | null;
    rider_location_latitude?: number | null;
    rider_location_longitude?: number | null;
    rider_location_updated_at?: string | null;
    pickup_verified_at?: string | null;
    delivery_verified_at?: string | null;
    has_delivery_proof?: boolean;
    recipient_confirmed?: boolean;
    delivery_recipient_name?: string | null;
    proof_captured_at?: string | null;
    proof_recorded_at?: string | null;
};

const terminalStatuses = new Set(['DELIVERED', 'FAILED', 'CANCELLED']);

function statusLabel(status: string): string {
    return status.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function DeliveryTrackingPanel({ deliveryId, sellerName, buyerName, sellerLatitude, sellerLongitude, buyerLatitude, buyerLongitude, onStatusChange }: {
    deliveryId: number;
    sellerName: string;
    buyerName: string;
    sellerLatitude: number | string | null;
    sellerLongitude: number | string | null;
    buyerLatitude: number | string | null;
    buyerLongitude: number | string | null;
    onStatusChange?: (status: string) => void;
}) {
    const [delivery, setDelivery] = React.useState<LiveDelivery | null>(null);
    const [error, setError] = React.useState('');
    const [loading, setLoading] = React.useState(true);
    const onStatusChangeRef = React.useRef(onStatusChange);

    React.useEffect(() => { onStatusChangeRef.current = onStatusChange; }, [onStatusChange]);

    React.useEffect(() => {
        let active = true;
        let timer: number | undefined;
        let stopped = false;

        const refresh = async () => {
            try {
                const response = await api.get<{ delivery: LiveDelivery }>(`/api/deliveries/${deliveryId}/tracking`);
                if (!active) return;
                setDelivery(response.data.delivery);
                onStatusChangeRef.current?.(response.data.delivery.status);
                setError('');
                stopped = terminalStatuses.has(response.data.delivery.status);
            } catch (requestError: any) {
                if (active) setError(requestError.userMessage ?? 'Live delivery information could not be refreshed.');
            } finally {
                if (active) setLoading(false);
                if (active && !stopped) timer = window.setTimeout(() => void refresh(), 10_000);
            }
        };

        void refresh();
        return () => {
            active = false;
            if (timer !== undefined) window.clearTimeout(timer);
        };
    }, [deliveryId]);

    return <section className="delivery-tracking-panel" aria-label="Live delivery tracking">
        <div className="delivery-tracking-heading">
            <div><p className="eyebrow">{delivery?.delivery_reference ?? 'Delivery tracking'}</p><h3>{delivery ? statusLabel(delivery.status) : 'Loading delivery status'}</h3></div>
            {delivery?.rider?.name && <span>Rider · {delivery.rider.name}</span>}
        </div>
        {loading && <p role="status">Loading the latest rider location…</p>}
        {error && <p className="delivery-tracking-error" role="status">{error}</p>}
        {delivery && <dl className="delivery-tracking-events">
            <div><dt>Pickup verified</dt><dd>{delivery.pickup_verified_at ? new Date(delivery.pickup_verified_at).toLocaleString() : 'Not yet'}</dd></div>
            <div><dt>Delivery verified</dt><dd>{delivery.delivery_verified_at ? new Date(delivery.delivery_verified_at).toLocaleString() : 'Not yet'}</dd></div>
            <div><dt>Rider location</dt><dd>{delivery.rider_location_updated_at ? `Updated ${new Date(delivery.rider_location_updated_at).toLocaleString()}` : 'Waiting for rider location'}</dd></div>
        </dl>}
        {delivery && <DeliveryProofSummary
            deliveryId={delivery.id}
            hasProof={delivery.has_delivery_proof ?? false}
            recipientConfirmed={delivery.recipient_confirmed}
            recipientName={delivery.delivery_recipient_name}
            capturedAt={delivery.proof_captured_at}
            recordedAt={delivery.proof_recorded_at}
        />}
        <React.Suspense fallback={<p role="status">Loading route map…</p>}>
            <OrderRouteMap
                sellerName={sellerName}
                buyerName={buyerName}
                sellerLatitude={sellerLatitude}
                sellerLongitude={sellerLongitude}
                buyerLatitude={buyerLatitude}
                buyerLongitude={buyerLongitude}
                riderLatitude={delivery?.rider_location_latitude ?? null}
                riderLongitude={delivery?.rider_location_longitude ?? null}
                riderName={delivery?.rider?.name ?? 'Rider'}
            />
        </React.Suspense>
    </section>;
}
