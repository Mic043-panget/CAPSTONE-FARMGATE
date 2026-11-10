import React from 'react';
import api from '../../lib/api';

type AccountUser = {
    id: number;
    name: string;
    email: string;
    role: string;
    deleted_at: string | null;
    moderation_violations_count: number;
};

type Violation = {
    id: number;
    created_at: string;
    description: string;
    reason: string;
    actor?: { name: string; email: string } | null;
};

type ActionMode = 'violation' | 'deactivate' | 'reactivate' | 'history';

export function UserAccountActions({ user, onError, onRefresh }: {
    user: AccountUser;
    onError: (message: string) => void;
    onRefresh: () => void;
}) {
    const [mode, setMode] = React.useState<ActionMode | null>(null);
    const [reason, setReason] = React.useState('');
    const [violations, setViolations] = React.useState<Violation[]>([]);
    const [loadingHistory, setLoadingHistory] = React.useState(false);
    const [saving, setSaving] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const triggerRef = React.useRef<HTMLButtonElement | null>(null);
    const closeRef = React.useRef<HTMLButtonElement>(null);
    const modalRef = React.useRef<HTMLElement>(null);

    React.useEffect(() => {
        if (!mode) return undefined;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        closeRef.current?.focus();
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !saving) {
                setMode(null);
                window.requestAnimationFrame(() => triggerRef.current?.focus());
                return;
            }
            if (event.key !== 'Tab') return;
            const focusable = modalRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled])');
            if (!focusable?.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [mode, saving]);

    function openAction(action: ActionMode, trigger: HTMLButtonElement) {
        triggerRef.current = trigger;
        setReason('');
        setMessage('');
        setMode(action);
    }

    function closeModal() {
        setMode(null);
        window.requestAnimationFrame(() => triggerRef.current?.focus());
    }

    async function openHistory(trigger: HTMLButtonElement) {
        triggerRef.current = trigger;
        setMode('history');
        setLoadingHistory(true);
        try {
            const response = await api.get<{ violations: Violation[] }>(`/api/admin/users/${user.id}/violations`);
            setViolations(response.data.violations);
        } catch (error: any) {
            setMode(null);
            onError(error.userMessage ?? error.response?.data?.message ?? 'Account violation history could not be loaded.');
        } finally {
            setLoadingHistory(false);
        }
    }

    async function submitAction(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!mode || mode === 'history' || reason.trim().length < 5) return;
        const path = mode === 'violation'
            ? `/api/admin/users/${user.id}/violations`
            : `/api/admin/users/${user.id}/${mode}`;
        setSaving(true);
        setMessage('');
        try {
            const response = await api.post<{ message: string; violation?: Violation }>(path, { reason: reason.trim() });
            setMessage(response.data.message);
            setReason('');
            onRefresh();
            if (mode === 'violation') {
                if (response.data.violation) {
                    const recordedViolation = response.data.violation;
                    setViolations((current) => [recordedViolation, ...current]);
                }
                setMode('history');
            } else {
                closeModal();
            }
        } catch (error: any) {
            onError(error.userMessage ?? error.response?.data?.message ?? 'The account action could not be completed.');
        } finally {
            setSaving(false);
        }
    }

    const title = mode === 'violation'
        ? 'Record account violation'
        : mode === 'deactivate'
            ? 'Deactivate account'
            : mode === 'reactivate'
                ? 'Reactivate account'
                : 'Violation history';

    return <>
        <div className="user-account-actions">
            <button type="button" onClick={(event) => { setMessage(''); void openHistory(event.currentTarget); }}>Violations ({user.moderation_violations_count})</button>
            {user.deleted_at
                ? <button type="button" onClick={(event) => openAction('reactivate', event.currentTarget)}>Reactivate</button>
                : <>
                    <button type="button" onClick={(event) => openAction('violation', event.currentTarget)}>Record violation</button>
                    <button type="button" className="user-account-deactivate" onClick={(event) => openAction('deactivate', event.currentTarget)}>Deactivate</button>
                </>}
        </div>
        {mode && <div className="user-account-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) closeModal(); }}>
            <section ref={modalRef} className="user-account-modal" role="dialog" aria-modal="true" aria-labelledby={`user-account-modal-title-${user.id}`}>
                <header>
                    <div><p className="eyebrow">Account controls · {user.role}</p><h3 id={`user-account-modal-title-${user.id}`}>{title}</h3><p>{user.name} · {user.email}</p></div>
                    <button ref={closeRef} type="button" onClick={closeModal} disabled={saving}>Close</button>
                </header>
                {mode === 'history' ? loadingHistory
                    ? <p className="user-account-feedback" role="status">Loading violation history…</p>
                    : violations.length
                        ? <ol className="user-violation-history">{violations.map((violation) => <li key={violation.id}>
                            <strong>{violation.reason}</strong>
                            <span>{violation.actor?.name ?? 'Administrator'} · {new Date(violation.created_at).toLocaleString()}</span>
                            <p>{violation.description}</p>
                        </li>)}</ol>
                        : <p className="user-account-feedback">No violation reports are recorded for this account.</p>
                    : <form onSubmit={submitAction}>
                        <p>{mode === 'violation'
                            ? 'Record a violation for administrative review. This flag does not automatically deactivate the account.'
                            : mode === 'deactivate'
                                ? 'The user will lose access immediately, and existing API tokens will be revoked. Reactivation can restore sign-in access; the user must sign in again.'
                                : 'The account will become available for sign-in again. Existing API tokens remain revoked.'}</p>
                        <label>Reason
                            <textarea required minLength={5} maxLength={255} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Enter a concise, factual reason" />
                        </label>
                        <small>{reason.length}/255 characters · minimum 5</small>
                        {message && <p className="user-account-feedback" role="status">{message}</p>}
                        <button type="submit" disabled={saving || reason.trim().length < 5}>{saving ? 'Saving…' : title}</button>
                    </form>}
            </section>
        </div>}
    </>;
}
