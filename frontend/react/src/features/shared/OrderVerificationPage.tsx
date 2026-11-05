import React from 'react';
import api from '../../lib/api';

type VerifiedOrder = {
    order_reference: string;
    status: string;
    created_at: string | null;
};

export function OrderVerificationPage({ reference }: { reference: string }) {
    const [order, setOrder] = React.useState<VerifiedOrder | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [notFound, setNotFound] = React.useState(false);
    const [unavailable, setUnavailable] = React.useState(false);

    React.useEffect(() => {
        let active = true;

        api.get<{ order: VerifiedOrder }>(`/api/orders/verify/${encodeURIComponent(reference)}`)
            .then((response) => {
                if (active) setOrder(response.data.order);
            })
            .catch((error: { response?: { status?: number } }) => {
                if (!active) return;
                if (error.response?.status === 404) setNotFound(true);
                else setUnavailable(true);
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => { active = false; };
    }, [reference]);

    return <main className="order-verification-page" aria-labelledby="order-verification-title">
        <a className="brand" href="/">FARM<span>GATE</span></a>
        <section className="order-verification-card">
            <p className="eyebrow">Public order lookup</p>
            <h1 id="order-verification-title">Order reference verification</h1>
            {loading
                ? <p role="status">Checking this reference...</p>
                : notFound || !order
                    ? <div role="alert"><strong>{unavailable ? 'Verification unavailable' : 'Reference not found'}</strong><p>{unavailable ? 'We could not check this order right now. Please try again later.' : 'We could not find an order matching this reference.'}</p></div>
                    : <>
                        <p className="order-verification-reference">{order.order_reference}</p>
                        <dl>
                            <div><dt>Order status</dt><dd>{order.status.replaceAll('_', ' ')}</dd></div>
                            {order.created_at && <div><dt>Order date</dt><dd><time dateTime={order.created_at}>{new Date(order.created_at).toLocaleString()}</time></dd></div>}
                        </dl>
                        <p className="order-verification-notice">A matching order reference confirms only that an order record exists. It does not confirm payment, delivery, or settlement.</p>
                    </>}
        </section>
    </main>;
}
