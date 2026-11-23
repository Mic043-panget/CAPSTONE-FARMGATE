import React from 'react';
import api from '../../lib/api';
import { WorkspaceBannerArtwork } from '../shared/WorkspaceBannerArtwork';
import { FarmgateDetailDialog } from '../shared/FarmgateDetailDialog';

type AccountUser = {
    id: number;
    name: string;
    email: string;
    role: string;
    deleted_at: string | null;
    moderation_violations_count: number;
    email_verified_at: string | null;
    phone_verified_at: string | null;
    created_at: string;
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
    const [menuOpen, setMenuOpen] = React.useState(false);
    const [detailsOpen, setDetailsOpen] = React.useState(false);
    const triggerRef = React.useRef<HTMLButtonElement | null>(null);
    const closeRef = React.useRef<HTMLButtonElement>(null);
    const modalRef = React.useRef<HTMLElement>(null);
    const menuId = React.useId();
    const menuContainerRef = React.useRef<HTMLDivElement>(null);
    const menuRef = React.useRef<HTMLDivElement>(null);
    const menuButtonRef = React.useRef<HTMLButtonElement>(null);

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

    React.useEffect(() => {
        if (!menuOpen) return undefined;
        const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
        const focusFirstItem = window.requestAnimationFrame(() => items()[0]?.focus());
        const handlePointerDown = (event: PointerEvent) => {
            if (!menuContainerRef.current?.contains(event.target as Node)) setMenuOpen(false);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                setMenuOpen(false);
                menuButtonRef.current?.focus();
                return;
            }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            const menuItems = items();
            if (!menuItems.length) return;
            event.preventDefault();
            const currentIndex = menuItems.indexOf(document.activeElement as HTMLButtonElement);
            const nextIndex = event.key === 'Home'
                ? 0
                : event.key === 'End'
                    ? menuItems.length - 1
                    : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + menuItems.length) % menuItems.length;
            menuItems[nextIndex].focus();
        };
        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            window.cancelAnimationFrame(focusFirstItem);
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [menuOpen]);

    function openAction(action: ActionMode, trigger: HTMLButtonElement) {
        setMenuOpen(false);
        triggerRef.current = trigger;
        setReason('');
        setMessage('');
        setMode(action);
    }

    function openMenuAction(action: ActionMode, menuItem: HTMLButtonElement) {
        const trigger = menuButtonRef.current ?? menuItem;
        if (action === 'history') {
            setMenuOpen(false);
            setMessage('');
            void openHistory(trigger);
            return;
        }
        openAction(action, trigger);
    }

    function closeModal() {
        setMode(null);
        window.requestAnimationFrame(() => triggerRef.current?.focus());
    }

    async function openHistory(trigger: HTMLButtonElement) {
        setMenuOpen(false);
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
    const emailVerified = Boolean(user.email_verified_at);
    const phoneVerified = Boolean(user.phone_verified_at);
    const verificationLabel = emailVerified && phoneVerified
        ? 'Email and mobile verified'
        : emailVerified
            ? 'Email verified'
            : phoneVerified
                ? 'Mobile verified'
                : 'Not verified';
    const joinedDate = new Date(user.created_at);
    const joinedDateLabel = Number.isNaN(joinedDate.getTime()) ? 'Date unavailable' : joinedDate.toLocaleDateString();
    const accountStatus = user.deleted_at ? 'Inactive' : 'Active';

    return <>
        <div className="user-account-actions">
            <button className="user-account-violations" type="button" aria-label={`View ${user.moderation_violations_count} violations for ${user.name}`} onClick={(event) => { setMessage(''); void openHistory(event.currentTarget); }}>Violations ({user.moderation_violations_count})</button>
            {user.deleted_at
                ? <button type="button" className="user-account-status-action" onClick={(event) => openAction('reactivate', event.currentTarget)}>Reactivate</button>
                : <>
                    <button type="button" className="user-account-record-violation" onClick={(event) => openAction('violation', event.currentTarget)}>Record violation</button>
                    <button type="button" className="user-account-status-action user-account-deactivate" onClick={(event) => openAction('deactivate', event.currentTarget)}>Deactivate</button>
                </>}
            <div className="user-account-more" ref={menuContainerRef}>
                <button
                    ref={menuButtonRef}
                    className="user-account-more-trigger"
                    type="button"
                    aria-label={`More details for ${user.name}`}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    aria-controls={menuOpen ? menuId : undefined}
                    onClick={() => setMenuOpen((open) => !open)}
                    onKeyDown={(event) => {
                        if (event.key === 'ArrowDown') {
                            event.preventDefault();
                            setMenuOpen(true);
                        }
                    }}
                >
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" /></svg>
                </button>
                {menuOpen && <div ref={menuRef} id={menuId} className="user-account-more-menu" role="menu" aria-label={`More actions for ${user.name}`} onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMenuOpen(false);
                }}>
                    <button type="button" role="menuitem" tabIndex={0} onClick={() => { setMenuOpen(false); setDetailsOpen(true); }}>View full details</button>
                    <button type="button" role="menuitem" tabIndex={-1} onClick={(event) => openMenuAction('history', event.currentTarget)}>Violation history</button>
                    {!user.deleted_at && <button type="button" role="menuitem" tabIndex={-1} onClick={(event) => openMenuAction('violation', event.currentTarget)}>Record violation</button>}
                    <button type="button" role="menuitem" tabIndex={-1} onClick={(event) => openMenuAction(user.deleted_at ? 'reactivate' : 'deactivate', event.currentTarget)}>{user.deleted_at ? 'Reactivate account' : 'Deactivate account'}</button>
                </div>}
            </div>
        </div>
        {detailsOpen && <FarmgateDetailDialog
            eyebrow="Account details"
            title={user.name}
            description={user.email}
            onClose={() => {
                setDetailsOpen(false);
                window.requestAnimationFrame(() => menuButtonRef.current?.focus());
            }}
            className="user-account-details-dialog"
            contentClassName="user-account-details-content"
        >
            <dl>
                <div><dt>Role</dt><dd>{user.role}</dd></div>
                <div><dt>Account status</dt><dd>{accountStatus}</dd></div>
                <div><dt>Verification</dt><dd>{verificationLabel}</dd></div>
                <div><dt>Joined</dt><dd><time dateTime={user.created_at}>{joinedDateLabel}</time></dd></div>
                <div><dt>Violation records</dt><dd>{user.moderation_violations_count}</dd></div>
            </dl>
        </FarmgateDetailDialog>}
        {mode && <div className="user-account-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) closeModal(); }}>
            <section ref={modalRef} className="user-account-modal" role="dialog" aria-modal="true" aria-labelledby={`user-account-modal-title-${user.id}`}>
                <header className="farmgate-modal-banner">
                    <div><p className="eyebrow">Account controls · {user.role}</p><h3 id={`user-account-modal-title-${user.id}`}>{title}</h3><p>{user.name} · {user.email}</p></div>
                    <WorkspaceBannerArtwork />
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
