import React from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type NearbyOrder = {
    id: number;
    distance_km: string | number;
    checkout_distance_km: string | number | null;
    checkout_distance_method: 'OSRM_ROAD_ROUTE' | 'OSRM_BARANGAY_ESTIMATE' | null;
    checkout_delivery_fee: string | number | null;
    expires_at: string | null;
    delivery: {
        id: number;
        delivery_reference: string;
        pickup_area: string;
        pickup_latitude_approximate: number | null;
        pickup_longitude_approximate: number | null;
        order: {
            id: number;
            order_reference: string;
            dropoff_area: string;
            dropoff_latitude_approximate: number | null;
            dropoff_longitude_approximate: number | null;
        };
    };
};

type NearbyOrdersMapProps = {
    offers: NearbyOrder[];
    selectedOfferId: number | null;
    riderLocation: { latitude: number; longitude: number } | null;
    onSelectOffer: (offerId: number) => void;
};

type Point = [number, number];

function point(latitude: number | null, longitude: number | null): Point | null {
    if (latitude === null || longitude === null || !Number.isFinite(latitude) || !Number.isFinite(longitude)
        || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        return null;
    }
    return [latitude, longitude];
}

function markerIcon(label: string, markerType: 'rider' | 'pickup' | 'dropoff', selected: boolean) {
    return L.divIcon({
        className: `rider-nearby-marker is-${markerType} ${selected ? 'is-selected' : ''}`,
        html: `<span>${label}</span>`,
        iconSize: [40, 46],
        iconAnchor: [20, 42],
    });
}

export function NearbyOrdersMap({ offers, selectedOfferId, riderLocation, onSelectOffer }: NearbyOrdersMapProps) {
    const containerRef = React.useRef<HTMLDivElement>(null);
    const mapRef = React.useRef<L.Map | null>(null);
    const markersRef = React.useRef<L.LayerGroup | null>(null);
    const riderMarkerRef = React.useRef<L.Marker | null>(null);
    const onSelectRef = React.useRef(onSelectOffer);
    const riderPoint = React.useMemo(
        () => point(riderLocation?.latitude ?? null, riderLocation?.longitude ?? null),
        [riderLocation?.latitude, riderLocation?.longitude],
    );
    const offerPoints = React.useMemo(() => offers.flatMap((offer) => [
        point(offer.delivery.pickup_latitude_approximate, offer.delivery.pickup_longitude_approximate),
        point(offer.delivery.order.dropoff_latitude_approximate, offer.delivery.order.dropoff_longitude_approximate),
    ]).filter((value): value is Point => value !== null), [offers]);
    const mapPoints = [...(riderPoint ? [riderPoint] : []), ...offerPoints];
    const hasMapPoints = mapPoints.length > 0;

    React.useEffect(() => {
        onSelectRef.current = onSelectOffer;
    }, [onSelectOffer]);

    React.useEffect(() => {
        if (!containerRef.current || mapRef.current || !hasMapPoints) return undefined;
        const map = L.map(containerRef.current, { scrollWheelZoom: false }).setView(mapPoints[0], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            maxZoom: 19,
        }).addTo(map);
        const markers = L.layerGroup().addTo(map);
        mapRef.current = map;
        markersRef.current = markers;
        const frame = requestAnimationFrame(() => map.invalidateSize());

        return () => {
            cancelAnimationFrame(frame);
            map.remove();
            mapRef.current = null;
            markersRef.current = null;
            riderMarkerRef.current = null;
        };
    }, [hasMapPoints]);

    React.useEffect(() => {
        const map = mapRef.current;
        const markers = markersRef.current;
        if (!map || !markers || !hasMapPoints) return;

        markers.clearLayers();
        riderMarkerRef.current = null;
        const bounds: Point[] = [];

        offers.forEach((offer) => {
            const pickup = point(
                offer.delivery.pickup_latitude_approximate,
                offer.delivery.pickup_longitude_approximate,
            );
            const dropoff = point(
                offer.delivery.order.dropoff_latitude_approximate,
                offer.delivery.order.dropoff_longitude_approximate,
            );
            const isSelected = offer.id === selectedOfferId;

            if (pickup) {
                const marker = L.marker(pickup, { icon: markerIcon('P', 'pickup', isSelected) }).addTo(markers);
                marker.bindTooltip(`Pickup area · ${offer.delivery.order.order_reference}`);
                marker.on('click', () => onSelectRef.current(offer.id));
                bounds.push(pickup);
            }
            if (dropoff) {
                const marker = L.marker(dropoff, { icon: markerIcon('D', 'dropoff', isSelected) }).addTo(markers);
                marker.bindTooltip(`Approximate drop-off area · ${offer.delivery.order.order_reference}`);
                marker.on('click', () => onSelectRef.current(offer.id));
                bounds.push(dropoff);
            }
            if (pickup && dropoff) {
                L.polyline([pickup, dropoff], {
                    color: isSelected ? '#bc7040' : '#3f7252',
                    dashArray: '5 7',
                    weight: isSelected ? 4 : 2,
                    opacity: 0.75,
                }).addTo(markers);
            }
        });

        if (riderPoint) {
            riderMarkerRef.current = L.marker(riderPoint, { icon: markerIcon('You', 'rider', false) })
                .addTo(markers)
                .bindTooltip('Your last reported location');
            bounds.push(riderPoint);
        } else {
            riderMarkerRef.current = null;
        }

        if (selectedOfferId !== null) {
            const selected = offers.find((offer) => offer.id === selectedOfferId);
            const pickup = selected && point(
                selected.delivery.pickup_latitude_approximate,
                selected.delivery.pickup_longitude_approximate,
            );
            const dropoff = selected && point(
                selected.delivery.order.dropoff_latitude_approximate,
                selected.delivery.order.dropoff_longitude_approximate,
            );
            const selectedBounds = [pickup, dropoff].filter((value): value is Point => value !== null);
            if (selectedBounds.length) {
                map.fitBounds(L.latLngBounds(selectedBounds), { padding: [32, 32], maxZoom: 13 });
                return;
            }
        }
        if (bounds.length > 1) map.fitBounds(L.latLngBounds(bounds), { padding: [32, 32], maxZoom: 12 });
        else if (bounds.length === 1) map.setView(bounds[0], 12);
    }, [hasMapPoints, offers, riderPoint, selectedOfferId]);

    function recenterMap() {
        const map = mapRef.current;
        if (!map) return;
        if (riderPoint) {
            map.setView(riderPoint, Math.max(map.getZoom(), 12));
        } else if (offerPoints.length > 1) {
            map.fitBounds(L.latLngBounds(offerPoints), { padding: [32, 32], maxZoom: 12 });
        } else if (offerPoints.length === 1) {
            map.setView(offerPoints[0], 12);
        }
    }

    return <div className="rider-nearby-map-frame">
        {hasMapPoints ? <div
            className="rider-nearby-map"
            ref={containerRef}
            role="region"
            aria-label="Map of nearby delivery requests"
        /> : <div className="rider-nearby-map rider-nearby-map-empty" role="region" aria-label="Map of nearby delivery requests">
            <strong>Map location unavailable</strong>
            <span>Share your location or wait for an order with available map coordinates.</span>
        </div>}
        {hasMapPoints && <button className="rider-map-recenter" type="button" aria-label={riderPoint ? 'Recenter map on your location' : 'Recenter map on nearby orders'} title="Recenter map" onClick={recenterMap}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
        </button>}
    </div>;
}
