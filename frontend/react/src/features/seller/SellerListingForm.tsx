import React from 'react';
import api, { initializeCsrf } from '../../lib/api';
import { ValidatedField } from '../../shared/components/ValidatedField';
import type { Category } from '../../shared/types';
import { positiveNumber, required } from '../../shared/validation';
import { showSuccess } from '../../lib/alerts';
import { ImageUploadPreview, IMAGE_UPLOAD_HINT, imageUploadError } from '../../shared/components/ImageUploadPreview';
import { FileDropzone } from '../../shared/components/FileDropzone';
import { compressListingImage } from '../../shared/imageCompression';

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
    const [photos, setPhotos] = React.useState<File[]>([]);
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
            for (const photo of photos) formData.append('image_files[]', await compressListingImage(photo));
            await api.post('/api/seller/listings', formData);
            setListingName('');
            setPrice('');
            setQuantity('1');
            setPhotos([]);
            showSuccess('Listing draft saved.');
            onSaved();
        } catch (requestError: any) {
            onError(requestError.userMessage ?? requestError.response?.data?.message ?? requestError.message ?? 'The listing could not be saved.');
        }
    }

    function addPhotos(files: File[]) {
        const invalid = files.find((file) => imageUploadError(file));
        if (invalid) {
            onError(imageUploadError(invalid) ?? 'Choose a supported image.');
            return;
        }
        if (photos.length + files.length > 5) {
            onError('Choose no more than 5 livestock photos.');
            return;
        }
        setPhotos((current) => [...current, ...files]);
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
            <FileDropzone
                label="Select multiple livestock photos"
                accept="image/jpeg,image/png,image/webp"
                multiple
                disabled={photos.length >= 5}
                buttonLabel={photos.length >= 5 ? 'Maximum reached' : 'Choose photos'}
                onFiles={addPhotos}
                helperText={`${IMAGE_UPLOAD_HINT} Listing photos are compressed in your browser before upload.`}
            />
            {photos.length > 0 && <div className="listing-photo-row">
                {photos.map((photo, index) => <div className="listing-photo-slot" key={`${photo.name}-${photo.lastModified}-${index}`}>
                    <span>Photo {index + 1}</span>
                    <ImageUploadPreview file={photo} alt={`Livestock photo ${index + 1} preview`} />
                    <span className="listing-photo-name">{photo.name}</span>
                    <button type="button" onClick={() => setPhotos((current) => current.filter((_, photoIndex) => photoIndex !== index))}>Remove</button>
                </div>)}
            </div>}
        </fieldset>
        <button type="submit">Save draft</button>
    </form>;
}
