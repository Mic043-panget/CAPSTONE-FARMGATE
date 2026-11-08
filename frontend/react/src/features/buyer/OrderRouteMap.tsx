import React from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

type OrderRouteMapProps = {
    sellerName: string;
    buyerName: string;
    sellerLatitude: number | string | null;
    sellerLongitude: number | string | null;
    buyerLatitude: number | string | null;
    buyerLongitude: number | string | null;
    riderLatitude?: number | string | null;
    riderLongitude?: number | string | null;
    riderName?: string;
};

type Coordinate = [number, number];

type RouteResponse = {
    routes?: {
        geometry?: {
            coordinates?: [number, number][];
        };
    }[];
};

function coordinate(latitude: number | string | null, longitude: number | string | null): Coordinate | null {
    if (latitude === null || longitude === null) return null;
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return [lat, lng];
}

export function OrderRouteMap({
    sellerName,
    buyerName,
    sellerLatitude,
    sellerLongitude,
    buyerLatitude,
    buyerLongitude,
    riderLatitude,
    riderLongitude,
    riderName = 'Rider',
}: OrderRouteMapProps) {
    const containerRef = React.useRef<HTMLDivElement>(null);
    const mapRef = React.useRef<L.Map | null>(null);
    const riderMarkerRef = React.useRef<L.Marker | null>(null);
    const riderRouteRef = React.useRef<L.Polyline | null>(null);
    const sellerPoint = coordinate(sellerLatitude, sellerLongitude);
    const buyerPoint = coordinate(buyerLatitude, buyerLongitude);
    const riderPoint = coordinate(riderLatitude ?? null, riderLongitude ?? null);
    const [routeLoading, setRouteLoading] = React.useState(true);
    const [routeError, setRouteError] = React.useState<string | null>(null);
    const [riderRouteError, setRiderRouteError] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (!containerRef.current || !sellerPoint || !buyerPoint) return undefined;

        const sellerLatLng = L.latLng(sellerPoint);
        const buyerLatLng = L.latLng(buyerPoint);
        const map = L.map(containerRef.current, { scrollWheelZoom: false });
        mapRef.current = map;
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            maxZoom: 19,
        }).addTo(map);

        const bounds = L.latLngBounds([sellerLatLng, buyerLatLng]);
        map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15 });
        L.marker(sellerLatLng, {
            icon: L.divIcon({
                className: 'buyer-order-map-marker',
                html: '<span><b>S</b></span>',
                iconSize: [30, 38],
                iconAnchor: [15, 36],
            }),
        }).addTo(map).bindTooltip(`Seller: ${sellerName}`);
        L.marker(buyerLatLng, {
            icon: L.divIcon({
                className: 'buyer-order-map-marker',
                html: '<span><b>B</b></span>',
                iconSize: [30, 38],
                iconAnchor: [15, 36],
            }),
        }).addTo(map).bindTooltip(`Buyer: ${buyerName}`);

        const straightLine = L.polyline([sellerLatLng, buyerLatLng], {
            color: '#8a948b',
            dashArray: '6 8',
            weight: 4,
        }).addTo(map);
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 12000);
        let active = true;

        fetch(`https://router.project-osrm.org/route/v1/driving/${sellerPoint[1]},${sellerPoint[0]};${buyerPoint[1]},${buyerPoint[0]}?overview=full&geometries=geojson`, {
            signal: controller.signal,
        }).then(async (response) => {
            if (!response.ok) throw new Error('Road routing service returned an error.');
            const result = await response.json() as RouteResponse;
            const routeCoordinates = result.routes?.[0]?.geometry?.coordinates;
            if (!routeCoordinates || routeCoordinates.length < 2) throw new Error('No drivable road route was found.');
            if (!active) return;

            const roadRoute = routeCoordinates.map(([longitude, latitude]) => L.latLng(latitude, longitude));
            straightLine.setLatLngs(roadRoute);
            straightLine.setStyle({ color: '#285e48', dashArray: '', weight: 5 });
            map.fitBounds(L.latLngBounds(roadRoute), { padding: [36, 36], maxZoom: 15 });
        }).catch(() => {
            if (active) setRouteError('Road directions are temporarily unavailable; the dashed line shows the direct path between the pinned locations.');
        }).finally(() => {
            window.clearTimeout(timeout);
            if (active) setRouteLoading(false);
        });

        requestAnimationFrame(() => map.invalidateSize());
        return () => {
            active = false;
            controller.abort();
            window.clearTimeout(timeout);
            mapRef.current = null;
            riderMarkerRef.current = null;
            riderRouteRef.current = null;
            map.remove();
        };
    }, [buyerName, buyerPoint?.[0], buyerPoint?.[1], sellerName, sellerPoint?.[0], sellerPoint?.[1]]);

    React.useEffect(() => {
        const map = mapRef.current;
        if (!map || !riderPoint) {
            riderMarkerRef.current?.remove();
            riderMarkerRef.current = null;
            return;
        }

        if (riderMarkerRef.current) {
            riderMarkerRef.current.setLatLng(riderPoint);
            riderMarkerRef.current.setTooltipContent(`${riderName} · live location`);
            return;
        }
        riderMarkerRef.current = L.marker(riderPoint, {
            icon: L.divIcon({
                className: 'buyer-order-map-marker rider-live-marker',
                html: '<span><b>R</b></span>',
                iconSize: [30, 38],
                iconAnchor: [15, 36],
            }),
        }).addTo(map).bindTooltip(`${riderName} · live location`);
    }, [riderName, riderPoint?.[0], riderPoint?.[1]]);

    React.useEffect(() => {
        const map = mapRef.current;
        riderRouteRef.current?.remove();
        riderRouteRef.current = null;
        setRiderRouteError(null);
        if (!map || !riderPoint || !sellerPoint || !buyerPoint) return undefined;

        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 12_000);
        let active = true;

        fetch(`https://router.project-osrm.org/route/v1/driving/${riderPoint[1]},${riderPoint[0]};${sellerPoint[1]},${sellerPoint[0]}?overview=full&geometries=geojson`, {
            signal: controller.signal,
        }).then(async (response) => {
            if (!response.ok) throw new Error('Road routing service returned an error.');
            const result = await response.json() as RouteResponse;
            const routeCoordinates = result.routes?.[0]?.geometry?.coordinates;
            if (!routeCoordinates || routeCoordinates.length < 2) throw new Error('No drivable road route was found.');
            if (!active) return;

            const roadRoute = routeCoordinates.map(([longitude, latitude]) => L.latLng(latitude, longitude));
            riderRouteRef.current = L.polyline(roadRoute, {
                color: '#ed7d31',
                weight: 5,
                opacity: 0.9,
            }).addTo(map).bindTooltip(`Rider to seller · ${riderName}`);
            map.fitBounds(L.latLngBounds([sellerPoint, buyerPoint, ...roadRoute]), { padding: [36, 36], maxZoom: 15 });
        }).catch(() => {
            if (active) setRiderRouteError('The road route from the rider to the seller is temporarily unavailable.');
        }).finally(() => {
            window.clearTimeout(timeout);
        });

        return () => {
            active = false;
            controller.abort();
            window.clearTimeout(timeout);
        };
    }, [buyerPoint?.[0], buyerPoint?.[1], riderName, riderPoint?.[0], riderPoint?.[1], sellerPoint?.[0], sellerPoint?.[1]]);

    React.useEffect(() => {
        setRouteLoading(true);
        setRouteError(null);
    }, [buyerPoint?.[0], buyerPoint?.[1], sellerPoint?.[0], sellerPoint?.[1]]);

    if (!sellerPoint || !buyerPoint) {
        return <section className="buyer-order-route-map" aria-label="Seller to buyer route">
            <h3>Seller-to-buyer route</h3>
            <p className="buyer-order-route-help" role="status">
                {sellerPoint ? 'The buyer delivery address needs a map pin before a route can be shown.' : buyerPoint ? 'The seller needs to pin a pickup location before a route can be shown.' : 'A map route needs pinned locations for both the seller and buyer.'}
            </p>
        </section>;
    }

    const directionsUrl = `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${sellerPoint[0]},${sellerPoint[1]};${buyerPoint[0]},${buyerPoint[1]}`;

    return <section className="buyer-order-route-map" aria-label="Seller to buyer route">
        <h3>Seller-to-buyer road route</h3>
        <div className="buyer-order-route-map-canvas" ref={containerRef} role="img" aria-label={`Map showing the route from seller ${sellerName} to buyer ${buyerName}`} />
        {routeLoading && <p className="buyer-order-route-help" role="status">Loading road route…</p>}
        {routeError && <p className="buyer-order-route-help" role="status">{routeError}</p>}
        {riderPoint && riderRouteError && <p className="buyer-order-route-help" role="status">{riderRouteError}</p>}
        <a className="buyer-order-route-directions" href={directionsUrl} target="_blank" rel="noreferrer">Open directions in OpenStreetMap</a>
    </section>;
}
