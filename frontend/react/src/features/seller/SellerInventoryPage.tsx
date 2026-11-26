import React from 'react';
import api from '../../lib/api';
import { LoadingSkeleton } from '../../shared/components/LoadingSkeleton';
import { Pagination } from '../../shared/components/Pagination';
import type { Category } from '../../shared/types';

type Paginated<T> = {
    data: T[];
    current_page: number;
    last_page: number;
    from: number | null;
    to: number | null;
    total: number;
};

type InventoryListing = {
    listing_key: string;
    name: string;
    category: string;
    category_slug: string | null;
    image_url: string | null;
    images: { url: string; alt_text: string | null }[];
    breed: string | null;
    sex: string | null;
    age_months: number | null;
    estimated_weight_kg: string | null;
    description: string | null;
    pickup_location: string | null;
    health_information: string | null;
    vaccination_information: string | null;
    pricing_type: 'PER_KILO' | 'PER_HEAD' | null;
    price_per_kilo: string | null;
    price_per_head: string | null;
    status: string;
    available_quantity: number;
    quantity_sold: number;
    sales_total: string;
    updated_at: string | null;
};

type InventoryHistory = {
    order_reference: string;
    listing_name: string;
    category: string;
    image_url: string | null;
    date: string | null;
    quantity: number;
    buyer_name: string;
    order_status: string;
    payment_status: string | null;
    amount: string;
};

type ListingOption = { listing_key: string; name: string; category: string };
type InventoryResponse = {
    inventory: Paginated<InventoryListing>;
    history: Paginated<InventoryHistory>;
    listing_options: ListingOption[];
};
type InventoryOrderDetails = {
    order_reference: string;
    status: string;
    payment_status: string | null;
    payment_method: string | null;
    delivery_method: string | null;
    created_at: string | null;
    buyer_name: string;
    subtotal_amount: string;
    total_amount: string;
    items: { listing_name: string; category: string; quantity: number; unit_price: string; total_amount: string; pricing_type: string | null }[];
    status_history: { from_status: string | null; to_status: string; reason: string | null; date: string | null; actor_name: string }[];
};

const orderStatuses = ['PENDING_CONFIRMATION', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'FULFILLING', 'COMPLETED', 'CANCELLED', 'REJECTED'];
const paymentStatuses = ['PENDING', 'PAID', 'UNPAID', 'FAILED'];
const currency = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 });

function formatStatus(status: string): string {
    return status.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string | null): string {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatAmount(value: string | number | null | undefined): string {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? currency.format(numeric) : '—';
}

function InventoryIcon({ name }: { name: 'search' | 'sort' | 'livestock' | 'close' | 'details' }) {
    const paths = {
        search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
        sort: <><path d="M8 4v16M4 8l4-4 4 4M16 20V4m-4 12 4 4 4-4" /></>,
        livestock: <><path d="M3.5 13c0-3 2.3-5 5.7-5h6.2l2.1-2 2.2 1.2-.5 2.4c1.3.9 2.3 2.3 2.3 4v2h-2.2v2h-2v-2H8v2H6v-2H3.5z" /><circle cx="14.5" cy="10.8" r=".7" /></>,
        close: <><path d="m6 6 12 12M18 6 6 18" /></>,
        details: <><path d="M4 4h16v16H4zM8 8h8M8 12h8M8 16h5" /></>,
    };

    return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export function SellerInventoryPage({ categories, initialListingKey, onBack }: { categories: Category[]; initialListingKey?: string | null; onBack: () => void }) {
    const [data, setData] = React.useState<InventoryResponse | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState('');
    const [search, setSearch] = React.useState('');
    const [listingKey, setListingKey] = React.useState(initialListingKey ?? '');
    const [category, setCategory] = React.useState('');
    const [orderStatus, setOrderStatus] = React.useState('');
    const [paymentStatus, setPaymentStatus] = React.useState('');
    const [from, setFrom] = React.useState('');
    const [to, setTo] = React.useState('');
    const [sort, setSort] = React.useState('updated_at');
    const [direction, setDirection] = React.useState<'asc' | 'desc'>('desc');
    const [historySort, setHistorySort] = React.useState('date:desc');
    const [inventoryPage, setInventoryPage] = React.useState(1);
    const [historyPage, setHistoryPage] = React.useState(1);
    const [reloadKey, setReloadKey] = React.useState(0);
    const [selectedReference, setSelectedReference] = React.useState<string | null>(null);
    const [selectedListing, setSelectedListing] = React.useState<InventoryListing | null>(null);
    const [orderDetails, setOrderDetails] = React.useState<InventoryOrderDetails | null>(null);
    const [detailsLoading, setDetailsLoading] = React.useState(false);
    const [detailsError, setDetailsError] = React.useState('');

    React.useEffect(() => {
        setListingKey(initialListingKey ?? '');
        setInventoryPage(1);
        setHistoryPage(1);
    }, [initialListingKey]);

    React.useEffect(() => {
        let active = true;
        setLoading(true);
        setError('');
        api.get<InventoryResponse>('/api/seller/inventory', {
            params: {
                search: search || undefined,
                listing_key: listingKey || undefined,
                category: category || undefined,
                order_status: orderStatus || undefined,
                payment_status: paymentStatus || undefined,
                from: from || undefined,
                to: to || undefined,
                sort,
                direction,
                history_sort: historySort.split(':')[0],
                history_direction: historySort.split(':')[1],
                inventory_page: inventoryPage,
                history_page: historyPage,
                per_page: 10,
            },
        }).then((response) => {
            if (active) setData(response.data);
        }).catch((requestError: any) => {
            if (active) setError(requestError.userMessage ?? requestError.response?.data?.message ?? 'Inventory and sales history could not be loaded.');
        }).finally(() => {
            if (active) setLoading(false);
        });
        return () => { active = false; };
    }, [search, listingKey, category, orderStatus, paymentStatus, from, to, sort, direction, historySort, inventoryPage, historyPage, reloadKey]);

    React.useEffect(() => {
        if (!selectedReference) {
            setOrderDetails(null);
            return;
        }
        let active = true;
        setDetailsLoading(true);
        setDetailsError('');
        api.get<{ order: InventoryOrderDetails }>(`/api/seller/inventory/orders/${encodeURIComponent(selectedReference)}`)
            .then((response) => {
                if (active) setOrderDetails(response.data.order);
            }).catch((requestError: any) => {
                if (active) setDetailsError(requestError.userMessage ?? requestError.response?.data?.message ?? 'Order details could not be loaded.');
            }).finally(() => {
                if (active) setDetailsLoading(false);
            });
        return () => { active = false; };
    }, [selectedReference]);

    function updateFilter(setter: (value: string) => void, value: string) {
        setter(value);
        setInventoryPage(1);
        setHistoryPage(1);
    }

    const inventory = data?.inventory;
    const history = data?.history;

    return <section className="seller-work-section seller-inventory-page" aria-labelledby="seller-inventory-title">
        <header className="seller-inventory-heading">
            <div><p className="eyebrow">Stock and sales</p><h2 id="seller-inventory-title">Listing Inventory</h2><p>Current availability and completed sales for your listings, with order history.</p></div>
            <button type="button" className="seller-inline-action" onClick={() => { window.location.hash = 'listings'; onBack(); }}>Back to My Listings</button>
        </header>

        <section className="seller-inventory-panel" aria-label="Inventory filters">
            <div className="seller-inventory-filters">
                <label className="seller-inventory-search"><span>Search inventory and orders</span><span className="seller-listing-control-input"><InventoryIcon name="search" /><input value={search} onChange={(event) => updateFilter(setSearch, event.target.value)} type="search" placeholder="Listing, order reference, or buyer" /></span></label>
                <label><span>Listing</span><select value={listingKey} onChange={(event) => updateFilter(setListingKey, event.target.value)}><option value="">All listings</option>{data?.listing_options.map((option) => <option value={option.listing_key} key={option.listing_key}>{option.name} · {option.category}</option>)}</select></label>
                <label><span>Category</span><select value={category} onChange={(event) => updateFilter(setCategory, event.target.value)}><option value="">All categories</option>{categories.map((item) => <option value={item.slug} key={item.slug}>{item.name}</option>)}</select></label>
                <label><span>Order status</span><select value={orderStatus} onChange={(event) => updateFilter(setOrderStatus, event.target.value)}><option value="">All statuses</option>{orderStatuses.map((status) => <option value={status} key={status}>{formatStatus(status)}</option>)}</select></label>
                <label><span>Payment status</span><select value={paymentStatus} onChange={(event) => updateFilter(setPaymentStatus, event.target.value)}><option value="">All payments</option>{paymentStatuses.map((status) => <option value={status} key={status}>{formatStatus(status)}</option>)}</select></label>
                <label><span>From</span><input type="date" value={from} max={to || undefined} onChange={(event) => updateFilter(setFrom, event.target.value)} /></label>
                <label><span>To</span><input type="date" value={to} min={from || undefined} onChange={(event) => updateFilter(setTo, event.target.value)} /></label>
            </div>
        </section>

        <section className="seller-inventory-panel" aria-labelledby="seller-inventory-table-title">
            <div className="seller-inventory-section-heading"><div><p className="eyebrow">By listing</p><h3 id="seller-inventory-table-title">Inventory summary</h3></div><label className="seller-inventory-sort"><span><InventoryIcon name="sort" />Sort inventory</span><select value={`${sort}:${direction}`} onChange={(event) => { const [nextSort, nextDirection] = event.target.value.split(':') as [string, 'asc' | 'desc']; setSort(nextSort); setDirection(nextDirection); setInventoryPage(1); }}><option value="updated_at:desc">Recently updated</option><option value="updated_at:asc">Least recently updated</option><option value="name:asc">Name A–Z</option><option value="name:desc">Name Z–A</option><option value="category:asc">Category A–Z</option><option value="category:desc">Category Z–A</option><option value="quantity_sold:desc">Most sold</option><option value="quantity_sold:asc">Least sold</option><option value="sales_total:desc">Highest sales</option><option value="sales_total:asc">Lowest sales</option></select></label></div>
            {error && <div className="seller-inventory-error" role="alert"><p>{error}</p><button type="button" onClick={() => setReloadKey((key) => key + 1)}>Try again</button></div>}
            {loading ? <LoadingSkeleton variant="table" count={4} columns={7} label="Loading seller inventory" />
                : error ? null
                    : inventory?.data.length ? <>
                        <div className="seller-inventory-table-wrap"><table className="seller-inventory-table"><caption className="sr-only">Seller listing inventory and completed sales</caption><thead><tr><th>Listing</th><th>Category</th><th>Available</th><th>Quantity sold</th><th>Sales total</th><th>Last updated</th><th>Details</th></tr></thead><tbody>
                            {inventory.data.map((item) => <tr key={item.listing_key}>
                                <td data-label="Listing"><span className="seller-inventory-listing">{item.image_url ? <img src={item.image_url} alt="" loading="lazy" /> : <span className="seller-inventory-image-placeholder"><InventoryIcon name="livestock" /></span>}<strong>{item.name}</strong></span></td>
                                <td data-label="Category">{item.category}</td><td data-label="Available">{item.available_quantity}</td><td data-label="Quantity sold">{item.quantity_sold}</td><td data-label="Sales total"><strong>{formatAmount(item.sales_total)}</strong></td><td data-label="Last updated">{formatDate(item.updated_at)}</td><td data-label="Details"><button className="seller-inventory-details-button" type="button" onClick={() => setSelectedListing(item)}><InventoryIcon name="details" /><span>View full details</span></button></td>
                            </tr>)}
                        </tbody></table></div>
                        <div className="seller-inventory-pagination"><span>{inventory.from ?? 0}–{inventory.to ?? 0} of {inventory.total} listings</span>{inventory.last_page > 1 && <Pagination page={inventory.current_page} lastPage={inventory.last_page} onChange={setInventoryPage} label="Inventory pages" />}</div>
                    </> : <div className="seller-inventory-empty"><h4>{search || listingKey || category ? 'No matching listings' : 'No inventory yet'}</h4><p>{search || listingKey || category ? 'Adjust the search or filters to see listings.' : 'Your listings and stock totals will appear here.'}</p></div>}
        </section>

        <section className="seller-inventory-panel" aria-labelledby="seller-inventory-history-title">
            <div className="seller-inventory-section-heading"><div><p className="eyebrow">Transactions</p><h3 id="seller-inventory-history-title">Sales and order history</h3></div><label className="seller-inventory-sort"><span><InventoryIcon name="sort" />Sort order history</span><select value={historySort} onChange={(event) => { setHistorySort(event.target.value); setHistoryPage(1); }}><option value="date:desc">Newest first</option><option value="date:asc">Oldest first</option><option value="amount:desc">Highest amount</option><option value="amount:asc">Lowest amount</option><option value="quantity:desc">Highest quantity</option><option value="quantity:asc">Lowest quantity</option><option value="listing:asc">Listing A–Z</option><option value="buyer:asc">Buyer A–Z</option><option value="order_status:asc">Order status A–Z</option></select></label></div>
            {loading ? <LoadingSkeleton variant="table" count={3} columns={7} label="Loading seller order history" />
                : error ? <p className="seller-inventory-muted">History is unavailable until inventory data can be loaded.</p>
                    : history?.data.length ? <>
                        <div className="seller-inventory-history-table-wrap"><table className="seller-inventory-table seller-inventory-history-table"><caption className="sr-only">Order history for your listings</caption><thead><tr><th>Listing / order</th><th>Date</th><th>Quantity</th><th>Buyer</th><th>Order status</th><th>Payment</th><th>Amount</th><th>Details</th></tr></thead><tbody>
                            {history.data.map((item, index) => <tr key={`${item.order_reference}-${item.listing_name}-${index}`}>
                                <td data-label="Listing / order"><strong>{item.listing_name}</strong><small>{item.order_reference}</small></td><td data-label="Date">{formatDate(item.date)}</td><td data-label="Quantity">{item.quantity}</td><td data-label="Buyer">{item.buyer_name}</td><td data-label="Order status"><span className="seller-inventory-status">{formatStatus(item.order_status)}</span></td><td data-label="Payment">{item.payment_status ? formatStatus(item.payment_status) : '—'}</td><td data-label="Amount">{formatAmount(item.amount)}</td><td data-label="Details"><button className="seller-inventory-details-button" type="button" onClick={() => setSelectedReference(item.order_reference)}><InventoryIcon name="details" /><span>View full details</span></button></td>
                            </tr>)}
                        </tbody></table></div>
                        <div className="seller-inventory-pagination"><span>{history.from ?? 0}–{history.to ?? 0} of {history.total} order items</span>{history.last_page > 1 && <Pagination page={history.current_page} lastPage={history.last_page} onChange={setHistoryPage} label="Sales history pages" />}</div>
                    </> : <div className="seller-inventory-empty"><h4>{search || listingKey || category || orderStatus || from || to ? 'No matching order history' : 'No orders yet'}</h4><p>{search || listingKey || category || orderStatus || from || to ? 'Try changing the search, date range, or filters.' : 'Orders for your listings will appear here when buyers place them.'}</p></div>}
        </section>

        {selectedListing && <div className="seller-inventory-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedListing(null); }}>
            <section className="seller-inventory-modal seller-inventory-listing-modal" role="dialog" aria-modal="true" aria-labelledby="seller-inventory-listing-modal-title">
                <header><div><p className="eyebrow">Listing inventory details</p><h3 id="seller-inventory-listing-modal-title">{selectedListing.name}</h3></div><button type="button" aria-label="Close listing details" onClick={() => setSelectedListing(null)}><InventoryIcon name="close" /></button></header>
                <div className="seller-inventory-order-details">
                    {selectedListing.images.length > 0 && <div className="seller-inventory-listing-gallery" aria-label="Listing images">{selectedListing.images.map((image, index) => <img key={`${image.url}-${index}`} src={image.url} alt={image.alt_text || `${selectedListing.name} photo ${index + 1}`} loading="lazy" />)}</div>}
                    <dl>
                        <div><dt>Category</dt><dd>{selectedListing.category}</dd></div>
                        <div><dt>Status</dt><dd>{formatStatus(selectedListing.status)}</dd></div>
                        <div><dt>Breed</dt><dd>{selectedListing.breed || '—'}</dd></div>
                        <div><dt>Sex</dt><dd>{selectedListing.sex ? formatStatus(selectedListing.sex) : '—'}</dd></div>
                        <div><dt>Age</dt><dd>{selectedListing.age_months == null ? '—' : `${selectedListing.age_months} months`}</dd></div>
                        <div><dt>Estimated weight per animal</dt><dd>{selectedListing.estimated_weight_kg ? `${selectedListing.estimated_weight_kg} kg` : '—'}</dd></div>
                        <div><dt>Price</dt><dd>{formatAmount(selectedListing.pricing_type === 'PER_KILO' ? selectedListing.price_per_kilo : selectedListing.price_per_head)} / {selectedListing.pricing_type === 'PER_KILO' ? 'kg' : 'head'}</dd></div>
                        <div><dt>Available quantity</dt><dd>{selectedListing.available_quantity} {selectedListing.pricing_type === 'PER_KILO' ? 'kg' : 'head'}</dd></div>
                        <div><dt>Quantity sold</dt><dd>{selectedListing.quantity_sold}</dd></div>
                        <div><dt>Sales total</dt><dd>{formatAmount(selectedListing.sales_total)}</dd></div>
                        <div><dt>Pickup location</dt><dd>{selectedListing.pickup_location || '—'}</dd></div>
                        <div><dt>Last updated</dt><dd>{formatDate(selectedListing.updated_at)}</dd></div>
                    </dl>
                    <h4>Description</h4><p className="seller-inventory-listing-description">{selectedListing.description || 'No description provided.'}</p>
                    <h4>Health information</h4><p className="seller-inventory-listing-description">{selectedListing.health_information || 'No health information provided.'}</p>
                    <h4>Vaccination information</h4><p className="seller-inventory-listing-description">{selectedListing.vaccination_information || 'No vaccination information provided.'}</p>
                </div>
            </section>
        </div>}

        {selectedReference && <div className="seller-inventory-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedReference(null); }}>
            <section className="seller-inventory-modal" role="dialog" aria-modal="true" aria-labelledby="seller-inventory-modal-title">
                <header><div><p className="eyebrow">Order details</p><h3 id="seller-inventory-modal-title">{orderDetails?.order_reference ?? selectedReference}</h3></div><button type="button" aria-label="Close order details" onClick={() => setSelectedReference(null)}><InventoryIcon name="close" /></button></header>
                {detailsLoading ? <LoadingSkeleton variant="table" count={2} columns={3} label="Loading order details" />
                    : detailsError ? <p className="seller-inventory-error" role="alert">{detailsError}<button type="button" onClick={() => setSelectedReference(null)}>Close</button></p>
                        : orderDetails && <div className="seller-inventory-order-details">
                            <dl><div><dt>Buyer</dt><dd>{orderDetails.buyer_name}</dd></div><div><dt>Order date</dt><dd>{formatDate(orderDetails.created_at)}</dd></div><div><dt>Order status</dt><dd>{formatStatus(orderDetails.status)}</dd></div><div><dt>Payment status</dt><dd>{orderDetails.payment_status ? formatStatus(orderDetails.payment_status) : '—'}</dd></div><div><dt>Payment method</dt><dd>{orderDetails.payment_method ? formatStatus(orderDetails.payment_method) : '—'}</dd></div><div><dt>Delivery method</dt><dd>{orderDetails.delivery_method ? formatStatus(orderDetails.delivery_method) : '—'}</dd></div><div><dt>Subtotal</dt><dd>{formatAmount(orderDetails.subtotal_amount)}</dd></div><div><dt>Order total</dt><dd>{formatAmount(orderDetails.total_amount)}</dd></div></dl>
                            <h4>Items</h4><div className="seller-inventory-detail-items">{orderDetails.items.map((item, index) => <article key={`${item.listing_name}-${index}`}><div><strong>{item.listing_name}</strong><small>{item.category} · {item.quantity} {item.pricing_type === 'PER_KILO' ? 'kg' : 'head'}</small></div><span>{formatAmount(item.unit_price)} each</span><strong>{formatAmount(item.total_amount)}</strong></article>)}</div>
                            <h4>Status history</h4>{orderDetails.status_history.length ? <ol className="seller-inventory-status-history">{orderDetails.status_history.map((item, index) => <li key={`${item.to_status}-${item.date}-${index}`}><div><strong>{item.from_status ? `${formatStatus(item.from_status)} → ` : ''}{formatStatus(item.to_status)}</strong><small>{item.actor_name} · {item.date ? new Date(item.date).toLocaleString('en-PH') : 'Date unavailable'}</small>{item.reason && <p>{item.reason}</p>}</div></li>)}</ol> : <p className="seller-inventory-muted">No status changes have been recorded.</p>}
                        </div>}
            </section>
        </div>}
    </section>;
}
