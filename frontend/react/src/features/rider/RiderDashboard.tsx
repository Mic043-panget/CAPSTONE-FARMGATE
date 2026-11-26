import React from 'react';
import api from '../../lib/api';
import { NotificationsPage } from '../buyer/NotificationsPage';
import { AIChatPage } from '../shared/AIChatPage';
import { DeliveryTrackingPanel } from '../shared/DeliveryTrackingPanel';
import { ReportPanel } from '../shared/ReportPanel';
import { Pagination } from '../../shared/components/Pagination';
import { NavigationBadge } from '../../shared/components/NavigationBadge';
import { TabNav } from '../../shared/components/TabNav';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { RiderAccountSettings } from './RiderAccountSettings';
import { DeliveryProofSummary } from '../shared/DeliveryProofSummary';
import type { NearbyOrder } from './NearbyOrdersMap';
import { confirmAction } from '../../lib/alerts';
import type { User } from '../../shared/types';
import { SystemCalendar } from '../shared/SystemCalendar';
import { LoadingSkeleton } from '../../shared/components/LoadingSkeleton';
import { RiderEarningsPage } from './RiderEarningsPage';
import { WorkspaceAccountControl, WorkspaceMobileHeader, WorkspaceNotificationsButton, useWorkspaceMobileMenu } from '../shared/WorkspaceMobileHeader';
import { WorkspaceBannerArtwork } from '../shared/WorkspaceBannerArtwork';
import { RiderDeliveryTutorial } from './RiderDeliveryTutorial';
import { RoleMobileBottomNavigation } from '../shared/RoleMobileBottomNavigation';
import { FarmgateBrand } from '../shared/FarmgateBrand';
import { WorkspaceSidebarIcon } from '../shared/WorkspaceSidebarIcon';
import { ImageUploadPreview, IMAGE_UPLOAD_HINT, imageUploadError } from '../../shared/components/ImageUploadPreview';
import { FileDropzone } from '../../shared/components/FileDropzone';
import { compressDeliveryProofImage } from '../../shared/imageCompression';

const NearbyOrdersMap = React.lazy(() => import('./NearbyOrdersMap').then((module) => ({ default: module.NearbyOrdersMap })));

type RiderPage = 'dashboard' | 'earnings' | 'deliveries' | 'events' | 'chats' | 'reports' | 'notifications' | 'account';
type RiderDeliveryTab = 'nearby' | 'assigned' | 'scanner' | 'history';
type RiderDeliveryIconName = 'pin' | 'truck' | 'qr' | 'history' | 'bell' | 'refresh' | 'check' | 'arrow' | 'route' | 'buyer' | 'cod' | 'photo' | 'calendar' | 'order' | 'search' | 'filter' | 'camera';
function RiderDeliveryIcon({ name }: { name: RiderDeliveryIconName }) {
    return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {name === 'pin' ? <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>
            : name === 'truck' ? <><path d="M3 6h11v12H3zM14 10h4l3 3v5h-7" /><circle cx="7.5" cy="18" r="1.5" /><circle cx="18" cy="18" r="1.5" /></>
                : name === 'qr' ? <><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2M18 14h2M14 18h6M17 16v4" /></>
                    : name === 'history' ? <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2M4.5 5.5 3 8h3" /></>
                        : name === 'bell' ? <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>
                            : name === 'refresh' ? <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 9a7 7 0 0 1 11.6-2L20 12M4 12l2.3 5a7 7 0 0 0 11.6-2" /></>
                                : name === 'check' ? <path d="m5 12 4 4L19 6" />
                                    : name === 'route' ? <><circle cx="5" cy="18" r="2" /><circle cx="19" cy="6" r="2" /><path d="M7 18h2.5a3.5 3.5 0 0 0 3.5-3.5v-5A3.5 3.5 0 0 1 16.5 6H17" /></>
                                        : name === 'buyer' ? <><circle cx="12" cy="8" r="3.5" /><path d="M4 21a8 8 0 0 1 16 0" /></>
                                            : name === 'cod' ? <><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H20v14H5.5A2.5 2.5 0 0 1 3 16.5zM3 8h17M15 12h5v4h-5a2 2 0 0 1 0-4Z" /><circle cx="16" cy="14" r=".5" /></>
                                                : name === 'photo' ? <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9" r="1.5" /><path d="m21 15-5-5L5 20" /></>
                                                    : name === 'calendar' ? <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>
                                                        : name === 'order' ? <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3" /></>
                                                            : name === 'search' ? <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></>
                                                                : name === 'filter' ? <><path d="M4 6h16M7 12h10M10 18h4" /><circle cx="8" cy="6" r="1.5" fill="currentColor" /><circle cx="15" cy="12" r="1.5" fill="currentColor" /><circle cx="11" cy="18" r="1.5" fill="currentColor" /></>
                                                                    : name === 'camera' ? <><path d="M3 8h4l2-3h6l2 3h4v11H3z" /><circle cx="12" cy="13" r="3.5" /></>
                                                                        : <><path d="M5 12h14M13 6l6 6-6 6" /></>}
    </svg>;
}
type RiderSummary = {
    availability: string;
    offers: number;
    accepted: number;
    active: number;
    delivered: number;
    delivered_with_proof?: number;
    delivered_without_proof?: number;
    cancellations: number;
    average_delivery_minutes: number | null;
    filtered_deliveries: number;
};
type RiderOffer = NearbyOrder;
type RiderNotification = {
    id: string;
    data: { type?: string; order_reference?: string; delivery_reference?: string; message?: string; offer_id?: number; has_delivery_proof?: boolean };
    read_at: string | null;
    created_at: string;
};
type RiderActivity = {
    id: number;
    delivery_reference?: string | null;
    order_reference: string | null;
    from_status: string | null;
    to_status: string;
    reason: string | null;
    created_at: string | null;
};
type RiderDelivery = {
    id: number;
    delivery_reference: string;
    status: string;
    has_delivery_proof?: boolean;
    recipient_confirmed?: boolean;
    delivery_recipient_name?: string | null;
    proof_captured_at?: string | null;
    proof_recorded_at?: string | null;
    pickup_address: string | null;
    pickup_latitude: number | null;
    pickup_longitude: number | null;
    order: {
        id: number;
        order_reference: string;
        status: string;
        total_amount: string | number;
        payment_method?: string | null;
        payment_status?: string | null;
        cod_collection?: { status: string; remittance_id: number | null } | null;
        delivery_fee: string | number;
        delivery_distance_km: string | number | null;
        delivery_distance_method: 'OSRM_ROAD_ROUTE' | 'OSRM_BARANGAY_ESTIMATE' | null;
        delivery_method?: string;
        shipping_address?: {
            recipient_name?: string;
            phone_number?: string;
            street_address?: string;
            address_line2?: string | null;
            barangay?: string;
            city_municipality?: string;
            province?: string;
            latitude?: number | string | null;
            longitude?: number | string | null;
        } | null;
        buyer?: { name: string; phone_number?: string | null } | null;
        seller?: { name: string } | null;
    };
};
type Paginated<T> = { data: T[]; current_page: number; last_page: number; total: number };
type BarcodeDetectorResult = { rawValue: string };
type BarcodeDetectorLike = { detect: (video: HTMLVideoElement) => Promise<BarcodeDetectorResult[]> };
type BarcodeDetectorFactory = new (options: { formats: string[] }) => BarcodeDetectorLike;

const activeStatuses = new Set(['RIDER_ACCEPTED', 'PICKUP_PENDING', 'PICKED_UP', 'IN_TRANSIT']);
const riderStatuses = ['RIDER_ACCEPTED', 'PICKUP_PENDING', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'CANCELLED'];
const navigation: { id: RiderPage; label: string; icon: string }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: '◈' },
    { id: 'earnings', label: 'Earnings', icon: '₱' },
    { id: 'deliveries', label: 'Deliveries', icon: '▣' },
    { id: 'events', label: 'Events', icon: '◷' },
    { id: 'chats', label: 'Chats', icon: '✦' },
    { id: 'reports', label: 'Reports', icon: '▥' },
    { id: 'notifications', label: 'Notifications', icon: '♧' },
    { id: 'account', label: 'Settings', icon: '◉' },
];
const riderMobileDestinations = [
    { id: 'dashboard', label: 'Home', icon: 'home' },
    { id: 'chats', label: 'Chats', icon: 'chat' },
    { id: 'deliveries', label: 'Deliveries', icon: 'delivery' },
    { id: 'account', label: 'Settings', icon: 'settings' },
] as const;

function statusLabel(status: string): string {
    return status.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function locationFor(order: RiderDelivery['order']): string {
    const address = order.shipping_address;
    return [
        address?.street_address,
        address?.address_line2,
        address?.barangay,
        address?.city_municipality,
        address?.province,
    ].filter(Boolean).join(', ') || 'Drop-off address is not available';
}

function qrCode(rawValue: string): { purpose: 'pickup' | 'delivery' | 'order'; token: string } | null {
    const match = /^FARMGATE:(PICKUP|DELIVERY|ORDER):([A-Za-z0-9]{64})$/i.exec(rawValue.trim());
    if (!match) return null;
    return { purpose: match[1].toLowerCase() as 'pickup' | 'delivery' | 'order', token: match[2] };
}

function CodCollectionAction({ delivery, onSaved }: { delivery: RiderDelivery; onSaved: () => void }) {
    const [busy, setBusy] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const [error, setError] = React.useState('');
    const [amount, setAmount] = React.useState('');
    const [proof, setProof] = React.useState<File | null>(null);
    if (delivery.order.payment_method !== 'COD') return null;

    async function collect(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const parsedAmount = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(amount.trim());
        const amountCents = parsedAmount
            ? Number(parsedAmount[1]) * 100 + Number((parsedAmount[2] ?? '').padEnd(2, '0'))
            : 0;
        if (!Number.isSafeInteger(amountCents) || amountCents < 1 || !proof) {
            setError('Enter the cash amount actually received and attach a photo of the handover record.');
            return;
        }
        setBusy(true);
        setError('');
        setMessage('');
        try {
            const formData = new FormData();
            formData.append('amount_cents', String(amountCents));
            formData.append('proof', proof);
            const response = await api.post<{ message: string }>(`/api/deliveries/${delivery.id}/cod-collection`, formData);
            setMessage(response.data.message);
            setAmount('');
            setProof(null);
            onSaved();
        } catch (requestError: any) {
            setError(requestError.userMessage ?? requestError.response?.data?.message ?? 'COD cash collection could not be recorded.');
        } finally {
            setBusy(false);
        }
    }

    const collection = delivery.order.cod_collection;
    return <section className="rider-cod-collection" aria-label="Cash on delivery collection">
        <h5><RiderDeliveryIcon name="cod" />Cash on delivery</h5>
        {collection ? <p className="rider-cod-collection-state" role="status"><span>{statusLabel(collection.status)}</span>Cash collection recorded{collection.remittance_id ? ' · included in a remittance batch' : ''}</p>
            : delivery.order.payment_status === 'PAID' ? <p className="rider-cod-collection-state is-paid" role="status"><RiderDeliveryIcon name="check" />Buyer payment is marked paid.</p>
            : delivery.status !== 'DELIVERED' ? <p>Record cash after drop-off QR verification.</p>
                    : <form onSubmit={(event) => void collect(event)} aria-busy={busy}>
                        <p>Order total: PHP {Number(delivery.order.total_amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. Record what you actually received; Farmgate admin must confirm remittance before the buyer payment is marked paid.</p>
                        <label>Cash received (PHP)
                            <input type="number" min="0.01" step="0.01" inputMode="decimal" required value={amount} onChange={(event) => setAmount(event.target.value)} />
                        </label>
                        <div><FileDropzone label="Handover record photo" accept="image/jpeg,image/png,image/webp" required onFiles={(files) => {
                                const selected = files[0] ?? null;
                                const validationError = selected ? imageUploadError(selected) : null;
                                if (validationError) {
                                    setError(validationError);
                                    return;
                                }
                                setError('');
                                setProof(selected);
                            }} helperText={IMAGE_UPLOAD_HINT} />
                        <ImageUploadPreview file={proof} alt="Selected cash handover photo preview" />
                        </div>
                        <button type="submit" className="seller-inline-action" disabled={busy}>{busy ? 'Saving collection…' : 'Record cash received'}</button>
                    </form>}
        {message && <p role="status" aria-live="polite">{message}</p>}
        {error && <p role="alert">{error}</p>}
    </section>;
}

type RiderCodCollection = {
    id: number;
    expected_amount_cents: number;
    collected_amount_cents: number;
    status: string;
    order?: { order_reference: string };
};
type RiderCodReceivingMethod = {
    id: number;
    method_type: 'BANK_TRANSFER' | 'BANK_QR' | 'PAYMONGO_QR' | string;
    label: string;
    instructions: string | null;
    bank_name: string | null;
    account_holder: string | null;
    account_number: string | null;
    qr_url: string | null;
};
type RiderCodRemittance = {
    id: number;
    reference: string;
    status: string;
    method: string | null;
    expected_amount_cents: number;
    submitted_at: string | null;
    received_amount_cents: number | null;
};

function newCodTransferReference(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const randomBytes = crypto.getRandomValues(new Uint8Array(8));
    const suffix = Array.from(randomBytes, (byte) => alphabet[byte % alphabet.length]).join('');

    return `FG-COD-${new Date().getFullYear()}-${suffix}`;
}

function privateQrHref(rawUrl: string | null): string | null {
    if (!rawUrl) return null;
    try {
        const url = new URL(rawUrl, window.location.origin);
        if (url.username || url.password) return null;
        return url.protocol === 'https:' || url.origin === window.location.origin ? url.href : null;
    } catch {
        return null;
    }
}

function remittanceNextStep(status: string): string {
    switch (status) {
        case 'SUBMITTED':
        case 'PENDING':
        case 'UNDER_REVIEW':
            return 'Keep the original handover or transfer record. Wait for Farmgate admin to review and confirm receipt.';
        case 'NEEDS_REVIEW':
            return 'Farmgate admin needs to review this remittance. Keep your proof available and follow up with admin if requested.';
        case 'RECEIVED':
        case 'CONFIRMED':
        case 'COMPLETED':
        case 'RECONCILED':
            return 'Admin confirmed this remittance. No further action is needed for this batch.';
        case 'DISPUTED':
            return 'Admin recorded a discrepancy. Keep your proof and contact Farmgate admin to resolve the amount difference.';
        case 'REJECTED':
        case 'FAILED':
            return 'This remittance was not accepted. Review any admin follow-up and contact Farmgate support before submitting again.';
        default:
            return 'Check this remittance status with Farmgate admin if you are unsure what to do next.';
    }
}

function RiderRemittancePanel({ onSubmitted }: { onSubmitted: () => void }) {
    const [collections, setCollections] = React.useState<RiderCodCollection[]>([]);
    const [methods, setMethods] = React.useState<RiderCodReceivingMethod[]>([]);
    const [remittances, setRemittances] = React.useState<RiderCodRemittance[]>([]);
    const [loadingCollections, setLoadingCollections] = React.useState(true);
    const [loadingHistory, setLoadingHistory] = React.useState(true);
    const [busy, setBusy] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const [error, setError] = React.useState('');
    const [collectionsLoadError, setCollectionsLoadError] = React.useState('');
    const [historyLoadError, setHistoryLoadError] = React.useState('');
    const [methodChoice, setMethodChoice] = React.useState('CASH_HANDOVER');
    const [receiverName, setReceiverName] = React.useState('');
    const [transactionReference, setTransactionReference] = React.useState(newCodTransferReference);
    const [proof, setProof] = React.useState<File | null>(null);
    const busyRef = React.useRef(false);

    const selectedMethod = methods.find((method) => String(method.id) === methodChoice);
    const methodType = selectedMethod?.method_type ?? 'CASH_HANDOVER';
    const isCashHandover = methodType === 'CASH_HANDOVER';
    const isElectronic = methodType === 'BANK_TRANSFER' || methodType === 'BANK_QR' || methodType === 'PAYMONGO_QR';
    const totalCents = collections.reduce((sum, item) => sum + item.collected_amount_cents, 0);

    async function refreshCollections() {
        setLoadingCollections(true);
        setCollectionsLoadError('');
        try {
            const response = await api.get<{ collections: RiderCodCollection[] }>('/api/riders/cod/collections');
            setCollections(response.data.collections);
        } catch (requestError: any) {
            setCollectionsLoadError(requestError.userMessage ?? requestError.response?.data?.message ?? 'COD collections could not be loaded.');
        } finally {
            setLoadingCollections(false);
        }
    }

    async function refreshHistory() {
        setLoadingHistory(true);
        setHistoryLoadError('');
        try {
            const [methodsResponse, remittancesResponse] = await Promise.all([
                api.get<{ methods: RiderCodReceivingMethod[] }>('/api/riders/cod/receiving-methods'),
                api.get<{ remittances: RiderCodRemittance[] }>('/api/riders/cod/remittances'),
            ]);
            const activeMethods = methodsResponse.data.methods.filter((method) =>
                method.method_type === 'BANK_TRANSFER' || method.method_type === 'BANK_QR' || method.method_type === 'PAYMONGO_QR' || method.method_type === 'CASH_HANDOVER');
            setMethods(activeMethods);
            setRemittances(remittancesResponse.data.remittances);
            setMethodChoice((current) => current === 'CASH_HANDOVER' || activeMethods.some((method) => String(method.id) === current)
                ? current
                : 'CASH_HANDOVER');
        } catch (requestError: any) {
            setHistoryLoadError(requestError.userMessage ?? requestError.response?.data?.message ?? 'COD remittance methods and history could not be loaded.');
        } finally {
            setLoadingHistory(false);
        }
    }

    async function refresh() {
        setError('');
        await Promise.all([refreshCollections(), refreshHistory()]);
    }

    React.useEffect(() => { void refresh(); }, []);

    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busyRef.current) return;
        if (collections.length === 0 || !methodType || (!isCashHandover && !selectedMethod)) {
            setError('There are no collected COD funds to remit, or the selected receiving method is no longer available.');
            return;
        }
        if ((isCashHandover && !receiverName.trim()) || (isElectronic && !transactionReference.trim()) || (isElectronic && !proof)) {
            setError(isCashHandover
                ? 'Enter the name of the person receiving the cash handover.'
                : 'Enter the transaction reference and attach transfer or payment proof.');
            return;
        }
        if (proof && !['image/jpeg', 'image/png', 'image/webp'].includes(proof.type)) {
            setError('Choose a JPEG, PNG, or WebP image for remittance proof.');
            return;
        }
        if (proof && imageUploadError(proof)) {
            setError(imageUploadError(proof) ?? 'Choose a supported image.');
            return;
        }
        busyRef.current = true;
        setBusy(true);
        setError('');
        setMessage('');
        try {
            const confirmed = await confirmAction({
                title: 'Submit COD remittance?',
                text: `This submits ${collections.length} collection(s), totaling PHP ${(totalCents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, for admin reconciliation.`,
                confirmText: 'Submit remittance',
            });
            if (!confirmed) return;

            const formData = new FormData();
            formData.append('method_type', methodType);
            if (selectedMethod) formData.append('receiving_method_id', String(selectedMethod.id));
            if (isCashHandover) formData.append('receiver_name', receiverName.trim());
            if (isElectronic) formData.append('transaction_reference', transactionReference.trim());
            if (proof) formData.append('proof', proof);
            const response = await api.post<{ message: string }>('/api/riders/cod/remittances', formData);
            setMessage(response.data.message);
            setReceiverName('');
            setTransactionReference(newCodTransferReference());
            setProof(null);
            await refresh();
            onSubmitted();
        } catch (requestError: any) {
            setError(requestError.userMessage ?? requestError.response?.data?.message ?? 'COD remittance could not be submitted.');
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }

    return <div className="rider-cod-panels">
        <section className="rider-cod-remittance" aria-labelledby="rider-cod-remittance-title">
        <div className="rider-cod-remittance-heading"><span className="rider-cod-panel-icon"><RiderDeliveryIcon name="cod" /></span><div><p className="eyebrow">Cash custody</p><h3 id="rider-cod-remittance-title">COD cash to remit</h3></div></div>
        {loadingCollections ? <p role="status">Loading collected cash…</p> : collectionsLoadError
            ? <p className="rider-cod-load-error" role="alert">{collectionsLoadError} <button type="button" onClick={() => void refreshCollections()}>Try again</button></p>
            : collections.length === 0
            ? <p className="rider-cod-remittance-summary">No collected COD cash is waiting for remittance.</p>
            : <div className="rider-cod-remittance-collections">
                <p>{collections.length} order(s) · PHP {(totalCents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                <ul>{collections.map((item) => <li key={item.id}>{item.order?.order_reference ?? 'Order'} · received PHP {(item.collected_amount_cents / 100).toFixed(2)}{item.status === 'NEEDS_REVIEW' ? ' · Needs review' : ''}</li>)}</ul>
            </div>}
        {!loadingHistory && !historyLoadError && <div className="rider-cod-method-info">
            <label htmlFor="rider-cod-method">Remittance method</label>
            <select id="rider-cod-method" value={methodChoice} onChange={(event) => {
                setMethodChoice(event.target.value);
                setError('');
            }} disabled={busy}>
                <option value="CASH_HANDOVER">Cash handover</option>
                {methods.some((method) => method.method_type !== 'CASH_HANDOVER')
                    ? <optgroup label="Bank transfer or QR">
                        {methods.filter((method) => method.method_type !== 'CASH_HANDOVER').map((method) =>
                            <option key={method.id} value={String(method.id)}>{method.label}</option>)}
                    </optgroup>
                    : <option value="ONLINE_UNAVAILABLE" disabled>Online remittance · not set up</option>}
            </select>
            {methods.every((method) => method.method_type === 'CASH_HANDOVER')
                && <p className="rider-cod-method-note">Ask an admin to add a bank account or online banking QR.</p>}
            {selectedMethod && <div className="rider-cod-receiving-details">
                <strong>{selectedMethod.label}</strong>
                {selectedMethod.bank_name && <span>{selectedMethod.bank_name}</span>}
                {selectedMethod.account_holder && <span>Account holder: {selectedMethod.account_holder}</span>}
                {selectedMethod.account_number && <span>Farmgate receiving account: {selectedMethod.account_number}</span>}
                {selectedMethod.instructions && <p>{selectedMethod.instructions}</p>}
                {privateQrHref(selectedMethod.qr_url) && <a href={privateQrHref(selectedMethod.qr_url) ?? undefined} target="_blank" rel="noreferrer">Open private receiving QR</a>}
            </div>}
        </div>}
        {loadingHistory && <p role="status">Loading receiving methods…</p>}
        {!loadingCollections && !collectionsLoadError && collections.length > 0 && !loadingHistory && !historyLoadError && <form className="rider-cod-remittance-form" onSubmit={(event) => void submit(event)} aria-busy={busy}>
            {isCashHandover
                ? <label htmlFor="rider-cod-receiver">Cash received by
                    <input id="rider-cod-receiver" type="text" autoComplete="name" maxLength={120} required value={receiverName} onChange={(event) => setReceiverName(event.target.value)} disabled={busy} />
                </label>
                : isElectronic && <label htmlFor="rider-cod-reference">Transaction reference
                    <input id="rider-cod-reference" type="text" maxLength={120} required value={transactionReference} onChange={(event) => setTransactionReference(event.target.value)} disabled={busy} />
                    <small>Use this Farmgate reference in your bank transfer description. You can replace it with a bank-provided transaction reference.</small>
                </label>}
            <div><FileDropzone label={`Remittance proof ${isElectronic ? '(required)' : '(optional)'}`} accept="image/jpeg,image/png,image/webp" required={isElectronic} disabled={busy} onFiles={(files) => {
                    const selected = files[0] ?? null;
                    const validationError = selected ? imageUploadError(selected) : null;
                    if (validationError) {
                        setError(validationError);
                        return;
                    }
                    setProof(selected);
                    setError('');
                }} helperText={IMAGE_UPLOAD_HINT} />
            </div>
            <ImageUploadPreview file={proof} alt="Selected COD remittance proof preview" />
            <button className="seller-inline-action" type="submit" disabled={busy || loadingCollections || loadingHistory}>{busy ? 'Submitting…' : 'Submit remittance to admin'}</button>
        </form>}
        {message && <p className="rider-cod-feedback" role="status" aria-live="polite">{message}</p>}
        {error && <p className="rider-cod-feedback rider-cod-feedback-error" role="alert">{error} <button type="button" onClick={() => void refresh()} disabled={busy}>Reload COD details</button></p>}
        </section>
        <section className="rider-cod-remittance-history" aria-labelledby="rider-cod-history-title">
            <header className="rider-cod-history-title"><span className="rider-cod-panel-icon"><RiderDeliveryIcon name="history" /></span><div><p className="eyebrow">Submitted records</p><h3 id="rider-cod-history-title">Remittance history</h3></div></header>
            {loadingHistory ? <p role="status">Loading remittance history…</p> : historyLoadError
                ? <p className="rider-cod-load-error" role="alert">{historyLoadError} <button type="button" onClick={() => void refreshHistory()}>Try again</button></p>
                : remittances.length === 0
                ? <p>No remittances have been submitted yet.</p>
                : <ul>{remittances.map((remittance) => <li key={remittance.id}>
                    <div className="rider-cod-history-heading"><strong>{remittance.reference}</strong><span className={`rider-remittance-status rider-remittance-status--${remittance.status.toLowerCase().replaceAll('_', '-')}`}>{statusLabel(remittance.status)}</span></div>
                    <p><RiderDeliveryIcon name="cod" />{remittance.method ? statusLabel(remittance.method) : 'Remittance'} · Expected PHP {(remittance.expected_amount_cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        {remittance.received_amount_cents !== null && ` · Received PHP ${(remittance.received_amount_cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</p>
                    {remittance.submitted_at && <time dateTime={remittance.submitted_at}><RiderDeliveryIcon name="calendar" />Submitted {new Date(remittance.submitted_at).toLocaleString('en-PH')}</time>}
                    <p>{remittanceNextStep(remittance.status)}</p>
                </li>)}</ul>}
        </section>
    </div>;
}

function DeliveryProofCapture({ delivery, onSaved }: { delivery: RiderDelivery; onSaved: () => void }) {
    const maxSourcePhotoBytes = 40 * 1024 * 1024;
    const [photo, setPhoto] = React.useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = React.useState('');
    const [recipientName, setRecipientName] = React.useState('');
    const [recipientConfirmed, setRecipientConfirmed] = React.useState(false);
    const [capturedAt, setCapturedAt] = React.useState('');
    const [saving, setSaving] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const [error, setError] = React.useState('');
    const inputRef = React.useRef<HTMLInputElement>(null);
    const savingRef = React.useRef(false);

    React.useEffect(() => {
        if (!photo) {
            setPreviewUrl('');
            return undefined;
        }
        const url = URL.createObjectURL(photo);
        setPreviewUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [photo]);

    function selectPhoto(file: File | null) {
        const validationError = file ? imageUploadError(file, maxSourcePhotoBytes) : null;
        if (validationError) {
            setError(validationError);
            return;
        }
        setError('');
        setMessage('');
        setPhoto(file);
        setCapturedAt(file ? new Date().toISOString() : '');
    }

    function openCamera() {
        if (!inputRef.current) return;
        inputRef.current.value = '';
        inputRef.current.click();
    }

    async function saveProof(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!photo || !recipientName.trim() || !recipientConfirmed || savingRef.current) {
            setError('Add a photo and confirm receipt.');
            return;
        }
        savingRef.current = true;
        setSaving(true);
        setError('');
        setMessage('');
        const formData = new FormData();
        try {
            formData.append('photo', await compressDeliveryProofImage(photo));
            formData.append('recipient_name', recipientName.trim());
            formData.append('recipient_confirmed', '1');
            formData.append('captured_at', capturedAt);
            const response = await api.post<{ message: string }>(`/api/deliveries/${delivery.id}/proof`, formData);
            setMessage(response.data.message);
            setPhoto(null);
            setRecipientName('');
            setRecipientConfirmed(false);
            setCapturedAt('');
            if (inputRef.current) inputRef.current.value = '';
            onSaved();
        } catch (requestError: any) {
            setError(requestError.userMessage ?? requestError.response?.data?.message ?? requestError.message ?? 'Delivery proof could not be saved. Check your connection and try again.');
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    }

    if (!activeStatuses.has(delivery.status) || !['PICKED_UP', 'IN_TRANSIT'].includes(delivery.status)) return null;
    if (delivery.has_delivery_proof) return <p className="rider-proof-saved" role="status"><RiderDeliveryIcon name="check" />Proof saved · Scan the order QR at drop-off.</p>;

    return <form className="rider-proof-capture" onSubmit={(event) => void saveProof(event)}>
        <h4><RiderDeliveryIcon name="photo" />Delivery proof</h4>
        {previewUrl ? <div className="rider-proof-preview">
            <img src={previewUrl} alt="Preview of delivery proof photo" />
            <div className="rider-proof-photo-actions">
                <button type="button" className="seller-inline-action" disabled={saving} onClick={openCamera}>Retake photo</button>
                <FileDropzone label="Choose or drop a proof photo" accept="image/jpeg,image/png,image/webp" disabled={saving} buttonLabel="Choose photo" onFiles={(files) => selectPhoto(files[0] ?? null)} />
            </div>
        </div> : <div className="rider-proof-photo-actions">
            <button type="button" className="seller-inline-action rider-proof-camera-button" disabled={saving} onClick={openCamera}>
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8h4l2-3h6l2 3h4v11H3z" /><circle cx="12" cy="13" r="3.5" /></svg>
                Take photo
            </button>
            <FileDropzone label="Choose or drop a proof photo" accept="image/jpeg,image/png,image/webp" disabled={saving} buttonLabel="Choose photo" onFiles={(files) => selectPhoto(files[0] ?? null)} />
        </div>}
        <input ref={inputRef} className="rider-proof-file-input" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" tabIndex={-1} aria-hidden="true" onChange={(event) => { selectPhoto(event.target.files?.[0] ?? null); event.currentTarget.value = ''; }} />
        <small>JPEG, PNG, or WebP; up to 40 MB before local optimization. The photo is resized and compressed before it is securely saved.</small>
        <label className="rider-proof-recipient"><span><RiderDeliveryIcon name="buyer" />Recipient</span><input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} required maxLength={120} autoComplete="name" /></label>
        <label className="rider-proof-confirmation"><input type="checkbox" checked={recipientConfirmed} onChange={(event) => setRecipientConfirmed(event.target.checked)} required />Receipt confirmed</label>
        {error && <p className="rider-delivery-error" role="alert">{error}</p>}
        {message && <p className="rider-location-notice" role="status">{message}</p>}
        <button type="submit" className="seller-inline-action" disabled={saving || !photo || !recipientName.trim() || !recipientConfirmed}>{saving ? 'Saving…' : 'Save proof'}</button>
    </form>;
}

function RiderDeliveryTracking({ delivery }: { delivery: RiderDelivery }) {
    const [expanded, setExpanded] = React.useState(false);

    return <details className="rider-delivery-tracking" onToggle={(event) => setExpanded(event.currentTarget.open)}>
        <summary>Route &amp; live tracking</summary>
        {expanded && <DeliveryTrackingPanel
            deliveryId={delivery.id}
            sellerName={delivery.order.seller?.name ?? 'Seller'}
            buyerName={delivery.order.shipping_address?.recipient_name ?? delivery.order.buyer?.name ?? 'Buyer'}
            sellerLatitude={delivery.pickup_latitude}
            sellerLongitude={delivery.pickup_longitude}
            buyerLatitude={delivery.order.shipping_address?.latitude ?? null}
            buyerLongitude={delivery.order.shipping_address?.longitude ?? null}
        />}
    </details>;
}

function DeliveryVerification({ delivery, onVerified, onError, autoExpand = false, showSuccessMessage = true }: {
    delivery: RiderDelivery;
    onVerified: () => void;
    onError: (message: string) => void;
    autoExpand?: boolean;
    showSuccessMessage?: boolean;
}) {
    const [expanded, setExpanded] = React.useState(autoExpand);
    const [scanValue, setScanValue] = React.useState('');
    const [scanning, setScanning] = React.useState(false);
    const [scanningMessage, setScanningMessage] = React.useState('');
    const [verificationMessage, setVerificationMessage] = React.useState('');
    const [submitting, setSubmitting] = React.useState(false);
    const [videoReady, setVideoReady] = React.useState(false);
    const videoRef = React.useRef<HTMLVideoElement>(null);
    const streamRef = React.useRef<MediaStream | null>(null);
    const submittedRef = React.useRef(false);

    const expectedPurpose = ['RIDER_ACCEPTED', 'PICKUP_PENDING'].includes(delivery.status) ? 'pickup' : 'delivery';
    const action = expectedPurpose === 'pickup' ? 'Verify pickup' : 'Verify delivery';
    const parsedCode = qrCode(scanValue);
    const purposeMatches = parsedCode !== null && (parsedCode.purpose === 'order' || parsedCode.purpose === expectedPurpose);
    const proofRequired = expectedPurpose === 'delivery' && !delivery.has_delivery_proof;
    const scanValidationError = scanValue && !parsedCode
        ? 'QR code not recognized. Center a FARMGATE order QR in the frame and scan again.'
        : scanValue && !purposeMatches
            ? `This assignment requires a ${expectedPurpose} QR code. Scan the matching FARMGATE code.`
            : '';
    const scanResultMessage = !scanValue
        ? scanning && videoReady ? 'Camera is scanning for a FARMGATE QR code.' : 'Waiting for a live camera scan.'
        : scanValidationError
            ? 'A QR code was detected, but it is not valid for this assignment.'
            : proofRequired
                ? 'QR detected. Delivery photo proof is still required.'
                : 'FARMGATE QR detected. Secure token hidden.';
    const cameraStatus = scanValue
        ? scanValidationError ? 'QR not valid' : 'QR detected'
        : scanning
            ? videoReady ? 'Scanning live camera' : 'Connecting to camera…'
            : scanningMessage ? 'Camera unavailable' : 'Camera paused';
    const canVerify = Boolean(parsedCode && purposeMatches && !proofRequired && !scanning && !submitting);

    function cameraFailureMessage(cameraError: unknown): string {
        const errorName = cameraError instanceof Error ? cameraError.name : '';
        if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
            return 'Camera permission was denied. Allow camera access in your browser settings, then select Use camera to retry.';
        }
        if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
            return 'No camera was found. Connect or enable a camera, then select Use camera to retry.';
        }
        if (!navigator.mediaDevices?.getUserMedia) {
            return 'Camera access is unavailable in this browser. Use a camera-enabled browser and select Use camera to retry.';
        }
        return 'Camera could not start. Check camera availability and permissions, then select Use camera to retry.';
    }

    React.useEffect(() => {
        if (!scanning) return undefined;
        let cancelled = false;
        let stream: MediaStream | null = null;
        let timer: number | undefined;

        const startCamera = async () => {
            try {
                if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is not available in this browser.');
                stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
                if (cancelled || !videoRef.current) {
                    stream.getTracks().forEach((track) => track.stop());
                    return;
                }
                streamRef.current = stream;
                videoRef.current.srcObject = stream;
                await videoRef.current.play();
                setVideoReady(true);

                const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorFactory }).BarcodeDetector;
                if (!Detector) {
                    setScanningMessage('Automatic QR scanning is not supported in this browser. Open the Rider workspace in a supported browser, then select Use camera to retry.');
                    setScanning(false);
                    return;
                }
                const detector = new Detector({ formats: ['qr_code'] });
                timer = window.setInterval(async () => {
                    if (cancelled || !videoRef.current || submittedRef.current) return;
                    try {
                        const codes = await detector.detect(videoRef.current);
                        if (codes[0]?.rawValue) {
                            setScanValue(codes[0].rawValue);
                            setScanningMessage('');
                            setScanning(false);
                        }
                    } catch {
                        setScanningMessage('The camera could not read the QR code. Hold the FARMGATE code steady, or stop and restart the camera.');
                    }
                }, 700);
            } catch (cameraError) {
                if (!cancelled) {
                    setVideoReady(false);
                    setScanningMessage(cameraFailureMessage(cameraError));
                    setScanning(false);
                }
            }
        };

        void startCamera();
        return () => {
            cancelled = true;
            if (timer !== undefined) window.clearInterval(timer);
            stream?.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
            setVideoReady(false);
        };
    }, [scanning]);

    async function submitCode(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (submittedRef.current) return;
        const parsed = qrCode(scanValue);
        if (!parsed) {
            onError('Enter the complete FARMGATE order QR code.');
            return;
        }
        if (parsed.purpose !== 'order' && parsed.purpose !== expectedPurpose) {
            onError(`This delivery currently requires a ${expectedPurpose} QR code.`);
            return;
        }
        if (expectedPurpose === 'delivery' && !delivery.has_delivery_proof) {
            onError('Save delivery photo proof and recipient confirmation from My Deliveries before scanning the order QR at drop-off.');
            return;
        }
        setSubmitting(true);
        setVerificationMessage('');
        submittedRef.current = true;
        try {
            const endpoint = expectedPurpose === 'pickup'
                ? `/api/deliveries/${delivery.id}/pickup-verify`
                : `/api/deliveries/${delivery.id}/delivery-verify`;
            let position: GeolocationPosition | null = null;
            if (navigator.geolocation) {
                try {
                    position = await new Promise<GeolocationPosition>((resolve, reject) => {
                        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
                    });
                } catch (locationError) {
                    throw new Error('QR verification needs your current location. Allow location access and retry at the seller pickup or buyer delivery location.');
                }
            } else {
                throw new Error('Location services are unavailable in this browser. Enable location access to verify the pickup or delivery.');
            }
            await api.post(endpoint, {
                qr_token: parsed.token,
                latitude: position!.coords.latitude,
                longitude: position!.coords.longitude,
            });
            setScanValue('');
            setScanning(false);
            setVerificationMessage(`${expectedPurpose === 'pickup' ? 'Pickup' : 'Delivery'} QR verified successfully. Assignment status is updating.`);
            setExpanded(false);
            submittedRef.current = false;
            onVerified();
        } catch (requestError: any) {
            submittedRef.current = false;
            onError(requestError.userMessage ?? requestError.response?.data?.message ?? requestError.message ?? 'Delivery verification failed.');
        } finally {
            setSubmitting(false);
        }
    }

    if (!activeStatuses.has(delivery.status)) return null;

    return <div className="rider-verification">
        <button type="button" className="rider-qr-close" disabled={submitting} aria-expanded={expanded} onClick={() => { setScanning(false); setExpanded((open) => !open); }}>{expanded ? 'Close scanner' : 'Open camera scanner'}</button>
        {showSuccessMessage && verificationMessage && <p className="rider-qr-success" role="status">{verificationMessage}</p>}
        {expanded && <form className="rider-qr-form" onSubmit={(event) => void submitCode(event)}>
            <p className="rider-qr-instructions">Scan the assigned order QR at the {expectedPurpose === 'pickup' ? 'seller pickup' : 'buyer delivery'} location.</p>
            <p className="rider-qr-location-note"><RiderDeliveryIcon name="pin" />Location access is required and you must be within the configured distance of the saved pin.</p>
            <div className="rider-qr-scan-layout">
                <div className={`rider-qr-camera-field ${scanning ? 'is-scanning' : ''}`}>
                    <video ref={videoRef} className="rider-qr-video" playsInline muted aria-label="Live camera feed for QR scanning" />
                    <div className="rider-qr-camera-overlay" aria-hidden="true">
                        <div className="rider-qr-scan-frame">
                            <span className="rider-qr-frame-corner is-top-left" />
                            <span className="rider-qr-frame-corner is-top-right" />
                            <span className="rider-qr-frame-corner is-bottom-left" />
                            <span className="rider-qr-frame-corner is-bottom-right" />
                        </div>
                        <div className="rider-qr-camera-status"><RiderDeliveryIcon name="camera" /><span>{cameraStatus}</span></div>
                    </div>
                </div>
                <div className="rider-qr-controls">
                    <div className={`rider-qr-result ${scanValidationError ? 'has-error' : scanValue && !proofRequired ? 'is-ready' : ''}`} role="status" aria-live="polite">
                        <RiderDeliveryIcon name="qr" />
                        <div><strong>QR scan result</strong><span>{scanResultMessage}</span></div>
                    </div>
                    {scanValidationError && <p className="rider-qr-help" role="alert">{scanValidationError}</p>}
                    {scanningMessage && <p className="rider-qr-help" role="alert">{scanningMessage}</p>}
                    {proofRequired && <p className="rider-qr-proof-required"><RiderDeliveryIcon name="photo" />Capture and save delivery photo proof in My Deliveries before scanning at the buyer location.</p>}
                    <div className="rider-qr-actions">
                        <button type="button" className="rider-qr-camera-action" disabled={submitting || (scanning && !videoReady)} onClick={() => {
                            if (scanning) {
                                setScanning(false);
                            } else {
                                setScanValue('');
                                setScanningMessage('');
                                setScanning(true);
                            }
                        }}>
                            <RiderDeliveryIcon name="camera" />{scanning ? videoReady ? 'Stop camera' : 'Opening camera…' : 'Use camera'}
                        </button>
                        <button type="submit" className="rider-qr-verify-action" disabled={!canVerify} aria-busy={submitting}>
                            <RiderDeliveryIcon name="check" />{submitting ? 'Verifying…' : action}
                        </button>
                    </div>
                </div>
            </div>
        </form>}
    </div>;
}

function RiderDashboardContent({ user, onUserUpdated, onError, onLogout }: {
    user: User;
    onUserUpdated: (user: User) => void;
    onError: (message: string) => void;
    onLogout: () => void;
}) {
    const [page, setPage] = React.useState<RiderPage>(() => window.location.hash === '#notifications' ? 'notifications' : 'dashboard');
    const [mobileNavOpen, setMobileNavOpen] = useWorkspaceMobileMenu();
    const [deliveryTab, setDeliveryTab] = React.useState<RiderDeliveryTab>('nearby');
    const [deliveryTutorialOpen, setDeliveryTutorialOpen] = React.useState(false);
    const [summary, setSummary] = React.useState<RiderSummary | null>(null);
    const [summaryLoading, setSummaryLoading] = React.useState(true);
    const [summaryError, setSummaryError] = React.useState('');
    const [statusCounts, setStatusCounts] = React.useState<Record<string, number>>({});
    const [recentActivity, setRecentActivity] = React.useState<RiderActivity[]>([]);
    const summaryRequestIdRef = React.useRef(0);
    const [dashboardFrom, setDashboardFrom] = React.useState('');
    const [dashboardTo, setDashboardTo] = React.useState('');
    const [dashboardStatus, setDashboardStatus] = React.useState('');
    const [dashboardSearch, setDashboardSearch] = React.useState('');
    const [offers, setOffers] = React.useState<RiderOffer[]>([]);
    const [offersLoading, setOffersLoading] = React.useState(true);
    const [offersError, setOffersError] = React.useState('');
    const [riderLocation, setRiderLocation] = React.useState<{ latitude: number; longitude: number; updated_at: string | null } | null>(null);
    const [selectedOfferId, setSelectedOfferId] = React.useState<number | null>(null);
    const [actingOnOfferId, setActingOnOfferId] = React.useState<number | null>(null);
    const [locationUpdating, setLocationUpdating] = React.useState(false);
    const [riderNotifications, setRiderNotifications] = React.useState<RiderNotification[]>([]);
    const [notificationBulkReadCount, setNotificationBulkReadCount] = React.useState(0);
    const [notificationActionBusy, setNotificationActionBusy] = React.useState(false);
    const [notificationActionMessage, setNotificationActionMessage] = React.useState('');
    const [notice, setNotice] = React.useState('');
    const [deliveries, setDeliveries] = React.useState<RiderDelivery[]>([]);
    const [deliveryTotal, setDeliveryTotal] = React.useState(0);
    const [deliveryPage, setDeliveryPage] = React.useState(1);
    const [deliveryLastPage, setDeliveryLastPage] = React.useState(1);
    const [deliveryStatus, setDeliveryStatus] = React.useState('');
    const [deliverySearch, setDeliverySearch] = React.useState('');
    const [deliveriesLoading, setDeliveriesLoading] = React.useState(false);
    const [deliveryError, setDeliveryError] = React.useState('');
    const [deliveryRevision, setDeliveryRevision] = React.useState(0);
    const [scannerDeliveries, setScannerDeliveries] = React.useState<RiderDelivery[]>([]);
    const [selectedScannerDeliveryId, setSelectedScannerDeliveryId] = React.useState<number | null>(null);
    const [scannerLoading, setScannerLoading] = React.useState(false);
    const [scannerError, setScannerError] = React.useState('');
    const [scannerSuccessMessage, setScannerSuccessMessage] = React.useState('');
    const [navigationCounts, setNavigationCounts] = React.useState({ notifications: 0, chats: 0 });
    const [setupProgressVisible, setSetupProgressVisible] = React.useState(true);
    const setupProgressButtonRef = React.useRef<HTMLButtonElement>(null);
    const [activeConversationId, setActiveConversationId] = React.useState<number | undefined>();
    const [sharingDeliveryId, setSharingDeliveryId] = React.useState<number | null>(null);
    const [locationNotice, setLocationNotice] = React.useState('');
    const locationWatchRef = React.useRef<number | null>(null);
    const lastLocationPostedRef = React.useRef(0);
    const offerActionLockRef = React.useRef(false);
    const closeSetupProgress = React.useCallback(() => {
        setSetupProgressVisible(false);
        window.requestAnimationFrame(() => setupProgressButtonRef.current?.focus());
    }, []);
    const debouncedSearch = useDebouncedValue(deliverySearch);
    const debouncedDashboardSearch = useDebouncedValue(dashboardSearch);

    const refreshSummary = React.useCallback(async (reportFailure: boolean) => {
        const requestId = ++summaryRequestIdRef.current;
        setSummaryLoading(true);
        setSummaryError('');
        const [summaryResult, offersResult] = await Promise.allSettled([
            api.get<{
                    summary: RiderSummary;
                    status_counts: Record<string, number>;
                    recent_activity: RiderActivity[];
                }>('/api/dashboard/rider', {
                    params: {
                        from: dashboardFrom || undefined,
                        to: dashboardTo || undefined,
                        status: dashboardStatus || undefined,
                        search: debouncedDashboardSearch.trim() || undefined,
                    },
                }),
            api.get<{
                    offers: RiderOffer[];
                    rider_location: { latitude: number; longitude: number; updated_at: string | null } | null;
                }>('/api/riders/offers'),
        ]);
        if (requestId !== summaryRequestIdRef.current) return;

        const errors: string[] = [];

        if (summaryResult.status === 'fulfilled') {
            setSummary(summaryResult.value.data.summary);
            setStatusCounts(summaryResult.value.data.status_counts);
            setRecentActivity(summaryResult.value.data.recent_activity);
            setSummaryLoading(false);
            setSummaryError('');
        } else {
            setSummary(null);
            setStatusCounts({});
            setRecentActivity([]);
            setSummaryLoading(false);
            setSummaryError('Rider dashboard data could not be loaded.');
            errors.push('Rider dashboard data could not be loaded.');
        }

        if (offersResult.status === 'fulfilled') {
            setOffers(offersResult.value.data.offers);
            setRiderLocation(offersResult.value.data.rider_location);
            setOffersLoading(false);
            setOffersError('');
        } else {
            setOffersLoading(false);
            setOffersError('Nearby orders could not be loaded.');
            errors.push('Nearby orders could not be loaded.');
        }

        if (reportFailure && errors.length) onError(`${errors.join(' ')} Please try again.`);
    }, [dashboardFrom, dashboardStatus, dashboardTo, debouncedDashboardSearch, onError]);

    const refreshNavigationCounts = React.useCallback(async () => {
        try {
            const response = await api.get<{
                notifications: RiderNotification[];
                unread_count: number;
                unread_chat_count: number;
                bulk_read_count: number;
            }>('/api/notifications');
            setNavigationCounts({ notifications: response.data.unread_count, chats: response.data.unread_chat_count });
            setNotificationBulkReadCount(response.data.bulk_read_count ?? 0);
            setRiderNotifications(response.data.notifications.filter((notification) => [
                'rider_offer_available',
                'rider_assignment_confirmed',
                'delivery_proof_recorded',
            ].includes(notification.data.type ?? '')).slice(0, 5));
        } catch {
            // The navigation remains usable if badges are temporarily unavailable.
        }
    }, []);

    async function markRiderNotificationsRead(): Promise<void> {
        if (notificationActionBusy || notificationBulkReadCount === 0) return;
        setNotificationActionBusy(true);
        setNotificationActionMessage('');
        try {
            const response = await api.post<{ marked_count: number }>('/api/notifications/read');
            await refreshNavigationCounts();
            setNotificationActionMessage(response.data.marked_count
                ? `${response.data.marked_count} informational notification${response.data.marked_count === 1 ? '' : 's'} marked as read. Critical alerts remain unread until opened or acknowledged.`
                : 'There are no unread informational notifications to mark as read. Critical alerts remain unread until opened or acknowledged.');
        } catch (requestError) {
            setNotificationActionMessage(requestError instanceof Error && 'userMessage' in requestError && typeof requestError.userMessage === 'string'
                ? requestError.userMessage
                : 'Notifications could not be marked as read. Try again.');
        } finally {
            setNotificationActionBusy(false);
        }
    }

    React.useEffect(() => {
        if (offers.length === 0) {
            setSelectedOfferId(null);
        } else if (selectedOfferId === null || !offers.some((offer) => offer.id === selectedOfferId)) {
            setSelectedOfferId(offers[0].id);
        }
    }, [offers, selectedOfferId]);

    React.useEffect(() => {
        if (scannerDeliveries.length === 0) {
            setSelectedScannerDeliveryId(null);
        } else if (selectedScannerDeliveryId === null || !scannerDeliveries.some((delivery) => delivery.id === selectedScannerDeliveryId)) {
            setSelectedScannerDeliveryId(scannerDeliveries[0].id);
        }
    }, [scannerDeliveries, selectedScannerDeliveryId]);

    React.useEffect(() => {
        void refreshSummary(true);
        void refreshNavigationCounts();
        const interval = window.setInterval(() => {
            void refreshSummary(false);
            void refreshNavigationCounts();
        }, 15_000);
        return () => window.clearInterval(interval);
    }, [refreshNavigationCounts, refreshSummary]);

    React.useEffect(() => {
        if (page !== 'deliveries' || deliverySearch !== debouncedSearch) return undefined;
        let active = true;
        setDeliveriesLoading(true);
        setDeliveryError('');
        api.get<{ deliveries: Paginated<RiderDelivery> }>('/api/riders/deliveries', {
            params: { search: debouncedSearch.trim() || undefined, status: deliveryStatus || undefined, page: deliveryPage, per_page: 10 },
        }).then((response) => {
            if (!active) return;
            setDeliveries(response.data.deliveries.data);
            setDeliveryTotal(response.data.deliveries.total);
            setDeliveryLastPage(response.data.deliveries.last_page);
        }).catch((requestError: any) => {
            if (active) setDeliveryError(requestError.userMessage ?? 'Your deliveries could not be loaded.');
        }).finally(() => {
            if (active) setDeliveriesLoading(false);
        });
        return () => { active = false; };
    }, [deliveryPage, deliverySearch, deliveryStatus, debouncedSearch, deliveryRevision, page]);

    React.useEffect(() => {
        if (page !== 'deliveries' || deliveryTab !== 'scanner') return undefined;
        let active = true;
        setScannerLoading(true);
        setScannerError('');

        const loadActiveDeliveries = async () => {
            try {
                const activeDeliveryStatuses = ['RIDER_ACCEPTED', 'PICKUP_PENDING', 'PICKED_UP', 'IN_TRANSIT'];
                const groups = await Promise.all(activeDeliveryStatuses.map(async (status) => {
                    const records: RiderDelivery[] = [];
                    let currentPage = 1;
                    let lastPage = 1;
                    do {
                        const response = await api.get<{ deliveries: Paginated<RiderDelivery> }>('/api/riders/deliveries', {
                            params: { status, page: currentPage, per_page: 50 },
                        });
                        records.push(...response.data.deliveries.data);
                        lastPage = response.data.deliveries.last_page;
                        currentPage += 1;
                    } while (currentPage <= lastPage);
                    return records;
                }));
                if (!active) return;
                setScannerDeliveries(groups.flat());
            } catch (requestError: any) {
                if (active) {
                    setScannerDeliveries([]);
                    setScannerError(requestError.userMessage ?? 'Active deliveries could not be loaded for QR verification.');
                }
            } finally {
                if (active) setScannerLoading(false);
            }
        };

        void loadActiveDeliveries();
        return () => { active = false; };
    }, [deliveryRevision, deliveryTab, page]);

    React.useEffect(() => () => {
        if (locationWatchRef.current !== null) navigator.geolocation?.clearWatch(locationWatchRef.current);
    }, []);

    async function showConfirmedAssignment(offer: RiderOffer): Promise<boolean> {
        const response = await api.get<{ deliveries: Paginated<RiderDelivery> }>('/api/riders/deliveries', {
            params: { search: offer.delivery.order.order_reference, page: 1, per_page: 10 },
        });
        const assigned = response.data.deliveries.data.find((delivery) =>
            delivery.id === offer.delivery.id
            && delivery.order.order_reference === offer.delivery.order.order_reference
            && activeStatuses.has(delivery.status),
        );
        if (!assigned) return false;

        setNotice(`Farmgate confirms delivery ${assigned.delivery_reference} is assigned to you.`);
        setOffers((current) => current.filter((item) => item.id !== offer.id));
        setDeliverySearch(offer.delivery.order.order_reference);
        setDeliveryStatus('');
        setDeliveryPage(1);
        setDeliveries([assigned]);
        setDeliveryTotal(1);
        setDeliveryLastPage(1);
        setDeliveryError('');
        setDeliveriesLoading(false);
        setDeliveryTab('assigned');
        setPage('deliveries');

        return true;
    }

    async function acceptOffer(offer: RiderOffer) {
        if (offerActionLockRef.current) return;
        offerActionLockRef.current = true;
        try {
            const confirmed = await confirmAction({
                title: 'Accept this delivery?',
                text: `Order ${offer.delivery.order.order_reference} will be assigned only if it is still available.`,
                confirmText: 'Accept delivery',
            });
            if (!confirmed) return;

            setActingOnOfferId(offer.id);
            setNotice('');
            const response = await api.post<{ message: string; delivery: { id: number; status: string } }>(
                `/api/riders/offers/${offer.id}/accept`,
            );
            if (response.data.delivery.id !== offer.delivery.id || response.data.delivery.status !== 'RIDER_ACCEPTED') {
                throw new Error('Farmgate did not confirm the expected delivery assignment. Refresh My Deliveries before trying again.');
            }
            setNotice(`Delivery for order ${offer.delivery.order.order_reference} is now assigned to you.`);
            setOffers((current) => current.filter((item) => item.id !== offer.id));
            setDeliverySearch('');
            setDeliveryStatus('');
            setDeliveryPage(1);
            setDeliveries([]);
            setDeliveryError('');
            setDeliveriesLoading(true);
            setDeliveryTab('assigned');
            setPage('deliveries');
            refreshDeliveries();
            void refreshSummary(false);
            void refreshNavigationCounts();
        } catch (requestError: any) {
            const serverMessage = requestError.response?.data?.message;
            const message = requestError.response?.status === 409
                ? (serverMessage ?? 'This delivery is no longer available.')
                : requestError.userMessage ?? requestError.response?.data?.message ?? requestError.message ?? 'The delivery could not be accepted.';
            let assignmentConfirmed = false;
            try {
                assignmentConfirmed = await showConfirmedAssignment(offer);
            } catch {
                assignmentConfirmed = false;
            }
            if (!assignmentConfirmed) setNotice(`${message} Farmgate could not confirm an assignment; refresh Nearby Orders before retrying.`);
            void refreshSummary(false);
            void refreshNavigationCounts();
        } finally {
            setActingOnOfferId(null);
            offerActionLockRef.current = false;
        }
    }

    async function declineOffer(offer: RiderOffer) {
        if (offerActionLockRef.current) return;
        offerActionLockRef.current = true;
        try {
            const confirmed = await confirmAction({
                title: 'Decline this delivery offer?',
                text: `Order ${offer.delivery.order.order_reference} will be offered to other eligible riders.`,
                confirmText: 'Decline offer',
                danger: true,
            });
            if (!confirmed) return;

            setActingOnOfferId(offer.id);
            setNotice('');
            const response = await api.post<{ message: string; delivery: { status: string } }>(
                `/api/riders/offers/${offer.id}/decline`,
            );
            setNotice(response.data.delivery.status === 'WAITING_FOR_RIDER'
                ? `Offer declined. Order ${offer.delivery.order.order_reference} is awaiting another eligible rider.`
                : `Offer declined. Other eligible riders were notified for order ${offer.delivery.order.order_reference}.`);
            setOffers((current) => current.filter((item) => item.id !== offer.id));
            void refreshSummary(false);
            void refreshNavigationCounts();
        } catch (requestError: any) {
            const serverMessage = requestError.response?.data?.message;
            setNotice(requestError.response?.status === 409
                ? (serverMessage ?? 'This delivery offer is no longer available.')
                : requestError.userMessage ?? requestError.response?.data?.message ?? requestError.message ?? 'The delivery offer could not be declined.');
            void refreshSummary(false);
            void refreshNavigationCounts();
        } finally {
            setActingOnOfferId(null);
            offerActionLockRef.current = false;
        }
    }

    const updateRiderLocation = React.useCallback(async (reportFailure = true) => {
        if (!navigator.geolocation) {
            const message = 'This device does not support location access. Nearby delivery offers require a recent location.';
            setLocationNotice(message);
            if (reportFailure) onError(message);
            return;
        }

        setLocationUpdating(true);
        try {
            const position = await new Promise<GeolocationPosition>((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true,
                    maximumAge: 30_000,
                    timeout: 20_000,
                });
            });
            const { latitude, longitude } = position.coords;
            await api.post('/api/riders/location', { latitude, longitude });
            setRiderLocation({ latitude, longitude, updated_at: new Date().toISOString() });
            setLocationNotice('Your location was updated for nearby delivery offers.');
            await refreshSummary(false);
        } catch (requestError: any) {
            const message = requestError.userMessage ?? requestError.message ?? 'Your location could not be updated.';
            setLocationNotice(`${message} Nearby offers require a recent location; use Refresh my location to try again.`);
            if (reportFailure) onError(message);
        } finally {
            setLocationUpdating(false);
        }
    }, [onError, refreshSummary]);

    React.useEffect(() => {
        if (summary?.availability !== 'AVAILABLE') return undefined;

        void updateRiderLocation(false);
        const interval = window.setInterval(() => {
            void updateRiderLocation(false);
        }, 10 * 60 * 1000);

        return () => window.clearInterval(interval);
    }, [summary?.availability, updateRiderLocation]);

    function refreshDeliveries() {
        setDeliveryRevision((revision) => revision + 1);
    }

    function toggleLocationSharing(deliveryId: number) {
        if (sharingDeliveryId === deliveryId) {
            if (locationWatchRef.current !== null) navigator.geolocation.clearWatch(locationWatchRef.current);
            locationWatchRef.current = null;
            setSharingDeliveryId(null);
            setLocationNotice('Location sharing stopped.');
            return;
        }
        if (!navigator.geolocation) {
            onError('This device does not support location sharing.');
            return;
        }
        if (locationWatchRef.current !== null) navigator.geolocation.clearWatch(locationWatchRef.current);
        setLocationNotice('');
        setSharingDeliveryId(deliveryId);
        locationWatchRef.current = navigator.geolocation.watchPosition(async (position) => {
            if (Date.now() - lastLocationPostedRef.current < 10_000) return;
            lastLocationPostedRef.current = Date.now();
            try {
                await api.post(`/api/deliveries/${deliveryId}/location`, {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    observed_at: new Date(position.timestamp).toISOString(),
                });
                setLocationNotice('Your location is being shared with the buyer and seller.');
            } catch (requestError: any) {
                setLocationNotice('');
                onError(requestError.userMessage ?? 'Your live location could not be shared. Check the delivery assignment and try again.');
            }
        }, (geoError) => {
            setSharingDeliveryId(null);
            if (locationWatchRef.current !== null) navigator.geolocation.clearWatch(locationWatchRef.current);
            locationWatchRef.current = null;
            onError(geoError.message || 'Location permission is needed to share delivery progress.');
        }, { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 });
    }

    function openConversation(conversationId?: number) {
        setActiveConversationId(conversationId);
        setPage('chats');
    }

    React.useEffect(() => {
        const handleHashChange = () => {
            if (window.location.hash === '#notifications') setPage('notifications');
        };
        window.addEventListener('hashchange', handleHashChange);

        return () => window.removeEventListener('hashchange', handleHashChange);
    }, []);

    function openRiderDeliveries(search: string | number) {
        setDeliverySearch(String(search));
        setDeliveryStatus('');
        setDeliveryPage(1);
        setDeliveryTab('assigned');
        setPage('deliveries');
    }

    const isChat = page === 'chats';
    const pageTitle = navigation.find((item) => item.id === page)?.label ?? 'Dashboard';
    const selectedScannerDelivery = scannerDeliveries.find((delivery) => delivery.id === selectedScannerDeliveryId) ?? null;
    const badgeCount = (id: RiderPage) => id === 'notifications' ? navigationCounts.notifications : id === 'chats' ? navigationCounts.chats : 0;
    const statusTotal = Object.values(statusCounts).reduce((total, count) => total + count, 0);

    return <main className="admin-shell seller-shell rider-shell">
        <aside className={`admin-sidebar role-sidebar${mobileNavOpen ? ' mobile-open' : ''}`} onKeyDown={(event) => {
            if (event.key === 'Escape') setMobileNavOpen(false);
        }}>
            <WorkspaceMobileHeader
                role="rider"
                menuOpen={mobileNavOpen}
                controlsId="rider-mobile-navigation"
                onToggle={() => setMobileNavOpen((open) => !open)}
                location="Bongabong, Oriental Mindoro"
                notificationCount={navigationCounts.notifications}
                notificationsActive={page === 'notifications'}
                onOpenNotifications={() => { setPage('notifications'); setMobileNavOpen(false); }}
            />
            <div className="role-mobile-menu-panel" id="rider-mobile-navigation">
            <FarmgateBrand />
            <div className="admin-sidebar-label">RIDER PORTAL</div>
            <nav aria-label="Rider navigation">{navigation.map((item) => {
                const count = badgeCount(item.id);
                const mobileMenuExcluded = ['notifications', 'chats', 'listings'].includes(item.id);
                return <button type="button" key={item.id} className={`${page === item.id ? 'active' : ''}${item.id === 'notifications' ? ' admin-notifications-sidebar-link' : ''}${mobileMenuExcluded ? ' role-mobile-menu-excluded' : ''}`} aria-current={page === item.id ? 'page' : undefined} aria-label={count ? `${item.label}, ${count} unread` : item.label} onClick={() => { setPage(item.id); setNotice(''); setMobileNavOpen(false); }}>
                    <span className="nav-icon"><WorkspaceSidebarIcon name={item.id} /></span><span className="seller-nav-label">{item.label}</span><NavigationBadge count={count} />
                </button>;
            })}</nav>
            <button className="sidebar-logout" type="button" onClick={onLogout}>Log out <span>↗</span></button>
            </div>
        </aside>
        <section className="admin-content seller-content">
            <header className="admin-header workspace-banner-header"><div><p className="eyebrow">FARMGATE rider workspace</p><h1>{pageTitle}</h1><p>{page === 'earnings' ? 'Track your payouts and earning history.' : 'Manage your assigned deliveries and keep customers updated.'}</p></div><WorkspaceBannerArtwork /><div className="role-header-context"><WorkspaceNotificationsButton count={navigationCounts.notifications} active={page === 'notifications'} onClick={() => setPage('notifications')} /><WorkspaceAccountControl role="rider" userName={user.name} profilePhotoUrl={user.profile_photo_url} onOpenAccount={() => setPage('account')} /></div></header>
            {notice && <p className="rider-offer-notice" role="status">{notice}</p>}
            {page === 'dashboard' && <section className="role-dashboard rider-dashboard" aria-busy={summaryLoading}>
                <div className="rider-dashboard-heading">
                    <div><p className="eyebrow">Rider overview</p><h2>Delivery performance</h2><p>All totals and activity below use your assigned delivery records.</p></div>
                    <div className="rider-dashboard-actions">
                        <button type="button" onClick={() => setPage('reports')}>Open reports</button>
                        <button type="button" onClick={() => setPage('account')}>Manage availability</button>
                    </div>
                </div>
                <div className="rider-analytics-controls" role="search" aria-label="Filter rider analytics">
                    <label>Search order reference<input type="search" value={dashboardSearch} onChange={(event) => setDashboardSearch(event.target.value)} placeholder="Search reference" /></label>
                    <label>Delivery status<select value={dashboardStatus} onChange={(event) => setDashboardStatus(event.target.value)}>
                        <option value="">All statuses</option>
                        {riderStatuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
                    </select></label>
                    <label>From date<input type="date" value={dashboardFrom} max={dashboardTo || undefined} onChange={(event) => setDashboardFrom(event.target.value)} /></label>
                    <label>To date<input type="date" value={dashboardTo} min={dashboardFrom || undefined} onChange={(event) => setDashboardTo(event.target.value)} /></label>
                    <button type="button" onClick={() => { setDashboardSearch(''); setDashboardStatus(''); setDashboardFrom(''); setDashboardTo(''); }}>Clear filters</button>
                </div>
                {summaryError && <p className="rider-delivery-error" role="alert">{summaryError} <button type="button" onClick={() => void refreshSummary(true)}>Try again</button></p>}
                {summaryLoading && !summary ? <div className="rider-metric-grid rider-metric-grid-skeleton" role="status" aria-label="Loading rider dashboard">
                    {Array.from({ length: 8 }, (_, index) => <article className="rider-metric-skeleton" key={index}><span /><strong /></article>)}
                </div> : <div className="rider-metric-grid" aria-live="polite">
                    <article><span>Open offers</span><strong>{summary?.offers ?? '—'}</strong></article>
                    <article><span>Accepted assignments</span><strong>{summary?.accepted ?? '—'}</strong></article>
                    <article><span>Active deliveries</span><strong>{summary?.active ?? '—'}</strong></article>
                    <article><span>Delivered</span><strong>{summary?.delivered ?? '—'}</strong></article>
                    <article><span>Delivered with proof</span><strong>{summary?.delivered_with_proof ?? '—'}</strong></article>
                    <article><span>Delivered without proof</span><strong>{summary?.delivered_without_proof ?? '—'}</strong></article>
                    <article><span>Cancelled</span><strong>{summary?.cancellations ?? '—'}</strong></article>
                    <article><span>Avg. verified delivery time</span><strong>{summary?.average_delivery_minutes === undefined ? '—' : summary.average_delivery_minutes === null ? 'Not enough data' : `${summary.average_delivery_minutes} min`}</strong></article>
                </div>}
                <div className="rider-analytics-layout">
                    <section className="rider-analytics-card" aria-labelledby="rider-status-chart-heading">
                        <div className="rider-work-heading"><div><p className="eyebrow">Filtered deliveries</p><h3 id="rider-status-chart-heading">Status breakdown</h3></div><span>{summary ? `${summary.filtered_deliveries} ${summary.filtered_deliveries === 1 ? 'delivery' : 'deliveries'}` : '— deliveries'}</span></div>
                        {summaryLoading && !summary ? <LoadingSkeleton variant="list" count={3} label="Loading delivery status breakdown" /> : !summary ? <p className="rider-empty">Couldn’t load the status breakdown. Try again above.</p> : Object.keys(statusCounts).length === 0 ? <p className="rider-empty">No delivery activity for these filters.</p>
                            : <div className="rider-status-chart" role="list" aria-label="Delivery counts by status">
                                {Object.entries(statusCounts).sort(([first], [second]) => first.localeCompare(second)).map(([status, count]) => {
                                    const percentage = statusTotal ? count / statusTotal * 100 : 0;
                                    return <div className="rider-status-bar" role="listitem" key={status} aria-label={`${statusLabel(status)}: ${count} deliveries, ${Math.round(percentage)}% of filtered total`}>
                                        <span>{statusLabel(status)}</span><i aria-hidden="true"><b style={{ width: `${percentage}%` }} /></i><strong>{count}</strong><span className="rider-status-share">{Math.round(percentage)}%</span>
                                    </div>;
                                })}
                            </div>}
                    </section>
                    <section className="rider-analytics-card" aria-labelledby="rider-recent-activity-heading">
                        <div className="rider-work-heading"><div><p className="eyebrow">Recorded events</p><h3 id="rider-recent-activity-heading">Recent activity</h3></div></div>
                        {summaryLoading && !summary ? <LoadingSkeleton variant="list" count={3} label="Loading recent delivery activity" /> : !summary ? <p className="rider-empty">Couldn’t load recent delivery activity. Try again above.</p> : recentActivity.length === 0 ? <p className="rider-empty">No status changes match these filters.</p>
                            : <ol className="rider-activity-list">{recentActivity.map((activity) => <li key={activity.id}>
                                <span><strong>{activity.delivery_reference ?? activity.order_reference ?? 'Delivery'}</strong> · {statusLabel(activity.to_status)}</span>
                                <time>{activity.created_at ? new Date(activity.created_at).toLocaleString() : '—'}</time>
                            </li>)}</ol>}
                    </section>
                </div>
            </section>}
            {page === 'earnings' && <RiderEarningsPage onError={onError} />}
            {page === 'deliveries' && <section className="rider-deliveries" aria-label="Rider deliveries">
                <div className="rider-delivery-toolbar">
                    <RiderDeliveryTutorial
                        open={deliveryTutorialOpen}
                        onToggle={() => setDeliveryTutorialOpen((open) => !open)}
                        onDismiss={() => setDeliveryTutorialOpen(false)}
                        onDeliveryTabChange={setDeliveryTab}
                    />
                    <TabNav
                        label="Delivery workspace"
                        className="rider-delivery-tabs"
                        value={deliveryTab}
                        onChange={(value) => setDeliveryTab(value as RiderDeliveryTab)}
                        options={[
                            { value: 'nearby', label: <span className="rider-delivery-tab-label"><RiderDeliveryIcon name="pin" />Nearby Orders</span>, id: 'rider-delivery-tab-nearby' },
                            { value: 'assigned', label: <span className="rider-delivery-tab-label"><RiderDeliveryIcon name="truck" />My Deliveries</span>, id: 'rider-delivery-tab-assigned' },
                            { value: 'scanner', label: <span className="rider-delivery-tab-label"><RiderDeliveryIcon name="qr" />QR Scanner</span>, id: 'rider-delivery-tab-scanner' },
                            { value: 'history', label: <span className="rider-delivery-tab-label"><RiderDeliveryIcon name="history" />Delivery History</span>, id: 'rider-delivery-tab-history' },
                        ]}
                    />
                </div>
                {deliveryTab === 'nearby' && <section id="rider-nearby-workspace" className="rider-nearby-workspace" aria-labelledby="rider-offers-title" aria-live="polite">
                    <div className="rider-nearby-columns" aria-busy={offersLoading}>
                        <div className="rider-nearby-main">
                            <div className="rider-nearby-panel">
                                <div className="rider-nearby-heading">
                                    <div className="rider-nearby-title">
                                        <span className="rider-nearby-title-icon"><RiderDeliveryIcon name="pin" /></span>
                                        <div><p className="eyebrow">New assignments</p><h2 id="rider-offers-title">Nearby orders</h2><p>{offers.length} {offers.length === 1 ? 'order' : 'orders'} available to you</p></div>
                                    </div>
                                    <div className="rider-nearby-location">
                                        <span>{riderLocation?.updated_at
                                            ? `Location updated ${new Date(riderLocation.updated_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                                            : 'Share your location to center nearby requests'}</span>
                                        <button type="button" disabled={locationUpdating} onClick={() => void updateRiderLocation()}>
                                            <RiderDeliveryIcon name="refresh" />{locationUpdating ? 'Updating…' : riderLocation ? 'Refresh location' : 'Use my location'}
                                        </button>
                                    </div>
                                </div>
                                {locationNotice && <p className="rider-location-notice" role="status">{locationNotice}</p>}
                                {offersError && <p className="rider-delivery-error" role="alert">{offersError} <button type="button" onClick={() => void refreshSummary(true)}>Try again</button></p>}
                                <React.Suspense fallback={<div className="rider-nearby-map rider-map-loading" role="status">Loading map…</div>}>
                                    <NearbyOrdersMap offers={offers} selectedOfferId={selectedOfferId} riderLocation={riderLocation} onSelectOffer={setSelectedOfferId} />
                                </React.Suspense>
                                <p className="rider-map-privacy-note">P = pickup, D = approximate drop-off. Offer-map distances are approximate; checkout distance is the saved road route. Exact buyer details stay hidden until assignment.</p>
                                {offersLoading && offers.length === 0 ? <div className="rider-offer-skeletons" role="status" aria-label="Loading nearby orders">
                                    {Array.from({ length: 3 }, (_, index) => <div className="rider-offer-skeleton" key={index}><span /><span /><span /></div>)}
                                </div> : offersError && offers.length === 0 ? null : offers.length === 0 ? <div className="rider-offers-empty">
                                    <span className="rider-offers-empty-icon"><RiderDeliveryIcon name="truck" /></span>
                                    <div><h3>No nearby orders right now</h3><p>New eligible delivery offers will appear here when available in your area.</p>
                                        <details><summary>Why might there be no orders?</summary><p>Only standard-delivery orders marked Ready for Pickup with confirmed payment and a valid seller pickup location are offered to verified, available riders within the configured distance. Refreshing your location retries eligible expired offers.</p></details>
                                    </div>
                                </div> : <div className="rider-offers-list">{offers.map((offer) => {
                                    const selected = selectedOfferId === offer.id;
                                    return <article className={`rider-offer-card ${selected ? 'is-selected' : ''}`} key={offer.id}>
                                        <button type="button" className="rider-offer-select" aria-pressed={selected} onClick={() => setSelectedOfferId(offer.id)}>
                                            <span><strong>{offer.delivery.delivery_reference} · Order {offer.delivery.order.order_reference}</strong><small>{selected ? 'Selected on map' : 'Show this request on map'}</small></span>
                                            <span className="rider-offer-distance">{Number(offer.distance_km).toFixed(1)} km direct from rider at offer time</span>
                                        </button>
                                        <p><b>Pickup area:</b> {offer.delivery.pickup_area}</p>
                                        <p><b>Drop-off area:</b> {offer.delivery.order.dropoff_area}</p>
                                        <p><b>Checkout distance:</b> {offer.checkout_distance_km === null
                                            ? 'Not available'
                                            : `${Number(offer.checkout_distance_km).toFixed(1)} km (${offer.checkout_distance_method === 'OSRM_BARANGAY_ESTIMATE' ? 'barangay-level road distance estimate' : 'OSRM road route'})`}</p>
                                        <p><b>Buyer checkout delivery fee:</b> {offer.checkout_delivery_fee === null ? 'Not available' : `₱${Number(offer.checkout_delivery_fee).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</p>
                                        {offer.expires_at && <p className="rider-offer-expiry">Offer expires {new Date(offer.expires_at).toLocaleString()}</p>}
                                        <button type="button" disabled={actingOnOfferId !== null} aria-busy={actingOnOfferId === offer.id} onClick={() => void acceptOffer(offer)}>
                                            {actingOnOfferId === offer.id ? 'Accepting…' : 'Accept delivery'}
                                        </button>
                                        <button type="button" disabled={actingOnOfferId !== null} aria-busy={actingOnOfferId === offer.id} onClick={() => void declineOffer(offer)}>
                                            {actingOnOfferId === offer.id ? 'Updating…' : 'Decline offer'}
                                        </button>
                                    </article>;
                                })}</div>}
                            </div>
                        </div>
                        <aside className="rider-order-notifications" aria-labelledby="rider-order-notifications-title">
                            <header><span className="rider-order-notification-icon"><RiderDeliveryIcon name="bell" /></span><div><p className="eyebrow">Updates</p><h3 id="rider-order-notifications-title">Order Notifications</h3></div><NavigationBadge count={navigationCounts.notifications} /></header>
                            {navigationCounts.notifications > 0 && <div className="rider-notification-bulk-actions">
                                <button type="button" onClick={() => void markRiderNotificationsRead()} disabled={notificationActionBusy || notificationBulkReadCount === 0} aria-busy={notificationActionBusy}>
                                    {notificationActionBusy ? 'Marking…' : <><RiderDeliveryIcon name="check" />Mark all as read</>}
                                </button>
                                <p>Critical alerts remain unread until opened or acknowledged.</p>
                            </div>}
                            {notificationActionMessage && <p className="rider-notification-action-message" role="status">{notificationActionMessage}</p>}
                            <h4><RiderDeliveryIcon name="pin" />Nearby orders</h4>
                            {offersLoading && offers.length === 0 ? <p className="rider-notification-empty" role="status">Checking for nearby orders…</p>
                                : offersError && offers.length === 0 ? <p className="rider-notification-empty">Nearby orders are currently unavailable.</p>
                                    : offers.length === 0 ? <p className="rider-notification-empty">No open requests.</p> : offers.slice(0, 3).map((offer) => {
                                const unread = riderNotifications.some((item) => item.read_at === null
                                    && item.data.type === 'rider_offer_available'
                                    && item.data.order_reference === offer.delivery.order.order_reference);
                                return <button type="button" className="rider-order-notification" key={`offer-${offer.id}`} onClick={() => setSelectedOfferId(offer.id)}>
                                    <span className={`rider-notification-dot ${unread ? 'is-unread' : ''}`} aria-label={unread ? 'Unread' : 'Read'} />
                                    <span><strong>{offer.delivery.delivery_reference} · {offer.delivery.order.order_reference}</strong><small>{offer.delivery.order.dropoff_area}</small></span>
                                    <span className="rider-notification-state">Available</span>
                                </button>;
                            })}
                            <h4><RiderDeliveryIcon name="truck" />Assignment updates</h4>
                            {riderNotifications.filter((item) => item.data.type === 'rider_assignment_confirmed').length === 0
                                ? <p className="rider-notification-empty">No assignment confirmations yet.</p>
                                : riderNotifications.filter((item) => item.data.type === 'rider_assignment_confirmed').slice(0, 3).map((item) => (
                                    <div className="rider-order-notification" key={item.id}>
                                        <span className={`rider-notification-dot ${item.read_at === null ? 'is-unread' : ''}`} aria-label={item.read_at === null ? 'Unread' : 'Read'} />
                                        <span><strong>{item.data.delivery_reference ?? item.data.order_reference ?? 'Assignment confirmed'}</strong><small>{item.data.message ?? 'Your delivery acceptance is confirmed.'}</small></span>
                                        <time>{new Date(item.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
                                    </div>
                                ))}
                            <button type="button" className="rider-notifications-link" onClick={() => setPage('notifications')}>View all notifications <RiderDeliveryIcon name="arrow" /></button>
                        </aside>
                    </div>
                </section>}
                {deliveryTab === 'assigned' && <section id="rider-assigned-deliveries" className="rider-assigned-deliveries" aria-label="My assigned deliveries">
                    <RiderRemittancePanel key={deliveryRevision} onSubmitted={() => setDeliveryRevision((revision) => revision + 1)} />
                    <div className="rider-delivery-filters" role="search" aria-label="Filter my deliveries">
                        <label><span className="rider-delivery-filter-label"><RiderDeliveryIcon name="search" />Search deliveries</span><span className="rider-delivery-filter-control"><input type="search" value={deliverySearch} onChange={(event) => { setDeliverySearch(event.target.value); setDeliveryPage(1); }} placeholder="Delivery or order reference, buyer, or seller" /></span></label>
                        <label><span className="rider-delivery-filter-label"><RiderDeliveryIcon name="filter" />Delivery status</span><select value={deliveryStatus} onChange={(event) => { setDeliveryStatus(event.target.value); setDeliveryPage(1); }}><option value="">All statuses</option>{riderStatuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label>
                    </div>
                    {deliveryError && deliveries.length > 0 && <p className="rider-delivery-error" role="alert">{deliveryError} <button type="button" onClick={() => setDeliveryRevision((revision) => revision + 1)}>Try again</button></p>}
                    {deliveriesLoading ? <div className="rider-delivery-skeletons" role="status" aria-label="Loading assigned deliveries">
                        {Array.from({ length: 3 }, (_, index) => <article className="rider-delivery-skeleton" key={index}><span /><span /><span /></article>)}
                    </div> : deliveryError && deliveries.length === 0 ? <div className="rider-deliveries-empty rider-deliveries-load-error" role="alert"><h3>Deliveries couldn’t be loaded</h3><p>Try again to refresh your assigned deliveries.</p><button type="button" className="seller-inline-action" onClick={() => setDeliveryRevision((revision) => revision + 1)}>Try again</button></div>
                        : deliveries.length === 0 ? <div className="rider-deliveries-empty"><h3>No matching deliveries</h3><p>Accepted assignments appear here. Try a different filter or search.</p></div>
                        : <div className="rider-delivery-groups">{riderStatuses.map((status) => {
                            const group = deliveries.filter((delivery) => delivery.status === status);
                            if (group.length === 0) return null;
                            return <section className="rider-delivery-group" key={status} aria-labelledby={`delivery-status-${status}`}>
                                <h3 id={`delivery-status-${status}`}><RiderDeliveryIcon name="truck" />{statusLabel(status)} <span className="rider-delivery-group-count">{group.length}</span></h3>
                                <div className="rider-delivery-list">{group.map((delivery) => <article className="rider-delivery-card rider-assigned-delivery-card" key={delivery.id}>
                                    <div className="rider-assigned-card-details">
                                        <div className="rider-delivery-card-heading rider-assigned-card-heading">
                                            <div className="rider-assigned-reference">
                                                <span className="rider-assigned-card-icon"><RiderDeliveryIcon name="truck" /></span>
                                                <div className="rider-assigned-reference-text">
                                                    <p className="eyebrow">Delivery reference</p>
                                                    <strong className="rider-assigned-delivery-reference">{delivery.delivery_reference}</strong>
                                                    <span className="rider-assigned-order-reference"><RiderDeliveryIcon name="order" />Order {delivery.order.order_reference}</span>
                                                </div>
                                            </div>
                                            <span className={`rider-delivery-status rider-delivery-status--${delivery.status.toLowerCase()}`}>
                                                {delivery.status === 'DELIVERED' && <RiderDeliveryIcon name="check" />}{statusLabel(delivery.status)}
                                            </span>
                                        </div>
                                        <p className="rider-delivery-route"><RiderDeliveryIcon name="route" />{delivery.order.delivery_distance_km !== null
                                            ? <>{Number(delivery.order.delivery_distance_km).toFixed(2)} km <span>·</span> Fee ₱{Number(delivery.order.delivery_fee).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>
                                            : 'Saved route distance and fee unavailable'}</p>
                                        <div className="rider-delivery-addresses">
                                            <p><b><RiderDeliveryIcon name="pin" />Pickup</b><span title={delivery.pickup_address ?? delivery.order.seller?.name ?? 'Seller location'}>{delivery.pickup_address ?? delivery.order.seller?.name ?? 'Seller location'}</span></p>
                                            <p><b><RiderDeliveryIcon name="pin" />Drop-off</b><span title={locationFor(delivery.order)}>{locationFor(delivery.order)}</span></p>
                                            <p><b><RiderDeliveryIcon name="buyer" />Buyer</b><span title={`${delivery.order.shipping_address?.recipient_name ?? delivery.order.buyer?.name ?? 'Buyer'}${delivery.order.buyer?.phone_number ? ` · ${delivery.order.buyer.phone_number}` : ''}`}>{delivery.order.shipping_address?.recipient_name ?? delivery.order.buyer?.name ?? 'Buyer'}{delivery.order.buyer?.phone_number ? ` · ${delivery.order.buyer.phone_number}` : ''}</span></p>
                                        </div>
                                        {activeStatuses.has(delivery.status) && <div className="rider-delivery-actions">
                                            <button type="button" className="seller-inline-action" onClick={() => toggleLocationSharing(delivery.id)}><RiderDeliveryIcon name="pin" />{sharingDeliveryId === delivery.id ? 'Stop sharing location' : 'Share live location'}</button>
                                        </div>}
                                        {sharingDeliveryId === delivery.id && locationNotice && <p className="rider-location-notice" role="status">{locationNotice}</p>}
                                    </div>
                                    {(delivery.order.payment_method === 'COD' || ['PICKED_UP', 'IN_TRANSIT', 'DELIVERED'].includes(delivery.status)) && <div className="rider-assigned-card-workflow">
                                        <CodCollectionAction delivery={delivery} onSaved={() => {
                                            refreshDeliveries();
                                            void refreshSummary(false);
                                            setDeliveryRevision((revision) => revision + 1);
                                        }} />
                                        <DeliveryProofCapture delivery={delivery} onSaved={() => {
                                            refreshDeliveries();
                                            void refreshSummary(false);
                                        }} />
                                        {delivery.status === 'DELIVERED' && <DeliveryProofSummary
                                            deliveryId={delivery.id}
                                            hasProof={delivery.has_delivery_proof ?? false}
                                            recipientConfirmed={delivery.recipient_confirmed}
                                            recipientName={delivery.delivery_recipient_name}
                                            capturedAt={delivery.proof_captured_at}
                                            recordedAt={delivery.proof_recorded_at}
                                            showMetadataIcons
                                        />}
                                    </div>}
                                    <aside className="rider-assigned-order-total"><span>Order total</span><strong>₱{Number(delivery.order.total_amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></aside>
                                    {activeStatuses.has(delivery.status) && <div className="rider-assigned-card-tracking"><RiderDeliveryTracking delivery={delivery} /></div>}
                                </article>)}</div>
                            </section>;
                        })}</div>}
                    <div className="rider-delivery-pagination" aria-live="polite">
                        <span>{deliveriesLoading ? 'Loading assigned deliveries…' : deliveryError && deliveries.length === 0 ? 'Assigned delivery count unavailable' : `${deliveryTotal} assigned ${deliveryTotal === 1 ? 'delivery' : 'deliveries'}${deliveryTotal > 0 ? ` · Page ${deliveryPage} of ${deliveryLastPage}` : ''}`}</span>
                        {!deliveriesLoading && deliveryTotal > 0 && deliveryLastPage > 1 && <Pagination page={deliveryPage} lastPage={deliveryLastPage} onChange={setDeliveryPage} />}
                    </div>
                </section>}
                {deliveryTab === 'scanner' && <section id="rider-qr-scanner" className="rider-qr-scanner" aria-labelledby="rider-qr-scanner-title">
                    <div className="rider-work-heading"><div><p className="eyebrow">Assigned deliveries only</p><h3 id="rider-qr-scanner-title">QR Scanner</h3><p>Choose an active assignment to verify pickup or delivery.</p></div><button type="button" className="seller-inline-action rider-qr-refresh-action" aria-label={scannerLoading ? 'Refreshing assignments' : 'Refresh assignments'} disabled={scannerLoading} aria-busy={scannerLoading} onClick={() => { setScannerSuccessMessage(''); refreshDeliveries(); }}><RiderDeliveryIcon name="refresh" /><span className="rider-qr-refresh-label">{scannerLoading ? 'Refreshing…' : 'Refresh assignments'}</span></button></div>
                    {scannerError && <p className="rider-delivery-error" role="alert">{scannerError}</p>}
                    {scannerSuccessMessage && <p className="rider-qr-success" role="status">{scannerSuccessMessage}</p>}
                    {scannerLoading ? <LoadingSkeleton variant="list" count={3} label="Loading active assignments" />
                        : scannerDeliveries.length === 0 ? <div className="rider-deliveries-empty"><h4>No active assigned deliveries</h4><p>Accept a delivery first. Nearby, unassigned requests cannot be scanned or verified.</p></div>
                            : <div className="rider-qr-scanner-content">
                                <label className="rider-scanner-assignment"><span><RiderDeliveryIcon name="truck" />Assigned delivery</span>
                                    <select value={selectedScannerDeliveryId ?? ''} onChange={(event) => { setSelectedScannerDeliveryId(Number(event.target.value)); setScannerSuccessMessage(''); }}>
                                        {scannerDeliveries.map((delivery) => <option key={delivery.id} value={delivery.id}>
                                            {delivery.delivery_reference} · {delivery.order.order_reference} · {statusLabel(delivery.status)}
                                        </option>)}
                                    </select>
                                </label>
                                {selectedScannerDelivery && <div className="rider-qr-workspace">
                                    <article className="rider-qr-delivery-summary" aria-label="Selected assigned delivery">
                                        <div className="rider-qr-summary-heading">
                                            <span className="rider-qr-summary-icon"><RiderDeliveryIcon name="truck" /></span>
                                            <div>
                                                <p className="eyebrow">Delivery reference</p>
                                                <strong>{selectedScannerDelivery.delivery_reference}</strong>
                                                <span className="rider-qr-order-reference"><RiderDeliveryIcon name="order" />Order {selectedScannerDelivery.order.order_reference}</span>
                                            </div>
                                        </div>
                                        <span className={`rider-delivery-status rider-delivery-status--${selectedScannerDelivery.status.toLowerCase()}`}>{statusLabel(selectedScannerDelivery.status)}</span>
                                        <div className="rider-qr-summary-details">
                                            <p><span><RiderDeliveryIcon name="order" />Order total</span><strong>₱{Number(selectedScannerDelivery.order.total_amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></p>
                                            <p><span><RiderDeliveryIcon name="pin" />Pickup</span><strong>{selectedScannerDelivery.pickup_address ?? selectedScannerDelivery.order.seller?.name ?? 'Seller location'}</strong></p>
                                            <p><span><RiderDeliveryIcon name="pin" />Drop-off</span><strong>{locationFor(selectedScannerDelivery.order)}</strong></p>
                                            <p><span><RiderDeliveryIcon name="buyer" />Buyer</span><strong>{selectedScannerDelivery.order.shipping_address?.recipient_name ?? selectedScannerDelivery.order.buyer?.name ?? 'Buyer'}{selectedScannerDelivery.order.buyer?.phone_number ? ` · ${selectedScannerDelivery.order.buyer.phone_number}` : ''}</strong></p>
                                        </div>
                                    </article>
                                    <section className="rider-qr-scan-panel" aria-labelledby="rider-qr-scan-panel-title">
                                        <header className="rider-qr-scan-heading">
                                            <span className="rider-qr-panel-icon"><RiderDeliveryIcon name="qr" /></span>
                                            <div><p className="eyebrow">Camera verification</p><h4 id="rider-qr-scan-panel-title">Scan order QR</h4></div>
                                        </header>
                                        <DeliveryVerification
                                            delivery={selectedScannerDelivery}
                                            autoExpand
                                            showSuccessMessage={false}
                                            onVerified={() => {
                                                const purpose = ['RIDER_ACCEPTED', 'PICKUP_PENDING'].includes(selectedScannerDelivery.status) ? 'Pickup' : 'Delivery';
                                                setScannerSuccessMessage(`${purpose} QR verified successfully. Assigned delivery status is refreshing.`);
                                                refreshDeliveries();
                                                void refreshSummary(false);
                                            }}
                                            onError={onError}
                                        />
                                    </section>
                                </div>}
                            </div>}
                </section>}
                {deliveryTab === 'history' && <div id="rider-delivery-history"><ReportPanel role="RIDER" onError={onError} title="Delivery History" hideTypeSelector /></div>}
            </section>}
            {page === 'chats' && <AIChatPage role="RIDER" initialConversationId={activeConversationId} onBack={() => setPage('dashboard')} />}
            {page === 'reports' && <ReportPanel role="RIDER" onError={onError} />}
            {page === 'events' && <SystemCalendar role="RIDER" onError={onError} onOpenDelivery={(_, orderReference) => openRiderDeliveries(orderReference ?? '')} />}
            {page === 'notifications' && <NotificationsPage role="RIDER" onOpenOrder={(orderId, orderReference) => openRiderDeliveries(orderReference ?? orderId)} onOpenConversation={openConversation} onOpenEvent={(eventId) => { window.history.pushState({}, '', `#calendar/event/${eventId}`); setPage('events'); }} onNotificationsRead={refreshNavigationCounts} />}
            {page === 'account' && <RiderAccountSettings
                user={user}
                onUserUpdated={onUserUpdated}
                onError={onError}
                setupProgressVisible={setupProgressVisible}
                setupProgressButtonRef={setupProgressButtonRef}
                onToggleSetupProgress={() => setSetupProgressVisible((visible) => !visible)}
                onCloseSetupProgress={closeSetupProgress}
                onReviewTutorial={() => {
                    setDeliveryTab('nearby');
                    setDeliveryTutorialOpen(true);
                    setPage('deliveries');
                }}
            />}
            {isChat && <span className="sr-only" aria-live="polite">Rider chats workspace</span>}
        </section>
        <RoleMobileBottomNavigation
            items={riderMobileDestinations}
            activeId={page}
            navigationLabel="Key rider destinations"
            onNavigate={(destination) => { setPage(destination); setNotice(''); setMobileNavOpen(false); }}
        />
    </main>;
}

class RiderDashboardBoundary extends React.Component<{
    children: React.ReactNode;
}, { hasError: boolean }> {
    state = { hasError: false };

    static getDerivedStateFromError(): { hasError: boolean } {
        return { hasError: true };
    }

    componentDidCatch(): void {
        console.error('Rider workspace rendering failed.');
    }

    render() {
        if (this.state.hasError) {
            return <main className="admin-shell seller-shell rider-shell">
                <section className="admin-content seller-content rider-workspace-fallback" role="alert">
                    <h1>Rider workspace could not be displayed</h1>
                    <p>Refresh the page and try again. Check your recent activity before repeating an action.</p>
                    <button type="button" onClick={() => window.location.reload()}>Refresh page</button>
                </section>
            </main>;
        }

        return this.props.children;
    }
}

export function RiderDashboard(props: React.ComponentProps<typeof RiderDashboardContent>) {
    return <RiderDashboardBoundary><RiderDashboardContent {...props} /></RiderDashboardBoundary>;
}
