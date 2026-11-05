import React from 'react';
import api from '../../lib/api';

export function DeliveryProofSummary({ deliveryId, hasProof, recipientConfirmed, recipientName, capturedAt, recordedAt }: {
    deliveryId: number;
    hasProof: boolean;
    recipientConfirmed?: boolean;
    recipientName?: string | null;
    capturedAt?: string | null;
    recordedAt?: string | null;
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
        <h4>Proof of delivery</h4>
        {!hasProof
            ? <p>Photo and recipient confirmation not recorded.</p>
            : <>
                <p>{recipientConfirmed ? 'Recipient confirmation recorded' : 'Recipient confirmation unavailable'}{recipientName ? ` · ${recipientName}` : ''}</p>
                <p>Photo captured: {capturedAt ? new Date(capturedAt).toLocaleString() : 'Time unavailable'}</p>
                {recordedAt && <p>Proof saved: {new Date(recordedAt).toLocaleString()}</p>}
                <button type="button" className="seller-inline-action" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
                    {expanded ? 'Hide delivery photo' : 'View private delivery photo'}
                </button>
                {loading && <p role="status">Loading private photo…</p>}
                {error && <p role="alert">{error}</p>}
                {expanded && imageUrl && <img className="delivery-proof-image" src={imageUrl} alt={`Delivery proof for delivery ${deliveryId}`} />}
            </>}
    </section>;
}
