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

const NearbyOrdersMap = React.lazy(() => import('./NearbyOrdersMap').then((module) => ({ default: module.NearbyOrdersMap })));

type RiderPage = 'dashboard' | 'deliveries' | 'chats' | 'reports' | 'notifications' | 'account';
type RiderDeliveryTab = 'nearby' | 'assigned' | 'scanner' | 'history';
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
    data: { type?: string; order_reference?: string; message?: string; offer_id?: number; has_delivery_proof?: boolean };
    read_at: string | null;
    created_at: string;
};
type RiderActivity = {
    id: number;
    order_reference: string | null;
    from_status: string | null;
    to_status: string;
    reason: string | null;
    created_at: string | null;
};
type RiderDelivery = {
    id: number;
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
    { id: 'deliveries', label: 'Deliveries', icon: '▣' },
    { id: 'chats', label: 'Chats', icon: '✦' },
    { id: 'reports', label: 'Reports', icon: '▥' },
    { id: 'notifications', label: 'Notifications', icon: '♧' },
    { id: 'account', label: 'Settings', icon: '◉' },
];

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

function DeliveryProofCapture({ delivery, onSaved }: { delivery: RiderDelivery; onSaved: () => void }) {
    const [photo, setPhoto] = React.useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = React.useState('');
    const [recipientName, setRecipientName] = React.useState('');
    const [recipientConfirmed, setRecipientConfirmed] = React.useState(false);
    const [capturedAt, setCapturedAt] = React.useState('');
    const [saving, setSaving] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const [error, setError] = React.useState('');
    const inputRef = React.useRef<HTMLInputElement>(null);

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
        setError('');
        setMessage('');
        setPhoto(file);
        setCapturedAt(file ? new Date().toISOString() : '');
    }

    async function saveProof(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!photo || !recipientName.trim() || !recipientConfirmed || saving) {
            setError('Capture a delivery photo, enter the recipient name, and confirm receipt before saving.');
            return;
        }
        setSaving(true);
        setError('');
        setMessage('');
        const formData = new FormData();
        formData.append('photo', photo);
        formData.append('recipient_name', recipientName.trim());
        formData.append('recipient_confirmed', '1');
        formData.append('captured_at', capturedAt);
        try {
            const response = await api.post<{ message: string }>(`/api/deliveries/${delivery.id}/proof`, formData);
            setMessage(response.data.message);
            setPhoto(null);
            setRecipientName('');
            setRecipientConfirmed(false);
            setCapturedAt('');
            if (inputRef.current) inputRef.current.value = '';
            onSaved();
        } catch (requestError: any) {
            setError(requestError.userMessage ?? requestError.response?.data?.message ?? 'Delivery proof could not be saved. Check your connection and try again.');
        } finally {
            setSaving(false);
        }
    }

    if (!activeStatuses.has(delivery.status) || !['PICKED_UP', 'IN_TRANSIT'].includes(delivery.status)) return null;
    if (delivery.has_delivery_proof) return <p className="rider-proof-saved" role="status">Delivery photo and recipient confirmation are saved. Scan the same order QR at the buyer location to complete delivery.</p>;

    return <form className="rider-proof-capture" onSubmit={(event) => void saveProof(event)}>
        <h4>Delivery proof</h4>
        <p>Capture and save a delivery photo with recipient confirmation before scanning the order QR at drop-off.</p>
        {previewUrl ? <div className="rider-proof-preview">
            <img src={previewUrl} alt="Preview of delivery proof photo" />
            <div><button type="button" className="seller-inline-action" disabled={saving} onClick={() => {
                selectPhoto(null);
                if (inputRef.current) inputRef.current.value = '';
            }}>Retake photo</button><span>Review the photo before saving.</span></div>
        </div> : <label className="rider-proof-photo-control">Capture delivery photo
            <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" required onChange={(event) => selectPhoto(event.target.files?.[0] ?? null)} />
        </label>}
        <p className="rider-qr-help">If camera access is denied, allow camera permission in your browser settings or choose a saved photo with the same control.</p>
        <label>Recipient name<input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} required maxLength={120} autoComplete="name" /></label>
        <label className="rider-proof-confirmation"><input type="checkbox" checked={recipientConfirmed} onChange={(event) => setRecipientConfirmed(event.target.checked)} required />Recipient confirmed they received this order.</label>
        {error && <p className="rider-delivery-error" role="alert">{error}</p>}
        {message && <p className="rider-location-notice" role="status">{message}</p>}
        <button type="submit" className="seller-inline-action" disabled={saving || !photo || !recipientName.trim() || !recipientConfirmed}>{saving ? 'Saving proof…' : 'Confirm and save proof'}</button>
    </form>;
}

function DeliveryVerification({ delivery, onVerified, onError, autoExpand = false }: {
    delivery: RiderDelivery;
    onVerified: () => void;
    onError: (message: string) => void;
    autoExpand?: boolean;
}) {
    const [expanded, setExpanded] = React.useState(autoExpand);
    const [scanValue, setScanValue] = React.useState('');
    const [scanning, setScanning] = React.useState(false);
    const [scanningMessage, setScanningMessage] = React.useState('');
    const [submitting, setSubmitting] = React.useState(false);
    const [videoReady, setVideoReady] = React.useState(false);
    const videoRef = React.useRef<HTMLVideoElement>(null);
    const streamRef = React.useRef<MediaStream | null>(null);
    const submittedRef = React.useRef(false);

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
                    setScanningMessage('Automatic QR scanning is not supported here. Paste or type the QR value below.');
                    return;
                }
                const detector = new Detector({ formats: ['qr_code'] });
                timer = window.setInterval(async () => {
                    if (cancelled || !videoRef.current || submittedRef.current) return;
                    try {
                        const codes = await detector.detect(videoRef.current);
                        if (codes[0]?.rawValue) {
                            setScanValue(codes[0].rawValue);
                            setScanning(false);
                        }
                    } catch {
                        setScanningMessage('The camera could not read that QR code. Hold it steady or enter the code manually.');
                    }
                }, 700);
            } catch (cameraError) {
                setScanningMessage(cameraError instanceof Error ? cameraError.message : 'Camera access failed. Enter the QR value manually.');
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
        if (submitting) return;
        const parsed = qrCode(scanValue);
        if (!parsed) {
            onError('Enter the complete FARMGATE order QR code.');
            return;
        }
        const expectedPurpose = ['RIDER_ACCEPTED', 'PICKUP_PENDING'].includes(delivery.status) ? 'pickup' : 'delivery';
        if (parsed.purpose !== 'order' && parsed.purpose !== expectedPurpose) {
            onError(`This delivery currently requires a ${expectedPurpose} QR code.`);
            return;
        }
        if (expectedPurpose === 'delivery' && !delivery.has_delivery_proof) {
            onError('Save delivery photo proof and recipient confirmation from My Deliveries before scanning the order QR at drop-off.');
            return;
        }
        setSubmitting(true);
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
            setExpanded(false);
            onVerified();
        } catch (requestError: any) {
            submittedRef.current = false;
            onError(requestError.userMessage ?? requestError.response?.data?.message ?? requestError.message ?? 'Delivery verification failed.');
        } finally {
            setSubmitting(false);
        }
    }

    if (!activeStatuses.has(delivery.status)) return null;
    const action = ['RIDER_ACCEPTED', 'PICKUP_PENDING'].includes(delivery.status) ? 'Verify pickup' : 'Verify delivery';

    return <div className="rider-verification">
        <button type="button" className="rider-inline-action" onClick={() => { setScanning(false); setExpanded((open) => !open); }}>{expanded ? 'Close scanner' : action}</button>
        {expanded && <form className="rider-qr-form" onSubmit={(event) => void submitCode(event)}>
            <p>{action === 'Verify pickup'
                ? 'Scan the order QR and allow location access. Pickup must be within the configured distance of the seller pin.'
                : 'After saving proof in My Deliveries, scan the same order QR at the buyer location. Location access is required and must be within the configured distance of the saved pin.'}</p>
            <video ref={videoRef} className="rider-qr-video" playsInline muted aria-label="Camera QR scanner" />
            {videoReady && scanningMessage === '' && <p role="status">Point the rear camera at the FARMGATE QR code.</p>}
            {scanningMessage && <p className="rider-qr-help" role="status">{scanningMessage}</p>}
            <label>QR value<input value={scanValue} onChange={(event) => setScanValue(event.target.value)} autoComplete="off" placeholder="FARMGATE:ORDER:…" /></label>
            {action === 'Verify delivery' && <p className="rider-qr-help">Proof {delivery.has_delivery_proof ? 'is saved' : 'is not saved yet'}; use My Deliveries to capture and save the photo first.</p>}
            <div className="rider-qr-actions">
                <button type="button" onClick={() => { setScanning((value) => !value); setScanningMessage(''); }}>{scanning ? 'Stop camera' : 'Use camera'}</button>
                <button type="submit" disabled={submitting || !scanValue.trim()}>{submitting ? 'Verifying…' : action}</button>
            </div>
        </form>}
    </div>;
}

export function RiderDashboard({ user, onUserUpdated, onError, onLogout }: {
    user: User;
    onUserUpdated: (user: User) => void;
    onError: (message: string) => void;
    onLogout: () => void;
}) {
    const [page, setPage] = React.useState<RiderPage>('dashboard');
    const [deliveryTab, setDeliveryTab] = React.useState<RiderDeliveryTab>('nearby');
    const [summary, setSummary] = React.useState<RiderSummary | null>(null);
    const [statusCounts, setStatusCounts] = React.useState<Record<string, number>>({});
    const [recentActivity, setRecentActivity] = React.useState<RiderActivity[]>([]);
    const [dashboardFrom, setDashboardFrom] = React.useState('');
    const [dashboardTo, setDashboardTo] = React.useState('');
    const [dashboardStatus, setDashboardStatus] = React.useState('');
    const [dashboardSearch, setDashboardSearch] = React.useState('');
    const [offers, setOffers] = React.useState<RiderOffer[]>([]);
    const [riderLocation, setRiderLocation] = React.useState<{ latitude: number; longitude: number; updated_at: string | null } | null>(null);
    const [selectedOfferId, setSelectedOfferId] = React.useState<number | null>(null);
    const [actingOnOfferId, setActingOnOfferId] = React.useState<number | null>(null);
    const [locationUpdating, setLocationUpdating] = React.useState(false);
    const [riderNotifications, setRiderNotifications] = React.useState<RiderNotification[]>([]);
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
    const [navigationCounts, setNavigationCounts] = React.useState({ notifications: 0, chats: 0 });
    const [activeConversationId, setActiveConversationId] = React.useState<number | undefined>();
    const [sharingDeliveryId, setSharingDeliveryId] = React.useState<number | null>(null);
    const [locationNotice, setLocationNotice] = React.useState('');
    const locationWatchRef = React.useRef<number | null>(null);
    const lastLocationPostedRef = React.useRef(0);
    const debouncedSearch = useDebouncedValue(deliverySearch);
    const debouncedDashboardSearch = useDebouncedValue(dashboardSearch);

    const refreshSummary = React.useCallback(async (reportFailure: boolean) => {
        try {
            const [summaryResponse, offersResponse] = await Promise.all([
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
            setSummary(summaryResponse.data.summary);
            setStatusCounts(summaryResponse.data.status_counts);
            setRecentActivity(summaryResponse.data.recent_activity);
            setOffers(offersResponse.data.offers);
            setRiderLocation(offersResponse.data.rider_location);
        } catch {
            if (reportFailure) onError('Rider dashboard data could not be loaded. Please try again.');
        }
    }, [dashboardFrom, dashboardStatus, dashboardTo, debouncedDashboardSearch, onError]);

    const refreshNavigationCounts = React.useCallback(async () => {
        try {
            const response = await api.get<{
                notifications: RiderNotification[];
                unread_count: number;
                unread_chat_count: number;
            }>('/api/notifications');
            setNavigationCounts({ notifications: response.data.unread_count, chats: response.data.unread_chat_count });
            setRiderNotifications(response.data.notifications.filter((notification) => [
                'rider_offer_available',
                'rider_assignment_confirmed',
                'delivery_proof_recorded',
            ].includes(notification.data.type ?? '')).slice(0, 5));
        } catch {
            // The navigation remains usable if badges are temporarily unavailable.
        }
    }, []);

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

    async function acceptOffer(offer: RiderOffer) {
        if (!await confirmAction({
            title: 'Accept this delivery?',
            text: `Order ${offer.delivery.order.order_reference} will be assigned only if it is still available.`,
            confirmText: 'Accept delivery',
        })) return;

        setActingOnOfferId(offer.id);
        setNotice('');
        try {
            const response = await api.post<{ message: string; delivery: { id: number; status: string } }>(
                `/api/riders/offers/${offer.id}/accept`,
            );
            if (response.data.delivery.status !== 'RIDER_ACCEPTED') {
                throw new Error('The server did not confirm this delivery assignment.');
            }
            setNotice(`Delivery for order ${offer.delivery.order.order_reference} is now assigned to you.`);
            await Promise.all([refreshSummary(false), refreshNavigationCounts()]);
            refreshDeliveries();
            setDeliveryTab('assigned');
            setPage('deliveries');
        } catch (requestError: any) {
            const serverMessage = requestError.response?.data?.message;
            const message = requestError.response?.status === 409
                ? (serverMessage ?? 'This delivery is no longer available. Nearby orders have been refreshed.')
                : requestError.message ?? requestError.userMessage ?? 'The delivery could not be accepted. Nearby orders have been refreshed.';
            setNotice(message);
            await Promise.all([refreshSummary(false), refreshNavigationCounts()]);
        } finally {
            setActingOnOfferId(null);
        }
    }

    async function declineOffer(offer: RiderOffer) {
        if (!await confirmAction({
            title: 'Decline this delivery offer?',
            text: `Order ${offer.delivery.order.order_reference} will be offered to other eligible riders.`,
            confirmText: 'Decline offer',
            danger: true,
        })) return;

        setActingOnOfferId(offer.id);
        setNotice('');
        try {
            const response = await api.post<{ message: string; delivery: { status: string } }>(
                `/api/riders/offers/${offer.id}/decline`,
            );
            setNotice(response.data.delivery.status === 'WAITING_FOR_RIDER'
                ? `Offer declined. Order ${offer.delivery.order.order_reference} is awaiting another eligible rider.`
                : `Offer declined. Other eligible riders were notified for order ${offer.delivery.order.order_reference}.`);
            await Promise.all([refreshSummary(false), refreshNavigationCounts()]);
        } catch (requestError: any) {
            const serverMessage = requestError.response?.data?.message;
            setNotice(requestError.response?.status === 409
                ? (serverMessage ?? 'This delivery offer is no longer available. Nearby orders have been refreshed.')
                : requestError.message ?? requestError.userMessage ?? 'The delivery offer could not be declined.');
            await Promise.all([refreshSummary(false), refreshNavigationCounts()]);
        } finally {
            setActingOnOfferId(null);
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

    function openRiderDeliveries(search: string | number) {
        setDeliverySearch(String(search));
        setDeliveryStatus('');
        setDeliveryPage(1);
        setDeliveryTab('assigned');
        setPage('deliveries');
    }

    function openDeliveryNotification(deliveryOrderId: number) {
        openRiderDeliveries(deliveryOrderId);
    }

    async function confirmLogout() {
        if (!await confirmAction({ title: 'Log out of FarmGate?', text: 'Your account session will end on this device.', confirmText: 'Log out' })) return;
        onLogout();
    }

    const isChat = page === 'chats';
    const pageTitle = navigation.find((item) => item.id === page)?.label ?? 'Dashboard';
    const selectedScannerDelivery = scannerDeliveries.find((delivery) => delivery.id === selectedScannerDeliveryId) ?? null;
    const badgeCount = (id: RiderPage) => id === 'notifications' ? navigationCounts.notifications : id === 'chats' ? navigationCounts.chats : 0;

    return <main className="admin-shell seller-shell rider-shell">
        <aside className="admin-sidebar">
            <a className="brand" href="/">FARM<span>GATE</span></a>
            <div className="admin-sidebar-label">RIDER PORTAL</div>
            <nav aria-label="Rider navigation">{navigation.map((item) => {
                const count = badgeCount(item.id);
                return <button type="button" key={item.id} className={page === item.id ? 'active' : ''} aria-current={page === item.id ? 'page' : undefined} aria-label={count ? `${item.label}, ${count} unread` : item.label} onClick={() => { setPage(item.id); setNotice(''); }}>
                    <span className="nav-icon" aria-hidden="true">{item.icon}</span><span className="seller-nav-label">{item.label}</span><NavigationBadge count={count} />
                </button>;
            })}</nav>
            <button className="sidebar-logout" type="button" onClick={() => void confirmLogout()}>Log out <span>↗</span></button>
        </aside>
        <section className="admin-content seller-content">
            <header className="admin-header"><div><p className="eyebrow">FARMGATE rider workspace</p><h1>{pageTitle}</h1><p>Manage your assigned deliveries and keep customers updated.</p></div><span className="admin-role">RIDER</span></header>
            {notice && <p className="rider-offer-notice" role="status">{notice}</p>}
            {page === 'dashboard' && <section className="role-dashboard rider-dashboard">
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
                <div className="rider-metric-grid" aria-live="polite">
                    <article><span>Open offers</span><strong>{summary?.offers ?? '—'}</strong></article>
                    <article><span>Accepted assignments</span><strong>{summary?.accepted ?? '—'}</strong></article>
                    <article><span>Active deliveries</span><strong>{summary?.active ?? '—'}</strong></article>
                    <article><span>Delivered</span><strong>{summary?.delivered ?? '—'}</strong></article>
                    <article><span>Delivered with proof</span><strong>{summary?.delivered_with_proof ?? '—'}</strong></article>
                    <article><span>Delivered without proof</span><strong>{summary?.delivered_without_proof ?? '—'}</strong></article>
                    <article><span>Cancelled</span><strong>{summary?.cancellations ?? '—'}</strong></article>
                    <article><span>Avg. verified delivery time</span><strong>{summary?.average_delivery_minutes === null || summary?.average_delivery_minutes === undefined ? 'Not enough data' : `${summary.average_delivery_minutes} min`}</strong></article>
                </div>
                <div className="rider-analytics-layout">
                    <section className="rider-analytics-card" aria-labelledby="rider-status-chart-heading">
                        <div className="rider-work-heading"><div><p className="eyebrow">Filtered deliveries</p><h3 id="rider-status-chart-heading">Status breakdown</h3></div><span>{summary?.filtered_deliveries ?? 0} records</span></div>
                        {Object.keys(statusCounts).length === 0 ? <p className="rider-empty">No delivery activity for these filters.</p>
                            : <div className="rider-status-chart" role="list" aria-label="Delivery counts by status">
                                {Object.entries(statusCounts).sort(([first], [second]) => first.localeCompare(second)).map(([status, count]) => {
                                    const maximum = Math.max(1, ...Object.values(statusCounts));
                                    return <div className="rider-status-bar" role="listitem" key={status} aria-label={`${statusLabel(status)}: ${count}`}>
                                        <span>{statusLabel(status)}</span><i><b style={{ width: `${count / maximum * 100}%` }} /></i><strong>{count}</strong>
                                    </div>;
                                })}
                            </div>}
                    </section>
                    <section className="rider-analytics-card" aria-labelledby="rider-recent-activity-heading">
                        <div className="rider-work-heading"><div><p className="eyebrow">Recorded events</p><h3 id="rider-recent-activity-heading">Recent activity</h3></div></div>
                        {recentActivity.length === 0 ? <p className="rider-empty">No status changes match these filters.</p>
                            : <ol className="rider-activity-list">{recentActivity.map((activity) => <li key={activity.id}>
                                <span><strong>{activity.order_reference ?? 'Delivery'}</strong> · {statusLabel(activity.to_status)}</span>
                                <time>{activity.created_at ? new Date(activity.created_at).toLocaleString() : '—'}</time>
                            </li>)}</ol>}
                    </section>
                </div>
            </section>}
            {page === 'deliveries' && <section className="rider-deliveries" aria-labelledby="rider-deliveries-title">
                <div className="rider-work-heading"><div><p className="eyebrow">Rider workspace</p><h2 id="rider-deliveries-title">Deliveries</h2></div></div>
                <TabNav
                    label="Delivery workspace"
                    className="rider-delivery-tabs"
                    value={deliveryTab}
                    onChange={(value) => setDeliveryTab(value as RiderDeliveryTab)}
                    options={[
                        { value: 'nearby', label: 'Nearby Orders' },
                        { value: 'assigned', label: 'My Deliveries' },
                        { value: 'scanner', label: 'QR Scanner' },
                        { value: 'history', label: 'Delivery History' },
                    ]}
                />
                {deliveryTab === 'nearby' && <section className="rider-nearby-workspace" aria-labelledby="rider-offers-title" aria-live="polite">
                    <div className="rider-nearby-heading">
                        <div><p className="eyebrow">New assignments</p><h2 id="rider-offers-title">Nearby orders</h2><p>{offers.length} currently available to you</p></div>
                        <div className="rider-nearby-location">
                            <span>{riderLocation?.updated_at
                                ? `Location updated ${new Date(riderLocation.updated_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                                : 'Share your location to center nearby requests'}</span>
                            <button type="button" disabled={locationUpdating} onClick={() => void updateRiderLocation()}>
                                {locationUpdating ? 'Updating…' : riderLocation ? 'Refresh my location' : 'Use my location'}
                            </button>
                        </div>
                    </div>
                    {locationNotice && <p className="rider-location-notice" role="status">{locationNotice}</p>}
                    <div className="rider-nearby-columns">
                        <div className="rider-nearby-main">
                            <React.Suspense fallback={<div className="rider-nearby-map rider-map-loading" role="status">Loading map…</div>}>
                                <NearbyOrdersMap offers={offers} selectedOfferId={selectedOfferId} riderLocation={riderLocation} onSelectOffer={setSelectedOfferId} />
                            </React.Suspense>
                            <p className="rider-map-privacy-note">P = pickup, D = approximate drop-off. Offer-map distances are approximate; checkout distance is the saved road route. Exact buyer details stay hidden until assignment.</p>
                            {offers.length === 0 ? <p className="rider-offers-empty">No delivery offers right now. Only standard-delivery orders marked Ready for Pickup with confirmed payment and a valid seller pickup location are offered to verified, available riders within the configured distance. Refreshing your location retries eligible expired offers. Accept an offer to add it to My Deliveries.</p>
                                : <div className="rider-offers-list">{offers.map((offer) => {
                                    const selected = selectedOfferId === offer.id;
                                    return <article className={`rider-offer-card ${selected ? 'is-selected' : ''}`} key={offer.id}>
                                        <button type="button" className="rider-offer-select" aria-pressed={selected} onClick={() => setSelectedOfferId(offer.id)}>
                                            <span><strong>Order {offer.delivery.order.order_reference}</strong><small>{selected ? 'Selected on map' : 'Show this request on map'}</small></span>
                                            <span className="rider-offer-distance">{Number(offer.distance_km).toFixed(1)} km direct from rider at offer time</span>
                                        </button>
                                        <p><b>Pickup area:</b> {offer.delivery.pickup_area}</p>
                                        <p><b>Drop-off area:</b> {offer.delivery.order.dropoff_area}</p>
                                        <p><b>Checkout distance:</b> {offer.checkout_distance_km === null
                                            ? 'Not available'
                                            : `${Number(offer.checkout_distance_km).toFixed(1)} km (${offer.checkout_distance_method === 'OSRM_BARANGAY_ESTIMATE' ? 'barangay-level road distance estimate' : 'OSRM road route'})`}</p>
                                        <p><b>Buyer checkout delivery fee:</b> {offer.checkout_delivery_fee === null ? 'Not available' : `₱${Number(offer.checkout_delivery_fee).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</p>
                                        {offer.expires_at && <p className="rider-offer-expiry">Offer expires {new Date(offer.expires_at).toLocaleString()}</p>}
                                        <button type="button" disabled={actingOnOfferId !== null} onClick={() => void acceptOffer(offer)}>
                                            {actingOnOfferId === offer.id ? 'Checking availability…' : 'Accept delivery'}
                                        </button>
                                        <button type="button" disabled={actingOnOfferId !== null} onClick={() => void declineOffer(offer)}>
                                            {actingOnOfferId === offer.id ? 'Updating offer…' : 'Decline offer'}
                                        </button>
                                    </article>;
                                })}</div>}
                        </div>
                        <aside className="rider-order-notifications" aria-labelledby="rider-order-notifications-title">
                            <header><div><p className="eyebrow">Updates</p><h3 id="rider-order-notifications-title">Order Notifications</h3></div><NavigationBadge count={navigationCounts.notifications} /></header>
                            <h4>Nearby orders</h4>
                            {offers.length === 0 ? <p className="rider-notification-empty">No open requests.</p> : offers.slice(0, 3).map((offer) => {
                                const unread = riderNotifications.some((item) => item.read_at === null
                                    && item.data.type === 'rider_offer_available'
                                    && item.data.order_reference === offer.delivery.order.order_reference);
                                return <button type="button" className="rider-order-notification" key={`offer-${offer.id}`} onClick={() => setSelectedOfferId(offer.id)}>
                                    <span className={`rider-notification-dot ${unread ? 'is-unread' : ''}`} aria-label={unread ? 'Unread' : 'Read'} />
                                    <span><strong>{offer.delivery.order.order_reference}</strong><small>{offer.delivery.order.dropoff_area}</small></span>
                                    <span className="rider-notification-state">Available</span>
                                </button>;
                            })}
                            <h4>Assignment updates</h4>
                            {riderNotifications.filter((item) => item.data.type === 'rider_assignment_confirmed').length === 0
                                ? <p className="rider-notification-empty">No assignment confirmations yet.</p>
                                : riderNotifications.filter((item) => item.data.type === 'rider_assignment_confirmed').slice(0, 3).map((item) => (
                                    <div className="rider-order-notification" key={item.id}>
                                        <span className={`rider-notification-dot ${item.read_at === null ? 'is-unread' : ''}`} aria-label={item.read_at === null ? 'Unread' : 'Read'} />
                                        <span><strong>{item.data.order_reference ?? 'Assignment confirmed'}</strong><small>{item.data.message ?? 'Your delivery acceptance is confirmed.'}</small></span>
                                        <time>{new Date(item.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
                                    </div>
                                ))}
                            <button type="button" className="rider-notifications-link" onClick={() => setPage('notifications')}>View all notifications</button>
                        </aside>
                    </div>
                </section>}
                {deliveryTab === 'assigned' && <>
                    <div className="rider-delivery-filters" role="search" aria-label="Filter my deliveries">
                        <label>Search deliveries<input type="search" value={deliverySearch} onChange={(event) => { setDeliverySearch(event.target.value); setDeliveryPage(1); }} placeholder="Order reference, buyer, or seller" /></label>
                        <label>Delivery status<select value={deliveryStatus} onChange={(event) => { setDeliveryStatus(event.target.value); setDeliveryPage(1); }}><option value="">All statuses</option>{riderStatuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label>
                    </div>
                    <p className="rider-delivery-count" aria-live="polite">{deliveryTotal} assigned deliveries</p>
                    {deliveryError && <p className="rider-delivery-error" role="alert">{deliveryError} <button type="button" onClick={() => setDeliveryRevision((revision) => revision + 1)}>Try again</button></p>}
                    {deliveriesLoading ? <p role="status">Loading deliveries…</p> : deliveries.length === 0 ? <div className="rider-deliveries-empty"><h3>No matching deliveries</h3><p>Accepted assignments appear here. Try a different filter or search.</p></div>
                        : <div className="rider-delivery-groups">{riderStatuses.map((status) => {
                            const group = deliveries.filter((delivery) => delivery.status === status);
                            if (group.length === 0) return null;
                            return <section className="rider-delivery-group" key={status} aria-labelledby={`delivery-status-${status}`}>
                                <h3 id={`delivery-status-${status}`}>{statusLabel(status)} <span>{group.length}</span></h3>
                                <div className="rider-delivery-list">{group.map((delivery) => <article className="rider-delivery-card" key={delivery.id}>
                                    <div className="rider-delivery-card-heading"><div><p className="eyebrow">Order {delivery.order.order_reference}</p><h4>{statusLabel(delivery.status)}</h4></div><strong>₱{Number(delivery.order.total_amount).toLocaleString()}</strong></div>
                                    {delivery.order.delivery_distance_km !== null && <p>{Number(delivery.order.delivery_distance_km).toFixed(2)} km ({delivery.order.delivery_distance_method === 'OSRM_BARANGAY_ESTIMATE' ? 'barangay-level road distance estimate' : 'OSRM road route'}) · Buyer delivery fee ₱{Number(delivery.order.delivery_fee).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>}
                                    <div className="rider-delivery-addresses"><p><b>Pickup</b><span>{delivery.pickup_address ?? delivery.order.seller?.name ?? 'Seller location'}</span></p><p><b>Drop-off</b><span>{locationFor(delivery.order)}</span></p><p><b>Buyer</b><span>{delivery.order.shipping_address?.recipient_name ?? delivery.order.buyer?.name ?? 'Buyer'}{delivery.order.buyer?.phone_number ? ` · ${delivery.order.buyer.phone_number}` : ''}</span></p></div>
                                    {activeStatuses.has(delivery.status) && <div className="rider-delivery-actions">
                                        <button type="button" className="seller-inline-action" onClick={() => toggleLocationSharing(delivery.id)}>{sharingDeliveryId === delivery.id ? 'Stop sharing location' : 'Share live location'}</button>
                                    </div>}
                                    <DeliveryProofCapture delivery={delivery} onSaved={() => {
                                        refreshDeliveries();
                                        void refreshSummary(false);
                                    }} />
                                    {sharingDeliveryId === delivery.id && locationNotice && <p className="rider-location-notice" role="status">{locationNotice}</p>}
                                    {delivery.status === 'DELIVERED' && <DeliveryProofSummary
                                        deliveryId={delivery.id}
                                        hasProof={delivery.has_delivery_proof ?? false}
                                        recipientConfirmed={delivery.recipient_confirmed}
                                        recipientName={delivery.delivery_recipient_name}
                                        capturedAt={delivery.proof_captured_at}
                                        recordedAt={delivery.proof_recorded_at}
                                    />}
                                    {activeStatuses.has(delivery.status) && <DeliveryTrackingPanel
                                        deliveryId={delivery.id}
                                        sellerName={delivery.order.seller?.name ?? 'Seller'}
                                        buyerName={delivery.order.shipping_address?.recipient_name ?? delivery.order.buyer?.name ?? 'Buyer'}
                                        sellerLatitude={delivery.pickup_latitude}
                                        sellerLongitude={delivery.pickup_longitude}
                                        buyerLatitude={delivery.order.shipping_address?.latitude ?? null}
                                        buyerLongitude={delivery.order.shipping_address?.longitude ?? null}
                                    />}
                                </article>)}</div>
                            </section>;
                        })}</div>}
                    {!deliveriesLoading && deliveryTotal > 0 && <div className="rider-delivery-pagination"><span>Page {deliveryPage} of {deliveryLastPage} · {deliveryTotal} deliveries</span>{deliveryLastPage > 1 && <Pagination page={deliveryPage} lastPage={deliveryLastPage} onChange={setDeliveryPage} />}</div>}
                </>}
                {deliveryTab === 'scanner' && <section className="rider-qr-scanner" aria-labelledby="rider-qr-scanner-title">
                    <div className="rider-work-heading"><div><p className="eyebrow">Assigned deliveries only</p><h3 id="rider-qr-scanner-title">QR Scanner</h3><p>Choose an active assignment to verify pickup or delivery.</p></div><button type="button" className="seller-inline-action" onClick={refreshDeliveries}>Refresh assignments</button></div>
                    {scannerError && <p className="rider-delivery-error" role="alert">{scannerError}</p>}
                    {scannerLoading ? <p role="status">Loading active assignments…</p>
                        : scannerDeliveries.length === 0 ? <div className="rider-deliveries-empty"><h4>No active assigned deliveries</h4><p>Accept a delivery first. Nearby, unassigned requests cannot be scanned or verified.</p></div>
                            : <div className="rider-qr-scanner-content">
                                <label className="rider-scanner-assignment">Assigned delivery
                                    <select value={selectedScannerDeliveryId ?? ''} onChange={(event) => setSelectedScannerDeliveryId(Number(event.target.value))}>
                                        {scannerDeliveries.map((delivery) => <option key={delivery.id} value={delivery.id}>
                                            {delivery.order.order_reference} · {statusLabel(delivery.status)}
                                        </option>)}
                                    </select>
                                </label>
                                {selectedScannerDelivery && <article className="rider-delivery-card">
                                    <div className="rider-delivery-card-heading"><div><p className="eyebrow">Order {selectedScannerDelivery.order.order_reference}</p><h4>{statusLabel(selectedScannerDelivery.status)}</h4></div></div>
                                    <DeliveryVerification delivery={selectedScannerDelivery} autoExpand onVerified={() => { refreshDeliveries(); void refreshSummary(false); }} onError={onError} />
                                </article>}
                            </div>}
                </section>}
                {deliveryTab === 'history' && <ReportPanel role="RIDER" onError={onError} title="Delivery History" hideTypeSelector />}
            </section>}
            {page === 'chats' && <AIChatPage role="RIDER" initialConversationId={activeConversationId} onBack={() => setPage('dashboard')} />}
            {page === 'reports' && <ReportPanel role="RIDER" onError={onError} />}
            {page === 'notifications' && <NotificationsPage role="RIDER" onOpenOrder={openDeliveryNotification} onOpenConversation={openConversation} onNotificationsRead={refreshNavigationCounts} />}
            {page === 'account' && <RiderAccountSettings user={user} onUserUpdated={onUserUpdated} onError={onError} />}
            {isChat && <span className="sr-only" aria-live="polite">Rider chats workspace</span>}
        </section>
    </main>;
}
