import React from 'react';
import api from '../../lib/api';

function ProofMetadataIcon({ name }: { name: 'check' | 'calendar' | 'photo' }) {
    return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {name === 'check' ? <path d="m5 12 4 4L19 6" />
            : name === 'calendar' ? <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>
                : <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9" r="1.5" /><path d="m21 15-5-5L5 20" /></>}
    </svg>;
}

export function DeliveryProofSummary({ deliveryId, hasProof, recipientConfirmed, recipientName, capturedAt, recordedAt, showMetadataIcons = false }: {
    deliveryId: number;
    hasProof: boolean;
    recipientConfirmed?: boolean;
    recipientName?: string | null;
    capturedAt?: string | null;
    recordedAt?: string | null;
    showMetadataIcons?: boolean;
}) {
    const [expanded, setExpanded] = React.useState(false);
    const [imageUrl, setImageUrl] = React.useState('');
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState('');

    React.useEffect(() => {
        if (!expanded || !hasProof) return undefined;
        let active = true;
        let objectUrl = '';
        setLoading(true);
        setError('');
        api.get(`/api/deliveries/${deliveryId}/proof`, { responseType: 'blob' })
            .then((response) => {
                if (!active) return;
                objectUrl = URL.createObjectURL(response.data);
                setImageUrl(objectUrl);
            })
            .catch((requestError: any) => {
                if (active) setError(requestError.userMessage ?? 'The private delivery photo could not be loaded. Try again.');
            })
            .finally(() => { if (active) setLoading(false); });
        return () => {
            active = false;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            setImageUrl('');
        };
    }, [deliveryId, expanded, hasProof]);

    return <section className="delivery-proof-summary" aria-label="Delivery proof">
        <h4>{showMetadataIcons && <ProofMetadataIcon name="photo" />}Proof of delivery</h4>
        {!hasProof
            ? <p>Photo and recipient confirmation not recorded.</p>
            : <>
                <p>{showMetadataIcons && <ProofMetadataIcon name={recipientConfirmed ? 'check' : 'calendar'} />}{recipientConfirmed ? 'Recipient confirmation recorded' : 'Recipient confirmation unavailable'}{recipientName ? ` · ${recipientName}` : ''}</p>
                <p>{showMetadataIcons && <ProofMetadataIcon name="calendar" />}Photo captured: {capturedAt ? new Date(capturedAt).toLocaleString() : 'Time unavailable'}</p>
                {recordedAt && <p>{showMetadataIcons && <ProofMetadataIcon name="calendar" />}Proof saved: {new Date(recordedAt).toLocaleString()}</p>}
                <button type="button" className="seller-inline-action" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
                    {showMetadataIcons && <ProofMetadataIcon name="photo" />}{expanded ? 'Hide delivery photo' : 'View private delivery photo'}
                </button>
                {loading && <p role="status">Loading private photo…</p>}
                {error && <p role="alert">{error}</p>}
                {expanded && imageUrl && <img className="delivery-proof-image" src={imageUrl} alt="Private delivery proof photo" />}
            </>}
    </section>;
}
