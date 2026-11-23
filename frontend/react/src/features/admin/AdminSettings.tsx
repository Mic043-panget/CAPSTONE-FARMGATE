import React from 'react';
import api, { initializeCsrf } from '../../lib/api';
import { confirmAction, showSuccess } from '../../lib/alerts';
import { AdminSellerVerificationPage } from './AdminSellerVerificationPage';
import { SettingsCategoryIcon } from '../shared/SettingsCategoryIcon';

type Definition = { default: unknown; type: 'string' | 'integer' | 'decimal' | 'boolean' | 'json'; category: string; label: string };
type Tier = { id: number; name?: string; min_km: string | number; max_km?: string | number | null; base_fee: string | number; fee_per_km: string | number; priority: number; is_active: boolean };
type TierDraft = { name: string; min_km: string | number; max_km: string | number; base_fee: string | number; fee_per_km: string | number; priority: string | number; is_active: boolean };
type SettingsHistoryEntry = {
    id: number;
    key: string;
    old_value: unknown;
    new_value: unknown;
    change_reason?: string | null;
    created_at: string;
    actor?: { name?: string | null } | null;
};
type SettingsHistoryResponse = {
    data: SettingsHistoryEntry[];
    current_page: number;
    last_page: number;
    total: number;
};
type SettingsResponse = { settings: Record<string, unknown>; definitions: Record<string, Definition>; tiers: Tier[]; history: SettingsHistoryResponse };
const categoryLabels: Record<string, string> = {
    account: 'Account', orders: 'Orders', charges: 'Charges', delivery: 'Delivery', distance: 'Distance',
    rider: 'Rider', seller: 'Seller', buyer: 'Buyer', listings: 'Listings', notifications: 'Notifications', finance: 'Finance',
    security: 'Security', system: 'System', 'seller-verification': 'Seller verification',
};
const categoryDescriptions: Record<string, string> = {
    account: 'Control registrations and account lifecycle access.',
    security: 'Configure password, session, and verification protections.',
    seller: 'Manage seller verification and listing rules.',
    rider: 'Manage rider verification, assignment, and compensation.',
    orders: 'Set order limits and processing windows.',
    charges: 'Review marketplace charge and fee configuration.',
    finance: 'Manage seller payout availability and audit reasons.',
    delivery: 'Configure delivery pricing, limits, and verification.',
    distance: 'Manage distance calculations and delivery rate tiers.',
    listings: 'Set livestock quantity, image, and approval rules.',
    notifications: 'Manage system notification channels and categories.',
    system: 'Set platform-wide defaults and maintenance behavior.',
    'seller-verification': 'Review submitted seller identity documents using the existing workflow.',
};

const initialTier: TierDraft = { name: '', min_km: 0, max_km: '', base_fee: 0, fee_per_km: 0, priority: 0, is_active: true };

function settingIconName(key: string, category: string): string {
    if (category !== 'account') return category;
    if (key.startsWith('seller_')) return 'seller';
    if (key.startsWith('rider_')) return 'rider';
    return 'account';
}

function SettingsStatusIcon({ enabled }: { enabled: boolean }) {
    return <span className={`settings-status-icon${enabled ? ' is-enabled' : ' is-disabled'}`} aria-hidden="true">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {enabled ? <><circle cx="10" cy="10" r="7.5" /><path d="m6.5 10 2.2 2.2 4.8-4.8" /></> : <><circle cx="10" cy="10" r="7.5" /><path d="M7 10h6" /></>}
        </svg>
    </span>;
}

function historyValue(value: unknown, definition?: Definition): string {
    if (value === null || value === undefined || value === '') return 'Not configured';
    if (definition?.type === 'boolean') {
        return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true' ? 'Enabled' : 'Disabled';
    }

    return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export function AdminSettings({ onError, initialCategory = 'account', onOpenAuditHistory }: {
    onError: (message: string) => void;
    initialCategory?: string;
    onOpenAuditHistory?: () => void;
}) {
    const [settings, setSettings] = React.useState<Record<string, unknown>>({});
    const [savedSettings, setSavedSettings] = React.useState<Record<string, unknown>>({});
    const [definitions, setDefinitions] = React.useState<Record<string, Definition>>({});
    const [tiers, setTiers] = React.useState<Tier[]>([]);
    const [history, setHistory] = React.useState<SettingsHistoryEntry[]>([]);
    const [category, setCategory] = React.useState(initialCategory);
    const [reason, setReason] = React.useState('');
    const [tier, setTier] = React.useState<TierDraft>(initialTier);
    const [loading, setLoading] = React.useState(true);
    const [loadError, setLoadError] = React.useState('');
    const [saving, setSaving] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const [saveError, setSaveError] = React.useState('');
    const [historyOpen, setHistoryOpen] = React.useState(true);
    const [historyTotal, setHistoryTotal] = React.useState(0);
    const [historyLoading, setHistoryLoading] = React.useState(false);
    const [historyError, setHistoryError] = React.useState('');

    function getAccessMessage(error: any): string {
        const status = error?.response?.status;
        if (status === 401) {
            return 'Your session has expired. Please sign in again to manage system settings.';
        }
        if (status === 403) {
            return 'Admin access is required to view or change system settings.';
        }
        return error?.userMessage ?? 'System settings could not be loaded.';
    }

    function load() {
        setLoading(true);
        setLoadError('');
        api.get<SettingsResponse>('/api/admin/settings').then(({ data }) => {
            setSettings(data.settings);
            setSavedSettings(data.settings);
            setDefinitions(data.definitions);
            setTiers(data.tiers);
            setHistory(data.history.data ?? []);
            setHistoryTotal(data.history.total ?? data.history.data?.length ?? 0);
            setHistoryError('');
            setCategory((current) => current === 'seller-verification'
                || Object.values(data.definitions).some((definition) => definition.category === current)
                ? current
                : Object.values(data.definitions).some((definition) => definition.category === initialCategory)
                    ? initialCategory
                    : Object.values(data.definitions)[0]?.category ?? 'account');
        }).catch((error: any) => {
            const errorMessage = getAccessMessage(error);
            setLoadError(errorMessage);
            onError(errorMessage);
        }).finally(() => setLoading(false));
    }

    React.useEffect(load, [initialCategory]);

    async function loadHistoryPage(page: number) {
        setHistoryLoading(true);
        setHistoryError('');
        try {
            const { data } = await api.get<{ history: SettingsHistoryResponse }>(`/api/admin/settings/history?page=${page}`);
            setHistory(data.history.data ?? []);
            setHistoryTotal(data.history.total ?? 0);
        } catch (error: any) {
            const errorMessage = getAccessMessage(error);
            setHistoryError(errorMessage);
            onError(errorMessage);
        } finally {
            setHistoryLoading(false);
        }
    }

    function updateValue(key: string, definition: Definition, value: string | boolean) {
        const next = definition.type === 'boolean'
            ? value === true
            : definition.type === 'integer'
                ? Number.parseInt(String(value), 10) || 0
                : definition.type === 'decimal'
                    ? Number.parseFloat(String(value)) || 0
                    : value;
        setSettings((current) => ({ ...current, [key]: next }));
    }

    async function save(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setSaving(true);
        setMessage('');
        setSaveError('');
        try {
            await initializeCsrf();
            await api.put('/api/admin/settings', { settings, reason: reason || undefined });
            setMessage('Settings saved and audited.');
            showSuccess('Admin settings saved.');
            setReason('');
            load();
        } catch (error: any) {
            const errorMessage = getAccessMessage(error);
            setSaveError(errorMessage);
            onError(errorMessage);
        } finally {
            setSaving(false);
        }
    }

    async function saveTier(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        try {
            await initializeCsrf();
            await api.post('/api/admin/settings/tiers', { ...tier, max_km: tier.max_km || null });
            setTier(initialTier);
            showSuccess('Delivery rate tier added.');
            load();
        } catch (error: any) {
            onError(getAccessMessage(error));
        }
    }

    async function deleteTier(id: number) {
        if (!await confirmAction({ title: 'Delete delivery rate tier?', text: 'This change will affect future delivery fee calculations.', confirmText: 'Delete tier', danger: true })) return;
        try {
            await initializeCsrf();
            await api.delete(`/api/admin/settings/tiers/${id}`);
            showSuccess('Delivery rate tier deleted.');
            load();
        } catch (error: any) {
            onError(getAccessMessage(error));
        }
    }

    const categories = [...new Set([...Object.values(definitions).map((definition) => definition.category), 'seller-verification'])];
    const categoryOptions = categories.map((item) => ({ value: item, label: categoryLabels[item] ?? item }));
    const visibleSettings = Object.entries(definitions).filter(([, definition]) => definition.category === category);
    const categoryLabel = categoryLabels[category] ?? category;
    const categoryHeading = category === 'account' ? 'Registration & Account Controls' : `${categoryLabel} settings`;
    const reasonRequired = category === 'finance'
        && Boolean(savedSettings.manual_seller_payouts_enabled) !== Boolean(settings.manual_seller_payouts_enabled);
    const recentHistory = history.slice(0, 3);
    return <section className="admin-section settings-panel" aria-labelledby="admin-settings-title">
        <div className="admin-section-heading settings-page-heading">
            <div className="settings-page-title">
                <span className="settings-page-icon"><SettingsCategoryIcon name="system" /></span>
                <div><p className="eyebrow">Governance</p><h2 id="admin-settings-title">Admin Settings</h2></div>
            </div>
            <span className="settings-audit-status"><SettingsStatusIcon enabled /><span>Database-backed and audited</span></span>
        </div>
        {loading ? <p className="admin-loading" role="status">Loading settings...</p> : loadError ? <div className="settings-load-error" role="alert">
            <p>{loadError}</p><button type="button" onClick={load}>Retry loading settings</button>
        </div> : <>
            <nav className="settings-category-nav" aria-label="Settings category">
                {categoryOptions.map((option) => <button
                    type="button"
                    className={`settings-category-tab${option.value === category ? ' is-active' : ''}`}
                    key={option.value}
                    aria-current={option.value === category ? 'page' : undefined}
                    onClick={() => setCategory(option.value)}
                >
                    <SettingsCategoryIcon name={option.value} /><span>{option.label}</span>
                </button>)}
            </nav>
            <div className="settings-page-layout">
                <section className="settings-focused-panel" aria-labelledby="settings-category-heading">
                    <header className="settings-category-heading">
                        <span className="settings-section-icon"><SettingsCategoryIcon name={category} /></span>
                        <div>
                            <p className="eyebrow">{categoryLabel}</p>
                            <h3 id="settings-category-heading">{categoryHeading}</h3>
                            <p>{categoryDescriptions[category] ?? 'Review and update the saved values for this settings category.'}</p>
                        </div>
                    </header>
                    {category === 'seller-verification' ? <AdminSellerVerificationPage /> : <>
                        <form className="settings-form" onSubmit={save}>
                            <div className="settings-grid">
                                {visibleSettings.map(([key, definition]) => definition.type === 'boolean'
                                    ? <label key={key} className="settings-field settings-toggle-field">
                                        <span className="settings-field-copy">
                                            <span className="settings-row-icon"><SettingsCategoryIcon name={settingIconName(key, category)} /></span>
                                            <span className="settings-field-text">
                                                <strong>{definition.label}</strong>
                                                <span className="settings-field-state"><SettingsStatusIcon enabled={Boolean(settings[key])} />{Boolean(settings[key]) ? 'Enabled' : 'Disabled'}</span>
                                            </span>
                                        </span>
                                        <input className="settings-toggle-input" type="checkbox" role="switch" aria-label={definition.label} checked={Boolean(settings[key])} onChange={(event) => updateValue(key, definition, event.target.checked)} />
                                    </label>
                                    : <label key={key} className="settings-field settings-value-field">
                                        <span className="settings-row-icon"><SettingsCategoryIcon name={settingIconName(key, category)} /></span>
                                        <span className="settings-value-copy">
                                            <strong>{definition.label}</strong>
                                            <input aria-label={definition.label} type={definition.type === 'string' ? 'text' : 'number'} min={definition.type === 'integer' || definition.type === 'decimal' ? 0 : undefined} step={definition.type === 'integer' ? 1 : definition.type === 'decimal' ? 0.01 : undefined} value={String(settings[key] ?? '')} onChange={(event) => updateValue(key, definition, event.target.value)} />
                                        </span>
                                    </label>)}
                            </div>
                            <label className="settings-reason">
                                <span>Reason for change <small>{reasonRequired ? '(required for this change)' : category === 'finance' ? '(required when payout availability changes)' : '(optional)'}</small></span>
                                <input required={reasonRequired} value={reason} maxLength={255} onChange={(event) => setReason(event.target.value)} placeholder="Briefly explain the reason for this change" />
                                {category === 'finance' && <small className="settings-reason-help">A reason is required when enabling or disabling manual seller payouts.</small>}
                            </label>
                            <div className="settings-actions">
                                <button type="submit" disabled={saving}>
                                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M4 3h13l3 3v15H4zM8 3v6h8V3M8 21v-8h8v8" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
                                    {saving ? 'Saving...' : 'Save Settings'}
                                </button>
                                {message && <span className="settings-success" role="status"><SettingsStatusIcon enabled />{message}</span>}
                                {saveError && <span className="settings-save-error" role="alert">{saveError}</span>}
                            </div>
                        </form>
                        {category === 'distance' && <section className="tier-editor" aria-labelledby="settings-tier-heading">
                            <header className="settings-subsection-heading">
                                <span className="settings-row-icon"><SettingsCategoryIcon name="distance" /></span>
                                <div><h4 id="settings-tier-heading">Delivery rate tiers</h4><p>Distance-based fees currently saved for Farmgate.</p></div>
                            </header>
                            <form className="settings-grid settings-tier-form" onSubmit={saveTier}>
                                <label>Name<input value={tier.name} onChange={(event) => setTier({ ...tier, name: event.target.value })} /></label>
                                <label>Minimum km<input type="number" min="0" step="0.01" value={String(tier.min_km)} onChange={(event) => setTier({ ...tier, min_km: event.target.value })} /></label>
                                <label>Maximum km<input type="number" min="0" step="0.01" value={String(tier.max_km)} onChange={(event) => setTier({ ...tier, max_km: event.target.value })} /></label>
                                <label>Base fee<input type="number" min="0" step="0.01" value={String(tier.base_fee)} onChange={(event) => setTier({ ...tier, base_fee: event.target.value })} /></label>
                                <label>Per km fee<input type="number" min="0" step="0.01" value={String(tier.fee_per_km)} onChange={(event) => setTier({ ...tier, fee_per_km: event.target.value })} /></label>
                                <label>Priority<input type="number" min="0" step="1" value={String(tier.priority)} onChange={(event) => setTier({ ...tier, priority: event.target.value })} /></label>
                                <button type="submit">Add delivery tier</button>
                            </form>
                            {tiers.length ? <>
                                <div className="data-table-wrap settings-tier-table-wrap"><table className="settings-tier-table"><thead><tr><th>Name</th><th>Range</th><th>Base</th><th>Per km</th><th>Action</th></tr></thead><tbody>{tiers.map((item) => <tr key={item.id}><td>{item.name ?? '-'}</td><td>{item.min_km}–{item.max_km ?? '+'} km</td><td>{item.base_fee}</td><td>{item.fee_per_km}</td><td><button type="button" onClick={() => deleteTier(item.id)}>Delete</button></td></tr>)}</tbody></table></div>
                                <div className="settings-tier-cards">{tiers.map((item) => <article className="settings-tier-card" key={`card-${item.id}`}>
                                    <h5>{item.name ?? 'Unnamed tier'}</h5>
                                    <dl><div><dt>Range</dt><dd>{item.min_km}–{item.max_km ?? '+'} km</dd></div><div><dt>Base fee</dt><dd>{item.base_fee}</dd></div><div><dt>Per km</dt><dd>{item.fee_per_km}</dd></div><div><dt>Priority</dt><dd>{item.priority}</dd></div></dl>
                                    <button type="button" onClick={() => deleteTier(item.id)}>Delete tier</button>
                                </article>)}</div>
                            </> : <p className="admin-empty">No delivery tiers configured.</p>}
                        </section>}
                    </>}
                </section>
                <section className="settings-history" aria-labelledby="settings-history-heading">
                    <header className="settings-history-heading">
                        <div className="settings-history-title">
                            <span className="settings-history-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M3 12a9 9 0 1 0 2.6-6.4L3 8M3 3v5h5M12 7v5l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
                            <div><h3 id="settings-history-heading">Recent Changes</h3><span>{historyTotal} recorded {historyTotal === 1 ? 'change' : 'changes'}</span></div>
                        </div>
                        <div className="settings-history-actions">
                            {onOpenAuditHistory && <button className="settings-history-audit-link" type="button" onClick={onOpenAuditHistory}>View all <span aria-hidden="true">→</span></button>}
                            <button className="settings-history-toggle" type="button" aria-expanded={historyOpen} aria-controls="settings-history-content" onClick={() => {
                                const nextOpen = !historyOpen;
                                setHistoryOpen(nextOpen);
                                if (nextOpen) void loadHistoryPage(1);
                            }}>{historyOpen ? 'Hide' : 'Show'}</button>
                        </div>
                    </header>
                    {historyOpen && <div id="settings-history-content" className="settings-history-content">
                        {historyLoading ? <p role="status">Loading recent changes...</p> : historyError ? <div className="settings-history-error" role="alert">
                            <p>{historyError}</p><button type="button" onClick={() => void loadHistoryPage(1)}>Retry</button>
                        </div> : historyTotal ? <>
                            <p className="settings-history-count" role="status">Showing {recentHistory.length} latest of {historyTotal} recorded changes</p>
                            <ol className="settings-history-list">
                                {recentHistory.map((item) => {
                                    const definition = definitions[item.key];
                                    return <li className="settings-history-entry" key={item.id}>
                                        <span className="settings-history-entry-icon"><SettingsCategoryIcon name={definition?.category ?? category} /></span>
                                        <div className="settings-history-entry-copy">
                                            <strong>{definition?.label ?? item.key.replaceAll('_', ' ')}</strong>
                                            <p>Changed from <b>{historyValue(item.old_value, definition)}</b> to <b>{historyValue(item.new_value, definition)}</b>.</p>
                                            {item.change_reason && <p className="settings-history-reason" title={item.change_reason}>{item.change_reason}</p>}
                                            <small>{item.actor?.name ?? 'Unknown admin'} · <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time></small>
                                        </div>
                                    </li>;
                                })}
                            </ol>
                        </> : <p className="admin-empty">No setting changes recorded.</p>}
                    </div>}
                </section>
            </div>
        </>}
    </section>;
}
