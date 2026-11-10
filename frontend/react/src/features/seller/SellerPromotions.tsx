import React from 'react';
import { LoadingSkeleton } from '../../shared/components/LoadingSkeleton';
import api, { initializeCsrf } from '../../lib/api';
import { confirmAction, showSuccess } from '../../lib/alerts';
import { Pagination } from '../../shared/components/Pagination';
import { SystemCalendar } from '../shared/SystemCalendar';

type EligibleListing = {
    id: number;
    name: string;
    pricing_type: 'PER_KILO' | 'PER_HEAD';
    status?: string;
    price_per_kilo?: string;
    price_per_head?: string;
};

type Promotion = {
    id: number;
    name: string;
    description: string | null;
    discount_type: 'PERCENTAGE' | 'FIXED';
    discount_value: string;
    applies_to_all: boolean;
    status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ENDED';
    starts_at: string;
    ends_at: string;
    listings: EligibleListing[];
    image_url: string | null;
};

type PromotionForm = {
    name: string;
    description: string;
    discount_type: 'PERCENTAGE' | 'FIXED';
    discount_value: string;
    applies_to_all: boolean;
    listing_ids: number[];
    starts_at: string;
    ends_at: string;
    image: File | null;
};

const emptyForm = (): PromotionForm => ({
    name: '',
    description: '',
    discount_type: 'PERCENTAGE',
    discount_value: '',
    applies_to_all: true,
    listing_ids: [],
    starts_at: '',
    ends_at: '',
    image: null,
});

const MAX_PROMOTION_IMAGE_BYTES = 5 * 1024 * 1024;
const allowedPromotionImageTypes = ['image/jpeg', 'image/png', 'image/webp'];
const allowedPromotionImageExtensions = ['jpg', 'jpeg', 'png', 'webp'];

function toLocalDateTime(value: string): string {
    const date = new Date(value);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
}

function toIsoDateTime(value: string): string {
    return new Date(value).toISOString();
}

function errorMessage(error: any): string {
    const validation = error.response?.data?.errors;
    if (validation) return Object.values(validation).flat().join(' ');
    return error.userMessage ?? error.response?.data?.message ?? 'The promotion request could not be completed.';
}

export function SellerPromotions({ onError }: { onError: (message: string) => void }) {
    const [activeTab, setActiveTab] = React.useState<'promotions' | 'events'>(() =>
        /^#calendar\/(?:event|promotion)\/\d+$/.test(window.location.hash) ? 'events' : 'promotions',
    );
    const [clock, setClock] = React.useState(Date.now());
    const [promotions, setPromotions] = React.useState<Promotion[]>([]);
    const [page, setPage] = React.useState(1);
    const [lastPage, setLastPage] = React.useState(1);
    const [totalPromotions, setTotalPromotions] = React.useState(0);
    const [listings, setListings] = React.useState<EligibleListing[]>([]);
    const [knownListings, setKnownListings] = React.useState<Record<number, EligibleListing>>({});
    const [inactiveSelectedListings, setInactiveSelectedListings] = React.useState<EligibleListing[]>([]);
    const [eligibleListingPage, setEligibleListingPage] = React.useState(1);
    const [eligibleListingsLastPage, setEligibleListingsLastPage] = React.useState(1);
    const [loading, setLoading] = React.useState(true);
    const [form, setForm] = React.useState<PromotionForm | null>(null);
    const [editing, setEditing] = React.useState<number | null>(null);
    const [saving, setSaving] = React.useState(false);
    const [existingImageUrl, setExistingImageUrl] = React.useState<string | null>(null);
    const [removeExistingImage, setRemoveExistingImage] = React.useState(false);
    const [imageError, setImageError] = React.useState('');
    const imageInputRef = React.useRef<HTMLInputElement>(null);
    const [localImagePreview, setLocalImagePreview] = React.useState<string | null>(null);

    React.useEffect(() => {
        const syncTabWithHash = () => {
            if (/^#calendar\/(?:event|promotion)\/\d+$/.test(window.location.hash)) {
                setActiveTab('events');
            }
        };
        window.addEventListener('hashchange', syncTabWithHash);
        return () => window.removeEventListener('hashchange', syncTabWithHash);
    }, []);

    const reload = React.useCallback(async () => {
        setLoading(true);
        try {
            const [promotionResponse, listingResponse] = await Promise.all([
                api.get<{ promotions: { data: Promotion[]; last_page: number; total: number } }>('/api/seller/promotions', { params: { page } }),
                api.get<{ listings: { data: EligibleListing[]; last_page: number } }>('/api/seller/promotions/eligible-listings', { params: { page: eligibleListingPage } }),
            ]);
            setPromotions(promotionResponse.data.promotions.data);
            setLastPage(promotionResponse.data.promotions.last_page);
            setTotalPromotions(promotionResponse.data.promotions.total);
            setListings(listingResponse.data.listings.data);
            setKnownListings((current) => ({
                ...current,
                ...Object.fromEntries(promotionResponse.data.promotions.data.flatMap((promotion) => promotion.listings).map((listing) => [listing.id, listing])),
                ...Object.fromEntries(listingResponse.data.listings.data.map((listing) => [listing.id, listing])),
            }));
            setEligibleListingsLastPage(listingResponse.data.listings.last_page);
        } catch (error) {
            onError(errorMessage(error));
        } finally {
            setLoading(false);
        }
    }, [eligibleListingPage, onError, page]);

    React.useEffect(() => { void reload(); }, [reload]);

    React.useEffect(() => {
        const timer = window.setInterval(() => setClock(Date.now()), 60_000);
        return () => window.clearInterval(timer);
    }, []);

    React.useEffect(() => {
        if (!localImagePreview) return;
        return () => URL.revokeObjectURL(localImagePreview);
    }, [localImagePreview]);

    function beginEdit(promotion: Promotion) {
        setEditing(promotion.id);
        setInactiveSelectedListings(promotion.listings.filter((listing) => listing.status !== 'ACTIVE'));
        setForm({
            name: promotion.name,
            description: promotion.description ?? '',
            discount_type: promotion.discount_type,
            discount_value: promotion.discount_value,
            applies_to_all: promotion.applies_to_all,
            listing_ids: promotion.listings.map((listing) => listing.id),
            starts_at: toLocalDateTime(promotion.starts_at),
            ends_at: toLocalDateTime(promotion.ends_at),
            image: null,
        });
        setExistingImageUrl(promotion.image_url);
        setRemoveExistingImage(false);
        setImageError('');
        setLocalImagePreview(null);
    }

    function clearPromotionForm() {
        setForm(null);
        setEditing(null);
        setExistingImageUrl(null);
        setRemoveExistingImage(false);
        setImageError('');
        setLocalImagePreview(null);
        if (imageInputRef.current) imageInputRef.current.value = '';
    }

    function beginCreate() {
        clearPromotionForm();
        setInactiveSelectedListings([]);
        setForm(emptyForm());
    }

    function selectPromotionImage(file: File | null) {
        if (!file) return;
        const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
        if (!allowedPromotionImageExtensions.includes(extension) || (file.type !== '' && !allowedPromotionImageTypes.includes(file.type))) {
            setImageError('Choose a JPG, PNG, or WebP image.');
            if (imageInputRef.current) imageInputRef.current.value = '';
            return;
        }
        if (file.size > MAX_PROMOTION_IMAGE_BYTES) {
            setImageError('The promotion image must be 5 MB or smaller.');
            if (imageInputRef.current) imageInputRef.current.value = '';
            return;
        }
        setImageError('');
        setLocalImagePreview(URL.createObjectURL(file));
        setRemoveExistingImage(false);
        updateForm('image', file);
    }

    function removePromotionImage() {
        setLocalImagePreview(null);
        if (imageInputRef.current) imageInputRef.current.value = '';
        if (form?.image) {
            updateForm('image', null);
            setRemoveExistingImage(false);
        } else if (existingImageUrl) {
            setRemoveExistingImage(true);
        }
        setImageError('');
    }

    async function save(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!form) return;
        setSaving(true);
        try {
            await initializeCsrf();
            const payload = new FormData();
            payload.append('name', form.name);
            payload.append('description', form.description);
            payload.append('discount_type', form.discount_type);
            payload.append('discount_value', form.discount_value);
            payload.append('applies_to_all', form.applies_to_all ? '1' : '0');
            payload.append('starts_at', toIsoDateTime(form.starts_at));
            payload.append('ends_at', toIsoDateTime(form.ends_at));
            payload.append('remove_image', removeExistingImage ? '1' : '0');
            if (!form.applies_to_all) form.listing_ids.forEach((id) => payload.append('listing_ids[]', String(id)));
            if (form.image) payload.append('image', form.image);
            if (editing) {
                payload.append('_method', 'PUT');
                await api.post(`/api/seller/promotions/${editing}`, payload);
            } else {
                await api.post('/api/seller/promotions', payload);
            }
            setPage(1);
            clearPromotionForm();
            showSuccess(editing ? 'Promotion updated.' : 'Draft promotion saved.');
            if (page === 1) await reload();
        } catch (error) {
            onError(errorMessage(error));
        } finally {
            setSaving(false);
        }
    }

    async function transition(promotion: Promotion, action: 'activate' | 'pause' | 'end' | 'delete') {
        const confirmed = await confirmAction({
            title: action === 'end' ? 'End this promotion?' : action === 'delete' ? 'Delete this draft?' : `${action === 'activate' ? (promotion.status === 'PAUSED' ? 'Resume' : 'Activate') : 'Pause'} this promotion?`,
            text: action === 'end' ? 'It will no longer apply to buyers.' : 'This change will be saved to your promotion.',
            confirmText: action === 'end' ? 'End promotion' : action === 'delete' ? 'Delete draft' : action === 'activate' ? 'Continue' : 'Pause promotion',
        });
        if (!confirmed) return;
        try {
            await initializeCsrf();
            if (action === 'delete') await api.delete(`/api/seller/promotions/${promotion.id}`);
            else await api.post(`/api/seller/promotions/${promotion.id}/${action}`);
            showSuccess(action === 'delete' ? 'Draft promotion deleted.' : `Promotion ${action === 'activate' ? 'activated' : action === 'end' ? 'ended' : 'paused'}.`);
            await reload();
        } catch (error) {
            onError(errorMessage(error));
        }
    }

    function updateForm<K extends keyof PromotionForm>(key: K, value: PromotionForm[K]) {
        setForm((current) => current ? { ...current, [key]: value } : current);
    }

    function previewPrice(listing: EligibleListing): { original: number; discounted: number; savings: number } {
        const originalCents = Math.round(Number(listing.pricing_type === 'PER_KILO' ? listing.price_per_kilo : listing.price_per_head) * 100);
        const discount = Number(form?.discount_value ?? 0);
        const discountCents = form?.discount_type === 'PERCENTAGE'
            ? Math.round(originalCents * discount / 100)
            : Math.round(discount * 100);
        const discountedCents = Math.max(0, originalCents - discountCents);
        return { original: originalCents / 100, discounted: discountedCents / 100, savings: (originalCents - discountedCents) / 100 };
    }

    const selectedPreviewListings = form?.applies_to_all
        ? listings
        : [...new Map(
            [...Object.values(knownListings), ...inactiveSelectedListings]
                .filter((listing) => form?.listing_ids.includes(listing.id))
                .map((listing) => [listing.id, listing]),
        ).values()];

    return <>
        <nav className="seller-promotion-tabs" role="group" aria-label="Seller promotions area">
            <button type="button" aria-pressed={activeTab === 'promotions'} className={activeTab === 'promotions' ? 'active' : ''} onClick={() => setActiveTab('promotions')}>Promotions</button>
            <button type="button" aria-pressed={activeTab === 'events'} className={activeTab === 'events' ? 'active' : ''} onClick={() => setActiveTab('events')}>Events</button>
        </nav>
        {activeTab === 'events' ? <SystemCalendar role="SELLER" onError={onError} /> : <section className="seller-work-section" aria-labelledby="seller-promotions-title">
        <div className="seller-work-heading">
            <div><p className="eyebrow">Offers &amp; discounts</p><h2 id="seller-promotions-title">Promotions</h2></div>
            <span>{totalPromotions} total promotions</span>
            <button className="seller-inline-action" type="button" onClick={() => form ? clearPromotionForm() : beginCreate()}>{form ? 'Close form' : 'Create promotion +'}</button>
        </div>
        <p>Create date-bounded discounts for all eligible listings or selected active listings. Promotions with overlapping dates cannot apply to the same listing.</p>
        {form && <form className="seller-promotion-form" onSubmit={save}>
            <label>Promotion name<input required maxLength={120} value={form.name} onChange={(event) => updateForm('name', event.target.value)} /></label>
            <label>Description <span>(optional)</span><textarea maxLength={2000} value={form.description} onChange={(event) => updateForm('description', event.target.value)} /></label>
            <section className="seller-promotion-image-field" aria-labelledby="seller-promotion-image-heading">
                <h3 id="seller-promotion-image-heading">Promotion image <span>(optional, JPG, PNG, or WebP; up to 5 MB)</span></h3>
                <label htmlFor="seller-promotion-image">Choose image file</label>
                <input ref={imageInputRef} id="seller-promotion-image" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" aria-describedby={imageError ? 'seller-promotion-image-help seller-promotion-image-error' : 'seller-promotion-image-help'} onChange={(event) => selectPromotionImage(event.target.files?.[0] ?? null)} />
                <p id="seller-promotion-image-help">Choose an image to upload. Selecting another image replaces the current selection.</p>
                {imageError && <p id="seller-promotion-image-error" className="seller-promotion-image-error" role="alert">{imageError}</p>}
                {(localImagePreview || (existingImageUrl && !removeExistingImage)) && <div className="seller-promotion-image-preview">
                    <img src={localImagePreview ?? existingImageUrl ?? undefined} alt="Promotion image preview" />
                    <button className="seller-table-action seller-promotion-remove-image" type="button" onClick={removePromotionImage}>Remove image</button>
                </div>}
                {removeExistingImage && <p role="status">The saved image will be removed when you save.</p>}
            </section>
            <div className="seller-promotion-fields">
                <label>Discount type<select value={form.discount_type} onChange={(event) => updateForm('discount_type', event.target.value as PromotionForm['discount_type'])}><option value="PERCENTAGE">Percentage</option><option value="FIXED">Fixed amount (PHP)</option></select></label>
                <label>{form.discount_type === 'PERCENTAGE' ? 'Discount (%)' : 'Discount (PHP)'}<input type="number" min="0.01" max={form.discount_type === 'PERCENTAGE' ? 100 : undefined} step="0.01" required value={form.discount_value} onChange={(event) => updateForm('discount_value', event.target.value)} /></label>
            </div>
            <fieldset><legend>Livestock listing scope</legend>
                <label className="seller-promotion-radio"><input type="radio" checked={form.applies_to_all} onChange={() => updateForm('applies_to_all', true)} /> All eligible active listings</label>
                <label className="seller-promotion-radio"><input type="radio" checked={!form.applies_to_all} onChange={() => updateForm('applies_to_all', false)} /> Selected active listings</label>
                {!form.applies_to_all && <><div className="seller-promotion-listings">{inactiveSelectedListings.filter((listing) => form.listing_ids.includes(listing.id)).map((listing) => <label key={listing.id}><input type="checkbox" checked onChange={() => updateForm('listing_ids', form.listing_ids.filter((id) => id !== listing.id))} />{listing.name} <small>Unavailable — deselect to continue</small></label>)}{listings.length ? listings.map((listing) => <label key={listing.id}><input type="checkbox" checked={form.listing_ids.includes(listing.id)} onChange={(event) => updateForm('listing_ids', event.target.checked ? [...form.listing_ids, listing.id] : form.listing_ids.filter((id) => id !== listing.id))} />{listing.name} <small>PHP {Number(listing.pricing_type === 'PER_KILO' ? listing.price_per_kilo : listing.price_per_head).toLocaleString()} / {listing.pricing_type === 'PER_KILO' ? 'kg' : 'head'}</small></label>) : <p>No eligible active listings.</p>}</div><Pagination page={eligibleListingPage} lastPage={eligibleListingsLastPage} onChange={setEligibleListingPage} /></>}
            </fieldset>
            <section className="seller-promotion-preview" aria-labelledby="seller-promotion-preview-title">
                <h3 id="seller-promotion-preview-title">Included livestock listings and price preview</h3>
                {form.applies_to_all && <p>All eligible active listings are included. The preview below shows the currently loaded page; the promotion applies to all eligible listings, including other pages.</p>}
                {!form.applies_to_all && !selectedPreviewListings.length && <p>Select at least one active livestock listing to preview its discounted price.</p>}
                {selectedPreviewListings.length > 0 && <div className="seller-promotion-preview-list">
                    {selectedPreviewListings.map((listing) => {
                        const preview = previewPrice(listing);
                        return <p key={listing.id}><strong>{listing.name}</strong><span>{preview.original.toLocaleString('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 })} → {preview.discounted.toLocaleString('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 })} / {listing.pricing_type === 'PER_KILO' ? 'kg' : 'head'}</span><small>Save {preview.savings.toLocaleString('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 })} per unit</small></p>;
                    })}
                </div>}
            </section>
            <div className="seller-promotion-fields">
                <label>Starts at<input type="datetime-local" required value={form.starts_at} onChange={(event) => updateForm('starts_at', event.target.value)} /></label>
                <label>Ends at<input type="datetime-local" required value={form.ends_at} onChange={(event) => updateForm('ends_at', event.target.value)} /></label>
            </div>
            <div className="seller-promotion-form-actions"><button className="seller-inline-action" type="submit" disabled={saving || Boolean(imageError)}>{saving ? 'Saving...' : editing ? 'Save changes' : 'Save as draft'}</button><button className="seller-table-action" type="button" onClick={clearPromotionForm}>Cancel</button></div>
        </form>}
        {loading ? <LoadingSkeleton variant="cards" count={3} label="Loading seller promotions" /> : promotions.length ? <div className="seller-promotion-list">{promotions.map((promotion) => {
            const expired = new Date(promotion.ends_at).getTime() <= clock;
            const scheduled = new Date(promotion.starts_at).getTime() > clock;
            const status = promotion.status === 'DRAFT' ? 'DRAFT' : expired ? 'ENDED' : promotion.status === 'ACTIVE' ? scheduled ? 'SCHEDULED' : 'ACTIVE' : promotion.status;
            return <article className="seller-promotion-card" key={promotion.id}>
                <div className="seller-promotion-card-heading"><div><h3>{promotion.name}</h3><span className={`status-pill status-${status.toLowerCase()}`}>{status}</span></div><strong>{promotion.discount_type === 'PERCENTAGE' ? `${Number(promotion.discount_value)}% off` : `PHP ${Number(promotion.discount_value).toLocaleString()} off`}</strong></div>
                {promotion.image_url && <img className="seller-promotion-card-image" src={promotion.image_url} alt={`${promotion.name} promotion`} />}
                {promotion.description && <p>{promotion.description}</p>}
                <p>{promotion.applies_to_all ? 'All eligible active listings' : promotion.listings.map((listing) => listing.name).join(', ') || 'Selected listings'}</p>
                <p className="seller-promotion-dates">{new Date(promotion.starts_at).toLocaleString()} – {new Date(promotion.ends_at).toLocaleString()}</p>
                <div className="seller-promotion-actions">
                    {['DRAFT', 'PAUSED', 'ACTIVE'].includes(promotion.status) && !expired && <button type="button" className="seller-table-action" onClick={() => beginEdit(promotion)}>Edit</button>}
                    {['DRAFT', 'PAUSED'].includes(promotion.status) && <button type="button" className="seller-table-action" onClick={() => void transition(promotion, 'activate')}>{promotion.status === 'PAUSED' ? 'Resume' : 'Activate'}</button>}
                    {promotion.status === 'ACTIVE' && !expired && <button type="button" className="seller-table-action" onClick={() => void transition(promotion, 'pause')}>Pause</button>}
                    {['ACTIVE', 'PAUSED'].includes(promotion.status) && <button type="button" className="seller-table-action" onClick={() => void transition(promotion, 'end')}>End</button>}
                    {promotion.status === 'DRAFT' && <button type="button" className="seller-table-action" onClick={() => void transition(promotion, 'delete')}>Delete draft</button>}
                </div>
            </article>;
        })}</div> : <p className="seller-empty">No promotions yet. Create a draft to prepare an offer for your active listings.</p>}
        <Pagination page={page} lastPage={lastPage} onChange={setPage} />
        </section>}
    </>;
}
