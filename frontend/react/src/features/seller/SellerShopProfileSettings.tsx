import React from 'react';
import api from '../../lib/api';
import { SettingsCategoryIcon } from '../shared/SettingsCategoryIcon';
import { ImageUploadPreview, IMAGE_UPLOAD_HINT, imageUploadError } from '../../shared/components/ImageUploadPreview';
import { FileDropzone } from '../../shared/components/FileDropzone';

type VerificationStatus = 'NOT_SUBMITTED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
type ShopProfile = {
    shop_name: string | null;
    business_name: string | null;
    shop_image_url: string | null;
    verification_status: VerificationStatus;
    verification_rejection_reason: string | null;
    verification_submitted_at: string | null;
    verification_reviewed_at: string | null;
};

function requestErrorMessage(error: unknown, fallback: string): string {
    if (typeof error === 'object' && error !== null && 'userMessage' in error && typeof error.userMessage === 'string') {
        return error.userMessage;
    }

    return fallback;
}

async function validateImageDimensions(file: File, minPixels: number, maxPixels: number): Promise<boolean> {
    const url = URL.createObjectURL(file);
    try {
        return await new Promise((resolve) => {
            const image = new Image();
            image.onload = () => resolve(
                image.naturalWidth >= minPixels
                && image.naturalHeight >= minPixels
                && image.naturalWidth <= maxPixels
                && image.naturalHeight <= maxPixels
                && image.naturalWidth * image.naturalHeight <= 40_000_000,
            );
            image.onerror = () => resolve(false);
            image.src = url;
        });
    } finally {
        URL.revokeObjectURL(url);
    }
}

const verificationLabels: Record<VerificationStatus, string> = {
    NOT_SUBMITTED: 'Not submitted',
    PENDING: 'Pending review',
    VERIFIED: 'Verified',
    REJECTED: 'Rejected',
};

export function SellerShopProfileSettings({ defaultShopName, onSaved }: { defaultShopName: string; onSaved?: () => void }) {
    const [profile, setProfile] = React.useState<ShopProfile | null>(null);
    const [shopName, setShopName] = React.useState(defaultShopName);
    const [shopImage, setShopImage] = React.useState<File | null>(null);
    const [identityDocument, setIdentityDocument] = React.useState<File | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [revision, setRevision] = React.useState(0);
    const [shopSaving, setShopSaving] = React.useState(false);
    const [verificationSaving, setVerificationSaving] = React.useState(false);
    const [shopError, setShopError] = React.useState('');
    const [verificationError, setVerificationError] = React.useState('');
    const [notice, setNotice] = React.useState('');

    React.useEffect(() => {
        let active = true;
        api.get<{ profile: ShopProfile }>('/api/seller/shop-profile')
            .then(({ data }) => {
                if (!active) return;
                setProfile(data.profile);
                setShopName(data.profile.shop_name?.trim() || data.profile.business_name?.trim() || defaultShopName);
            })
            .catch((error: unknown) => {
                if (active) setShopError(requestErrorMessage(error, 'Farm profile settings could not be loaded.'));
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => { active = false; };
    }, [defaultShopName, revision]);

    async function selectShopImage(file: File | undefined) {
        setShopError('');
        if (!file) return;
        const validationError = imageUploadError(file);
        if (validationError) {
            setShopError(validationError);
            return;
        }
        if (!await validateImageDimensions(file, 256, 16384)) {
            setShopError('Use an image with width and height between 256 and 16,384 pixels.');
            return;
        }
        setShopImage(file);
    }

    async function saveShopProfile(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (shopSaving) return;
        setShopSaving(true);
        setShopError('');
        setNotice('');
        const formData = new FormData();
        formData.append('shop_name', shopName.trim());
        if (shopImage) formData.append('shop_image', shopImage);

        try {
            const { data } = await api.post<{ profile: ShopProfile }>('/api/seller/shop-profile', formData);
            setProfile(data.profile);
            setShopName(data.profile.shop_name?.trim() || '');
            setShopImage(null);
            setNotice('Farm profile saved.');
            onSaved?.();
        } catch (error: unknown) {
            setShopError(requestErrorMessage(error, 'Your farm profile could not be saved.'));
        } finally {
            setShopSaving(false);
        }
    }

    async function selectIdentityDocument(file: File | undefined) {
        setVerificationError('');
        if (!file) return;
        if (file.type === 'application/pdf') {
            if (file.size > 8 * 1024 * 1024) {
                setVerificationError('PDF identity documents must be 8 MB or smaller.');
                return;
            }
        } else {
            const validationError = imageUploadError(file);
            if (validationError) {
                setVerificationError(validationError);
                return;
            }
        }
        if (file.type !== 'application/pdf' && !await validateImageDimensions(file, 360, 16384)) {
            setVerificationError('Use a clear image with both dimensions between 360 and 16,384 pixels.');
            return;
        }
        setIdentityDocument(file);
    }

    async function submitVerification(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!identityDocument || verificationSaving || profile?.verification_status === 'PENDING') return;
        setVerificationSaving(true);
        setVerificationError('');
        setNotice('');
        const formData = new FormData();
        formData.append('identity_document', identityDocument);

        try {
            const { data } = await api.post<{ profile: ShopProfile }>('/api/seller/verification/submit', formData);
            setProfile(data.profile);
            setIdentityDocument(null);
            setNotice('Identity document submitted. Your status is Pending review; no Verified badge is shown until an admin approves it.');
            onSaved?.();
        } catch (error: unknown) {
            setVerificationError(requestErrorMessage(error, 'Your identity document could not be submitted.'));
        } finally {
            setVerificationSaving(false);
        }
    }

    const status = profile?.verification_status ?? 'NOT_SUBMITTED';
    const preview = shopImage ? null : profile?.shop_image_url ?? null;

    return <div className="seller-shop-profile-settings">
        <div className="seller-work-heading settings-category-heading">
            <span className="settings-section-icon"><SettingsCategoryIcon name="seller" /></span>
            <div><p className="eyebrow">Public farm page</p><h3 id="seller-shop-profile-heading">Farm profile</h3><p>Manage your public farm page and identity verification status.</p></div>
        </div>
        {loading ? <p className="seller-loading" role="status">Loading farm profile...</p> : <>
            <section className="seller-shop-settings-card" aria-labelledby="seller-shop-branding-title">
                <div><h4 id="seller-shop-branding-title">Farm name and picture</h4><p>These details appear on your public farm page and livestock listing cards.</p></div>
                <form className="seller-shop-profile-form" onSubmit={(event) => void saveShopProfile(event)}>
                    <div className="seller-shop-image-preview">
                        {preview ? <img src={preview} alt="Farm picture preview" /> : <span aria-hidden="true">{shopName.trim().slice(0, 1).toUpperCase() || 'F'}</span>}
                    </div>
                    <div className="seller-shop-brand-fields">
                        <label>Farm name<input type="text" value={shopName} onChange={(event) => setShopName(event.target.value)} minLength={2} maxLength={120} required /></label>
                        <FileDropzone label="Farm picture" accept="image/jpeg,image/png,image/webp" onFiles={(files) => void selectShopImage(files[0])} helperText={`${IMAGE_UPLOAD_HINT} Minimum 256 pixels per side.`} />
                        <ImageUploadPreview file={shopImage} alt="Selected farm picture preview" />
                        <button className="seller-inline-action" type="submit" disabled={shopSaving || loading}>{shopSaving ? 'Saving farm profile...' : 'Save farm profile'}</button>
                    </div>
                </form>
            </section>

            <section className="seller-shop-settings-card seller-verification-settings" aria-labelledby="seller-verification-title">
                <div className="seller-verification-heading">
                    <div><h4 id="seller-verification-title">Identity verification</h4><p>Your ID is private and can only be opened by an authorized admin reviewer.</p></div>
                    <span className={`status-pill status-${status.toLowerCase()}`} role="status">{verificationLabels[status]}</span>
                </div>
                {status === 'REJECTED' && profile?.verification_rejection_reason && <p className="seller-verification-rejection"><strong>Reason:</strong> {profile.verification_rejection_reason}</p>}
                {status === 'PENDING' ? <p className="seller-verification-help">Your document is being reviewed. You can submit a replacement after a decision.</p>
                    : <form className="seller-verification-form" onSubmit={(event) => void submitVerification(event)}>
                        <FileDropzone label="Identity document" accept="image/jpeg,image/png,image/webp,application/pdf" required onFiles={(files) => void selectIdentityDocument(files[0])} helperText="JPEG, PNG, or WebP images up to 10 MB (optimized to 2 MB or smaller); PDF up to 8 MB. Submitting or replacing a document sets status to Pending review. It does not grant a Verified badge." />
                        {identityDocument && <><ImageUploadPreview file={identityDocument} alt="Selected identity document preview" /><p className="seller-verification-file" aria-live="polite">Selected: {identityDocument.name}</p></>}
                        <button className="seller-inline-action" type="submit" disabled={verificationSaving || !identityDocument}>{verificationSaving ? 'Submitting for review...' : status === 'REJECTED' ? 'Resubmit for review' : status === 'VERIFIED' ? 'Submit updated document' : 'Submit for review'}</button>
                    </form>}
            </section>
            {shopError && <p className="seller-shop-settings-error" role="alert">{shopError}{!profile && <button type="button" onClick={() => { setLoading(true); setRevision((value) => value + 1); }}>Retry loading</button>}</p>}
            {verificationError && <p className="seller-shop-settings-error" role="alert">{verificationError}</p>}
            {notice && <p className="seller-notice" role="status">{notice}</p>}
        </>}
    </div>;
}
