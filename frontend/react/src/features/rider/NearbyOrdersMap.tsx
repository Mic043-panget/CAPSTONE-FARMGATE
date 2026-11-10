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

function markerIcon(label: string, selected: boolean) {
    return L.divIcon({
        className: `rider-nearby-marker ${selected ? 'is-selected' : ''}`,
        html: `<span>${label}</span>`,
        iconSize: [32, 38],
        iconAnchor: [16, 36],
    });
}

export function NearbyOrdersMap({ offers, selectedOfferId, riderLocation, onSelectOffer }: NearbyOrdersMapProps) {
    const containerRef = React.useRef<HTMLDivElement>(null);
    const mapRef = React.useRef<L.Map | null>(null);
    const markersRef = React.useRef<L.LayerGroup | null>(null);
    const riderMarkerRef = React.useRef<L.Marker | null>(null);
    const onSelectRef = React.useRef(onSelectOffer);

    React.useEffect(() => {
        onSelectRef.current = onSelectOffer;
    }, [onSelectOffer]);

    React.useEffect(() => {
        if (!containerRef.current || mapRef.current) return undefined;
        const map = L.map(containerRef.current, { scrollWheelZoom: false }).setView([12.75, 121.38], 11);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            maxZoom: 19,
        }).addTo(map);
        const markers = L.layerGroup().addTo(map);
        mapRef.current = map;
        markersRef.current = markers;
        requestAnimationFrame(() => map.invalidateSize());

        return () => {
            map.remove();
            mapRef.current = null;
            markersRef.current = null;
            riderMarkerRef.current = null;
        };
    }, []);

    React.useEffect(() => {
        const map = mapRef.current;
        const markers = markersRef.current;
        if (!map || !markers) return;

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
                const marker = L.marker(pickup, { icon: markerIcon('P', isSelected) }).addTo(markers);
                marker.bindTooltip(`Pickup area · ${offer.delivery.order.order_reference}`);
                marker.on('click', () => onSelectRef.current(offer.id));
                bounds.push(pickup);
            }
            if (dropoff) {
                const marker = L.marker(dropoff, { icon: markerIcon('D', isSelected) }).addTo(markers);
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

        if (riderLocation && Number.isFinite(riderLocation.latitude) && Number.isFinite(riderLocation.longitude)) {
            const riderPoint: Point = [riderLocation.latitude, riderLocation.longitude];
            riderMarkerRef.current = L.marker(riderPoint, { icon: markerIcon('You', false) })
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
    }, [offers, riderLocation, selectedOfferId]);

    return <div
        className="rider-nearby-map"
        ref={containerRef}
        role="region"
        aria-label="Map of nearby delivery requests"
    />;
}
