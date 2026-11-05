import React from 'react';
import api from '../../lib/api';
import { confirmAction, showSuccess } from '../../lib/alerts';
import { Pagination } from '../../shared/components/Pagination';
import { QRCodeSVG } from 'qrcode.react';
import { DeliveryTrackingPanel } from '../shared/DeliveryTrackingPanel';

type SellerOrder = {
    id: number;
    buyer_id: number;
    order_reference: string;
    status: string;
    total_amount: string | number;
    subtotal_amount?: string | number;
    delivery_fee?: string | number;
    delivery_method?: string | null;
    payment_method?: string | null;
    payment_status?: string | null;
    shipping_address?: {
        recipient_name?: string;
        phone_number?: string;
        street_address?: string;
        address_line2?: string | null;
        barangay?: string;
        city_municipality?: string;
        province?: string;
        postal_code?: string;
        delivery_notes?: string | null;
        latitude?: number | string | null;
        longitude?: number | string | null;
    } | null;
    created_at: string;
    buyer?: { id: number; name: string } | null;
    items: {
        id: number;
        quantity: number;
        unit_price: string | number;
        total_amount: string | number;
        pricing_type: string;
        listing?: { name: string } | null;
    }[];
    status_history?: {
        id: number;
        from_status?: string | null;
        to_status: string;
        reason?: string | null;
        created_at: string;
        actor?: { name: string } | null;
    }[];
    delivery?: {
        id: number;
        status: string;
        rider_id?: number | null;
        assigned_at?: string | null;
        pickup_address?: string | null;
        pickup_latitude?: number | null;
        pickup_longitude?: number | null;
        rider?: { id: number; name: string } | null;
    } | null;
    seller?: {
        name: string;
        seller_profile?: { latitude?: number | string | null; longitude?: number | string | null } | null;
    } | null;
};

type SellerOrderNotification = {
    id: string;
    data: {
        type?: string;
        order_id?: number;
        order_reference?: string;
        status?: string;
        message?: string;
    };
    created_at: string;
};

const orderStatuses = [
    'PENDING_CONFIRMATION',
    'CONFIRMED',
    'PREPARING',
    'READY_FOR_PICKUP',
    'FULFILLING',
    'COMPLETED',
    'CANCELLED',
    'REJECTED',
];

const ordersPerPage = 10;
type OrderSort = 'newest' | 'oldest' | 'highest-total' | 'lowest-total' | 'status' | 'buyer';
const activeDeliveryStatuses = ['RIDER_ACCEPTED', 'PICKUP_PENDING', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED'];
const currency = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 });
const textCollator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

function formatStatus(status: string): string {
    return status.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function amount(value: string | number | undefined): string {
    return currency.format(Number(value ?? 0));
}

function orderAddress(order: SellerOrder): string {
    const address = order.shipping_address;
    if (!address) return order.delivery_method === 'SELF_PICKUP' ? 'Buyer will pick up' : 'No delivery address was saved.';
    return [
        address.street_address,
        address.address_line2,
        address.barangay,
        address.city_municipality,
        address.province,
        address.postal_code,
    ].filter(Boolean).join(', ') || 'No delivery address was saved.';
}

export function SellerOrdersPage({ onNavigationCountsChanged }: { onNavigationCountsChanged?: () => Promise<void> }) {
    const [orders, setOrders] = React.useState<SellerOrder[]>([]);
    const [notifications, setNotifications] = React.useState<SellerOrderNotification[]>([]);
    const [selectedOrder, setSelectedOrder] = React.useState<SellerOrder | null>(null);
    const [statusFilter, setStatusFilter] = React.useState('');
    const [search, setSearch] = React.useState('');
    const [sort, setSort] = React.useState<OrderSort>('newest');
    const [page, setPage] = React.useState(1);
    const [rejectReason, setRejectReason] = React.useState('');
    const [loading, setLoading] = React.useState(true);
    const [detailsLoading, setDetailsLoading] = React.useState(false);
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState('');
    const [notificationError, setNotificationError] = React.useState('');
    const [detailsError, setDetailsError] = React.useState('');
    const [pickupCode, setPickupCode] = React.useState<{ code: string; expires_at: string } | null>(null);
    const [pickupCodeLoading, setPickupCodeLoading] = React.useState(false);
    const [pickupCodeError, setPickupCodeError] = React.useState('');

    const refreshOrders = React.useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const response = await api.get<{ orders: SellerOrder[] }>('/api/orders');
            setOrders(response.data.orders);
            setSelectedOrder((current) => current ? response.data.orders.find((order) => order.id === current.id) ?? null : null);
        } catch (requestError: any) {
            setError(requestError.userMessage ?? requestError.response?.data?.message ?? 'Orders could not be loaded. Try again.');
        } finally {
            setLoading(false);
        }
    }, []);

    const refreshNotifications = React.useCallback(async () => {
        setNotificationError('');
        try {
            const response = await api.get<{ notifications: SellerOrderNotification[] }>('/api/notifications');
            setNotifications(response.data.notifications.filter((notification) =>
                notification.data?.type === 'order_status_changed'
                || notification.data?.type === 'rider_assignment_waiting'
                || notification.data?.type === 'delivery_proof_recorded',
            ));
        } catch (requestError: any) {
            setNotificationError(requestError.userMessage ?? 'Order notifications could not be loaded.');
        }
    }, []);

    React.useEffect(() => {
        void refreshOrders();
        void refreshNotifications();
    }, [refreshNotifications, refreshOrders]);

    React.useEffect(() => {
        if (!selectedOrder) return undefined;
        function closeOnEscape(event: KeyboardEvent) {
            if (event.key === 'Escape' && !saving) setSelectedOrder(null);
        }
        window.addEventListener('keydown', closeOnEscape);
        return () => window.removeEventListener('keydown', closeOnEscape);
    }, [saving, selectedOrder]);

    async function openOrder(orderId: number) {
        setSelectedOrder(orders.find((order) => order.id === orderId) ?? null);
        setPickupCode(null);
        setPickupCodeError('');
        setDetailsLoading(true);
        setDetailsError('');
        try {
            const response = await api.get<{ order: SellerOrder }>(`/api/orders/${orderId}`);
            setSelectedOrder(response.data.order);
            setRejectReason('');
        } catch (requestError: any) {
            setDetailsError(requestError.userMessage ?? requestError.response?.data?.message ?? 'Order details could not be loaded.');
        } finally {
            setDetailsLoading(false);
        }
    }

    async function issuePickupCode() {
        if (!selectedOrder || pickupCodeLoading) return;
        setPickupCodeLoading(true);
        setPickupCodeError('');
        try {
            const response = await api.post<{ code: string; expires_at: string }>(`/api/orders/${selectedOrder.id}/delivery-code`);
            setPickupCode(response.data);
        } catch (requestError: any) {
            setPickupCodeError(requestError.userMessage ?? requestError.response?.data?.message ?? 'Pickup QR code could not be issued.');
        } finally {
            setPickupCodeLoading(false);
        }
    }

    async function decideOrder(status: 'CONFIRMED' | 'REJECTED') {
        if (!selectedOrder || saving) return;
        const reason = rejectReason.trim();
        if (status === 'REJECTED' && !reason) {
            setError('Enter a reason before rejecting this order.');
            return;
        }
        const action = status === 'CONFIRMED' ? 'accept' : 'reject';
        setSaving(true);
        let confirmed = false;
        try {
            confirmed = await confirmAction({
                title: `${status === 'CONFIRMED' ? 'Accept' : 'Reject'} order ${selectedOrder.order_reference}?`,
                text: status === 'CONFIRMED'
                    ? 'This decision will update the order and notify the buyer.'
                    : `The buyer will be notified. Reason: ${reason}`,
                confirmText: `${status === 'CONFIRMED' ? 'Accept' : 'Reject'} order`,
                danger: status === 'REJECTED',
            });
        } catch {
            setError('The confirmation dialog could not be opened. Try the decision again.');
            setSaving(false);
            return;
        }
        if (!confirmed) {
            setSaving(false);
            return;
        }
        setError('');
        try {
            const response = await api.patch<{ rider_assignment_warning?: string | null }>(`/api/orders/${selectedOrder.id}/status`, {
                status,
                ...(status === 'REJECTED' ? { reason } : {}),
            });
            showSuccess(`Order ${selectedOrder.order_reference} ${status === 'CONFIRMED' ? 'accepted' : 'rejected'}.`);
            const assignmentWarning = response.data.rider_assignment_warning;
            setRejectReason('');
            await refreshOrders();
            await openOrder(selectedOrder.id);
            await refreshNotifications();
            await onNavigationCountsChanged?.();
            if (assignmentWarning) setError(assignmentWarning);
        } catch (requestError: any) {
            const message = requestError.userMessage ?? requestError.response?.data?.message ?? `The order could not be ${action}ed. Refresh and review its current status.`;
            await refreshOrders();
            await openOrder(selectedOrder.id);
            await refreshNotifications();
            setError(message);
        } finally {
            setSaving(false);
        }
    }

    async function retryRiderAssignment() {
        if (!selectedOrder || saving) return;
        setSaving(true);
        setError('');
        try {
            const response = await api.post<{ delivery: { status: string } }>('/api/deliveries/assign', { order_id: selectedOrder.id });
            const waitingForRider = response.data.delivery.status === 'WAITING_FOR_RIDER';
            await refreshOrders();
            await openOrder(selectedOrder.id);
            await refreshNotifications();
            await onNavigationCountsChanged?.();
            if (waitingForRider) setError('No eligible rider is available yet. The order remains awaiting rider assignment; you can retry later.');
            else showSuccess(`Rider offer updated for ${selectedOrder.order_reference}.`);
        } catch (requestError: any) {
            setError(requestError.userMessage ?? requestError.response?.data?.message ?? 'Rider assignment could not be retried. Please try again.');
        } finally {
            setSaving(false);
        }
    }

    const filteredOrders = orders.filter((order) => {
        if (statusFilter && order.status !== statusFilter) return false;
        const query = search.trim().toLocaleLowerCase();
        if (!query) return true;
        return [
            order.order_reference,
            order.buyer?.name,
            order.shipping_address?.recipient_name,
            order.status,
            ...order.items.map((item) => item.listing?.name),
        ].some((value) => value?.toLocaleLowerCase().includes(query));
    });
    const sortedOrders = [...filteredOrders].sort((left, right) => {
        let comparison = 0;
        switch (sort) {
            case 'oldest':
                comparison = Date.parse(left.created_at) - Date.parse(right.created_at);
                break;
            case 'highest-total':
                comparison = Number(right.total_amount) - Number(left.total_amount);
                break;
            case 'lowest-total':
                comparison = Number(left.total_amount) - Number(right.total_amount);
                break;
            case 'status':
                comparison = textCollator.compare(formatStatus(left.status), formatStatus(right.status));
                break;
            case 'buyer':
                comparison = textCollator.compare(
                    left.shipping_address?.recipient_name ?? left.buyer?.name ?? '',
                    right.shipping_address?.recipient_name ?? right.buyer?.name ?? '',
                );
                break;
            case 'newest':
            default:
                comparison = Date.parse(right.created_at) - Date.parse(left.created_at);
                break;
        }

        return comparison || right.id - left.id;
    });
    const lastPage = Math.max(1, Math.ceil(sortedOrders.length / ordersPerPage));
    const visibleOrders = sortedOrders.slice((page - 1) * ordersPerPage, page * ordersPerPage);
    React.useEffect(() => {
        if (page > lastPage) setPage(lastPage);
    }, [lastPage, page]);
    const canDecide = selectedOrder?.status === 'PENDING_CONFIRMATION';
    const paymentReady = selectedOrder?.payment_method == null || selectedOrder.payment_method === 'COD' || selectedOrder.payment_status === 'PAID';
    const delivery = selectedOrder?.delivery;
    const riderConfirmed = !!delivery && activeDeliveryStatuses.includes(delivery.status);

    return <section className="seller-orders" aria-labelledby="seller-orders-title">
        <header className="seller-orders-heading">
            <div><p className="eyebrow">Order management</p><h2 id="seller-orders-title">Orders</h2><p>Review incoming orders, make a decision, and track delivery.</p></div>
            <span>{orders.length} {orders.length === 1 ? 'order' : 'orders'}</span>
        </header>
        <div className="seller-orders-filters" role="search">
            <label>Search orders<input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Order number, buyer, or product" /></label>
            <label>Filter by status<select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}><option value="">All statuses</option>{orderStatuses.map((status) => <option key={status} value={status}>{formatStatus(status)}</option>)}</select></label>
            <label>Sort orders<select value={sort} onChange={(event) => { setSort(event.target.value as OrderSort); setPage(1); }}>
                <option value="newest">Date · Newest first</option>
                <option value="oldest">Date · Oldest first</option>
                <option value="highest-total">Total · Highest first</option>
                <option value="lowest-total">Total · Lowest first</option>
                <option value="status">Status · A–Z</option>
                <option value="buyer">Buyer · A–Z</option>
            </select></label>
        </div>
        {error && <p className="seller-orders-error" role="alert">{error} {orders.length === 0 && !loading && <button type="button" onClick={() => void refreshOrders()}>Try again</button>}</p>}
        {notificationError && <p className="seller-orders-error" role="alert">{notificationError}</p>}
        {notifications.length > 0 && <section className="seller-order-notifications" aria-labelledby="seller-order-notifications-title">
            <h3 id="seller-order-notifications-title">Order notifications</h3>
            <ul>{notifications.slice(0, 8).map((notification) => {
                const { type, order_id: orderId, order_reference: reference, status, message } = notification.data;
                const description = type === 'rider_assignment_waiting' || type === 'delivery_proof_recorded'
                    ? message ?? 'Rider assignment needs attention.'
                    : status === 'PENDING_CONFIRMATION'
                        ? `New order ${reference ?? ''} needs your decision.`
                        : `Order ${reference ?? ''} updated: ${status ? formatStatus(status) : 'status updated'}.`;
                return <li key={notification.id}>
                    <span>{description}</span><time dateTime={notification.created_at}>{new Date(notification.created_at).toLocaleString()}</time>
                    {orderId && <button type="button" onClick={() => void openOrder(orderId)}>Review order</button>}
                </li>;
            })}</ul>
        </section>}
        {loading ? <p className="seller-orders-state" role="status">Loading your orders...</p>
            : error && orders.length === 0 ? null
            : orders.length === 0 ? <div className="seller-orders-empty"><h3>No orders yet</h3><p>New buyer orders will appear here when they are placed.</p></div>
                : filteredOrders.length === 0 ? <div className="seller-orders-empty"><h3>No matching orders</h3><p>Try a different search or status filter.</p></div>
                    : <><div className="seller-orders-table-wrap"><table className="seller-orders-table">
                        <thead><tr><th scope="col">Order</th><th scope="col">Date</th><th scope="col">Buyer</th><th scope="col">Products</th><th scope="col">Total</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Details</span></th></tr></thead>
                        <tbody>{visibleOrders.map((order) => <tr key={order.id}>
                            <td><strong>{order.order_reference}</strong></td>
                            <td><time dateTime={order.created_at}>{new Date(order.created_at).toLocaleDateString()}</time></td>
                            <td>{order.shipping_address?.recipient_name ?? order.buyer?.name ?? 'Buyer'}</td>
                            <td>{order.items.map((item) => `${item.quantity} ${item.pricing_type === 'PER_KILO' ? 'kg' : 'head'} ${item.listing?.name ?? 'Removed listing'}`).join(', ')}</td>
                            <td>{amount(order.total_amount)}</td>
                            <td><span className={`seller-order-status status-${order.status.toLowerCase()}`}>{formatStatus(order.status)}</span></td>
                            <td><button className="seller-order-view" type="button" onClick={() => void openOrder(order.id)}>Review</button></td>
                        </tr>)}</tbody>
                    </table></div>
                    <div className="seller-orders-pagination">
                        <span>Showing {(page - 1) * ordersPerPage + 1}–{Math.min(page * ordersPerPage, sortedOrders.length)} of {sortedOrders.length} orders</span>
                        {lastPage > 1 && <Pagination page={page} lastPage={lastPage} onChange={setPage} />}
                    </div></>}
        {selectedOrder && <div className="seller-order-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setSelectedOrder(null); }}>
            <section className="seller-order-modal" role="dialog" aria-modal="true" aria-labelledby="seller-order-detail-title">
                <header className="seller-order-modal-heading">
                    <div><p className="eyebrow">Order details</p><h2 id="seller-order-detail-title">{selectedOrder.order_reference}</h2><time dateTime={selectedOrder.created_at}>{new Date(selectedOrder.created_at).toLocaleString()}</time></div>
                    <button type="button" aria-label="Close order details" onClick={() => setSelectedOrder(null)} disabled={saving}>Close</button>
                </header>
                {detailsLoading ? <p role="status">Loading order details...</p> : detailsError ? <p className="seller-orders-error" role="alert">{detailsError} <button type="button" onClick={() => void openOrder(selectedOrder.id)}>Try again</button></p> : <>
                    <div className="seller-order-detail-grid">
                        <section><h3>Buyer</h3><p>{selectedOrder.buyer?.name ?? selectedOrder.shipping_address?.recipient_name ?? 'Buyer'}</p>{selectedOrder.shipping_address?.phone_number && <p>Phone: {selectedOrder.shipping_address.phone_number}</p>}</section>
                        <section><h3>{selectedOrder.delivery_method === 'SELF_PICKUP' ? 'Pickup' : 'Delivery'}</h3><p>{selectedOrder.delivery_method?.replaceAll('_', ' ') ?? 'Not specified'}</p><p>{orderAddress(selectedOrder)}</p>{selectedOrder.shipping_address?.delivery_notes && <p>Notes: {selectedOrder.shipping_address.delivery_notes}</p>}</section>
                        <section><h3>Payment</h3><p>{selectedOrder.payment_method?.replaceAll('_', ' ') ?? 'Not specified'} · {selectedOrder.payment_status?.replaceAll('_', ' ') ?? 'Status unavailable'}</p></section>
                        <section><h3>Order status</h3><p><span className={`seller-order-status status-${selectedOrder.status.toLowerCase()}`}>{formatStatus(selectedOrder.status)}</span></p></section>
                    </div>
                    <section className="seller-order-items"><h3>Products and amounts</h3><div className="seller-order-table-scroll"><table><thead><tr><th scope="col">Product</th><th scope="col">Quantity</th><th scope="col">Unit price</th><th scope="col">Amount</th></tr></thead><tbody>{selectedOrder.items.map((item) => <tr key={item.id}><td>{item.listing?.name ?? 'Removed listing'}</td><td>{item.quantity} {item.pricing_type === 'PER_KILO' ? 'kg' : 'head'}</td><td>{amount(item.unit_price)}</td><td>{amount(item.total_amount)}</td></tr>)}</tbody></table></div><p>Products: {amount(selectedOrder.subtotal_amount)} · Delivery: {amount(selectedOrder.delivery_fee)} · Total: <strong>{amount(selectedOrder.total_amount)}</strong></p></section>
                    <section className="seller-order-delivery"><h3>Rider assignment</h3>
                        {selectedOrder.delivery_method !== 'STANDARD_DELIVERY' ? <p>No rider assignment is required for this delivery method.</p>
                            : ['CANCELLED', 'REJECTED', 'COMPLETED'].includes(selectedOrder.status) ? <p>No active rider assignment is required for this {formatStatus(selectedOrder.status).toLowerCase()} order.</p>
                            : riderConfirmed ? <p role="status">Assigned to {delivery?.rider?.name ?? 'rider'} · {formatStatus(delivery?.status ?? '')}{delivery?.assigned_at ? ` · ${new Date(delivery.assigned_at).toLocaleString()}` : ''}</p>
                                : delivery?.status === 'RIDER_OFFERED' || delivery?.status === 'SEARCHING_FOR_RIDER' ? <p role="status">{delivery.status === 'RIDER_OFFERED' ? `Offer sent to ${delivery.rider?.name ?? 'a rider'}; awaiting acceptance.` : 'Offers have been sent to available riders; awaiting acceptance.'}</p>
                                    : selectedOrder.status !== 'READY_FOR_PICKUP' && selectedOrder.status !== 'FULFILLING'
                                        ? <p role="status">Rider assignment begins when the order is ready for pickup{delivery?.status ? ` · ${formatStatus(delivery.status)}` : ''}.</p>
                                        : <><p role="status">Awaiting rider assignment{delivery?.status ? ` · ${formatStatus(delivery.status)}` : ''}.</p><button type="button" className="seller-order-retry" onClick={() => void retryRiderAssignment()} disabled={saving}>{saving ? 'Retrying...' : 'Retry rider assignment'}</button></>}
                    </section>
                    {selectedOrder.delivery_method === 'STANDARD_DELIVERY' && ['READY_FOR_PICKUP', 'FULFILLING'].includes(selectedOrder.status) && delivery && ['RIDER_ACCEPTED', 'PICKUP_PENDING'].includes(delivery.status) && <section className="delivery-qr-section" aria-labelledby="seller-pickup-qr-title">
                        <div><p className="eyebrow">Hand-off verification</p><h3 id="seller-pickup-qr-title">Pickup QR for the assigned rider</h3><p>This one-time code expires after 30 minutes. Show it only to the rider assigned to this order.</p></div>
                        {!pickupCode ? <button type="button" disabled={pickupCodeLoading} onClick={() => void issuePickupCode()}>{pickupCodeLoading ? 'Preparing secure QR…' : 'Show pickup QR'}</button> : <div className="delivery-qr-code"><QRCodeSVG value={pickupCode.code} size={160} level="M" marginSize={2} aria-label="One-time pickup verification QR code" /><p>Expires {new Date(pickupCode.expires_at).toLocaleTimeString()}</p></div>}
                        {pickupCodeError && <p role="alert">{pickupCodeError}</p>}
                    </section>}
                    {delivery && <DeliveryTrackingPanel
                        deliveryId={delivery.id}
                        sellerName={selectedOrder.seller?.name ?? 'Seller'}
                        buyerName={selectedOrder.shipping_address?.recipient_name ?? selectedOrder.buyer?.name ?? 'Buyer'}
                        sellerLatitude={selectedOrder.seller?.seller_profile?.latitude ?? delivery.pickup_latitude ?? null}
                        sellerLongitude={selectedOrder.seller?.seller_profile?.longitude ?? delivery.pickup_longitude ?? null}
                        buyerLatitude={selectedOrder.shipping_address?.latitude ?? null}
                        buyerLongitude={selectedOrder.shipping_address?.longitude ?? null}
                        onStatusChange={(status) => setSelectedOrder((current) => {
                            if (!current?.delivery || current.delivery.status === status) return current;
                            return { ...current, delivery: { ...current.delivery, status } };
                        })}
                    />}
                    {canDecide && <section className="seller-order-decision" aria-label="Order decision">
                        {!paymentReady && <p className="seller-orders-error">This online payment is awaiting confirmation. You can decide after payment is confirmed.</p>}
                        {selectedOrder.payment_method !== 'COD' && selectedOrder.payment_status !== 'PAID' ? null : <div className="seller-order-decision-actions">
                            <button type="button" disabled={saving} onClick={() => void decideOrder('CONFIRMED')}>{saving ? 'Updating...' : 'Accept order'}</button>
                            <label>Reason for rejection<textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} maxLength={500} required rows={2} /></label>
                            <button type="button" className="danger" disabled={saving || !rejectReason.trim()} onClick={() => void decideOrder('REJECTED')}>Reject order</button>
                        </div>}
                    </section>}
                    <section className="seller-order-history"><h3>Order history</h3>{selectedOrder.status_history?.length ? <ol>{selectedOrder.status_history.map((entry) => <li key={entry.id}><strong>{formatStatus(entry.to_status)}</strong><span>{entry.actor?.name ? ` · ${entry.actor.name}` : ''} · {new Date(entry.created_at).toLocaleString()}</span>{entry.reason && <p>{entry.reason}</p>}</li>)}</ol> : <p>No status history is recorded.</p>}</section>
                </>}
            </section>
        </div>}
    </section>;
}
