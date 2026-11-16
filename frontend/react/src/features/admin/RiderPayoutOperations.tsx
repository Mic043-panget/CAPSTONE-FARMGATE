import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import api, { initializeCsrf } from '../../lib/api';
import { confirmAction } from '../../lib/alerts';
import { Pagination } from '../../shared/components/Pagination';

type Props = { onError: (message: string) => void };
type TabId = 'settings' | 'destinations' | 'pending' | 'recorded';
type CapScope = 'NO_CAP' | 'PER_DELIVERY' | '';
type Page<T> = { data: T[]; current_page: number; last_page: number; total: number };
type RequestError = {
    userMessage?: string;
    response?: { data?: { message?: string; errors?: Record<string, string[]> } };
};
type EarningsSetting = {
    percentage: string;
    cap_scope: string;
    cap_amount: string | null;
    updated_at?: string | null;
    updater?: { name?: string } | null;
};
type SettingHistory = {
    new_percentage: string;
    new_cap_scope: string;
    new_cap_amount: string | null;
    actor?: { name?: string } | null;
    reason: string;
    created_at: string;
};
type Destination = {
    id: number;
    destination_type: 'BANK' | 'GCASH';
    account_holder_masked: string;
    bank_name_masked: string | null;
    account_number_masked: string | null;
    wallet_number_masked: string | null;
    status: string;
    is_current: boolean;
    verified_at: string | null;
    updated_at: string;
    rider: { id: number; name: string | null };
    verified_by_name?: string | null;
};
type DestinationHistory = {
    action: string;
    actor: string | null;
    reason: string | null;
    created_at: string | null;
};
type DestinationDetails = Destination & {
    consent_version: string | null;
    consent_accepted_at: string | null;
    verification_history: DestinationHistory[];
};
type Payout = {
    id: number;
    payout_reference: string;
    status: string;
    amount_cents: number;
    method: string | null;
    created_at: string;
    paid_at: string | null;
    receipt_url: string | null;
    destination_masked: {
        type: string;
        status: string;
        account_holder: string;
        institution: string;
        identifier: string | null;
    } | null;
    rider: { id: number; name: string | null };
    earning: {
        amount_cents: number;
        delivery_fee_cents: number;
        percentage_snapshot: string;
        cap_scope_snapshot: string;
        cap_amount_snapshot: string | null;
        delivery: {
            delivery_reference: string;
            delivery_verified_at: string | null;
            status: string;
        };
        order: { order_reference: string; delivery_fee: string | number };
    };
    histories: {
        action: string;
        from_status: string | null;
        to_status: string | null;
        reason: string | null;
        actor?: { name?: string } | null;
        created_at: string;
    }[];
};
type PayoutFormState = {
    externalReference: string;
    amount: string;
    paidAt: string;
    reason: string;
    receipt: File | null;
    confirmed: boolean;
    method: 'BANK_TRANSFER' | 'GCASH';
};

const TABS: { id: TabId; label: string; panel: string }[] = [
    { id: 'settings', label: 'Earnings & Payout Settings', panel: 'rider-payout-settings-panel' },
    { id: 'destinations', label: 'Payout Destinations', panel: 'rider-payout-destinations-panel' },
    { id: 'pending', label: 'Pending Manual Payouts', panel: 'rider-payout-pending-panel' },
    { id: 'recorded', label: 'Recorded External Payouts', panel: 'rider-payout-recorded-panel' },
];

function messageFrom(error: unknown, fallback: string): string {
    const requestError = error as RequestError;
    const validationMessage = requestError.response?.data?.errors
        ? Object.values(requestError.response.data.errors).flat().join(' ')
        : '';
    return validationMessage || requestError.userMessage || requestError.response?.data?.message || fallback;
}

function dateLabel(value: string | null | undefined): string {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function money(cents: number | null | undefined): string {
    return `₱${((cents ?? 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function parseCents(value: string): number | null {
    const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value.trim());
    if (!match) return null;
    const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
    return Number.isSafeInteger(cents) ? cents : null;
}

function localDate(): string {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 10);
}

function scopeLabel(scope: string | null | undefined): string {
    if (scope === 'PER_DELIVERY' || scope === 'PER_PAYOUT') return 'Per delivery';
    return scope === 'NO_CAP' ? 'No cap' : 'Not configured';
}

function destinationIdentifier(destination: Pick<Destination, 'destination_type' | 'account_number_masked' | 'wallet_number_masked'>): string {
    return destination.destination_type === 'BANK'
        ? destination.account_number_masked ?? 'Not available'
        : destination.wallet_number_masked ?? 'Not available';
}

function StatusPill({ children, status }: { children: string; status?: string }) {
    const kind = status?.toLowerCase().replaceAll('_', '-') ?? 'neutral';
    return <span className={`rider-payout-status-pill rider-payout-status-pill--${kind}`}>{children}</span>;
}

function LoadState({ loading, error, onRetry }: { loading: boolean; error: string; onRetry: () => void }) {
    if (loading) return <p className="seller-loading" role="status">Loading rider payout records…</p>;
    if (error) return <div className="seller-error" role="alert">{error} <button type="button" className="seller-inline-action" onClick={onRetry}>Try again</button></div>;
    return null;
}

export function RiderPayoutOperations({ onError }: Props) {
    const [activeTab, setActiveTab] = useState<TabId>('settings');
    const [payoutVersion, setPayoutVersion] = useState(0);
    const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({
        settings: null,
        destinations: null,
        pending: null,
        recorded: null,
    });

    const changeTab = (next: TabId) => {
        setActiveTab(next);
        tabRefs.current[next]?.focus();
    };

    const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: TabId) => {
        const index = TABS.findIndex((tab) => tab.id === current);
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            event.preventDefault();
            const direction = event.key === 'ArrowRight' ? 1 : -1;
            const next = TABS[(index + direction + TABS.length) % TABS.length].id;
            changeTab(next);
        } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            changeTab(event.key === 'Home' ? TABS[0].id : TABS[TABS.length - 1].id);
        }
    };

    return <section className="rider-payout-operations">
        <header className="rider-payout-operations-heading">
            <div>
                <p className="eyebrow">Admin · Payments</p>
                <h3>Rider earnings and payouts</h3>
                <p>Review delivery earnings and record only external transfers that have already been independently completed.</p>
            </div>
            <span className="rider-payout-count">One payout per eligible delivery</span>
        </header>
        <div className="seller-settings-tabs rider-settings-tabs rider-payout-tabs" role="tablist" aria-label="Rider payout operations">
            {TABS.map((tab) => <button
                key={tab.id}
                ref={(element) => { tabRefs.current[tab.id] = element; }}
                id={`rider-payout-${tab.id}-tab`}
                type="button"
                role="tab"
                className={`seller-settings-tab${activeTab === tab.id ? ' is-active' : ''}`}
                aria-selected={activeTab === tab.id}
                aria-controls={tab.panel}
                tabIndex={activeTab === tab.id ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(event) => onTabKeyDown(event, tab.id)}
            >{tab.label}</button>)}
        </div>
        <section id="rider-payout-settings-panel" role="tabpanel" aria-labelledby="rider-payout-settings-tab" hidden={activeTab !== 'settings'} className="rider-payout-tab-panel">
            <EarningsSettingsTab />
        </section>
        <section id="rider-payout-destinations-panel" role="tabpanel" aria-labelledby="rider-payout-destinations-tab" hidden={activeTab !== 'destinations'} className="rider-payout-tab-panel">
            <DestinationsTab onPayoutsChanged={() => setPayoutVersion((version) => version + 1)} />
        </section>
        <section id="rider-payout-pending-panel" role="tabpanel" aria-labelledby="rider-payout-pending-tab" hidden={activeTab !== 'pending'} className="rider-payout-tab-panel">
            <PendingPayoutsTab refreshVersion={payoutVersion} onPayoutChanged={() => setPayoutVersion((version) => version + 1)} onError={onError} />
        </section>
        <section id="rider-payout-recorded-panel" role="tabpanel" aria-labelledby="rider-payout-recorded-tab" hidden={activeTab !== 'recorded'} className="rider-payout-tab-panel">
            <RecordedPayoutsTab refreshVersion={payoutVersion} />
        </section>
    </section>;
}

function EarningsSettingsTab() {
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [actionError, setActionError] = useState('');
    const [saveMessage, setSaveMessage] = useState('');
    const [saving, setSaving] = useState(false);
    const [reload, setReload] = useState(0);
    const [configured, setConfigured] = useState(false);
    const [setting, setSetting] = useState<EarningsSetting | null>(null);
    const [history, setHistory] = useState<SettingHistory[]>([]);
    const [percentage, setPercentage] = useState('');
    const [capScope, setCapScope] = useState<CapScope>('');
    const [capAmount, setCapAmount] = useState('');
    const [reason, setReason] = useState('');

    useEffect(() => {
        let active = true;
        setLoading(true);
        setLoadError('');
        api.get<{ configured: boolean; setting: EarningsSetting | null; history: SettingHistory[] }>('/api/admin/rider-earnings/settings')
            .then((response) => {
            if (!active) return;
            const data = response.data;
            setConfigured(data.configured);
            setSetting(data.setting);
            setHistory(data.history ?? []);
            if (data.setting) {
                setPercentage(data.setting.percentage);
                setCapScope(data.setting.cap_scope === 'NO_CAP' ? 'NO_CAP' : 'PER_DELIVERY');
                setCapAmount(data.setting.cap_amount ?? '');
            } else {
                setCapScope('NO_CAP');
            }
        }).catch((error: unknown) => {
            if (active) setLoadError(messageFrom(error, 'Rider earnings settings could not be loaded.'));
        }).finally(() => {
            if (active) setLoading(false);
        });
        return () => { active = false; };
    }, [reload]);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setSaving(true);
        setActionError('');
        setSaveMessage('');
        try {
            await initializeCsrf();
            await api.put('/api/admin/rider-earnings/settings', {
                percentage: Number(percentage),
                cap_scope: capScope,
                cap_amount: capScope === 'PER_DELIVERY' ? Number(capAmount) : null,
                reason,
            });
            setReason('');
            setSaveMessage('Settings saved. Existing delivery earnings remain unchanged.');
            setReload((version) => version + 1);
        } catch (error: unknown) {
            setActionError(messageFrom(error, 'Rider earnings settings could not be saved.'));
        } finally {
            setSaving(false);
        }
    };

    return <div className="rider-payout-tab-content">
        <div className="rider-payout-subsection-heading">
            <div>
                <h4>Earnings calculation policy</h4>
                <p>New earnings use the saved rate when a delivery is completed and verified. Payouts remain one per delivery.</p>
            </div>
            <StatusPill status={configured ? 'configured' : 'not-configured'}>{configured ? 'Configured' : 'Not configured'}</StatusPill>
        </div>
        <LoadState loading={loading} error={loadError} onRetry={() => setReload((version) => version + 1)} />
        {!loading && !loadError && <div className={`rider-payout-config-notice${configured ? ' is-configured' : ''}`}>
            <strong>{configured ? 'Saved settings are active for future delivery earnings.' : 'No earnings rate or cap has been saved.'}</strong>
            {setting && <p>Current rate: {setting.percentage}% · {scopeLabel(setting.cap_scope)}{setting.cap_scope !== 'NO_CAP' && setting.cap_amount ? ` · cap ₱${Number(setting.cap_amount).toFixed(2)}` : ''}{setting.updater?.name ? ` · saved by ${setting.updater.name}` : ''}</p>}
            <small>Existing delivery earnings keep their original rate and amount. Changing this policy does not reprice saved earnings.</small>
        </div>}
        {!loading && !loadError && <form className="rider-payout-settings-form" onSubmit={submit} aria-busy={saving}>
            <div className="rider-earnings-settings-fields">
                <label className="rider-payout-field">Rider earnings percentage
                    <span className="rider-payout-percentage-control"><input type="number" min="0" max="100" step="0.01" value={percentage} onChange={(event) => setPercentage(event.target.value)} required /><span>% of delivery fee</span></span>
                </label>
                <label className="rider-payout-field">Maximum-compensation cap
                    <select value={capScope} onChange={(event) => setCapScope(event.target.value as CapScope)} required>
                        <option value="">Choose an option</option>
                        <option value="NO_CAP">No cap</option>
                        <option value="PER_DELIVERY">Cap per delivery</option>
                    </select>
                </label>
                {capScope === 'PER_DELIVERY' && <label className="rider-payout-field">Cap amount (PHP)
                    <input type="number" min="0.01" step="0.01" value={capAmount} onChange={(event) => setCapAmount(event.target.value)} required />
                    <small>Required when a per-delivery cap is selected.</small>
                </label>}
                <label className="rider-payout-field rider-payout-reason-field">Reason for this earnings and cap configuration
                    <input type="text" minLength={8} maxLength={255} value={reason} onChange={(event) => setReason(event.target.value)} required />
                </label>
            </div>
            <p className="rider-payout-cap-note">The rate and cap apply to future eligible deliveries only. No cap applies unless explicitly selected and saved.</p>
            {actionError && <p className="seller-error" role="alert">{actionError}</p>}
            {saveMessage && <p className="rider-payout-success" role="status">{saveMessage}</p>}
            <div className="rider-payout-settings-actions"><button type="submit" disabled={saving || !capScope}>{saving ? 'Saving…' : 'Save rider earnings settings'}</button></div>
        </form>}
        <section className="rider-payout-subsection" aria-labelledby="rider-payout-settings-history-title">
            <div className="rider-payout-subsection-heading"><div><h4 id="rider-payout-settings-history-title">Configuration audit history</h4><p>Every saved rate and cap change remains recorded with its administrator and reason.</p></div></div>
            {loading ? <p className="seller-loading">Loading configuration history…</p> : loadError ? <p className="seller-empty">History is unavailable until settings load successfully.</p> : history.length === 0 ? <p className="seller-empty">No rider earnings settings have been saved.</p> : <div className="rider-payout-history-table-wrap">
                <table className="data-table">
                    <thead><tr><th>Saved</th><th>Administrator</th><th>Rate</th><th>Cap</th><th>Reason</th></tr></thead>
                    <tbody>{history.map((item, index) => <tr key={`${item.created_at}-${index}`}>
                        <td>{dateLabel(item.created_at)}</td><td>{item.actor?.name ?? '—'}</td><td>{item.new_percentage}%</td><td>{scopeLabel(item.new_cap_scope)}{item.new_cap_scope !== 'NO_CAP' && item.new_cap_amount ? ` · ₱${Number(item.new_cap_amount).toFixed(2)}` : ''}</td><td>{item.reason}</td>
                    </tr>)}</tbody>
                </table>
            </div>}
        </section>
    </div>;
}

function DestinationsTab({ onPayoutsChanged }: { onPayoutsChanged: () => void }) {
    const [destinations, setDestinations] = useState<Page<Destination> | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [reload, setReload] = useState(0);
    const [page, setPage] = useState(1);
    const [searchText, setSearchText] = useState('');
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('ALL');
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [details, setDetails] = useState<DestinationDetails | null>(null);
    const [detailsLoading, setDetailsLoading] = useState(false);
    const [detailsError, setDetailsError] = useState('');
    const [decisionReason, setDecisionReason] = useState('');
    const [decisionError, setDecisionError] = useState('');
    const [savingDecision, setSavingDecision] = useState(false);

    useEffect(() => {
        const timer = window.setTimeout(() => { setSearch(searchText.trim()); setPage(1); }, 250);
        return () => window.clearTimeout(timer);
    }, [searchText]);

    useEffect(() => {
        let active = true;
        const params: Record<string, string | number> = { page, per_page: 10 };
        if (search) params.search = search;
        if (status !== 'ALL') params.status = status;
        setLoading(true);
        setError('');
        api.get<{ destinations: Page<Destination> }>('/api/admin/rider-payout-destinations', { params })
            .then((response) => { if (active) setDestinations(response.data.destinations); })
            .catch((requestError: unknown) => { if (active) setError(messageFrom(requestError, 'Rider payout destinations could not be loaded.')); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [page, search, status, reload]);

    const openDetails = async (destination: Destination) => {
        if (selectedId === destination.id) {
            setSelectedId(null);
            setDetails(null);
            return;
        }
        setSelectedId(destination.id);
        setDetails(null);
        setDetailsError('');
        setDecisionReason('');
        setDetailsLoading(true);
        try {
            const response = await api.get<{ destination: DestinationDetails }>(`/api/admin/rider-payout-destinations/${destination.id}`);
            setDetails(response.data.destination);
        } catch (requestError: unknown) {
            setDetailsError(messageFrom(requestError, 'Destination details could not be loaded.'));
        } finally {
            setDetailsLoading(false);
        }
    };

    const decide = async (decision: 'verify' | 'reject') => {
        if (!details || decisionReason.trim().length < 8) return;
        const approved = decision === 'verify';
        const confirmed = await confirmAction({
            title: approved ? 'Verify this payout destination?' : 'Reject this payout destination?',
            text: approved ? 'Only masked destination details will be available in Farmgate.' : 'The rider will need to update the destination before payouts can use it.',
            confirmText: approved ? 'Verify destination' : 'Reject destination',
            danger: !approved,
        });
        if (!confirmed) return;
        setSavingDecision(true);
        setDecisionError('');
        try {
            await initializeCsrf();
            await api.post(`/api/admin/rider-payout-destinations/${details.id}/${decision}`, { reason: decisionReason });
            setSelectedId(null);
            setDetails(null);
            setDecisionReason('');
            setReload((version) => version + 1);
            onPayoutsChanged();
        } catch (requestError: unknown) {
            setDecisionError(messageFrom(requestError, 'The payout destination decision could not be saved.'));
        } finally {
            setSavingDecision(false);
        }
    };

    return <div className="rider-payout-tab-content">
        <div className="rider-payout-subsection-heading"><div><h4>Rider payout destinations</h4><p>Only current, admin-verified destinations can be used when recording a transfer. Account identifiers remain masked.</p></div></div>
        <div className="rider-payout-filter-bar">
            <label className="seller-listing-search">Search rider or destination
                <input type="search" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Rider name, ID, bank, or status" />
            </label>
            <label className="rider-payout-filter">Destination status
                <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
                    <option value="ALL">All statuses</option>
                    <option value="PENDING_VERIFICATION">Pending verification</option>
                    <option value="VERIFIED">Verified</option>
                    <option value="REJECTED">Rejected</option>
                    <option value="REPLACED">Replaced</option>
                </select>
            </label>
        </div>
        <LoadState loading={loading} error={error} onRetry={() => setReload((version) => version + 1)} />
        {!loading && !error && <div className="rider-payout-history-table-wrap">
            <table className="data-table rider-payout-operations-table">
                <thead><tr><th>Rider</th><th>Destination</th><th>Masked identifier</th><th>Status</th><th>Updated</th><th>Action</th></tr></thead>
                <tbody>
                    {(destinations?.data ?? []).map((destination) => <FragmentDestinationRow
                        key={destination.id}
                        destination={destination}
                        selected={selectedId === destination.id}
                        details={selectedId === destination.id ? details : null}
                        detailsLoading={selectedId === destination.id && detailsLoading}
                        detailsError={selectedId === destination.id ? detailsError : ''}
                        reason={decisionReason}
                        decisionError={decisionError}
                        saving={savingDecision}
                        onReasonChange={setDecisionReason}
                        onOpen={() => void openDetails(destination)}
                        onDecision={decide}
                    />)}
                    {destinations?.data.length === 0 && <tr><td colSpan={6}><p className="rider-payout-empty-state">No payout destinations match these filters.</p></td></tr>}
                </tbody>
            </table>
        </div>}
        {!loading && !error && destinations && <Pagination page={destinations.current_page} lastPage={destinations.last_page} onChange={setPage} label="Rider payout destination pages" />}
    </div>;
}

function FragmentDestinationRow({
    destination, selected, details, detailsLoading, detailsError, reason, decisionError, saving, onReasonChange, onOpen, onDecision,
}: {
    destination: Destination;
    selected: boolean;
    details: DestinationDetails | null;
    detailsLoading: boolean;
    detailsError: string;
    reason: string;
    decisionError: string;
    saving: boolean;
    onReasonChange: (reason: string) => void;
    onOpen: () => void;
    onDecision: (decision: 'verify' | 'reject') => void;
}) {
    return <>
        <tr>
            <td>{destination.rider?.name ?? 'Rider'} <small className="rider-payout-secondary">Rider #{destination.rider?.id ?? '—'}</small></td>
            <td>{destination.destination_type === 'BANK' ? `Bank · ${destination.bank_name_masked ?? '—'}` : 'GCash'}{destination.is_current && <small className="rider-payout-secondary">Current</small>}</td>
            <td>{destinationIdentifier(destination)}</td>
            <td><StatusPill status={destination.status}>{destination.status.replaceAll('_', ' ')}</StatusPill></td>
            <td>{dateLabel(destination.updated_at)}</td>
            <td><button type="button" className="seller-inline-action" aria-expanded={selected} onClick={onOpen}>{selected ? 'Hide details' : 'View details'}</button></td>
        </tr>
        {selected && <tr className="rider-payout-expanded-row"><td colSpan={6}>
            {detailsLoading && <p className="seller-loading" role="status">Loading masked destination details…</p>}
            {detailsError && <p className="seller-error" role="alert">{detailsError}</p>}
            {details && <div className="rider-payout-expanded">
                <dl className="rider-payout-destination-details">
                    <div><dt>Rider</dt><dd>{details.rider?.name ?? '—'} (#{details.rider?.id ?? '—'})</dd></div>
                    <div><dt>Account holder</dt><dd>{details.account_holder_masked}</dd></div>
                    <div><dt>Destination</dt><dd>{details.destination_type === 'BANK' ? `Bank · ${details.bank_name_masked ?? '—'}` : 'GCash'}</dd></div>
                    <div><dt>Masked identifier</dt><dd>{destinationIdentifier(details)}</dd></div>
                    <div><dt>Status</dt><dd><StatusPill status={details.status}>{details.status.replaceAll('_', ' ')}</StatusPill></dd></div>
                    <div><dt>Verified</dt><dd>{details.verified_at ? `${dateLabel(details.verified_at)}${details.verified_by_name ? ` by ${details.verified_by_name}` : ''}` : 'Not verified'}</dd></div>
                    <div><dt>Rider consent</dt><dd>{details.consent_version ?? '—'}{details.consent_accepted_at ? ` · ${dateLabel(details.consent_accepted_at)}` : ''}</dd></div>
                </dl>
                {details.status === 'PENDING_VERIFICATION' && details.is_current && <form className="rider-payout-destination-review" onSubmit={(event) => event.preventDefault()}>
                    <label className="rider-payout-field">Reason for this destination decision
                        <textarea minLength={8} maxLength={500} required value={reason} onChange={(event) => onReasonChange(event.target.value)} />
                    </label>
                    {decisionError && <p className="seller-error" role="alert">{decisionError}</p>}
                    <div className="rider-payout-settings-actions">
                        <button type="button" disabled={saving || reason.trim().length < 8} onClick={() => onDecision('verify')}>{saving ? 'Saving…' : 'Verify destination'}</button>
                        <button type="button" className="rider-payout-danger-action" disabled={saving || reason.trim().length < 8} onClick={() => onDecision('reject')}>Reject destination</button>
                    </div>
                </form>}
                <div className="rider-payout-audit-list">
                    <h5>Destination audit history</h5>
                    {details.verification_history?.length ? <ol>{details.verification_history.map((item, index) => <li key={`${item.action}-${item.created_at}-${index}`}>
                        <strong>{item.action.replaceAll('_', ' ')}</strong><span>{item.actor ?? 'System'} · {dateLabel(item.created_at)}</span>{item.reason && <p>{item.reason}</p>}
                    </li>)}</ol> : <p>No destination audit events are available.</p>}
                </div>
            </div>}
        </td></tr>}
    </>;
}

function PendingPayoutsTab({ refreshVersion, onPayoutChanged, onError }: { refreshVersion: number; onPayoutChanged: () => void; onError: (message: string) => void }) {
    const [payouts, setPayouts] = useState<Page<Payout> | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [reload, setReload] = useState(0);
    const [page, setPage] = useState(1);
    const [searchText, setSearchText] = useState('');
    const [search, setSearch] = useState('');
    const [destinationStatus, setDestinationStatus] = useState('ALL');
    const [sort, setSort] = useState('newest');
    const [expandedId, setExpandedId] = useState<number | null>(null);
    const [forms, setForms] = useState<Record<number, PayoutFormState>>({});
    const [savingId, setSavingId] = useState<number | null>(null);
    const [actionError, setActionError] = useState('');

    useEffect(() => {
        const timer = window.setTimeout(() => { setSearch(searchText.trim()); setPage(1); }, 250);
        return () => window.clearTimeout(timer);
    }, [searchText]);

    useEffect(() => {
        let active = true;
        const params: Record<string, string | number> = { group: 'queue', page, per_page: 10, sort };
        if (search) params.search = search;
        if (destinationStatus !== 'ALL') params.destination_status = destinationStatus;
        setLoading(true);
        setError('');
        api.get<{ payouts: Page<Payout> }>('/api/admin/rider-payouts', { params })
            .then((response) => { if (active) setPayouts(response.data.payouts); })
            .catch((requestError: unknown) => { if (active) setError(messageFrom(requestError, 'Pending rider payouts could not be loaded.')); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [page, search, destinationStatus, sort, reload, refreshVersion]);

    const formFor = (payout: Payout): PayoutFormState => {
        const defaultMethod = payout.destination_masked?.type === 'GCASH' ? 'GCASH' : 'BANK_TRANSFER';
        return forms[payout.id] ?? {
            externalReference: '',
            amount: (payout.amount_cents / 100).toFixed(2),
            paidAt: localDate(),
            reason: '',
            receipt: null,
            confirmed: false,
            method: defaultMethod,
        };
    };

    const updateForm = (payout: Payout, values: Partial<PayoutFormState>) => {
        setForms((current) => ({ ...current, [payout.id]: { ...formFor(payout), ...values } }));
    };

    const recordPayout = async (event: FormEvent<HTMLFormElement>, payout: Payout) => {
        event.preventDefault();
        const form = formFor(payout);
        if (!payout.destination_masked || payout.destination_masked.status !== 'VERIFIED') {
            setActionError('A current verified payout destination is required.');
            return;
        }
        if (!form.receipt) {
            setActionError('Upload a private receipt for the completed external transfer.');
            return;
        }
        const amountCents = parseCents(form.amount);
        if (amountCents === null || amountCents !== payout.amount_cents) {
            setActionError('Enter the exact amount already transferred. It must match the delivery payout amount.');
            return;
        }
        const confirmed = await confirmAction({
            title: `Record ${money(payout.amount_cents)} as externally paid?`,
            text: 'Confirm only after you have independently completed the bank or e-wallet transfer. Farmgate will record it but will not send money.',
            confirmText: 'Record completed transfer',
        });
        if (!confirmed) return;
        setSavingId(payout.id);
        setActionError('');
        try {
            await initializeCsrf();
            const payload = new FormData();
            payload.append('external_reference', form.externalReference);
            payload.append('method', form.method);
            payload.append('amount_cents', String(amountCents));
            payload.append('paid_at', form.paidAt);
            payload.append('reason', form.reason);
            payload.append('externally_completed_confirmed', form.confirmed ? '1' : '');
            payload.append('receipt', form.receipt);
            await api.post(`/api/admin/rider-payouts/${payout.id}/manual-confirm`, payload);
            setExpandedId(null);
            setForms((current) => {
                const next = { ...current };
                delete next[payout.id];
                return next;
            });
            onPayoutChanged();
        } catch (requestError: unknown) {
            const message = messageFrom(requestError, 'The external payout could not be recorded.');
            setActionError(message);
            onError(message);
        } finally {
            setSavingId(null);
        }
    };

    return <div className="rider-payout-tab-content">
        <div className="rider-payout-subsection-heading">
            <div><h4>Eligible unpaid delivery earnings</h4><p>Each row represents one verified delivery and its saved fee and rate snapshot. Confirm the external transfer before recording it.</p></div>
            <span className="rider-payout-count">{payouts?.total ?? 0} pending</span>
        </div>
        <div className="rider-payout-filter-bar">
            <label className="seller-listing-search">Search rider, delivery, or order
                <input type="search" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Name, delivery reference, or order reference" />
            </label>
            <label className="rider-payout-filter">Destination
                <select value={destinationStatus} onChange={(event) => { setDestinationStatus(event.target.value); setPage(1); }}>
                    <option value="ALL">All destinations</option>
                    <option value="VERIFIED">Ready to pay</option>
                    <option value="NEEDS_REVIEW">Needs destination review</option>
                </select>
            </label>
            <label className="rider-payout-filter">Sort
                <select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}>
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                    <option value="amount_desc">Amount: high to low</option>
                    <option value="amount_asc">Amount: low to high</option>
                </select>
            </label>
        </div>
        <LoadState loading={loading} error={error} onRetry={() => setReload((version) => version + 1)} />
        {!loading && !error && <div className="rider-payout-history-table-wrap">
            <table className="data-table rider-payout-operations-table">
                <thead><tr><th>Payout reference</th><th>Rider</th><th>Delivery / order</th><th>Amount due</th><th>Destination</th><th>Details</th></tr></thead>
                <tbody>
                    {(payouts?.data ?? []).map((payout) => <PendingPayoutRow
                        key={payout.id}
                        payout={payout}
                        expanded={expandedId === payout.id}
                        form={formFor(payout)}
                        saving={savingId === payout.id}
                        actionError={expandedId === payout.id ? actionError : ''}
                        onToggle={() => { setExpandedId((current) => current === payout.id ? null : payout.id); setActionError(''); }}
                        onUpdate={(values) => updateForm(payout, values)}
                        onSubmit={(event) => void recordPayout(event, payout)}
                    />)}
                    {payouts?.data.length === 0 && <tr><td colSpan={6}><p className="rider-payout-empty-state">No eligible unpaid delivery earnings match these filters.</p></td></tr>}
                </tbody>
            </table>
        </div>}
        {!loading && !error && payouts && <Pagination page={payouts.current_page} lastPage={payouts.last_page} onChange={setPage} label="Pending rider payout pages" />}
    </div>;
}

function PendingPayoutRow({ payout, expanded, form, saving, actionError, onToggle, onUpdate, onSubmit }: {
    payout: Payout;
    expanded: boolean;
    form: PayoutFormState;
    saving: boolean;
    actionError: string;
    onToggle: () => void;
    onUpdate: (values: Partial<PayoutFormState>) => void;
    onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
    const destination = payout.destination_masked;
    const eligibleDestination = destination?.status === 'VERIFIED';
    return <>
        <tr>
            <td><strong>{payout.payout_reference}</strong><small className="rider-payout-secondary">{payout.status}</small></td>
            <td>{payout.rider?.name ?? 'Rider'}<small className="rider-payout-secondary">Rider #{payout.rider?.id ?? '—'}</small></td>
            <td>{payout.earning?.delivery?.delivery_reference ?? '—'}<small className="rider-payout-secondary">{payout.earning?.order?.order_reference ?? 'Order unavailable'}</small></td>
            <td><strong>{money(payout.amount_cents)}</strong></td>
            <td>{destination ? <>{destination.institution}<small className="rider-payout-secondary">{destination.identifier ?? 'Identifier unavailable'}</small><StatusPill status={destination.status}>{destination.status.replaceAll('_', ' ')}</StatusPill></> : <StatusPill status="needs-review">No destination</StatusPill>}</td>
            <td><button type="button" className="seller-inline-action" aria-expanded={expanded} onClick={onToggle}>{expanded ? 'Hide details' : 'Review payout'}</button></td>
        </tr>
        {expanded && <tr className="rider-payout-expanded-row"><td colSpan={6}>
            <div className="rider-payout-expanded">
                <div className="rider-payout-record-heading">
                    <div><p className="eyebrow">Delivery earnings</p><h5>{payout.earning?.delivery?.delivery_reference ?? 'Delivery reference unavailable'}</h5><p>Order {payout.earning?.order?.order_reference ?? '—'} · verified {dateLabel(payout.earning?.delivery?.delivery_verified_at)}</p></div>
                    <strong>{money(payout.amount_cents)}</strong>
                </div>
                <dl className="rider-payout-destination-details">
                    <div><dt>Delivery fee saved at completion</dt><dd>{money(payout.earning?.delivery_fee_cents)}</dd></div>
                    <div><dt>Saved earning rate</dt><dd>{payout.earning?.percentage_snapshot ?? '—'}%</dd></div>
                    <div><dt>Saved cap rule</dt><dd>{scopeLabel(payout.earning?.cap_scope_snapshot)}{payout.earning?.cap_amount_snapshot ? ` · ₱${Number(payout.earning.cap_amount_snapshot).toFixed(2)}` : ''}</dd></div>
                    <div><dt>Calculated rider earning</dt><dd>{money(payout.earning?.amount_cents)}</dd></div>
                    <div><dt>Verified payout destination</dt><dd>{destination ? `${destination.account_holder} · ${destination.institution} · ${destination.identifier ?? 'masked identifier unavailable'}` : 'No verified destination assigned'}</dd></div>
                    <div><dt>Destination status</dt><dd>{destination ? <StatusPill status={destination.status}>{destination.status.replaceAll('_', ' ')}</StatusPill> : 'Needs review'}</dd></div>
                </dl>
                <div className="rider-payout-audit-list">
                    <h5>Payout audit history</h5>
                    {payout.histories?.length ? <ol>{payout.histories.map((item, index) => <li key={`${item.action}-${item.created_at}-${index}`}><strong>{item.action.replaceAll('_', ' ')}</strong><span>{item.actor?.name ?? 'System'} · {dateLabel(item.created_at)}</span>{item.reason && <p>{item.reason}</p>}</li>)}</ol> : <p>No payout audit events are available.</p>}
                </div>
                {!eligibleDestination ? <p className="seller-error" role="status">A current admin-verified destination is required before an external transfer can be recorded.</p> : <form className="rider-payout-record-form" onSubmit={onSubmit}>
                    <h5>Record a completed external transfer</h5>
                    <p>Transfer the exact amount outside Farmgate first. Farmgate does not initiate transfers from this screen.</p>
                    <div className="rider-payout-payment-fields">
                        <label className="rider-payout-field">Transfer method<input value={form.method === 'GCASH' ? 'GCash' : 'Bank transfer'} readOnly /></label>
                        <label className="rider-payout-field">Transferred amount (PHP)
                            <input type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => onUpdate({ amount: event.target.value })} required />
                        </label>
                        <label className="rider-payout-field">External transfer reference
                            <input type="text" minLength={4} maxLength={100} pattern="[A-Za-z0-9._:-]+" value={form.externalReference} onChange={(event) => onUpdate({ externalReference: event.target.value })} required />
                        </label>
                        <label className="rider-payout-field">Transfer date
                            <input type="date" max={localDate()} value={form.paidAt} onChange={(event) => onUpdate({ paidAt: event.target.value })} required />
                        </label>
                        <label className="rider-payout-field">Private transfer receipt
                            <input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => onUpdate({ receipt: event.target.files?.[0] ?? null })} required />
                            <small>PDF or image, maximum 10 MB. Accessible only to this rider and authorized admins.</small>
                        </label>
                        <label className="rider-payout-field rider-payout-reason-field">Reason / reconciliation note
                            <textarea minLength={8} maxLength={500} value={form.reason} onChange={(event) => onUpdate({ reason: event.target.value })} required />
                        </label>
                    </div>
                    <label className="rider-payout-confirmation">
                        <input type="checkbox" checked={form.confirmed} onChange={(event) => onUpdate({ confirmed: event.target.checked })} required />
                        <span>I independently confirmed that this external transfer is complete for the exact amount shown.</span>
                    </label>
                    {actionError && <p className="seller-error" role="alert">{actionError}</p>}
                    <div className="rider-payout-settings-actions"><button type="submit" disabled={saving || !form.confirmed}>{saving ? 'Recording…' : 'Record completed external payout'}</button></div>
                </form>}
            </div>
        </td></tr>}
    </>;
}

function RecordedPayoutsTab({ refreshVersion }: { refreshVersion: number }) {
    const [payouts, setPayouts] = useState<Page<Payout> | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [reload, setReload] = useState(0);
    const [page, setPage] = useState(1);
    const [searchText, setSearchText] = useState('');
    const [search, setSearch] = useState('');
    const [method, setMethod] = useState('ALL');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [sort, setSort] = useState('newest');

    useEffect(() => {
        const timer = window.setTimeout(() => { setSearch(searchText.trim()); setPage(1); }, 250);
        return () => window.clearTimeout(timer);
    }, [searchText]);

    useEffect(() => {
        let active = true;
        const params: Record<string, string | number> = { group: 'recorded', page, per_page: 10, sort };
        if (search) params.search = search;
        if (method !== 'ALL') params.method = method;
        if (fromDate) params.from_date = fromDate;
        if (toDate) params.to_date = toDate;
        setLoading(true);
        setError('');
        api.get<{ payouts: Page<Payout> }>('/api/admin/rider-payouts', { params })
            .then((response) => { if (active) setPayouts(response.data.payouts); })
            .catch((requestError: unknown) => { if (active) setError(messageFrom(requestError, 'Recorded rider payouts could not be loaded.')); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [page, search, method, fromDate, toDate, sort, reload, refreshVersion]);

    return <div className="rider-payout-tab-content">
        <div className="rider-payout-subsection-heading"><div><h4>Recorded external payouts</h4><p>Only payouts confirmed after an external transfer are shown here. Receipt access is authenticated and private.</p></div><span className="rider-payout-count">{payouts?.total ?? 0} recorded</span></div>
        <div className="rider-payout-filter-bar rider-payout-filter-bar--recorded">
            <label className="seller-listing-search">Search payout, rider, delivery, or order
                <input type="search" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Payout reference, rider, or delivery reference" />
            </label>
            <label className="rider-payout-filter">Transfer method
                <select value={method} onChange={(event) => { setMethod(event.target.value); setPage(1); }}>
                    <option value="ALL">All methods</option>
                    <option value="BANK_TRANSFER">Bank transfer</option>
                    <option value="GCASH">GCash</option>
                </select>
            </label>
            <label className="rider-payout-filter">Paid from<input type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); setPage(1); }} /></label>
            <label className="rider-payout-filter">Paid through<input type="date" value={toDate} onChange={(event) => { setToDate(event.target.value); setPage(1); }} /></label>
            <label className="rider-payout-filter">Sort
                <select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}>
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                    <option value="amount_desc">Amount: high to low</option>
                    <option value="amount_asc">Amount: low to high</option>
                </select>
            </label>
        </div>
        <LoadState loading={loading} error={error} onRetry={() => setReload((version) => version + 1)} />
        {!loading && !error && <div className="rider-payout-history-table-wrap">
            <table className="data-table rider-payout-operations-table">
                <thead><tr><th>Payout reference</th><th>Rider</th><th>Delivery / order</th><th>Amount</th><th>Paid date</th><th>Destination</th><th>Receipt</th></tr></thead>
                <tbody>
                    {(payouts?.data ?? []).map((payout) => <tr key={payout.id}>
                        <td><strong>{payout.payout_reference}</strong><small className="rider-payout-secondary">{payout.method === 'GCASH' ? 'GCash' : 'Bank transfer'}</small></td>
                        <td>{payout.rider?.name ?? 'Rider'}<small className="rider-payout-secondary">Rider #{payout.rider?.id ?? '—'}</small></td>
                        <td>{payout.earning?.delivery?.delivery_reference ?? '—'}<small className="rider-payout-secondary">{payout.earning?.order?.order_reference ?? '—'}</small></td>
                        <td><strong>{money(payout.amount_cents)}</strong></td>
                        <td>{dateLabel(payout.paid_at)}</td>
                        <td>{payout.destination_masked ? <>{payout.destination_masked.institution}<small className="rider-payout-secondary">{payout.destination_masked.identifier ?? '—'}</small></> : 'Destination unavailable'}</td>
                        <td>{payout.receipt_url ? <a className="seller-inline-action rider-payout-receipt-link" href={payout.receipt_url} target="_blank" rel="noreferrer">View receipt</a> : <span className="rider-payout-secondary">Not recorded</span>}</td>
                    </tr>)}
                    {payouts?.data.length === 0 && <tr><td colSpan={7}><p className="rider-payout-empty-state">No recorded external payouts match these filters.</p></td></tr>}
                </tbody>
            </table>
        </div>}
        {!loading && !error && payouts && <Pagination page={payouts.current_page} lastPage={payouts.last_page} onChange={setPage} label="Recorded rider payout pages" />}
    </div>;
}
