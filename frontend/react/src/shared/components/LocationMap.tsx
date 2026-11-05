import React from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

type LocationMapProps = {
    latitude: number;
    longitude: number;
    onChange: (latitude: number, longitude: number) => void;
    tooltip?: string;
};

export function LocationMap({ latitude, longitude, onChange, tooltip = 'Drag to your location' }: LocationMapProps) {
    const containerRef = React.useRef<HTMLDivElement>(null);
    const mapRef = React.useRef<L.Map | null>(null);
    const markerRef = React.useRef<L.Marker | null>(null);
    const onChangeRef = React.useRef(onChange);

    React.useEffect(() => {
        onChangeRef.current = onChange;
    }, [onChange]);

    React.useEffect(() => {
        if (!containerRef.current || mapRef.current) return undefined;

        const map = L.map(containerRef.current, { scrollWheelZoom: false }).setView([latitude, longitude], 14);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            maxZoom: 19,
        }).addTo(map);
        const marker = L.marker([latitude, longitude], {
            draggable: true,
            icon: L.divIcon({ className: 'buyer-address-marker', html: '<span></span>', iconSize: [26, 36], iconAnchor: [13, 34] }),
        }).addTo(map);
        marker.bindTooltip(tooltip);
        marker.on('dragend', () => {
            const point = marker.getLatLng();
            onChangeRef.current(point.lat, point.lng);
        });
        map.on('click', (event: L.LeafletMouseEvent) => {
            marker.setLatLng(event.latlng);
            onChangeRef.current(event.latlng.lat, event.latlng.lng);
        });
        mapRef.current = map;
        markerRef.current = marker;
        requestAnimationFrame(() => map.invalidateSize());

        return () => {
            map.remove();
            mapRef.current = null;
            markerRef.current = null;
        };
    }, []);

    React.useEffect(() => {
        if (!mapRef.current || !markerRef.current) return;
        const point = L.latLng(latitude, longitude);
        markerRef.current.setLatLng(point);
        mapRef.current.panTo(point);
    }, [latitude, longitude]);

    return <div className="buyer-address-map" ref={containerRef} aria-label="Delivery location map" />;
}
