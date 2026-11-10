import React from 'react';
import { flushSync } from 'react-dom';
import api from '../../lib/api';
import { confirmAction, showSuccess } from '../../lib/alerts';
import { Pagination } from '../../shared/components/Pagination';
import { LoadingSkeleton } from '../../shared/components/LoadingSkeleton';
import { QRCodeSVG } from 'qrcode.react';
import { DeliveryTrackingPanel } from '../shared/DeliveryTrackingPanel';
import { FarmgateDetailDialog } from '../shared/FarmgateDetailDialog';

type SellerOrder = {
    id: number;
    buyer_id: number;
    order_reference: string;
    payment_reference?: string;
    status: string;
    total_amount: string | number;
    subtotal_amount?: string | number;
    delivery_fee?: string | number;
    platform_fee?: string | number;
    order_processing_fee?: string | number;
    transaction_fee?: string | number;
    payment_processing_fee?: string | number;
    buyer_service_fee?: string | number;
    discount_amount?: string | number;
    delivery_distance_km?: number | string | null;
    delivery_distance_method?: 'OSRM_ROAD_ROUTE' | 'OSRM_BARANGAY_ESTIMATE' | null;
    seller_location_snapshot?: {
        business_name?: string | null;
        address?: string | null;
        latitude?: number | string | null;
        longitude?: number | string | null;
    } | null;
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
    activities?: { id: number; activity_key: string; details: string; created_at: string; actor?: { name: string } | null }[];
    delivery?: {
        id: number;
        delivery_reference: string;
        status: string;
        rider_id?: number | null;
        assigned_at?: string | null;
        pickup_address?: string | null;
        pickup_latitude?: number | null;
        pickup_longitude?: number | null;
        pickup_verified_at?: string | null;
        rider?: { id: number; name: string } | null;
    } | null;
    seller?: {
        name: string;
        seller_profile?: {
            business_name?: string | null;
            phone?: string | null;
            address?: string | null;
            latitude?: number | string | null;
            longitude?: number | string | null;
        } | null;
    } | null;
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

function displayOrderStatus(order: SellerOrder): string {
    if (order.delivery?.status === 'DELIVERED') return 'Delivered';
    if (order.status === 'FULFILLING') return 'On the Way';
    return formatStatus(order.status);
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

export function SellerOrdersPage({ onNavigationCountsChanged, initialOrderId, onInitialOrderHandled }: {
    onNavigationCountsChanged?: () => Promise<void>;
    initialOrderId?: number | null;
    onInitialOrderHandled?: () => void;
}) {
    const [orders, setOrders] = React.useState<SellerOrder[]>([]);
    const [selectedOrder, setSelectedOrder] = React.useState<SellerOrder | null>(null);
    const [statusFilter, setStatusFilter] = React.useState('');
    const [search, setSearch] = React.useState('');
    const [sort, setSort] = React.useState<OrderSort>('newest');
    const [page, setPage] = React.useState(1);
    const [rejectReason, setRejectReason] = React.useState('');
    const [loading, setLoading] = React.useState(true);
    const [detailsLoading, setDetailsLoading] = React.useState(false);
    const [confirming, setConfirming] = React.useState(false);
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState('');
    const [detailsError, setDetailsError] = React.useState('');
    const [pickupCode, setPickupCode] = React.useState<{ code: string } | null>(null);
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

    React.useEffect(() => {
        void refreshOrders();
    }, [refreshOrders]);

    React.useEffect(() => {
        if (initialOrderId === undefined || initialOrderId === null || loading) return;
        void openOrder(initialOrderId);
        onInitialOrderHandled?.();
    }, [initialOrderId, loading, onInitialOrderHandled]);

    async function openOrder(orderId: number): Promise<boolean> {
        setSelectedOrder(orders.find((order) => order.id === orderId) ?? null);
        setPickupCode(null);
        setPickupCodeError('');
        setDetailsLoading(true);
        setDetailsError('');
        try {
            const response = await api.get<{ order: SellerOrder }>(`/api/orders/${orderId}`);
            setSelectedOrder(response.data.order);
            setRejectReason('');
            return true;
        } catch (requestError: any) {
            setDetailsError(requestError.userMessage ?? requestError.response?.data?.message ?? 'Order details could not be loaded.');
            return false;
        } finally {
            setDetailsLoading(false);
        }
    }

    async function issuePickupCode() {
        if (!selectedOrder || pickupCodeLoading) return;
        setPickupCodeLoading(true);
        setPickupCodeError('');
        try {
            const response = await api.post<{ code: string }>(`/api/orders/${selectedOrder.id}/delivery-code`);
            setPickupCode(response.data);
        } catch (requestError: any) {
            setPickupCodeError(requestError.userMessage ?? requestError.response?.data?.message ?? 'Order QR code could not be issued.');
        } finally {
            setPickupCodeLoading(false);
        }
    }

    async function printReceipt() {
        if (!selectedOrder) return;
        if (canIssuePickupCode) {
            setPickupCodeLoading(true);
            setPickupCodeError('');
            try {
                const response = await api.post<{ code: string }>(`/api/orders/${selectedOrder.id}/delivery-code`);
                flushSync(() => setPickupCode(response.data));
            } catch (requestError: any) {
                const message = requestError.userMessage ?? requestError.response?.data?.message ?? 'A current order QR could not be created, so the receipt was not printed.';
                setPickupCodeError(message);
                setPickupCodeLoading(false);
                return;
            }
            setPickupCodeLoading(false);
        }

        document.body.classList.add('printing-order-receipt');
        window.print();
        document.body.classList.remove('printing-order-receipt');
    }

    async function decideOrder(status: 'CONFIRMED' | 'REJECTED' | 'PREPARING' | 'READY_FOR_PICKUP') {
        if (!selectedOrder || saving || confirming) return;
        const reason = rejectReason.trim();
        if (status === 'REJECTED' && !reason) {
            setError('Enter a reason before rejecting this order.');
            return;
        }
        const action = {
            CONFIRMED: { label: 'Accept order', success: 'accepted', question: 'This decision will update the order and notify the buyer.' },
            REJECTED: { label: 'Reject order', success: 'rejected', question: `The buyer will be notified. Reason: ${reason}` },
            PREPARING: { label: 'Start preparing', success: 'moved to Preparing', question: 'This will update the order status and notify the buyer.' },
            READY_FOR_PICKUP: { label: 'Mark Ready for Pickup', success: 'marked Ready for Pickup', question: selectedOrder.delivery_method === 'STANDARD_DELIVERY'
                ? 'This will update the order and begin rider assignment.'
                : 'This will update the order and notify the buyer.' },
        }[status];
        setConfirming(true);
        let confirmed = false;
        try {
            confirmed = await confirmAction({
                title: `${action.label} for ${selectedOrder.order_reference}?`,
                text: action.question,
                confirmText: action.label,
                danger: status === 'REJECTED',
            });
        } catch {
            setError('The confirmation dialog could not be opened. Try the decision again.');
            setConfirming(false);
            return;
        }
        if (!confirmed) {
            setConfirming(false);
            return;
        }
        setConfirming(false);
        setSaving(true);
        setError('');
        const orderId = selectedOrder.id;
        try {
            const response = await api.patch<{
                order: SellerOrder;
                delivery?: SellerOrder['delivery'] | null;
                rider_assignment_warning?: string | null;
            }>(`/api/orders/${orderId}/status`, {
                status,
                ...(status === 'REJECTED' ? { reason } : {}),
            }, { timeout: 20_000 });
            showSuccess(`Order ${selectedOrder.order_reference} ${action.success}.`);
            const assignmentWarning = response.data.rider_assignment_warning;
            setRejectReason('');
            const updatedOrder: SellerOrder = {
                ...selectedOrder,
                ...response.data.order,
                ...(response.data.delivery ? { delivery: response.data.delivery } : {}),
            };
            setSelectedOrder(updatedOrder);
            setOrders((current) => current.map((order) => order.id === orderId ? { ...order, ...response.data.order } : order));
            void onNavigationCountsChanged?.();
            if (assignmentWarning) setError(assignmentWarning);
        } catch (requestError: any) {
            const message = requestError.userMessage
                ?? requestError.response?.data?.message
                ?? (['ECONNABORTED', 'ETIMEDOUT'].includes(requestError.code)
                    ? 'The server did not confirm this update in time. The order may have changed; check its current status before trying again.'
                    : `Could not ${action.label.toLowerCase()} for this order. Refresh and review its current status.`);
            void refreshOrders().then(() => openOrder(orderId));
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
    const pickupCodeIsCurrent = pickupCode !== null;
    const canIssuePickupCode = selectedOrder?.delivery_method === 'STANDARD_DELIVERY'
        && ['READY_FOR_PICKUP', 'FULFILLING'].includes(selectedOrder.status)
        && !!delivery
        && ['RIDER_ACCEPTED', 'PICKUP_PENDING', 'PICKED_UP', 'IN_TRANSIT'].includes(delivery.status);
    const shopName = selectedOrder?.seller_location_snapshot?.business_name
        || selectedOrder?.seller?.seller_profile?.business_name
        || selectedOrder?.seller?.name
        || 'Farmgate Seller';
    const shopAddress = selectedOrder?.seller_location_snapshot?.address
        || selectedOrder?.seller?.seller_profile?.address;
    const shopPhone = selectedOrder?.seller?.seller_profile?.phone;

    return <section className="seller-orders" aria-labelledby="seller-orders-title">
        <header className="seller-orders-heading">
            <div><p className="eyebrow">Order management</p><h2 id="seller-orders-title">Orders</h2><p>Review incoming orders, make a decision, and track delivery. The Orders badge counts orders still awaiting confirmation; reading a notification does not confirm an order.</p></div>
            <span>{orders.length} {orders.length === 1 ? 'order' : 'orders'}</span>
        </header>
        <div className="seller-orders-filters" role="search">
            <label>Search orders<input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Order number, buyer, or livestock" /></label>
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
        {loading ? <LoadingSkeleton variant="table" count={5} columns={7} label="Loading seller orders" />
            : error && orders.length === 0 ? null
            : orders.length === 0 ? <div className="seller-orders-empty"><h3>No orders yet</h3><p>New buyer orders will appear here when they are placed.</p></div>
                : filteredOrders.length === 0 ? <div className="seller-orders-empty"><h3>No matching orders</h3><p>Try a different search or status filter.</p></div>
                    : <><div className="seller-orders-table-wrap"><table className="seller-orders-table">
                        <thead><tr><th scope="col">Order</th><th scope="col">Date</th><th scope="col">Buyer</th><th scope="col">Livestock</th><th scope="col">Total</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Details</span></th></tr></thead>
                        <tbody>{visibleOrders.map((order) => <tr key={order.id}>
                            <td><strong>{order.order_reference}</strong></td>
                            <td><time dateTime={order.created_at}>{new Date(order.created_at).toLocaleDateString()}</time></td>
                            <td>{order.shipping_address?.recipient_name ?? order.buyer?.name ?? 'Buyer'}</td>
                            <td>{order.items.map((item) => `${item.quantity} ${item.pricing_type === 'PER_KILO' ? 'kg' : 'head'} ${item.listing?.name ?? 'Removed listing'}`).join(', ')}</td>
                            <td>{amount(order.total_amount)}</td>
                            <td><span className={`seller-order-status status-${displayOrderStatus(order).toLowerCase().replaceAll(' ', '_')}`}>{displayOrderStatus(order)}</span></td>
                            <td><button className="seller-order-view" type="button" onClick={() => void openOrder(order.id)}>Review</button></td>
                        </tr>)}</tbody>
                    </table></div>
                    <div className="seller-orders-pagination">
                        <span>Showing {(page - 1) * ordersPerPage + 1}–{Math.min(page * ordersPerPage, sortedOrders.length)} of {sortedOrders.length} orders</span>
                        {lastPage > 1 && <Pagination page={page} lastPage={lastPage} onChange={setPage} />}
                    </div></>}
        {selectedOrder && <FarmgateDetailDialog
            eyebrow="Order details"
            title={selectedOrder.order_reference}
            description={<time dateTime={selectedOrder.created_at}>{new Date(selectedOrder.created_at).toLocaleString()}</time>}
            onClose={() => setSelectedOrder(null)}
            closeDisabled={saving}
            className="seller-order-modal"
            contentClassName="seller-order-content"
        >
                {detailsLoading ? <p role="status">Loading order details...</p> : detailsError ? <p className="seller-orders-error" role="alert">{detailsError} <button type="button" onClick={() => void openOrder(selectedOrder.id)}>Try again</button></p> : <>
                    <div className="seller-order-detail-grid">
                        <section><h3>Buyer</h3><p>{selectedOrder.buyer?.name ?? selectedOrder.shipping_address?.recipient_name ?? 'Buyer'}</p>{selectedOrder.shipping_address?.phone_number && <p>Phone: {selectedOrder.shipping_address.phone_number}</p>}</section>
                        <section><h3>{selectedOrder.delivery_method === 'SELF_PICKUP' ? 'Pickup' : 'Delivery'}</h3><p>{selectedOrder.delivery_method?.replaceAll('_', ' ') ?? 'Not specified'}</p><p>{orderAddress(selectedOrder)}</p>{selectedOrder.shipping_address?.delivery_notes && <p>Notes: {selectedOrder.shipping_address.delivery_notes}</p>}</section>
                        <section><h3>Payment</h3><p>{selectedOrder.payment_method?.replaceAll('_', ' ') ?? 'Not specified'} · {selectedOrder.payment_status?.replaceAll('_', ' ') ?? 'Status unavailable'}</p><p>Payment reference: {selectedOrder.payment_reference ?? 'Not available'}</p></section>
                        <section><h3>Order status</h3><p><span className={`seller-order-status status-${displayOrderStatus(selectedOrder).toLowerCase().replaceAll(' ', '_')}`}>{displayOrderStatus(selectedOrder)}</span></p></section>
                    </div>
                    <section className="seller-order-items"><h3>Livestock and amounts</h3><div className="seller-order-table-scroll"><table><thead><tr><th scope="col">Livestock listing</th><th scope="col">Quantity</th><th scope="col">Unit price</th><th scope="col">Amount</th></tr></thead><tbody>{selectedOrder.items.map((item) => <tr key={item.id}><td>{item.listing?.name ?? 'Removed listing'}</td><td>{item.quantity} {item.pricing_type === 'PER_KILO' ? 'kg' : 'head'}</td><td>{amount(item.unit_price)}</td><td>{amount(item.total_amount)}</td></tr>)}</tbody></table></div><p>Livestock: {amount(selectedOrder.subtotal_amount)} · Delivery: {amount(selectedOrder.delivery_fee)}{selectedOrder.delivery_distance_km !== null && selectedOrder.delivery_distance_km !== undefined ? ` · ${Number(selectedOrder.delivery_distance_km).toFixed(2)} km (${selectedOrder.delivery_distance_method === 'OSRM_BARANGAY_ESTIMATE' ? 'barangay-level road distance estimate' : 'OSRM road route'})` : ''}{Number(selectedOrder.platform_fee ?? 0) > 0 ? ` · Platform fee: ${amount(selectedOrder.platform_fee)}` : ''}{Number(selectedOrder.order_processing_fee ?? 0) > 0 ? ` · Order processing: ${amount(selectedOrder.order_processing_fee)}` : ''}{Number(selectedOrder.transaction_fee ?? 0) > 0 ? ` · Transaction fee: ${amount(selectedOrder.transaction_fee)}` : ''}{Number(selectedOrder.payment_processing_fee ?? 0) > 0 ? ` · Payment processing: ${amount(selectedOrder.payment_processing_fee)}` : ''}{Number(selectedOrder.buyer_service_fee ?? 0) > 0 ? ` · Buyer service: ${amount(selectedOrder.buyer_service_fee)}` : ''}{Number(selectedOrder.discount_amount ?? 0) > 0 ? ` · Discount: − ${amount(selectedOrder.discount_amount)}` : ''} · Total: <strong>{amount(selectedOrder.total_amount)}</strong></p></section>
                    <section className="seller-order-delivery"><h3>Rider assignment</h3>
                        {delivery?.delivery_reference && <p>Delivery reference: <strong>{delivery.delivery_reference}</strong></p>}
                        {selectedOrder.delivery_method !== 'STANDARD_DELIVERY' ? <p>No rider assignment is required for this delivery method.</p>
                            : ['CANCELLED', 'REJECTED', 'COMPLETED'].includes(selectedOrder.status) ? <p>No active rider assignment is required for this {formatStatus(selectedOrder.status).toLowerCase()} order.</p>
                            : riderConfirmed ? <p role="status">Assigned to {delivery?.rider?.name ?? 'rider'} · {formatStatus(delivery?.status ?? '')}{delivery?.assigned_at ? ` · ${new Date(delivery.assigned_at).toLocaleString()}` : ''}</p>
                                : delivery?.status === 'RIDER_OFFERED' || delivery?.status === 'SEARCHING_FOR_RIDER' ? <p role="status">{delivery.status === 'RIDER_OFFERED' ? `Offer sent to ${delivery.rider?.name ?? 'a rider'}; awaiting acceptance.` : 'Offers have been sent to available riders; awaiting acceptance.'}</p>
                                    : selectedOrder.status !== 'READY_FOR_PICKUP' && selectedOrder.status !== 'FULFILLING'
                                        ? <p role="status">Rider assignment begins when the order is ready for pickup{delivery?.status ? ` · ${formatStatus(delivery.status)}` : ''}.</p>
                                        : <><p role="status">No verified, available rider with a recent location is within the configured assignment distance yet{delivery?.status ? ` · ${formatStatus(delivery.status)}` : ''}. Nearby riders should refresh their location while available.</p><button type="button" className="seller-order-retry" onClick={() => void retryRiderAssignment()} disabled={saving}>{saving ? 'Retrying...' : 'Retry rider assignment'}</button></>}
                    </section>
                    <section className="seller-order-receipt buyer-order-receipt seller-order-receipt-print" aria-labelledby="seller-order-receipt-title">
                        <header className="seller-receipt-brand">
                            <span className="seller-receipt-brand-mark">FARM<span>GATE</span></span>
                            <p className="eyebrow">Order receipt</p>
                            <h3 id="seller-order-receipt-title">{shopName}</h3>
                            <p>{selectedOrder.seller?.name ?? 'Farmgate Seller'}{shopPhone ? ` · ${shopPhone}` : ''}</p>
                            {shopAddress && <p>{shopAddress}</p>}
                            <p className="seller-receipt-document-label">Farmgate order receipt · Not a BIR-registered invoice or official receipt</p>
                        </header>
                        <p className="buyer-order-receipt-meta"><strong>{selectedOrder.order_reference}</strong><br />Issued {new Date(selectedOrder.created_at).toLocaleString()}</p>
                        <div className="buyer-order-receipt-parties">
                            <div><strong>Buyer</strong><span>{selectedOrder.shipping_address?.recipient_name ?? selectedOrder.buyer?.name ?? 'Buyer'}</span>{selectedOrder.shipping_address?.phone_number && <span>{selectedOrder.shipping_address.phone_number}</span>}</div>
                            <div><strong>{selectedOrder.delivery_method === 'SELF_PICKUP' ? 'Pickup' : 'Delivery'}</strong><span>{orderAddress(selectedOrder)}</span></div>
                        </div>
                        <dl className="buyer-order-receipt-payment">
                            <div><dt>Payment method</dt><dd>{selectedOrder.payment_method?.replaceAll('_', ' ') ?? 'Not specified'}</dd></div>
                            <div><dt>Payment status</dt><dd>{selectedOrder.payment_status?.replaceAll('_', ' ') ?? 'Status unavailable'}</dd></div>
                            <div><dt>Current order status</dt><dd>{displayOrderStatus(selectedOrder)}</dd></div>
                            <div><dt>Order status</dt><dd>{formatStatus(selectedOrder.status)}</dd></div>
                        </dl>
                        <table className="buyer-order-receipt-items">
                            <thead><tr><th scope="col">Livestock</th><th scope="col">Unit price</th><th scope="col">Line total</th></tr></thead>
                            <tbody>{selectedOrder.items.map((item) => <tr key={item.id}>
                                <td>{item.quantity.toLocaleString()} {item.pricing_type === 'PER_KILO' ? 'kg' : 'head'} × {item.listing?.name ?? 'Removed listing'}</td>
                                <td>{amount(item.unit_price)} / {item.pricing_type === 'PER_KILO' ? 'kg' : 'head'}</td>
                                <td>{amount(item.total_amount)}</td>
                            </tr>)}</tbody>
                        </table>
                        <dl className="buyer-order-receipt-totals">
                            <div><dt>Livestock total</dt><dd>{amount(selectedOrder.subtotal_amount)}</dd></div>
                            <div><dt>{selectedOrder.delivery_method === 'SELF_PICKUP' ? 'Pickup fee' : 'Delivery fee'}</dt><dd>{amount(selectedOrder.delivery_fee)}</dd></div>
                            {Number(selectedOrder.platform_fee ?? 0) > 0 && <div><dt>Platform fee</dt><dd>{amount(selectedOrder.platform_fee)}</dd></div>}
                            {Number(selectedOrder.order_processing_fee ?? 0) > 0 && <div><dt>Order processing fee</dt><dd>{amount(selectedOrder.order_processing_fee)}</dd></div>}
                            {Number(selectedOrder.transaction_fee ?? 0) > 0 && <div><dt>Transaction fee</dt><dd>{amount(selectedOrder.transaction_fee)}</dd></div>}
                            {Number(selectedOrder.payment_processing_fee ?? 0) > 0 && <div><dt>Payment processing fee</dt><dd>{amount(selectedOrder.payment_processing_fee)}</dd></div>}
                            {Number(selectedOrder.buyer_service_fee ?? 0) > 0 && <div><dt>Buyer service fee</dt><dd>{amount(selectedOrder.buyer_service_fee)}</dd></div>}
                            {Number(selectedOrder.discount_amount ?? 0) > 0 && <div><dt>Discount</dt><dd>− {amount(selectedOrder.discount_amount)}</dd></div>}
                            <div className="buyer-order-grand-total"><dt>Total</dt><dd>{amount(selectedOrder.total_amount)}</dd></div>
                        </dl>
                        {canIssuePickupCode && <div className="seller-receipt-pickup">
                            <h4>Order verification QR · Assigned rider only</h4>
                            {pickupCodeIsCurrent && pickupCode
                                ? <div className="buyer-order-receipt-verification">
                                    <QRCodeSVG value={pickupCode.code} size={152} level="M" marginSize={2} aria-label="One-time pickup verification QR code for the assigned rider" />
                                    <p>Persistent order QR · for pickup and drop-off verification</p>
                                    <small>Show this code only to the currently assigned rider. It remains valid until delivery is verified or the order is cancelled.</small>
                                </div>
                                : <p>A one-time pickup QR will be included when you print this receipt. You can also create one now.</p>}
                            <button type="button" className="seller-inline-action seller-receipt-screen-action" disabled={pickupCodeLoading} onClick={() => void issuePickupCode()}>{pickupCodeLoading ? 'Preparing secure QR…' : pickupCodeIsCurrent ? 'Refresh order QR' : 'Show order QR in receipt'}</button>
                        </div>}
                        {pickupCodeError && <p className="seller-orders-error seller-receipt-screen-action" role="alert">{pickupCodeError}</p>}
                        <div className="buyer-order-receipt-actions seller-receipt-screen-action">
                            <button className="buyer-order-receipt-done" type="button" disabled={pickupCodeLoading} onClick={() => void printReceipt()}>{pickupCodeLoading ? 'Preparing receipt…' : 'Print receipt'}</button>
                        </div>
                    </section>
                    {delivery && <DeliveryTrackingPanel
                        deliveryId={delivery.id}
                        sellerName={selectedOrder.seller?.name ?? 'Seller'}
                        buyerName={selectedOrder.shipping_address?.recipient_name ?? selectedOrder.buyer?.name ?? 'Buyer'}
                        sellerLatitude={selectedOrder.seller_location_snapshot?.latitude ?? delivery.pickup_latitude ?? selectedOrder.seller?.seller_profile?.latitude ?? null}
                        sellerLongitude={selectedOrder.seller_location_snapshot?.longitude ?? delivery.pickup_longitude ?? selectedOrder.seller?.seller_profile?.longitude ?? null}
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
                            <button type="button" disabled={saving || confirming} onClick={() => void decideOrder('CONFIRMED')}>{confirming ? 'Confirming...' : saving ? 'Updating...' : 'Accept order'}</button>
                            <label>Reason for rejection<textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} maxLength={500} required rows={2} /></label>
                            <button type="button" className="danger" disabled={saving || confirming || !rejectReason.trim()} onClick={() => void decideOrder('REJECTED')}>{confirming ? 'Confirming...' : saving ? 'Updating...' : 'Reject order'}</button>
                        </div>}
                    </section>}
                    {selectedOrder.status === 'CONFIRMED' && <section className="seller-order-decision" aria-label="Order preparation">
                        <h3>Order preparation</h3>
                        <p>Begin preparing the accepted order. Mark it ready when it can be handed over for pickup.</p>
                        {!paymentReady && <p className="seller-orders-error">This online payment is awaiting confirmation. You can continue after payment is confirmed.</p>}
                        <div className="seller-order-decision-actions">
                            <button type="button" disabled={saving || confirming || !paymentReady} onClick={() => void decideOrder('PREPARING')}>{confirming ? 'Confirming...' : saving ? 'Updating...' : 'Start preparing'}</button>
                        </div>
                    </section>}
                    {selectedOrder.status === 'PREPARING' && <section className="seller-order-decision" aria-label="Pickup readiness">
                        <h3>Pickup readiness</h3>
                        <p>Mark the order ready only after it has been prepared. For standard delivery, this starts rider assignment.</p>
                        {!paymentReady && <p className="seller-orders-error">This online payment is awaiting confirmation. You can continue after payment is confirmed.</p>}
                        <div className="seller-order-decision-actions">
                            <button type="button" disabled={saving || confirming || !paymentReady} onClick={() => void decideOrder('READY_FOR_PICKUP')}>{confirming ? 'Confirming...' : saving ? 'Updating...' : 'Mark Ready for Pickup'}</button>
                        </div>
                    </section>}
                    <section className="seller-order-history"><h3>Order history</h3>{selectedOrder.status_history?.length ? <ol>{selectedOrder.status_history.map((entry) => <li key={entry.id}><strong>{formatStatus(entry.to_status)}</strong><span>{entry.actor?.name ? ` · ${entry.actor.name}` : ''} · {new Date(entry.created_at).toLocaleString()}</span>{entry.reason && <p>{entry.reason}</p>}</li>)}</ol> : <p>No status history is recorded.</p>}</section>
                    {!!selectedOrder.activities?.length && <section className="seller-order-history"><h3>Case and review activity</h3><ol>{selectedOrder.activities.map((activity) => <li key={activity.id}><strong>{activity.activity_key.replaceAll('_', ' ')}</strong><span>{activity.actor?.name ? ` · ${activity.actor.name}` : ''} · {new Date(activity.created_at).toLocaleString()}</span><p>{activity.details}</p></li>)}</ol></section>}
                </>}
        </FarmgateDetailDialog>}
    </section>;
}
