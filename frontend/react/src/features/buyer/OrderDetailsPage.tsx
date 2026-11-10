import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import api from '../../lib/api';
import type { User } from '../../shared/types';
import { OrderRouteMap } from './OrderRouteMap';
import { DeliveryTrackingPanel } from '../shared/DeliveryTrackingPanel';
import { OrderCasePanel } from './OrderCasePanel';

type OrderDetails = {
    id: number;
    seller_id: number;
    order_reference: string;
    payment_reference?: string;
    status: string;
    total_amount: string;
    payment_method?: string | null;
    payment_status?: string | null;
    cod_payment?: {
        amount_due: string;
        status: string;
        collection_status: string | null;
        remittance_status: string | null;
    } | null;
    subtotal_amount?: string;
    delivery_fee?: string;
    delivery_distance_km?: number | string | null;
    delivery_distance_method?: 'OSRM_ROAD_ROUTE' | 'OSRM_BARANGAY_ESTIMATE' | null;
    platform_fee?: string;
    order_processing_fee?: string;
    transaction_fee?: string;
    payment_processing_fee?: string;
    buyer_service_fee?: string;
    discount_amount?: string;
    delivery_method?: string;
    created_at: string;
    updated_at: string;
    status_history?: { id: number; to_status: string; reason?: string | null; actor?: { name: string } | null; created_at: string }[];
    activities?: { id: number; actor?: { name: string } | null; activity_key: string; details: string; created_at: string }[];
    shipping_address?: {
        recipient_name?: string;
        street_address?: string;
        address_line2?: string | null;
        phone_number?: string | null;
        barangay?: string;
        city_municipality?: string;
        province?: string;
        postal_code?: string;
        latitude?: number | string | null;
        longitude?: number | string | null;
    } | null;
    seller_location_snapshot?: {
        business_name?: string | null;
        address?: string | null;
        latitude?: number | string | null;
        longitude?: number | string | null;
    } | null;
    seller?: {
        id: number;
        name: string;
        seller_profile?: {
            latitude: number | string | null;
            longitude: number | string | null;
            address?: string | null;
        } | null;
    } | null;
    delivery?: {
        id: number;
        delivery_reference: string;
        status: string;
        pickup_latitude?: number | null;
        pickup_longitude?: number | null;
        status_history?: { id: number; from_status: string | null; to_status: string; reason?: string | null; actor?: { name: string } | null; created_at: string }[];
    } | null;
    items: {
        id: number;
        quantity: number;
        unit_price: string;
        total_amount: string;
        pricing_type: 'PER_KILO' | 'PER_HEAD';
        listing?: {
            id: number;
            name: string;
            category?: { name: string; reference_code: string } | null;
        } | null;
    }[];
};

function formatAmount(amount: string | number | undefined): string {
    return Number(amount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function positiveAmount(amount: string | number | undefined): boolean {
    const value = Number(amount ?? 0);
    return Number.isFinite(value) && value > 0;
}

function paymentMethodLabel(method: string | null | undefined): string {
    return ({
        COD: 'Cash on Delivery (COD)',
        GCASH: 'GCash',
        CARD: 'Debit/Credit Card',
        GOOGLE_PAY: 'Google Pay',
    } as Record<string, string>)[method ?? ''] ?? method?.replaceAll('_', ' ') ?? 'Not specified';
}

function paymentStatusLabel(status: string | null | undefined): string {
    return ({
        PAID: 'Paid',
        UNPAID: 'Not paid',
        PENDING: 'Payment pending',
        FAILED: 'Payment failed',
        AWAITING_CONFIRMATION: 'Awaiting Farmgate confirmation',
    } as Record<string, string>)[status ?? ''] ?? status?.replaceAll('_', ' ') ?? 'Not available';
}

function formatCoordinates(latitude: number | string | null | undefined, longitude: number | string | null | undefined): string | null {
    if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) return null;
    const lat = Number(latitude);
    const lng = Number(longitude);
    return Number.isFinite(lat) && Number.isFinite(lng) ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : null;
}

export function OrderDetailsPage({ orderId, user, onBack, onChatWithSeller, onOpenSeller, onError }: {
    orderId: number;
    user: User;
    onBack: () => void;
    onChatWithSeller: (sellerId: number) => void;
    onOpenSeller: (sellerId: number) => void;
    onError: (message: string) => void;
}) {
    const [order, setOrder] = React.useState<OrderDetails | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [requestingUpdate, setRequestingUpdate] = React.useState(false);
    const [updateRequested, setUpdateRequested] = React.useState(false);
    const [receiptOpen, setReceiptOpen] = React.useState(false);
    const [deliveryCode, setDeliveryCode] = React.useState<{ code: string } | null>(null);
    const [deliveryCodeLoading, setDeliveryCodeLoading] = React.useState(false);

    React.useEffect(() => {
        let active = true;
        setOrder(null);
        setLoading(true);
        api.get<{ order: OrderDetails }>(`/api/orders/${orderId}`)
            .then((response) => {
                if (active) setOrder(response.data.order);
            })
            .catch((requestError: any) => {
                if (!active) return;
                const message = requestError.userMessage ?? requestError.response?.data?.message ?? 'Order details could not be loaded.';
                onError(message);
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => { active = false; };
    }, [onError, orderId]);

    React.useEffect(() => {
        if (!receiptOpen) return undefined;
        document.body.classList.add('printing-order-receipt');

        return () => document.body.classList.remove('printing-order-receipt');
    }, [receiptOpen]);

    async function requestOrderUpdate() {
        if (!order || requestingUpdate) return;
        setRequestingUpdate(true);
        try {
            await api.post(`/api/orders/${order.id}/request-update`);
            setUpdateRequested(true);
        } catch (requestError: any) {
            onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'The seller could not be notified.');
        } finally {
            setRequestingUpdate(false);
        }
    }

    async function issueDeliveryCode() {
        if (!order || deliveryCodeLoading) return;
        setDeliveryCodeLoading(true);
        try {
            const response = await api.post<{ code: string }>(`/api/orders/${order.id}/delivery-code`);
            setDeliveryCode(response.data);
        } catch (requestError: any) {
            onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'The delivery QR code could not be issued.');
        } finally {
            setDeliveryCodeLoading(false);
        }
    }

    const deliveryAddressText = order?.shipping_address
        ? [order.shipping_address.street_address, order.shipping_address.address_line2, order.shipping_address.barangay, order.shipping_address.city_municipality, order.shipping_address.province, order.shipping_address.postal_code].filter(Boolean).join(', ')
        : '';
    const buyerCoordinates = formatCoordinates(order?.shipping_address?.latitude, order?.shipping_address?.longitude);
    const deliveryAddress = deliveryAddressText || (buyerCoordinates ? `Pinned buyer location (${buyerCoordinates})` : 'No buyer location was saved for this order.');
    const sellerLatitude = order?.seller_location_snapshot?.latitude ?? order?.delivery?.pickup_latitude ?? order?.seller?.seller_profile?.latitude ?? null;
    const sellerLongitude = order?.seller_location_snapshot?.longitude ?? order?.delivery?.pickup_longitude ?? order?.seller?.seller_profile?.longitude ?? null;
    const sellerCoordinates = formatCoordinates(sellerLatitude, sellerLongitude);
    const sellerAddress = order?.seller_location_snapshot?.address ?? order?.seller?.seller_profile?.address;
    const distanceDescription = order?.delivery_distance_method === 'OSRM_BARANGAY_ESTIMATE'
        ? 'barangay-level road distance estimate'
        : order?.delivery_distance_method === 'OSRM_ROAD_ROUTE'
            ? 'OSRM road route'
            : 'Distance method not recorded';
    const displayOrderStatus = order?.delivery?.status === 'DELIVERED'
        ? 'Delivered'
        : order?.status === 'FULFILLING'
            ? 'On the Way'
            : order?.status.replaceAll('_', ' ');
    const historyEntries = [
        ...(order?.status_history ?? []).map((entry) => ({
            key: `order-${entry.id}`,
            title: `Order ${entry.to_status.replaceAll('_', ' ').toLowerCase()}`,
            details: entry.reason ?? '',
            actor: entry.actor?.name ?? 'FARMGATE',
            created_at: entry.created_at,
        })),
        ...(order?.delivery?.status_history ?? []).map((entry) => ({
            key: `delivery-${entry.id}`,
            title: `Delivery ${entry.to_status.replaceAll('_', ' ').toLowerCase()}`,
            details: entry.reason ?? '',
            actor: entry.actor?.name ?? 'FARMGATE',
            created_at: entry.created_at,
        })),
        ...(order?.activities ?? []).map((activity) => ({
            key: `activity-${activity.id}`,
            title: activity.activity_key.replaceAll('_', ' ').toLowerCase(),
            details: activity.details,
            actor: activity.actor?.name ?? 'FARMGATE',
            created_at: activity.created_at,
        })),
    ].sort((first, second) => Date.parse(second.created_at) - Date.parse(first.created_at));

    return <main className="buyer-order-details-page" aria-labelledby="buyer-order-details-title">
        <button className="buyer-order-back" type="button" onClick={onBack}>← Back to my orders</button>
        {loading ? <p className="buyer-orders-loading" role="status">Loading order details...</p> : !order ? <section className="buyer-orders-empty"><h1>Order unavailable</h1><p>This order could not be loaded.</p><button type="button" onClick={onBack}>Return to my orders</button></section> : <>
            <header className="buyer-order-details-page-heading">
                <div><p className="eyebrow">Order details</p><h1 id="buyer-order-details-title">Order {order.order_reference}</h1><time dateTime={order.created_at}>{new Date(order.created_at).toLocaleString()}</time></div>
                <span className={`buyer-order-status status-${(displayOrderStatus ?? order.status).toLowerCase().replaceAll(' ', '_')}`}>{displayOrderStatus}</span>
            </header>
            <div className="buyer-order-details-grid">
                <section><h2>Livestock</h2><ul>{order.items.map((item) => <li key={item.id}><span>{item.quantity} {item.pricing_type === 'PER_KILO' ? 'kg' : 'head'} × {item.listing?.name ?? 'Removed listing'} · PHP {formatAmount(item.unit_price)} each</span><strong>PHP {formatAmount(item.total_amount)}</strong></li>)}</ul></section>
                <section><h2>Order cost</h2><dl><div><dt>Livestock total</dt><dd>PHP {formatAmount(order.subtotal_amount ?? order.total_amount)}</dd></div><div><dt>Shipping</dt><dd>PHP {formatAmount(order.delivery_fee)}</dd></div>{order.delivery_distance_km !== null && order.delivery_distance_km !== undefined && <div><dt>Delivery distance</dt><dd>{Number(order.delivery_distance_km).toFixed(2)} km · {distanceDescription}</dd></div>}<div className="buyer-order-grand-total"><dt>Total</dt><dd>PHP {formatAmount(order.total_amount)}</dd></div></dl></section>
            </div>
            {order.cod_payment && <section className="buyer-order-cod-payment" aria-labelledby="buyer-order-cod-payment-title">
                <h2 id="buyer-order-cod-payment-title">Cash on delivery payment</h2>
                <dl>
                    <div><dt>Amount due</dt><dd>PHP {formatAmount(order.cod_payment.amount_due)}</dd></div>
                    <div><dt>Buyer payment</dt><dd>{paymentStatusLabel(order.cod_payment.status)}</dd></div>
                    {order.cod_payment.collection_status && <div><dt>Rider collection</dt><dd>{order.cod_payment.collection_status.replaceAll('_', ' ')}</dd></div>}
                    {order.cod_payment.remittance_status && <div><dt>Farmgate remittance</dt><dd>{order.cod_payment.remittance_status.replaceAll('_', ' ')}</dd></div>}
                </dl>
                {order.cod_payment.status === 'AWAITING_CONFIRMATION' && <p>Cash collection or uploaded proof is not payment confirmation. Farmgate will update this status after the remittance is verified.</p>}
            </section>}
            <div className="buyer-order-details-grid">
                <section><h2>Customer details</h2><p>{order.shipping_address?.recipient_name ?? user.name}</p><p>{user.email}</p><p>{order.shipping_address?.phone_number ?? user.phone_number ?? 'Phone not provided'}</p></section>
            </div>
            <section className="buyer-order-addresses" aria-label="Seller and buyer shipping addresses">
                <article className="buyer-order-address-card">
                    <p className="eyebrow">From</p>
                    <h2>Seller shipping address</h2>
                    <p className="buyer-order-address-name">{order.seller?.name ?? 'Seller'}</p>
                    {order.seller?.id && <button className="seller-shop-inline-link" type="button" onClick={() => { if (order.seller) onOpenSeller(order.seller.id); }}>Visit seller shop</button>}
                    <p>{sellerAddress || 'Street address not provided; use the pinned seller location on the map.'}</p>
                    {sellerCoordinates && <p className="buyer-order-address-coordinates">Pinned location: {sellerCoordinates}</p>}
                </article>
                <article className="buyer-order-address-card">
                    <p className="eyebrow">To</p>
                    <h2>{order.delivery_method === 'SELF_PICKUP' ? 'Buyer pickup location' : 'Buyer shipping address'}</h2>
                    {order.shipping_address ? <>
                        <p className="buyer-order-address-name">{order.shipping_address.recipient_name ?? user.name}</p>
                        {deliveryAddressText && <p>{deliveryAddressText}</p>}
                        {!deliveryAddressText && buyerCoordinates && <p>Street address not provided; use this pinned pickup location.</p>}
                        {order.shipping_address.phone_number && <p>Phone: {order.shipping_address.phone_number}</p>}
                        {buyerCoordinates && <p className="buyer-order-address-coordinates">Pinned location: {buyerCoordinates}</p>}
                    </> : <p>No buyer location was saved for this order.</p>}
                </article>
            </section>
            <section className="buyer-order-actions" aria-label="Order actions">
                <button type="button" onClick={() => void requestOrderUpdate()} disabled={requestingUpdate || updateRequested}>{requestingUpdate ? 'Requesting update...' : updateRequested ? 'Update requested' : 'Request order update'}</button>
                <button type="button" onClick={() => setReceiptOpen(true)}>View order receipt</button>
                <button type="button" onClick={() => order.seller?.id && onChatWithSeller(order.seller.id)} disabled={!order.seller?.id}>Chat with seller</button>
            </section>
            <OrderCasePanel order={order} onError={onError} />
            {!!historyEntries.length && <section className="buyer-order-activity" aria-labelledby="buyer-order-activity-title">
                <h2 id="buyer-order-activity-title">Order and case history</h2>
                <ol>{historyEntries.map((entry) => <li key={entry.key}><strong>{entry.title}</strong>{entry.details && <p>{entry.details}</p>}<small>{entry.actor} · {new Date(entry.created_at).toLocaleString()}</small></li>)}</ol>
            </section>}
            {order.delivery_method === 'STANDARD_DELIVERY' && order.status === 'FULFILLING' && order.delivery && ['PICKED_UP', 'IN_TRANSIT'].includes(order.delivery.status) && <section className="delivery-qr-section" aria-labelledby="buyer-delivery-qr-title">
                <div><p className="eyebrow">Hand-off verification</p><h2 id="buyer-delivery-qr-title">Order QR for the assigned rider</h2><p>This order QR is used at pickup and drop-off. Keep it private; it is valid until delivery is verified or the order is cancelled.</p></div>
                {!deliveryCode ? <button type="button" disabled={deliveryCodeLoading} onClick={() => void issueDeliveryCode()}>{deliveryCodeLoading ? 'Preparing secure QR…' : 'Show order QR'}</button> : <div className="delivery-qr-code"><QRCodeSVG value={deliveryCode.code} size={160} level="M" marginSize={2} aria-label="Order QR for pickup and delivery verification" /><p>Use at pickup and drop-off; valid until delivery is verified or the order is cancelled.</p></div>}
            </section>}
            {updateRequested && <p className="buyer-order-action-status" role="status">The seller was notified. You can request another update after 15 minutes.</p>}
            {order.delivery?.id ? <DeliveryTrackingPanel
                deliveryId={order.delivery.id}
                sellerName={order.seller?.name ?? 'Seller'}
                buyerName={order.shipping_address?.recipient_name ?? user.name}
                sellerLatitude={sellerLatitude}
                sellerLongitude={sellerLongitude}
                buyerLatitude={order.shipping_address?.latitude ?? null}
                buyerLongitude={order.shipping_address?.longitude ?? null}
                onStatusChange={(status) => setOrder((current) => {
                    if (!current?.delivery || current.delivery.status === status) return current;
                    return { ...current, delivery: { ...current.delivery, status } };
                })}
            /> : <OrderRouteMap
                sellerName={order.seller?.name ?? 'Seller'}
                buyerName={order.shipping_address?.recipient_name ?? user.name}
                sellerLatitude={sellerLatitude}
                sellerLongitude={sellerLongitude}
                buyerLatitude={order.shipping_address?.latitude ?? null}
                buyerLongitude={order.shipping_address?.longitude ?? null}
            />}
            {receiptOpen && <div className="buyer-order-receipt-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setReceiptOpen(false); }}>
                <section className="buyer-order-receipt" role="dialog" aria-modal="true" aria-labelledby="buyer-order-receipt-title">
                    <button className="buyer-order-receipt-close" type="button" aria-label="Close receipt" onClick={() => setReceiptOpen(false)}>×</button>
                    <p className="eyebrow">FARMGATE · Order receipt</p>
                    <h2 id="buyer-order-receipt-title">Order {order.order_reference}</h2>
                    <p className="buyer-order-receipt-meta">{new Date(order.created_at).toLocaleString()} · {displayOrderStatus}</p>
                    <p className="buyer-order-receipt-meta">Payment reference: {order.payment_reference ?? 'Not available'}</p>
                    {order.delivery?.delivery_reference && <p className="buyer-order-receipt-meta">Delivery reference: {order.delivery.delivery_reference}</p>}
                    <div className="buyer-order-receipt-parties"><div><strong>Seller</strong><span>{order.seller?.name ?? 'Seller'}</span></div><div><strong>Buyer</strong><span>{order.shipping_address?.recipient_name ?? user.name}</span></div></div>
                    <div className="buyer-order-receipt-address"><strong>Seller shipping address</strong><span>{sellerAddress || 'Address not provided'}</span></div>
                    <div className="buyer-order-receipt-address"><strong>{order.delivery_method === 'SELF_PICKUP' ? 'Buyer pickup location' : 'Buyer shipping address'}</strong><span>{deliveryAddress}</span></div>
                    <dl className="buyer-order-receipt-payment">
                        <div><dt>Payment method</dt><dd>{paymentMethodLabel(order.payment_method)}</dd></div>
                        <div><dt>Payment status</dt><dd>{paymentStatusLabel(order.cod_payment?.status ?? order.payment_status)}</dd></div>
                        {order.cod_payment && <div><dt>COD amount due</dt><dd>PHP {formatAmount(order.cod_payment.amount_due)}</dd></div>}
                    </dl>
                    <table className="buyer-order-receipt-items">
                        <thead><tr><th scope="col">Livestock</th><th scope="col">Unit price</th><th scope="col">Line total</th></tr></thead>
                        <tbody>{order.items.map((item) => <tr key={item.id}>
                            <td>{item.quantity.toLocaleString()} {item.pricing_type === 'PER_KILO' ? 'kg' : 'head'} × {item.listing?.name ?? 'Removed listing'}<br /><small>Category: {item.listing?.category?.name ?? 'Unavailable'} ({item.listing?.category?.reference_code ?? 'OT'})</small></td>
                            <td>PHP {formatAmount(item.unit_price)} / {item.pricing_type === 'PER_KILO' ? 'kg' : 'head'}</td>
                            <td>PHP {formatAmount(item.total_amount)}</td>
                        </tr>)}</tbody>
                    </table>
                    <dl className="buyer-order-receipt-totals">
                        <div><dt>Livestock total</dt><dd>PHP {formatAmount(order.subtotal_amount ?? order.total_amount)}</dd></div>
                        {positiveAmount(order.delivery_fee) && <div><dt>{order.delivery_method === 'SELF_PICKUP' ? 'Pickup fee' : 'Delivery fee'}</dt><dd>PHP {formatAmount(order.delivery_fee)}</dd></div>}
                        {order.delivery_distance_km !== null && order.delivery_distance_km !== undefined && <div><dt>Delivery distance</dt><dd>{Number(order.delivery_distance_km).toFixed(2)} km · {distanceDescription}</dd></div>}
                        {positiveAmount(order.platform_fee) && <div><dt>Platform fee</dt><dd>PHP {formatAmount(order.platform_fee)}</dd></div>}
                        {positiveAmount(order.order_processing_fee) && <div><dt>Order processing fee</dt><dd>PHP {formatAmount(order.order_processing_fee)}</dd></div>}
                        {positiveAmount(order.transaction_fee) && <div><dt>Transaction fee</dt><dd>PHP {formatAmount(order.transaction_fee)}</dd></div>}
                        {positiveAmount(order.payment_processing_fee) && <div><dt>Payment processing fee</dt><dd>PHP {formatAmount(order.payment_processing_fee)}</dd></div>}
                        {positiveAmount(order.buyer_service_fee) && <div><dt>Buyer service fee</dt><dd>PHP {formatAmount(order.buyer_service_fee)}</dd></div>}
                        {positiveAmount(order.discount_amount) && <div><dt>Discount</dt><dd>− PHP {formatAmount(order.discount_amount)}</dd></div>}
                        <div className="buyer-order-grand-total"><dt>Order total</dt><dd>PHP {formatAmount(order.total_amount)}</dd></div>
                    </dl>
                    <div className="buyer-order-receipt-verification">
                        <QRCodeSVG value={`${window.location.origin}/#verify/${encodeURIComponent(order.order_reference)}`} size={152} level="M" marginSize={2} aria-label={`QR code to verify order ${order.order_reference}`} />
                        <p>Scan to check this order reference.</p>
                        <small>Reference verification does not confirm payment or delivery.</small>
                    </div>
                    <div className="buyer-order-receipt-actions">
                        <button className="buyer-order-receipt-done" type="button" onClick={() => window.print()}>Print receipt</button>
                        <button className="buyer-order-receipt-done" type="button" onClick={() => setReceiptOpen(false)}>Done</button>
                    </div>
                </section>
            </div>}
        </>}
    </main>;
}
