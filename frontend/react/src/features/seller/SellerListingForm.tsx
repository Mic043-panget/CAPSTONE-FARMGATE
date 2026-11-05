import React from 'react';
import api, { initializeCsrf } from '../../lib/api';
import { ValidatedField } from '../../shared/components/ValidatedField';
import type { Category } from '../../shared/types';
import { positiveNumber, required } from '../../shared/validation';
import { showSuccess } from '../../lib/alerts';

type SellerListingFormProps = {
    categories: Category[];
    onSaved: () => void;
    onError: (message: string) => void;
};

export function SellerListingForm({ categories, onSaved, onError }: SellerListingFormProps) {
    const [listingName, setListingName] = React.useState('');
    const [listingCategory, setListingCategory] = React.useState('');
    const [pricingType, setPricingType] = React.useState<'PER_KILO' | 'PER_HEAD'>('PER_HEAD');
    const [price, setPrice] = React.useState('');
    const [quantity, setQuantity] = React.useState('1');
    const [photos, setPhotos] = React.useState<Array<File | null>>([null, null, null, null, null]);
    const photoInputRefs = React.useRef<Array<HTMLInputElement | null>>([]);
    const [submitAttempt, setSubmitAttempt] = React.useState(0);

    React.useEffect(() => setListingCategory(String(categories[0]?.id ?? '')), [categories]);

    async function createListing(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setSubmitAttempt((attempt) => attempt + 1);
        const validationError = required(listingName, 'Listing name') ?? positiveNumber(price, 'Price') ?? positiveNumber(quantity, 'Quantity');
        if (validationError) {
            onError(validationError);
            return;
        }

        try {
            await initializeCsrf();
            const formData = new FormData();
            formData.append('category_id', listingCategory);
            formData.append('name', listingName);
            formData.append('quantity', quantity);
            formData.append('pricing_type', pricingType);
            formData.append(pricingType === 'PER_KILO' ? 'price_per_kilo' : 'price_per_head', price);
            photos.forEach((photo) => { if (photo) formData.append('image_files[]', photo); });
            await api.post('/api/seller/listings', formData);
            setListingName('');
            setPrice('');
            setQuantity('1');
            setPhotos([null, null, null, null, null]);
            photoInputRefs.current.forEach((input) => { if (input) input.value = ''; });
            showSuccess('Listing draft saved.');
            onSaved();
        } catch (requestError: any) {
            onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'The listing could not be saved.');
        }
    }

    return <form className="seller-form" noValidate onSubmit={createListing}>
        <h3>Add a livestock listing</h3>
        <ValidatedField validationTrigger={submitAttempt} label="Name" value={listingName} onChange={setListingName} validate={(value) => required(value, 'Listing name')} />
        <ValidatedField validationTrigger={submitAttempt} as="select" label="Category" value={listingCategory} onChange={setListingCategory} validate={(value) => required(value, 'Category')}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</ValidatedField>
        <ValidatedField as="select" label="Pricing" value={pricingType} onChange={(value) => setPricingType(value as 'PER_KILO' | 'PER_HEAD')}><option value="PER_HEAD">Per head</option><option value="PER_KILO">Per kilo</option></ValidatedField>
        <ValidatedField validationTrigger={submitAttempt} label="Price" type="number" value={price} onChange={setPrice} validate={(value) => positiveNumber(value, 'Price')} />
        <ValidatedField validationTrigger={submitAttempt} label={pricingType === 'PER_KILO' ? 'Available kilograms' : 'Available animals'} type="number" value={quantity} onChange={setQuantity} validate={(value) => positiveNumber(value, pricingType === 'PER_KILO' ? 'Available kilograms' : 'Available animals')} />
        <fieldset className="listing-photo-fieldset">
            <legend>Livestock photos (up to 5)</legend>
            <div className="listing-photo-row">
                {photos.map((photo, index) => <label className="listing-photo-slot" key={index}>
                    <span>Photo {index + 1}</span>
                    <input ref={(input) => { photoInputRefs.current[index] = input; }} type="file" accept="image/jpeg,image/png,image/webp" aria-label={`Livestock photo ${index + 1}`} onChange={(event) => {
                        const file = event.currentTarget.files?.[0] ?? null;
                        if (file && (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)) {
                            onError('Choose a JPG, PNG, or WebP photo no larger than 5 MB.');
                            event.currentTarget.value = '';
                            return;
                        }
                        setPhotos((current) => current.map((item, photoIndex) => photoIndex === index ? file : item));
                    }} />
                    {photo && <><span className="listing-photo-name">{photo.name}</span><button type="button" onClick={() => { setPhotos((current) => current.map((item, photoIndex) => photoIndex === index ? null : item)); if (photoInputRefs.current[index]) photoInputRefs.current[index]!.value = ''; }}>Remove</button></>}
                </label>)}
            </div>
            <p>JPG, PNG, or WebP; maximum 5 MB each.</p>
        </fieldset>
        <button type="submit">Save draft</button>
    </form>;
}
