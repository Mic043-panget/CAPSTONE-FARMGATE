import React from 'react';
import api from '../../lib/api';
import type { User } from '../../shared/types';
import { confirmAction, showError, showSuccess } from '../../lib/alerts';
import { LoadingSkeleton } from '../../shared/components/LoadingSkeleton';

const LocationMap = React.lazy(() => import('../../shared/components/LocationMap').then((module) => ({ default: module.LocationMap })));

type CheckoutAddress = {
    id: number;
    label: string;
    recipient_name: string;
    phone_number: string;
    province: string;
    city_municipality: string;
    barangay: string;
    postal_code: string;
    street_address: string;
    address_line2: string | null;
    delivery_notes: string | null;
    latitude: number;
    longitude: number;
    is_default: boolean;
};

type ShippingAddress = Omit<CheckoutAddress, 'id' | 'is_default'> & { label: string };

type CheckoutLine = {
    listing_id: number;
    cart_item_id: number | null;
    name: string;
    quantity: number;
    available_quantity: number;
    unit_price: number;
    original_unit_price?: number;
    promotion_name?: string | null;
    pricing_type: 'PER_KILO' | 'PER_HEAD';
    image_url: string | null;
};

type CheckoutQuote = {
    subtotal: string;
    shipping: string;
    fees: string;
    total: string;
    delivery_distances_km: Record<string, number>;
    delivery_distance_methods: Record<string, 'OSRM_ROAD_ROUTE' | 'OSRM_BARANGAY_ESTIMATE'>;
    delivery_quote_token: string | null;
};
type BuyNowSelection = { listingId: number; quantity: number } | null;
type DeliveryMethod = 'SELF_PICKUP' | 'SELLER_DELIVERY' | 'STANDARD_DELIVERY';
type PaymentMethod = 'COD' | 'GCASH' | 'CARD' | 'GOOGLE_PAY';

type CheckoutPageProps = {
    user: User;
    buyNow: BuyNowSelection;
    onCancel: () => void;
    onComplete: (orderId: number, fromCart: boolean) => void;
    onError: (message: string) => void;
};

const steps = ['Shipping', 'Payment', 'Review'];
const cities = ['Calapan City', 'Bongabong', 'Pinamalayan', 'Roxas', 'Mansalay'];
const postalCodes: Record<string, string> = {
    'Calapan City': '5200',
    Bongabong: '5211',
    Pinamalayan: '5208',
    Roxas: '5212',
    Mansalay: '5213',
};
const bongabongBarangays = [
    'Anilao', 'Aplaya', 'Bagong Bayan I', 'Bagong Bayan II', 'Batangan', 'Bukal', 'Camantigue', 'Carmundo',
    'Cawayan', 'Dayhagan', 'Formon', 'Hagan', 'Hagupit', 'Ipil', 'Kaligtasan', 'Labasan', 'Labonan',
    'Libertad', 'Lisap', 'Luna', 'Malitbog', 'Mapang', 'Masaguisi', 'Mina de Oro', 'Morente', 'Ogbot',
    'Orconuma', 'Poblacion', 'Pulosahi', 'Sagana', 'San Isidro', 'San Jose', 'San Juan', 'Sta. Cruz',
    'Sigange', 'Tawas',
];
const defaultCoordinates = { latitude: 12.7321, longitude: 121.3654 };
const paymentOptions: { value: PaymentMethod; title: string; detail: string; mark: string }[] = [
    { value: 'COD', title: 'Cash on Delivery (COD)', detail: 'Pay when you receive your livestock', mark: '₱' },
    { value: 'GCASH', title: 'GCash', detail: 'Pay securely with GCash', mark: 'G' },
    { value: 'CARD', title: 'Debit/Credit Card', detail: 'BancNet, BPI, BDO, Metrobank, UnionBank', mark: '▰' },
    { value: 'GOOGLE_PAY', title: 'Google Pay', detail: 'Fast and secure payment', mark: 'G' },
];

function emptyShippingAddress(user: User): ShippingAddress {
    return {
        label: 'Checkout',
        recipient_name: user.name,
        phone_number: user.phone_number ?? '',
        province: 'Oriental Mindoro',
        city_municipality: 'Bongabong',
        barangay: '',
        postal_code: '5211',
        street_address: '',
        address_line2: '',
        delivery_notes: '',
        latitude: defaultCoordinates.latitude,
        longitude: defaultCoordinates.longitude,
    };
}

function addressText(address: Pick<ShippingAddress, 'street_address' | 'address_line2' | 'barangay' | 'city_municipality' | 'province' | 'postal_code'>): string {
    return [address.street_address, address.address_line2, address.barangay, address.city_municipality, address.province, address.postal_code].filter(Boolean).join(', ');
}

function peso(amount: number | string): string {
    return `₱${Number(amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function CheckoutPage({ user, buyNow, onCancel, onComplete, onError }: CheckoutPageProps) {
    const [deliveryMethod, setDeliveryMethod] = React.useState<DeliveryMethod>('SELF_PICKUP');
    const [paymentMethod, setPaymentMethod] = React.useState<PaymentMethod>('COD');
    const [addresses, setAddresses] = React.useState<CheckoutAddress[]>([]);
    const [shippingAddress, setShippingAddress] = React.useState<ShippingAddress>(() => emptyShippingAddress(user));
    const [locationConfirmed, setLocationConfirmed] = React.useState(false);
    const [showSavedAddresses, setShowSavedAddresses] = React.useState(true);
    const [showMap, setShowMap] = React.useState(false);
    const [items, setItems] = React.useState<CheckoutLine[]>([]);
    const [quantityDrafts, setQuantityDrafts] = React.useState<Record<number, string>>({});
    const [quote, setQuote] = React.useState<CheckoutQuote | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [quoteLoading, setQuoteLoading] = React.useState(false);
    const [submitting, setSubmitting] = React.useState(false);
    const [error, setError] = React.useState('');
    const [quoteRevision, setQuoteRevision] = React.useState(0);
    const [quoteUpdateNotice, setQuoteUpdateNotice] = React.useState('');

    React.useEffect(() => {
        let active = true;
        setLoading(true);
        const itemsRequest = buyNow
            ? api.get<{ listing: { id: number; name: string; quantity: number; pricing_type: 'PER_KILO' | 'PER_HEAD'; price_per_kilo?: string; price_per_head?: string; original_price?: string; current_price?: string; promotion?: { name: string } | null; images: { url: string }[] } }>(`/api/listings/${buyNow.listingId}`).then((response) => {
                const listing = response.data.listing;
                return [{
                    listing_id: listing.id,
                    cart_item_id: null,
                    name: listing.name,
                    quantity: buyNow.quantity,
                    available_quantity: listing.quantity,
                    unit_price: Number(listing.current_price ?? (listing.pricing_type === 'PER_KILO' ? listing.price_per_kilo : listing.price_per_head)),
                    original_unit_price: listing.promotion ? Number(listing.original_price) : undefined,
                    promotion_name: listing.promotion?.name,
                    pricing_type: listing.pricing_type,
                    image_url: listing.images[0]?.url ?? null,
                } satisfies CheckoutLine];
            })
            : api.get<{ items: { id: number; listing_id: number; quantity: number; unit_price: number; listing: { name: string; quantity: number; pricing_type: 'PER_KILO' | 'PER_HEAD'; original_price?: string; promotion?: { name: string } | null; images: { url: string; alt_text?: string | null }[] } | null }[] }>('/api/cart').then((response) => response.data.items.map((item): CheckoutLine => ({
                listing_id: item.listing_id,
                cart_item_id: item.id,
                name: item.listing?.name ?? 'Listing unavailable',
                quantity: item.quantity,
                available_quantity: item.listing?.quantity ?? item.quantity,
                unit_price: item.unit_price,
                original_unit_price: item.listing?.promotion && item.listing.original_price ? Number(item.listing.original_price) : undefined,
                promotion_name: item.listing?.promotion?.name,
                pricing_type: item.listing?.pricing_type ?? 'PER_HEAD',
                image_url: item.listing?.images[0]?.url ?? null,
            })));

        Promise.all([itemsRequest, api.get<{ addresses: CheckoutAddress[] }>('/api/buyer/addresses')])
            .then(([checkoutItems, addressResponse]) => {
                if (!active) return;
                setItems(checkoutItems);
                setAddresses(addressResponse.data.addresses);
                const address = addressResponse.data.addresses.find((saved) => saved.is_default) ?? addressResponse.data.addresses[0];
                if (address) {
                    setShippingAddress({ ...address, address_line2: address.address_line2 ?? '', delivery_notes: address.delivery_notes ?? '' });
                    setLocationConfirmed(true);
                }
            })
            .catch((requestError: any) => {
                if (!active) return;
                const message = requestError.userMessage ?? 'Checkout details could not be loaded.';
                setError(message);
                onError(message);
            })
            .finally(() => { if (active) setLoading(false); });

        return () => { active = false; };
    }, [buyNow, onError]);

    React.useEffect(() => {
        if (!items.length) return;
        if (!items.every((item) => Number.isInteger(item.quantity) && item.quantity >= 1 && item.quantity <= item.available_quantity)) {
            setQuote(null);
            setQuoteLoading(false);
            return;
        }
        if (deliveryMethod !== 'SELF_PICKUP' && !locationConfirmed) {
            setQuote(null);
            return;
        }
        let active = true;
        setQuoteLoading(true);
        api.post<CheckoutQuote>('/api/checkout/quote', {
            ...(buyNow
                ? { listing_id: buyNow.listingId, quantity: items[0].quantity }
                : { items: items.map((item) => ({ cart_item_id: item.cart_item_id, quantity: item.quantity })) }),
            delivery_method: deliveryMethod,
            ...(deliveryMethod !== 'SELF_PICKUP' ? {
                latitude: shippingAddress.latitude,
                longitude: shippingAddress.longitude,
                shipping_address: {
                    street_address: shippingAddress.street_address,
                    address_line2: shippingAddress.address_line2,
                    barangay: shippingAddress.barangay,
                    city_municipality: shippingAddress.city_municipality,
                    province: shippingAddress.province,
                    postal_code: shippingAddress.postal_code,
                },
            } : {}),
        }).then((response) => {
            if (active) {
                setQuote(response.data);
                setError('');
            }
        }).catch((requestError: any) => {
            if (active) {
                setQuote(null);
                setError(requestError.userMessage
                    ?? requestError.response?.data?.errors?.delivery_location?.[0]
                    ?? requestError.response?.data?.message
                    ?? 'Delivery and order fees could not be calculated.');
            }
        }).finally(() => { if (active) setQuoteLoading(false); });
        return () => { active = false; };
    }, [buyNow, deliveryMethod, items.map((item) => `${item.listing_id}:${item.quantity}`).join(','), locationConfirmed, shippingAddress.latitude, shippingAddress.longitude, shippingAddress.street_address, shippingAddress.address_line2, shippingAddress.barangay, shippingAddress.city_municipality, shippingAddress.province, shippingAddress.postal_code, quoteRevision]);

    const subtotal = items.reduce((total, item) => total + item.quantity * item.unit_price, 0);
    const requiredAddress = deliveryMethod !== 'SELF_PICKUP';

    function updateAddress<K extends keyof ShippingAddress>(key: K, value: ShippingAddress[K]) {
        setShippingAddress((current) => ({ ...current, [key]: value }));
    }

    function updateQuantity(item: CheckoutLine, value: string) {
        setQuantityDrafts((current) => ({ ...current, [item.listing_id]: value }));
        const quantity = Number(value);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > item.available_quantity) return;
        setItems((current) => current.map((line) => line.listing_id === item.listing_id ? { ...line, quantity } : line));
    }

    function finishQuantityEdit(item: CheckoutLine) {
        setQuantityDrafts((current) => {
            const next = { ...current };
            delete next[item.listing_id];
            return next;
        });
    }

    function selectSavedAddress(address: CheckoutAddress) {
        setShippingAddress({ ...address, address_line2: address.address_line2 ?? '', delivery_notes: address.delivery_notes ?? '' });
        setLocationConfirmed(true);
    }

    function updateCity(city: string) {
        setShippingAddress((current) => ({ ...current, city_municipality: city, barangay: '', postal_code: postalCodes[city] ?? current.postal_code }));
    }

    function validateCheckout(): string | null {
        if (!items.length) return 'There is no livestock in your order.';
        if (items.some((item) => !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > item.available_quantity)) return 'Choose a valid quantity for every livestock listing before continuing.';
        if (!requiredAddress) {
            if (!locationConfirmed || !Number.isFinite(shippingAddress.latitude) || !Number.isFinite(shippingAddress.longitude)) return 'Pin or select your location so the seller-to-buyer route can be shown on your order.';
            return null;
        }
        if (!shippingAddress.phone_number.trim()) return 'Enter a phone number for delivery.';
        if (!/^(09\d{9}|\+639\d{9})$/.test(shippingAddress.phone_number.replace(/[\s()-]/g, ''))) return 'Use a valid Philippine mobile number (09XXXXXXXXX or +639XXXXXXXXX).';
        if (!shippingAddress.city_municipality || !shippingAddress.barangay || !shippingAddress.postal_code || !shippingAddress.street_address.trim()) return 'Complete the delivery address, including barangay and street address.';
        if (!locationConfirmed || !Number.isFinite(shippingAddress.latitude) || !Number.isFinite(shippingAddress.longitude)) return 'Pin your exact delivery location on the map so the delivery fee can be calculated.';
        if (!quote) return error || 'Delivery fees are not available yet. Check that the seller has saved a pickup location.';
        return null;
    }

    async function placeOrder() {
        const validationMessage = validateCheckout();
        if (validationMessage) {
            setError(validationMessage);
            showError(validationMessage);
            return;
        }

        if (paymentMethod === 'COD') {
            const confirmed = await confirmAction({ title: 'Place your order?', text: 'The order will be sent to the seller for confirmation. Pay in cash when your livestock arrives or is collected.', confirmText: 'Place order' });
            if (!confirmed) return;
        } else {
            const confirmed = await confirmAction({ title: 'Continue to secure payment?', text: `Pay securely using ${paymentOptions.find((option) => option.value === paymentMethod)?.title} through PayMongo.`, confirmText: 'Continue to PayMongo' });
            if (!confirmed) return;
        }

        setSubmitting(true);
        setError('');
        try {
            const response = await api.post<{ order: { id: number; order_reference: string }; checkout_url: string | null }>('/api/checkout', {
                ...(buyNow
                    ? { listing_id: buyNow.listingId, quantity: items[0].quantity }
                    : { items: items.map((item) => ({ cart_item_id: item.cart_item_id, quantity: item.quantity })) }),
                delivery_method: deliveryMethod,
                payment_method: paymentMethod,
                ...(requiredAddress ? {
                    shipping_address: shippingAddress,
                    delivery_quote_token: quote?.delivery_quote_token,
                } : {}),
                ...(!requiredAddress ? {
                    buyer_location: {
                        ...shippingAddress,
                        latitude: shippingAddress.latitude,
                        longitude: shippingAddress.longitude,
                    },
                } : {}),
            });
            if (response.data.checkout_url) {
                window.location.assign(response.data.checkout_url);
                return;
            }
            showSuccess(`Order ${response.data.order.order_reference} placed for seller confirmation.`);
            onComplete(response.data.order.id, !buyNow);
        } catch (requestError: any) {
            const message = requestError.userMessage
                ?? requestError.response?.data?.errors?.delivery_location?.[0]
                ?? requestError.response?.data?.message
                ?? 'Checkout could not be completed.';
            setError(message);
            onError(message);
            if (requiredAddress && requestError.response?.status === 409) {
                setQuote(null);
                setQuoteUpdateNotice('The delivery location or fee changed. Review the refreshed distance and total, then place the order again.');
                setQuoteRevision((revision) => revision + 1);
            }
        } finally {
            setSubmitting(false);
        }
    }

    return <main className="buyer-checkout-screen" aria-labelledby="checkout-title">
        <header className="buyer-checkout-header">
            <button className="buyer-checkout-back" type="button" onClick={onCancel}>← Back</button>
            <div><p className="eyebrow">FARMGATE purchase</p><h1 id="checkout-title">Checkout</h1><p>Complete your purchase in a few simple steps</p></div>
        </header>
        <nav className="buyer-checkout-progress" aria-label="Checkout progress">
            {steps.map((label, index) => <React.Fragment key={label}>
                <div className={`buyer-checkout-step${index === 0 ? ' active' : ''}`} aria-current={index === 0 ? 'step' : undefined}><span>{index + 1}</span><strong>{label}</strong></div>
                {index < steps.length - 1 && <span className="buyer-checkout-progress-line" />}
            </React.Fragment>)}
        </nav>
        {loading ? <LoadingSkeleton variant="detail" count={2} label="Loading checkout details" /> : <div className="buyer-checkout-layout">
            <section className="buyer-checkout-main">
                <div className="buyer-checkout-section">
                    <header><h2>Personal &amp; Shipping Information</h2><p>Enter your details and delivery address</p></header>
                    <div className="buyer-checkout-form-card">
                        <h3>Personal Details</h3>
                        <div className="buyer-checkout-form-grid">
                            <label className="buyer-checkout-form-field">Full Name<input id="input-name" value={user.name} readOnly /></label>
                            <label className="buyer-checkout-form-field">Email Address<input id="input-email" type="email" value={user.email} readOnly /></label>
                            <label className="buyer-checkout-form-field buyer-checkout-form-field-full">Phone Number<input id="input-phone" type="tel" inputMode="tel" value={shippingAddress.phone_number} onChange={(event) => updateAddress('phone_number', event.target.value)} placeholder="09XXXXXXXXX or +639XXXXXXXXX" /><small>Format: 09XXXXXXXXX or +639XXXXXXXXX</small></label>
                        </div>
                    </div>
                    <section className="buyer-checkout-addresses">
                        <div className="buyer-checkout-subheading"><h3>Shipping Address</h3><div className="buyer-checkout-address-actions">
                            {addresses.length > 0 && <button type="button" className="buyer-checkout-muted-button" onClick={() => setShowSavedAddresses((visible) => !visible)}>{showSavedAddresses ? 'Hide' : 'Show'} Saved ({addresses.length})</button>}
                            <button type="button" className="buyer-checkout-muted-button" onClick={onCancel}>Manage</button>
                        </div></div>
                        {showSavedAddresses && addresses.length > 0 && <div className="buyer-checkout-address-list">{addresses.map((address) => {
                            const selected = address.latitude === shippingAddress.latitude && address.longitude === shippingAddress.longitude && address.street_address === shippingAddress.street_address;
                            return <button type="button" className={`buyer-checkout-saved-address${selected ? ' selected' : ''}`} key={address.id} onClick={() => selectSavedAddress(address)}>
                                <span><strong>{address.label}{address.is_default && <em>Default</em>}</strong><small>{address.recipient_name} · {address.phone_number}</small><small>{addressText(address)}</small></span>
                            </button>;
                        })}</div>}
                        <div className="buyer-checkout-form-grid buyer-checkout-address-form">
                            <label className="buyer-checkout-form-field">Province<select value={shippingAddress.province} onChange={(event) => updateAddress('province', event.target.value)}><option value="Oriental Mindoro">Oriental Mindoro</option></select></label>
                            <label className="buyer-checkout-form-field">City/Municipality<select value={shippingAddress.city_municipality} onChange={(event) => updateCity(event.target.value)}>{cities.map((city) => <option key={city} value={city}>{city}</option>)}</select></label>
                            <label className="buyer-checkout-form-field">Barangay{shippingAddress.city_municipality === 'Bongabong' ? <select value={shippingAddress.barangay} onChange={(event) => updateAddress('barangay', event.target.value)} required={requiredAddress}><option value="">-- Select Barangay --</option>{bongabongBarangays.map((barangay) => <option key={barangay} value={barangay}>{barangay}</option>)}</select> : <input value={shippingAddress.barangay} onChange={(event) => updateAddress('barangay', event.target.value)} placeholder="Barangay" required={requiredAddress} />}</label>
                            <label className="buyer-checkout-form-field">Zip Code<input value={shippingAddress.postal_code} onChange={(event) => updateAddress('postal_code', event.target.value)} placeholder="Postal code" /><small>Automatically filled based on city (you can edit if needed)</small></label>
                            <label className="buyer-checkout-form-field buyer-checkout-form-field-full">Street Address / House No.<input value={shippingAddress.street_address} onChange={(event) => updateAddress('street_address', event.target.value)} placeholder="House No., Street Name, Subdivision" required={requiredAddress} /></label>
                            <label className="buyer-checkout-form-field buyer-checkout-form-field-full">Additional Info (Optional)<input value={shippingAddress.address_line2 ?? ''} onChange={(event) => updateAddress('address_line2', event.target.value)} placeholder="Landmark, building name, floor, etc." /></label>
                        </div>
                        <button className="buyer-checkout-map-toggle" type="button" aria-expanded={showMap} onClick={() => setShowMap((visible) => !visible)}>⌖ &nbsp; Pin Your Exact Location{requiredAddress ? ' (Required for delivery)' : ' (Required for your order)'}</button>
                        <p className="buyer-checkout-map-help">Your saved or pinned location is included in order details so the seller can see the route, including for self-pickup.</p>
                        {showMap && <React.Suspense fallback={<p className="buyer-checkout-hint">Loading location map...</p>}><LocationMap latitude={shippingAddress.latitude} longitude={shippingAddress.longitude} onChange={(latitude, longitude) => {
                            setShippingAddress((address) => ({ ...address, latitude, longitude }));
                            setLocationConfirmed(true);
                        }} tooltip="Drag to your exact delivery location" /></React.Suspense>}
                        {!locationConfirmed && <p className="buyer-checkout-location-required">{requiredAddress ? 'Pin your location before delivery fees can be calculated.' : 'Select a saved address or pin your location to place this order.'}</p>}
                    </section>
                    <section className="buyer-checkout-choice-section">
                        <header><h2>Payment Method</h2><p>Choose how you want to pay</p></header>
                        <fieldset className="buyer-checkout-payment"><legend>Select Payment Method</legend>{paymentOptions.map((option) => <label className={`buyer-checkout-choice${paymentMethod === option.value ? ' selected' : ''}`} key={option.value}>
                            <input type="radio" name="payment-method" checked={paymentMethod === option.value} onChange={() => setPaymentMethod(option.value)} />
                            <span className="buyer-checkout-choice-mark" aria-hidden="true">{option.mark}</span><span><strong>{option.title}</strong><small>{option.detail}</small></span>
                            {option.value !== 'COD' && <span className="buyer-checkout-paymongo-mark">PayMongo</span>}
                        </label>)}</fieldset>
                        {paymentMethod === 'COD' && <aside className="buyer-checkout-instructions"><strong>Cash on Delivery Instructions:</strong><ul><li>Prepare exact amount when livestock arrives</li><li>Inspect livestock before payment</li><li>Payment accepted in cash only</li></ul></aside>}
                    </section>
                    <section className="buyer-checkout-choice-section">
                        <header><h2>Delivery Method</h2><p>Select how you want to receive your livestock</p></header>
                        <fieldset className="buyer-checkout-delivery"><legend>Delivery Method</legend>
                            <label className={`buyer-checkout-choice${deliveryMethod === 'SELF_PICKUP' ? ' selected' : ''}`}>
                                <input type="radio" name="delivery-method" checked={deliveryMethod === 'SELF_PICKUP'} onChange={() => setDeliveryMethod('SELF_PICKUP')} />
                                <span className="buyer-checkout-choice-mark" aria-hidden="true">⌖</span><span><strong>Self Pick-up</strong><small>Pick up your order from the seller's location</small></span><b>FREE</b>
                            </label>
                            <label className={`buyer-checkout-choice${deliveryMethod === 'SELLER_DELIVERY' ? ' selected' : ''}`}>
                                <input type="radio" name="delivery-method" checked={deliveryMethod === 'SELLER_DELIVERY'} onChange={() => setDeliveryMethod('SELLER_DELIVERY')} />
                                <span className="buyer-checkout-choice-mark" aria-hidden="true">▣</span><span><strong>Seller's Delivery Service</strong><small>Delivered by the seller (if available)</small></span><b>{quoteLoading ? 'Calculating...' : quote ? peso(quote.shipping) : 'Varies'}</b>
                            </label>
                            <label className={`buyer-checkout-choice${deliveryMethod === 'STANDARD_DELIVERY' ? ' selected' : ''}`}>
                                <input type="radio" name="delivery-method" checked={deliveryMethod === 'STANDARD_DELIVERY'} onChange={() => setDeliveryMethod('STANDARD_DELIVERY')} />
                                <span className="buyer-checkout-choice-mark" aria-hidden="true">➜</span><span><strong>Standard Delivery</strong><small>Regular delivery service (3-5 business days)</small></span><b>{quoteLoading ? 'Calculating...' : quote ? peso(quote.shipping) : 'Varies'}</b>
                            </label>
                        </fieldset>
                        {requiredAddress && <div className="buyer-checkout-delivery-notes">
                            <label className="buyer-checkout-form-field">Delivery Notes (Optional)<textarea value={shippingAddress.delivery_notes ?? ''} onChange={(event) => updateAddress('delivery_notes', event.target.value)} placeholder="Add any special instructions for delivery..." rows={3} /></label>
                            {deliveryMethod === 'STANDARD_DELIVERY' && <p className="buyer-checkout-hint">Your order will be delivered within 3-5 business days. Delivery fee is calculated automatically from the seller's and your pinned locations.</p>}
                            {deliveryMethod === 'SELLER_DELIVERY' && <p className="buyer-checkout-hint">The delivery fee is calculated automatically from the seller's and your pinned locations.</p>}
                        </div>}
                        {requiredAddress && quote && Object.entries(quote.delivery_distances_km ?? {}).map(([sellerId, distance]) => (
                            <p className="buyer-checkout-hint" key={sellerId}>
                                Seller {sellerId} route: {Number(distance).toFixed(2)} km
                                {quote.delivery_distance_methods[sellerId] === 'OSRM_BARANGAY_ESTIMATE'
                                    ? ' (barangay-level road distance estimate)'
                                    : ' (OSRM road route)'}
                            </p>
                        ))}
                    </section>
                </div>
            </section>
            <aside className="buyer-checkout-summary">
                <p className="eyebrow">Order Summary</p><h2>Review your livestock and total</h2>
                <h3>Your livestock</h3>
                <div className="buyer-checkout-summary-items">{items.map((item) => <article key={item.listing_id}>
                    <span className="buyer-checkout-item-image">{item.image_url ? <img src={item.image_url} alt="" /> : item.name.slice(0, 1)}</span>
                    <span className="buyer-checkout-item-name"><strong>{item.name}</strong>{item.original_unit_price !== undefined && <small className="checkout-promotion-note">{item.promotion_name} · <del>{peso(item.original_unit_price)}</del> Save {peso(item.original_unit_price - item.unit_price)} per unit</small>}<small>Price: {peso(item.unit_price)} / {item.pricing_type === 'PER_KILO' ? 'kg' : 'head'}</small><label className="buyer-checkout-quantity">Select {item.pricing_type === 'PER_KILO' ? 'kilograms' : 'number of animals'}<span><input type="number" min={1} max={item.available_quantity} step={1} value={quantityDrafts[item.listing_id] ?? (item.quantity > 0 ? String(item.quantity) : '')} onChange={(event) => updateQuantity(item, event.target.value)} onBlur={() => finishQuantityEdit(item)} aria-label={`Select ${item.pricing_type === 'PER_KILO' ? 'kilograms' : 'number of animals'} for ${item.name}`} />{item.pricing_type === 'PER_KILO' ? 'kg' : 'head'}</span></label><small>{item.quantity} × {peso(item.unit_price)} = {peso(item.quantity * item.unit_price)}</small></span>
                    <strong>{peso(item.quantity * item.unit_price)}</strong>
                </article>)}</div>
                <h3 className="buyer-checkout-summary-heading">Order Summary</h3>
                <div className="buyer-checkout-total-row"><span>Subtotal</span><strong>{peso(quote?.subtotal ?? subtotal)}</strong></div>
                <div className="buyer-checkout-total-row"><span>Shipping</span><strong>{deliveryMethod === 'SELF_PICKUP' ? 'FREE' : quoteLoading ? 'Calculating...' : quote ? peso(quote.shipping) : '—'}</strong></div>
                {quote && Number(quote.fees) > 0 && <div className="buyer-checkout-total-row"><span>Taxes &amp; service fees</span><strong>{peso(quote.fees)}</strong></div>}
                <div className="buyer-checkout-total-row buyer-checkout-grand-total"><span>Total Amount</span><strong>{peso(quote?.total ?? subtotal)}</strong></div>
                {requiredAddress && <p className="buyer-checkout-hint">Delivery fee uses the configured Farmgate fee rules applied to the OSRM road distance.</p>}
                {quoteUpdateNotice && <p className="buyer-checkout-hint" role="status">{quoteUpdateNotice}</p>}
                <p className="buyer-checkout-included">Includes all applicable taxes and fees</p>
                {error && <p className="buyer-checkout-error" role="alert">{error}</p>}
                <button className="buyer-checkout-primary buyer-checkout-submit" type="button" disabled={submitting || quoteLoading || (requiredAddress && !quote)} onClick={placeOrder}>{submitting ? 'Processing checkout...' : paymentMethod === 'COD' ? 'Place Order (COD)' : `Continue to PayMongo · ${paymentOptions.find((option) => option.value === paymentMethod)?.title}`}</button>
            </aside>
        </div>}
    </main>;
}
