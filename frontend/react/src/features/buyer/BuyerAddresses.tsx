import React from 'react';
import api from '../../lib/api';
import { confirmAction, showError, showSuccess } from '../../lib/alerts';
import { LocationMap } from '../../shared/components/LocationMap';

type BuyerAddress = {
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

type AddressForm = Omit<BuyerAddress, 'id' | 'is_default'> & { is_default: boolean };

const provinceOptions = [
    'Metro Manila', 'Benguet', 'Ilocos Norte', 'Cagayan', 'Pampanga', 'Bulacan', 'Cavite', 'Laguna',
    'Batangas', 'Rizal', 'Quezon', 'Oriental Mindoro', 'Occidental Mindoro', 'Marinduque', 'Romblon',
    'Palawan', 'Albay', 'Iloilo', 'Cebu', 'Leyte', 'Zamboanga del Sur', 'Misamis Oriental',
    'Davao del Sur', 'South Cotabato', 'Agusan del Norte',
];

const orientalMindoroCities = ['Calapan City', 'Bongabong', 'Pinamalayan', 'Roxas', 'Mansalay'];
const postalCodes: Record<string, string> = {
    'Calapan City': '5200',
    Bongabong: '5211',
    Pinamalayan: '5208',
    Roxas: '5212',
    Mansalay: '5213',
};
const defaultCoordinates = { latitude: 12.7321, longitude: 121.3654 };

function emptyAddress(): AddressForm {
    return {
        label: '',
        recipient_name: '',
        phone_number: '',
        province: 'Oriental Mindoro',
        city_municipality: 'Bongabong',
        barangay: '',
        postal_code: '5211',
        street_address: '',
        address_line2: '',
        delivery_notes: '',
        latitude: defaultCoordinates.latitude,
        longitude: defaultCoordinates.longitude,
        is_default: false,
    };
}

export function BuyerAddresses({ onError }: { onError: (message: string) => void }) {
    const [addresses, setAddresses] = React.useState<BuyerAddress[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [modalOpen, setModalOpen] = React.useState(false);
    const [editingAddress, setEditingAddress] = React.useState<BuyerAddress | null>(null);
    const [form, setForm] = React.useState<AddressForm>(emptyAddress);
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState('');
    const [notice, setNotice] = React.useState('');
    const [locationSearch, setLocationSearch] = React.useState('');
    const [searching, setSearching] = React.useState(false);
    const [locating, setLocating] = React.useState(false);

    const loadAddresses = React.useEffectEvent(async () => {
        setLoading(true);
        try {
            const response = await api.get<{ addresses: BuyerAddress[] }>('/api/buyer/addresses');
            setAddresses(response.data.addresses);
        } catch (requestError: any) {
            const message = requestError.userMessage ?? 'Saved addresses could not be loaded.';
            setError(message);
            onError(message);
        } finally {
            setLoading(false);
        }
    });

    React.useEffect(() => {
        void loadAddresses();
    }, []);

    function openNewAddress() {
        setEditingAddress(null);
        setForm(emptyAddress());
        setLocationSearch('');
        setError('');
        setNotice('');
        setModalOpen(true);
    }

    function openEditAddress(address: BuyerAddress) {
        setEditingAddress(address);
        setForm({ ...address, address_line2: address.address_line2 ?? '', delivery_notes: address.delivery_notes ?? '' });
        setLocationSearch('');
        setError('');
        setNotice('');
        setModalOpen(true);
    }

    function updateField<K extends keyof AddressForm>(key: K, value: AddressForm[K]) {
        setForm((current) => ({ ...current, [key]: value }));
    }

    function updateProvince(province: string) {
        setForm((current) => ({
            ...current,
            province,
            city_municipality: province === 'Oriental Mindoro' ? 'Bongabong' : '',
            postal_code: province === 'Oriental Mindoro' ? '5211' : '',
        }));
    }

    function updateCity(city: string) {
        setForm((current) => ({ ...current, city_municipality: city, postal_code: postalCodes[city] ?? current.postal_code }));
    }

    async function searchAddress() {
        if (!locationSearch.trim()) {
            setError('Enter an address or landmark to search.');
            showError('Enter an address or landmark to search.');
            return;
        }
        setSearching(true);
        setError('');
        try {
            const query = new URLSearchParams({ q: locationSearch, format: 'jsonv2', limit: '1', countrycodes: 'ph' });
            const response = await fetch(`https://nominatim.openstreetmap.org/search?${query}`);
            if (!response.ok) throw new Error('Address search is temporarily unavailable.');
            const results = await response.json() as { lat: string; lon: string; display_name: string }[];
            if (!results.length) throw new Error('No matching place found. Try a nearby street or landmark.');
            const result = results[0];
            setForm((current) => ({
                ...current,
                latitude: Number(result.lat),
                longitude: Number(result.lon),
                street_address: current.street_address || result.display_name.slice(0, 255),
            }));
            showSuccess('Location found on the map.');
        } catch (requestError: any) {
            const message = requestError.message ?? 'Address search is temporarily unavailable.';
            setError(message);
            showError(message);
        } finally {
            setSearching(false);
        }
    }

    function useCurrentLocation() {
        if (!navigator.geolocation) {
            setError('Location services are not available in this browser.');
            showError('Location services are not available in this browser.');
            return;
        }
        setLocating(true);
        setError('');
        navigator.geolocation.getCurrentPosition((position) => {
            setForm((current) => ({ ...current, latitude: position.coords.latitude, longitude: position.coords.longitude }));
            setLocating(false);
            showSuccess('Current location added to the map.');
        }, () => {
            setError('Your location could not be accessed. Check browser permissions or move the map pin.');
            showError('Your location could not be accessed. Check browser permissions or move the map pin.');
            setLocating(false);
        }, { enableHighAccuracy: true, timeout: 10000 });
    }

    async function saveAddress(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setSaving(true);
        setError('');
        setNotice('');
        try {
            const url = editingAddress ? `/api/buyer/addresses/${editingAddress.id}` : '/api/buyer/addresses';
            await api.request({ method: editingAddress ? 'PUT' : 'POST', url, data: form });
            setModalOpen(false);
            setNotice(editingAddress ? 'Address updated.' : 'Address saved.');
            showSuccess(editingAddress ? 'Address updated.' : 'Address saved.');
            await loadAddresses();
        } catch (requestError: any) {
            const message = requestError.userMessage ?? requestError.response?.data?.message ?? 'The address could not be saved.';
            setError(message);
            showError(message);
        } finally {
            setSaving(false);
        }
    }

    async function deleteAddress(address: BuyerAddress) {
        const confirmed = await confirmAction({ title: 'Delete this address?', text: `The ${address.label} address will be removed from your account.`, confirmText: 'Delete address', danger: true });
        if (!confirmed) return;
        setError('');
        setNotice('');
        try {
            await api.delete(`/api/buyer/addresses/${address.id}`);
            setNotice('Address deleted.');
            showSuccess('Address deleted.');
            await loadAddresses();
        } catch (requestError: any) {
            const message = requestError.userMessage ?? 'The address could not be deleted.';
            setError(message);
            showError(message);
        }
    }

    async function makeDefault(address: BuyerAddress) {
        const confirmed = await confirmAction({ title: 'Set default address?', text: `${address.label} will be used as your preferred delivery address.`, confirmText: 'Set as default' });
        if (!confirmed) return;
        try {
            await api.put(`/api/buyer/addresses/${address.id}`, { ...address, is_default: true });
            setNotice(`${address.label} is now your default address.`);
            showSuccess(`${address.label} is now your default address.`);
            await loadAddresses();
        } catch (requestError: any) {
            const message = requestError.userMessage ?? 'The default address could not be changed.';
            setError(message);
            showError(message);
        }
    }

    return <section className="buyer-addresses" aria-label="Saved delivery addresses">
        <header className="buyer-addresses-toolbar"><div><p className="eyebrow">Delivery details</p><h2>Saved addresses</h2></div><button type="button" onClick={openNewAddress}>Add new address</button></header>
        {error && !modalOpen && <p className="buyer-profile-message error" role="alert">{error}</p>}
        {notice && !modalOpen && <p className="buyer-profile-message success" role="status">{notice}</p>}
        {loading ? <p className="buyer-addresses-loading">Loading addresses...</p> : addresses.length ? <div className="buyer-address-list">{addresses.map((address) => <article className="buyer-address-card" key={address.id}>
            <div className="buyer-address-card-heading"><div><span className="buyer-address-pin" aria-hidden="true">⌖</span><h3>{address.label}</h3>{address.is_default && <span className="buyer-address-default">Default</span>}</div><div className="buyer-address-actions"><button type="button" onClick={() => openEditAddress(address)}>Edit</button><button type="button" className="danger" onClick={() => deleteAddress(address)}>Delete</button></div></div>
            <p className="buyer-address-recipient">{address.recipient_name} <span>{address.phone_number}</span></p>
            <p>{address.street_address}{address.address_line2 ? `, ${address.address_line2}` : ''}{address.barangay ? `, ${address.barangay}` : ''}, {address.city_municipality}, {address.province} {address.postal_code}</p>
            {address.delivery_notes && <small>Delivery note: {address.delivery_notes}</small>}
            {!address.is_default && <button className="buyer-address-make-default" type="button" onClick={() => makeDefault(address)}>Set as default</button>}
        </article>)}</div> : <div className="buyer-profile-empty"><span className="buyer-address-empty-icon" aria-hidden="true">⌖</span><h2>No saved addresses</h2><p>Add a delivery address so your orders can reach you.</p><button type="button" onClick={openNewAddress}>Add your first address</button></div>}

        {modalOpen && <div className="buyer-address-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModalOpen(false); }}>
            <section className="buyer-address-modal" role="dialog" aria-modal="true" aria-labelledby="buyer-address-modal-title">
                <header className="buyer-address-modal-heading"><div><p className="eyebrow">Delivery destination</p><h2 id="buyer-address-modal-title">{editingAddress ? 'Edit address' : 'Add new address'}</h2></div><button type="button" aria-label="Close address form" onClick={() => setModalOpen(false)}>×</button></header>
                <form onSubmit={saveAddress}>
                    <div className="buyer-address-form-grid">
                        <div className="buyer-address-fields">
                            <label>Address label<input value={form.label} onChange={(event) => updateField('label', event.target.value)} placeholder="e.g. Home, Work, Family" maxLength={80} required /><small>Give this address a memorable name.</small></label>
                            <label>Recipient name<input value={form.recipient_name} onChange={(event) => updateField('recipient_name', event.target.value)} placeholder="Full name of the person receiving the order" maxLength={120} required /></label>
                            <label>Phone number<input value={form.phone_number} onChange={(event) => updateField('phone_number', event.target.value)} placeholder="09XXXXXXXXX or +639XXXXXXXXX" inputMode="tel" maxLength={30} required /></label>
                            <section className="buyer-address-section"><h3>Address details</h3>
                                <label>Province<select value={form.province} onChange={(event) => updateProvince(event.target.value)} required>{provinceOptions.map((province) => <option key={province} value={province}>{province}</option>)}</select></label>
                                {form.province === 'Oriental Mindoro' ? <label>City / Municipality<select value={form.city_municipality} onChange={(event) => updateCity(event.target.value)} required>{orientalMindoroCities.map((city) => <option key={city} value={city}>{city}</option>)}</select></label> : <label>City / Municipality<input value={form.city_municipality} onChange={(event) => updateField('city_municipality', event.target.value)} maxLength={120} required /></label>}
                                <label>Barangay<input value={form.barangay} onChange={(event) => updateField('barangay', event.target.value)} placeholder="Barangay" maxLength={120} required /></label>
                                <label>Postal code<input value={form.postal_code} onChange={(event) => updateField('postal_code', event.target.value)} placeholder="Postal code" maxLength={12} required /></label>
                                <label>Street address<input value={form.street_address} onChange={(event) => updateField('street_address', event.target.value)} placeholder="House number, street name, subdivision" maxLength={255} required /></label>
                                <label>Additional info <span>(optional)</span><input value={form.address_line2 ?? ''} onChange={(event) => updateField('address_line2', event.target.value)} placeholder="Barangay, landmark, building name" maxLength={255} /></label>
                                <label>Delivery notes <span>(optional)</span><textarea value={form.delivery_notes ?? ''} onChange={(event) => updateField('delivery_notes', event.target.value)} placeholder="Gate code, nearby landmark, or delivery instructions" rows={3} maxLength={1000} /></label>
                            </section>
                            <label className="buyer-address-default-toggle"><input type="checkbox" checked={form.is_default} onChange={(event) => updateField('is_default', event.target.checked)} /> Set as default address</label>
                        </div>
                        <section className="buyer-address-map-section"><h3>Pin your location</h3><div className="buyer-address-search"><input value={locationSearch} onChange={(event) => setLocationSearch(event.target.value)} placeholder="Search street or landmark" aria-label="Search address on map" /><button type="button" disabled={searching} onClick={searchAddress}>{searching ? 'Searching...' : 'Search'}</button></div><LocationMap latitude={form.latitude} longitude={form.longitude} onChange={(latitude, longitude) => setForm((current) => ({ ...current, latitude, longitude }))} /><p className="buyer-address-map-help">Click the map or drag the pin to set your exact delivery location.</p><p className="buyer-address-coordinates">{form.latitude.toFixed(5)}, {form.longitude.toFixed(5)}</p><button type="button" className="buyer-address-locate" disabled={locating} onClick={useCurrentLocation}>{locating ? 'Locating...' : 'Use my location'}</button></section>
                    </div>
                    {error && <p className="buyer-address-form-error" role="alert">{error}</p>}
                    <footer className="buyer-address-modal-footer"><button type="button" className="secondary" onClick={() => setModalOpen(false)}>Cancel</button><button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save address'}</button></footer>
                </form>
            </section>
        </div>}
    </section>;
}
