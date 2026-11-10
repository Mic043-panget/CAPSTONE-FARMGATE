import React from 'react';
import api from '../../lib/api';
import { confirmAction, showSuccess } from '../../lib/alerts';
import { LoadingSkeleton } from '../../shared/components/LoadingSkeleton';

type CartListing = {
    id: number;
    name: string;
    status: string;
    quantity: number;
    pricing_type: 'PER_KILO' | 'PER_HEAD';
    original_price?: string;
    promotion?: { name: string } | null;
    category: string | null;
    images: { url: string; alt_text?: string | null }[];
};

type CartItem = {
    id: number;
    listing_id: number;
    quantity: number;
    unit_price: number;
    listing: CartListing | null;
};

type CartResponse = { items: CartItem[]; subtotal: number };

type BuyerCartProps = {
    open: boolean;
    onClose: () => void;
    onCheckout: () => void;
    onCartCountChange: (count: number) => void;
    onError: (message: string) => void;
};

function cartCount(items: CartItem[]): number {
    return items.reduce((total, item) => total + item.quantity, 0);
}

const pesoPrice = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function BuyerCart({ open, onClose, onCheckout, onCartCountChange, onError }: BuyerCartProps) {
    const [cart, setCart] = React.useState<CartResponse>({ items: [], subtotal: 0 });
    const [loading, setLoading] = React.useState(false);
    const [busyItemId, setBusyItemId] = React.useState<number | null>(null);
    const [message, setMessage] = React.useState('');

    React.useEffect(() => {
        if (!open) return undefined;
        let current = true;
        setLoading(true);
        setMessage('');
        document.body.style.overflow = 'hidden';
        api.get<CartResponse>('/api/cart')
            .then((response) => {
                if (!current) return;
                setCart(response.data);
                onCartCountChange(cartCount(response.data.items));
            })
            .catch((requestError: any) => {
                if (current) onError(requestError.userMessage ?? 'Your cart could not be loaded.');
            })
            .finally(() => {
                if (current) setLoading(false);
            });
        return () => {
            current = false;
            document.body.style.overflow = '';
        };
    }, [open, onCartCountChange, onError]);

    async function updateQuantity(item: CartItem, quantity: number) {
        setBusyItemId(item.id);
        setMessage('');
        try {
            const response = await api.patch<CartResponse>(`/api/cart/items/${item.id}`, { quantity });
            setCart(response.data);
            onCartCountChange(cartCount(response.data.items));
            showSuccess('Cart quantity updated.');
        } catch (requestError: any) {
            const errorMessage = requestError.userMessage ?? requestError.response?.data?.message ?? 'The cart could not be updated.';
            setMessage(errorMessage);
            onError(errorMessage);
        } finally {
            setBusyItemId(null);
        }
    }

    async function removeItem(item: CartItem) {
        const confirmed = await confirmAction({ title: 'Remove this livestock listing?', text: `${item.listing?.name ?? 'This livestock listing'} will be removed from your cart.`, confirmText: 'Remove', danger: true });
        if (!confirmed) return;
        setBusyItemId(item.id);
        setMessage('');
        try {
            const response = await api.delete<CartResponse>(`/api/cart/items/${item.id}`);
            setCart(response.data);
            onCartCountChange(cartCount(response.data.items));
            showSuccess('Livestock listing removed from cart.');
        } catch (requestError: any) {
            const errorMessage = requestError.userMessage ?? requestError.response?.data?.message ?? 'The livestock listing could not be removed.';
            setMessage(errorMessage);
            onError(errorMessage);
        } finally {
            setBusyItemId(null);
        }
    }

    if (!open) return null;

    const canCheckout = cart.items.length > 0 && cart.items.every((item) => item.listing?.status === 'ACTIVE' && item.quantity <= item.listing.quantity);

    return (
        <div className="buyer-cart-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
            <section className="buyer-cart-panel" role="dialog" aria-modal="true" aria-labelledby="buyer-cart-title">
                <header className="buyer-cart-heading"><div><p className="eyebrow">Buyer basket</p><h2 id="buyer-cart-title">Your cart</h2></div><button className="buyer-cart-close" type="button" aria-label="Close cart" onClick={onClose}>×</button></header>
                {loading ? <LoadingSkeleton variant="list" count={3} label="Loading your cart" /> : !cart.items.length ? <div className="buyer-cart-empty"><strong>Your cart is empty</strong><p>Open a livestock listing to add livestock to your cart.</p></div> : <>
                    <div className="buyer-cart-items">{cart.items.map((item) => <article className="buyer-cart-item" key={item.id}>
                        <div className="buyer-cart-image">{item.listing?.images[0] ? <img src={item.listing.images[0].url} alt={item.listing.images[0].alt_text ?? item.listing.name} /> : <span aria-hidden="true">{item.listing?.name.slice(0, 1) ?? '?'}</span>}</div>
                        <div className="buyer-cart-item-info"><p className="eyebrow">{item.listing?.category ?? 'Listing'}</p><h3>{item.listing?.name ?? 'Listing unavailable'}</h3><p>{item.listing?.promotion && item.listing.original_price && <del>{pesoPrice.format(Number(item.listing.original_price))} </del>}<strong>{pesoPrice.format(item.unit_price)}</strong> / {item.listing?.pricing_type === 'PER_KILO' ? 'kg' : 'head'}</p>{item.listing?.promotion && item.listing.original_price && <p className="buyer-cart-promotion-note">{item.listing.promotion.name} · Save {pesoPrice.format(Number(item.listing.original_price) - item.unit_price)} per unit</p>}<div className="buyer-cart-item-actions"><div className="quantity-stepper" aria-label={`${item.listing?.pricing_type === 'PER_KILO' ? 'Kilograms' : 'Number of animals'} for ${item.listing?.name ?? 'listing'}`}><button type="button" aria-label="Decrease quantity" disabled={busyItemId === item.id || item.quantity <= 1} onClick={() => updateQuantity(item, item.quantity - 1)}>−</button><span>{item.quantity} {item.listing?.pricing_type === 'PER_KILO' ? 'kg' : 'head'}</span><button type="button" aria-label="Increase quantity" disabled={busyItemId === item.id || !item.listing || item.quantity >= item.listing.quantity} onClick={() => updateQuantity(item, item.quantity + 1)}>+</button></div><button className="buyer-cart-remove" type="button" disabled={busyItemId === item.id} onClick={() => removeItem(item)}>Remove</button></div></div>
                        <strong className="buyer-cart-line-total">{pesoPrice.format(item.unit_price * item.quantity)}</strong>
                    </article>)}</div>
                    <div className="buyer-cart-summary"><div className="buyer-cart-subtotal"><span>Merchandise subtotal</span><strong>{pesoPrice.format(cart.subtotal)}</strong></div><p>Choose shipping and payment options at checkout.</p><button type="button" disabled={!canCheckout} onClick={onCheckout}>Proceed to checkout</button></div>
                </>}
                {message && <p className="buyer-cart-message" role="status">{message}</p>}
            </section>
        </div>
    );
}