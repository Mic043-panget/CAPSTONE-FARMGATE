import React from 'react';
import api, { initializeCsrf } from '../../lib/api';
import { ValidatedField } from '../../shared/components/ValidatedField';
import type { Category, Listing } from '../../shared/types';
import { positiveNumber, required } from '../../shared/validation';

type EditableListing = Listing & {
    breed?: string | null;
    sex?: string | null;
    age_months?: number | null;
    description?: string | null;
    pickup_location?: string | null;
    health_information?: string | null;
    vaccination_information?: string | null;
};

type SellerListingEditorProps = {
    listing: EditableListing;
    categories: Category[];
    onSaved: () => void;
    onCancel: () => void;
    onError: (message: string) => void;
};

export function SellerListingEditor({ listing, categories, onSaved, onCancel, onError }: SellerListingEditorProps) {
    const headingRef = React.useRef<HTMLHeadingElement>(null);
    const [name, setName] = React.useState(listing.name);
    const [categoryId, setCategoryId] = React.useState(String(listing.category.id));
    const [pricingType, setPricingType] = React.useState<'PER_KILO' | 'PER_HEAD'>(listing.pricing_type);
    const [price, setPrice] = React.useState(listing.pricing_type === 'PER_KILO' ? listing.price_per_kilo ?? '' : listing.price_per_head ?? '');
    const [quantity, setQuantity] = React.useState(String(listing.quantity));
    const [breed, setBreed] = React.useState(listing.breed ?? '');
    const [sex, setSex] = React.useState(listing.sex ?? '');
    const [ageMonths, setAgeMonths] = React.useState(listing.age_months == null ? '' : String(listing.age_months));
    const [estimatedWeight, setEstimatedWeight] = React.useState(listing.estimated_weight_kg ?? '');
    const [description, setDescription] = React.useState(listing.description ?? '');
    const [pickupLocation, setPickupLocation] = React.useState(listing.pickup_location ?? '');
    const [healthInformation, setHealthInformation] = React.useState(listing.health_information ?? '');
    const [vaccinationInformation, setVaccinationInformation] = React.useState(listing.vaccination_information ?? '');
    const [saving, setSaving] = React.useState(false);
    const [submitAttempt, setSubmitAttempt] = React.useState(0);

    React.useEffect(() => {
        headingRef.current?.focus();
    }, []);

    async function saveListing(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setSubmitAttempt((attempt) => attempt + 1);
        const quantityValue = Number(quantity);
        const ageValue = ageMonths === '' ? null : Number(ageMonths);
        const validationError = required(name, 'Listing name')
            ?? required(categoryId, 'Category')
            ?? positiveNumber(price, 'Price')
            ?? (!Number.isInteger(quantityValue) || quantityValue <= 0 ? 'Quantity must be a positive whole number.' : null)
            ?? (ageValue !== null && (!Number.isInteger(ageValue) || ageValue < 0) ? 'Age must be a whole number of months.' : null)
            ?? (estimatedWeight !== '' && Number(estimatedWeight) <= 0 ? 'Estimated weight must be greater than zero.' : null);
        if (validationError) {
            onError(validationError);
            return;
        }

        setSaving(true);
        try {
            await initializeCsrf();
            await api.put(`/api/seller/listings/${listing.id}`, {
                category_id: Number(categoryId),
                name: name.trim(),
                breed: breed.trim() || null,
                sex: sex.trim() || null,
                age_months: ageValue,
                estimated_weight_kg: estimatedWeight || null,
                quantity: quantityValue,
                description: description.trim() || null,
                pickup_location: pickupLocation.trim() || null,
                health_information: healthInformation.trim() || null,
                vaccination_information: vaccinationInformation.trim() || null,
                pricing_type: pricingType,
                price_per_kilo: pricingType === 'PER_KILO' ? price : null,
                price_per_head: pricingType === 'PER_HEAD' ? price : null,
            });
            onSaved();
        } catch (requestError: any) {
            onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'The listing could not be updated.');
        } finally {
            setSaving(false);
        }
    }

    return <form className="seller-listing-editor" noValidate onSubmit={saveListing} aria-labelledby={`edit-listing-title-${listing.id}`}>
        <h3 ref={headingRef} id={`edit-listing-title-${listing.id}`} tabIndex={-1}>Edit {listing.name}</h3>
        <div className="seller-listing-editor-fields">
            <ValidatedField validationTrigger={submitAttempt} label="Listing name" value={name} onChange={setName} validate={(value) => required(value, 'Listing name')} maxLength={180} />
            <ValidatedField validationTrigger={submitAttempt} as="select" label="Category" value={categoryId} onChange={setCategoryId} validate={(value) => required(value, 'Category')}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</ValidatedField>
            <ValidatedField as="select" label="Pricing type" value={pricingType} onChange={(value) => {
                setPricingType(value as 'PER_KILO' | 'PER_HEAD');
                setPrice('');
            }}><option value="PER_HEAD">Per head</option><option value="PER_KILO">Per kilo</option></ValidatedField>
            <ValidatedField validationTrigger={submitAttempt} label="Price" type="number" value={price} onChange={setPrice} validate={(value) => positiveNumber(value, 'Price')} />
            <ValidatedField validationTrigger={submitAttempt} label="Available quantity" type="number" value={quantity} onChange={setQuantity} validate={(value) => {
                const number = Number(value);
                return Number.isInteger(number) && number > 0 ? null : 'Quantity must be a positive whole number.';
            }} />
            <ValidatedField label="Breed" value={breed} onChange={setBreed} maxLength={120} />
            <ValidatedField label="Sex" value={sex} onChange={setSex} maxLength={20} />
            <ValidatedField label="Age (months)" type="number" value={ageMonths} onChange={setAgeMonths} />
            <ValidatedField label="Estimated weight (kg)" type="number" value={estimatedWeight} onChange={setEstimatedWeight} />
            <ValidatedField as="textarea" label="Description" value={description} onChange={setDescription} maxLength={5000} />
            <ValidatedField label="Pickup location details" value={pickupLocation} onChange={setPickupLocation} maxLength={500} />
            <ValidatedField as="textarea" label="Health information" value={healthInformation} onChange={setHealthInformation} maxLength={3000} />
            <ValidatedField as="textarea" label="Vaccination information" value={vaccinationInformation} onChange={setVaccinationInformation} maxLength={3000} />
        </div>
        <div className="seller-listing-editor-actions">
            <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</button>
            <button type="button" className="seller-listing-cancel" disabled={saving} onClick={onCancel}>Cancel</button>
        </div>
    </form>;
}
