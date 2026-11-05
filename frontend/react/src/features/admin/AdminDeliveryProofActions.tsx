import React from 'react';
import api from '../../lib/api';
import { DeliveryProofSummary } from '../shared/DeliveryProofSummary';

type Correction = { reason: string; created_at: string; corrected_by?: { name: string } | null };

export function AdminDeliveryProofActions({ row, onCorrected }: {
    row: Record<string, any>;
    onCorrected: () => void;
}) {
    const [editing, setEditing] = React.useState(false);
    const [recipientName, setRecipientName] = React.useState(row.delivery_recipient_name ?? '');
    const [photo, setPhoto] = React.useState<File | null>(null);
    const [photoCapturedAt, setPhotoCapturedAt] = React.useState('');
    const [reason, setReason] = React.useState('');
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState('');
    const photoInputRef = React.useRef<HTMLInputElement>(null);
    const corrections: Correction[] = row.proof_corrections ?? [];

    React.useEffect(() => {
        setRecipientName(row.delivery_recipient_name ?? '');
    }, [row.delivery_recipient_name]);

    async function submitCorrection(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (saving || (!photo && !recipientName.trim()) || !reason.trim()) return;
        const formData = new FormData();
        formData.append('reason', reason.trim());
        formData.append('recipient_name', recipientName.trim());
        if (photo) {
            formData.append('photo', photo);
            formData.append('captured_at', photoCapturedAt);
        }

        setSaving(true);
        setError('');
        try {
            await api.post(`/api/admin/deliveries/${row.id}/proof-correction`, formData);
            setPhoto(null);
            setPhotoCapturedAt('');
            if (photoInputRef.current) photoInputRef.current.value = '';
            setReason('');
            setEditing(false);
            onCorrected();
        } catch (requestError: any) {
            setError(requestError.userMessage ?? requestError.response?.data?.message ?? 'Proof correction could not be saved. Try again.');
        } finally {
            setSaving(false);
        }
    }

    return <div className="admin-delivery-proof-actions">
        <DeliveryProofSummary
            deliveryId={row.id}
            hasProof={Boolean(row.has_delivery_proof)}
            recipientConfirmed={row.recipient_confirmed}
            recipientName={row.delivery_recipient_name}
            capturedAt={row.proof_captured_at}
            recordedAt={row.proof_recorded_at}
        />
        {row.has_delivery_proof && <>
            <button type="button" className="admin-inline-action" aria-expanded={editing} onClick={() => setEditing((value) => !value)}>
                {editing ? 'Cancel correction' : 'Correct proof'}
            </button>
            {editing && <form className="admin-proof-correction-form" onSubmit={(event) => void submitCorrection(event)}>
                <label>Correct recipient name<input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} maxLength={120} /></label>
                <label>Replacement photo (optional)<input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
                    const selected = event.target.files?.[0] ?? null;
                    setPhoto(selected);
                    setPhotoCapturedAt(selected ? new Date().toISOString() : '');
                }} /></label>
                <label>Correction reason (required)<textarea value={reason} onChange={(event) => setReason(event.target.value)} required minLength={5} maxLength={500} /></label>
                {error && <p role="alert">{error}</p>}
                <button type="submit" disabled={saving || !reason.trim() || (!photo && !recipientName.trim())}>{saving ? 'Saving…' : 'Save audited correction'}</button>
            </form>}
        </>}
        {corrections.length > 0 && <details className="admin-proof-correction-history">
            <summary>Correction history ({corrections.length})</summary>
            <ol>{corrections.map((correction, index) => <li key={`${correction.created_at}-${index}`}>
                <strong>{correction.corrected_by?.name ?? 'Administrator'}</strong>
                <time dateTime={correction.created_at}>{new Date(correction.created_at).toLocaleString()}</time>
                <p>{correction.reason}</p>
            </li>)}</ol>
        </details>}
    </div>;
}
