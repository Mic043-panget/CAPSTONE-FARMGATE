import React from 'react';
import api from '../../lib/api';

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
                && image.naturalHeight <= maxPixels,
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

export function SellerShopProfileSettings({ defaultShopName }: { defaultShopName: string }) {
    const [profile, setProfile] = React.useState<ShopProfile | null>(null);
    const [shopName, setShopName] = React.useState(defaultShopName);
    const [shopImage, setShopImage] = React.useState<File | null>(null);
    const [imagePreview, setImagePreview] = React.useState<string | null>(null);
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
                if (active) setShopError(requestErrorMessage(error, 'Shop profile settings could not be loaded.'));
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => { active = false; };
    }, [defaultShopName, revision]);

    React.useEffect(() => {
        if (!shopImage) {
            setImagePreview(null);
            return undefined;
        }
        const url = URL.createObjectURL(shopImage);
        setImagePreview(url);
        return () => URL.revokeObjectURL(url);
    }, [shopImage]);

    async function selectShopImage(file: File | undefined) {
        setShopError('');
        setShopImage(null);
        if (!file) return;
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
            setShopError('Choose a JPG, PNG, or WebP image.');
            return;
        }
        if (file.size > 4 * 1024 * 1024) {
            setShopError('Shop images must be 4 MB or smaller.');
            return;
        }
        if (!await validateImageDimensions(file, 256, 4096)) {
            setShopError('Use an image with width and height between 256 and 4096 pixels.');
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
            setNotice('Shop profile saved.');
        } catch (error: unknown) {
            setShopError(requestErrorMessage(error, 'Your shop profile could not be saved.'));
        } finally {
            setShopSaving(false);
        }
    }

    async function selectIdentityDocument(file: File | undefined) {
        setVerificationError('');
        setIdentityDocument(null);
        if (!file) return;
        if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type)) {
            setVerificationError('Choose a JPG, PNG, or PDF identity document.');
            return;
        }
        if (file.size > 8 * 1024 * 1024) {
            setVerificationError('Identity documents must be 8 MB or smaller.');
            return;
        }
        if (file.type.startsWith('image/') && !await validateImageDimensions(file, 360, 8192)) {
            setVerificationError('Use a clear image with both dimensions between 360 and 8192 pixels.');
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
        } catch (error: unknown) {
            setVerificationError(requestErrorMessage(error, 'Your identity document could not be submitted.'));
        } finally {
            setVerificationSaving(false);
        }
    }

    const status = profile?.verification_status ?? 'NOT_SUBMITTED';
    const preview = imagePreview ?? profile?.shop_image_url ?? null;

    return <div className="seller-shop-profile-settings">
        <div className="seller-work-heading">
            <div><p className="eyebrow">Public storefront</p><h3 id="seller-shop-profile-heading">Shop profile</h3></div>
        </div>
        {loading ? <p className="seller-loading" role="status">Loading shop profile...</p> : <>
            <section className="seller-shop-settings-card" aria-labelledby="seller-shop-branding-title">
                <div><h4 id="seller-shop-branding-title">Shop name and picture</h4><p>These details appear on your public shop and livestock listing cards.</p></div>
                <form className="seller-shop-profile-form" onSubmit={(event) => void saveShopProfile(event)}>
                    <div className="seller-shop-image-preview">
                        {preview ? <img src={preview} alt="Shop picture preview" /> : <span aria-hidden="true">{shopName.trim().slice(0, 1).toUpperCase() || 'F'}</span>}
                    </div>
                    <div className="seller-shop-brand-fields">
                        <label>Shop name<input type="text" value={shopName} onChange={(event) => setShopName(event.target.value)} minLength={2} maxLength={120} required /></label>
                        <label>Shop picture <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void selectShopImage(event.target.files?.[0])} /><small>JPG, PNG, or WebP; up to 4 MB; 256–4096 px per side.</small></label>
                        <button className="seller-inline-action" type="submit" disabled={shopSaving || loading}>{shopSaving ? 'Saving shop profile...' : 'Save shop profile'}</button>
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
                        <label>Identity document
                            <input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(event) => void selectIdentityDocument(event.target.files?.[0])} required />
                            <small>JPG, PNG, or PDF; up to 8 MB. Submitting or replacing a document sets status to Pending review. It does not grant a Verified badge.</small>
                        </label>
                        {identityDocument && <p className="seller-verification-file" aria-live="polite">Selected: {identityDocument.name}</p>}
                        <button className="seller-inline-action" type="submit" disabled={verificationSaving || !identityDocument}>{verificationSaving ? 'Submitting for review...' : status === 'REJECTED' ? 'Resubmit for review' : status === 'VERIFIED' ? 'Submit updated document' : 'Submit for review'}</button>
                    </form>}
            </section>
            {shopError && <p className="seller-shop-settings-error" role="alert">{shopError}{!profile && <button type="button" onClick={() => { setLoading(true); setRevision((value) => value + 1); }}>Retry loading</button>}</p>}
            {verificationError && <p className="seller-shop-settings-error" role="alert">{verificationError}</p>}
            {notice && <p className="seller-notice" role="status">{notice}</p>}
        </>}
    </div>;
}
