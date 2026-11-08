import React from 'react';
import api from '../../lib/api';

type AdminReceiptOrder = {
    id: number;
    order_reference: string;
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
    created_at: string;
    activities?: { id: number; activity_key: string; details: string; created_at: string; actor?: { name: string } | null }[];
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

function money(value: string | number | undefined): string {
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

export function AdminOrderReceipt({ orderId, reference, onError }: {
    orderId: number;
    reference: string;
    onError: (message: string) => void;
}) {
    const [order, setOrder] = React.useState<AdminReceiptOrder | null>(null);
    const [open, setOpen] = React.useState(false);
    const [loading, setLoading] = React.useState(false);

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

    React.useEffect(() => {
        if (!open) return undefined;
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };
        window.addEventListener('keydown', closeOnEscape);
        return () => window.removeEventListener('keydown', closeOnEscape);
    }, [open]);

    function printReceipt() {
        document.body.classList.add('printing-admin-order-receipt');
        window.print();
        document.body.classList.remove('printing-admin-order-receipt');
    }

    const shopName = order?.seller?.seller_profile?.business_name || order?.seller?.name || 'Farmgate Seller';

    return <>
        <button className="admin-order-reference" type="button" onClick={() => { setOrder(null); setOpen(true); }}>{reference}</button>
        {open && <div className="buyer-order-receipt-backdrop" role="presentation" onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
        }}>
            <section className="buyer-order-receipt admin-order-receipt" role="dialog" aria-modal="true" aria-labelledby="admin-order-receipt-title">
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
                    <p className="buyer-order-receipt-meta"><strong>{order.order_reference}</strong><br />{new Date(order.created_at).toLocaleString()}</p>
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
                        <thead><tr><th scope="col">Item</th><th scope="col">Unit price</th><th scope="col">Line total</th></tr></thead>
                        <tbody>{order.items.map((item) => <tr key={item.id}>
                            <td>{item.quantity} {item.pricing_type === 'PER_KILO' ? 'kg' : 'head'} × {item.listing?.name ?? 'Removed listing'}</td>
                            <td>{money(item.unit_price)}</td>
                            <td>{money(item.total_amount)}</td>
                        </tr>)}</tbody>
                    </table>
                    <dl className="buyer-order-receipt-totals">
                        <div><dt>Products</dt><dd>{money(order.subtotal_amount)}</dd></div>
                        <div><dt>{order.delivery_method === 'SELF_PICKUP' ? 'Pickup fee' : 'Delivery fee'}</dt><dd>{money(order.delivery_fee)}</dd></div>
                        {Number(order.platform_fee ?? 0) > 0 && <div><dt>Platform fee</dt><dd>{money(order.platform_fee)}</dd></div>}
                        {Number(order.order_processing_fee ?? 0) > 0 && <div><dt>Order processing fee</dt><dd>{money(order.order_processing_fee)}</dd></div>}
                        {Number(order.transaction_fee ?? 0) > 0 && <div><dt>Transaction fee</dt><dd>{money(order.transaction_fee)}</dd></div>}
                        {Number(order.payment_processing_fee ?? 0) > 0 && <div><dt>Payment processing fee</dt><dd>{money(order.payment_processing_fee)}</dd></div>}
                        {Number(order.buyer_service_fee ?? 0) > 0 && <div><dt>Buyer service fee</dt><dd>{money(order.buyer_service_fee)}</dd></div>}
                        {Number(order.discount_amount ?? 0) > 0 && <div><dt>Discount</dt><dd>− {money(order.discount_amount)}</dd></div>}
                        <div className="buyer-order-grand-total"><dt>Total</dt><dd>{money(order.total_amount)}</dd></div>
                    </dl>
                    {!!order.activities?.length && <section className="seller-order-history admin-order-activity"><h3>Order and case activity</h3><ol>{order.activities.map((activity) => <li key={activity.id}><strong>{activity.activity_key.replaceAll('_', ' ')}</strong><span>{activity.actor?.name ? ` · ${activity.actor.name}` : ''} · {new Date(activity.created_at).toLocaleString()}</span><p>{activity.details}</p></li>)}</ol></section>}
                    <div className="buyer-order-receipt-actions admin-order-receipt-actions">
                        <button className="buyer-order-receipt-done" type="button" onClick={printReceipt}>Print receipt</button>
                        <button className="buyer-order-receipt-done" type="button" onClick={() => setOpen(false)}>Close</button>
                    </div>
                </>}
            </section>
        </div>}
    </>;
}
