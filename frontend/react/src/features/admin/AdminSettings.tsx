import React from 'react';
import api, { initializeCsrf } from '../../lib/api';
import { confirmAction, showSuccess } from '../../lib/alerts';
import { TabNav } from '../../shared/components/TabNav';
import { Pagination } from '../../shared/components/Pagination';

type Definition = { default: unknown; type: 'string' | 'integer' | 'decimal' | 'boolean' | 'json'; category: string; label: string };
type Tier = { id: number; name?: string; min_km: string | number; max_km?: string | number | null; base_fee: string | number; fee_per_km: string | number; priority: number; is_active: boolean };
type TierDraft = { name: string; min_km: string | number; max_km: string | number; base_fee: string | number; fee_per_km: string | number; priority: string | number; is_active: boolean };
type SettingsHistoryResponse = {
    data: Record<string, any>[];
    current_page: number;
    last_page: number;
    total: number;
};
type SettingsResponse = { settings: Record<string, unknown>; definitions: Record<string, Definition>; tiers: Tier[]; history: SettingsHistoryResponse };
const categoryLabels: Record<string, string> = {
    account: 'Account', orders: 'Orders', charges: 'Charges', delivery: 'Delivery', distance: 'Distance',
    rider: 'Rider', seller: 'Seller', buyer: 'Buyer', listings: 'Listings', notifications: 'Notifications', finance: 'Finance',
    security: 'Security', system: 'System',
};

const initialTier: TierDraft = { name: '', min_km: 0, max_km: '', base_fee: 0, fee_per_km: 0, priority: 0, is_active: true };

export function AdminSettings({ onError, initialCategory = 'account' }: { onError: (message: string) => void; initialCategory?: string }) {
    const [settings, setSettings] = React.useState<Record<string, unknown>>({});
    const [definitions, setDefinitions] = React.useState<Record<string, Definition>>({});
    const [tiers, setTiers] = React.useState<Tier[]>([]);
    const [history, setHistory] = React.useState<Record<string, any>[]>([]);
    const [category, setCategory] = React.useState(initialCategory);
    const [reason, setReason] = React.useState('');
    const [tier, setTier] = React.useState<TierDraft>(initialTier);
    const [loading, setLoading] = React.useState(true);
    const [saving, setSaving] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const [historyOpen, setHistoryOpen] = React.useState(false);
    const [historyPage, setHistoryPage] = React.useState(1);
    const [historyLastPage, setHistoryLastPage] = React.useState(1);
    const [historyTotal, setHistoryTotal] = React.useState(0);
    const [historyLoading, setHistoryLoading] = React.useState(false);

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
        api.get<SettingsResponse>('/api/admin/settings').then(({ data }) => {
            setSettings(data.settings);
            setDefinitions(data.definitions);
            setTiers(data.tiers);
            setHistory(data.history.data ?? []);
            setHistoryPage(1);
            setHistoryLastPage(data.history.last_page ?? 1);
            setHistoryTotal(data.history.total ?? data.history.data?.length ?? 0);
            setCategory((current) => Object.values(data.definitions).some((definition) => definition.category === current)
                ? current
                : Object.values(data.definitions).some((definition) => definition.category === initialCategory)
                    ? initialCategory
                    : Object.values(data.definitions)[0]?.category ?? 'account');
        }).catch((error: any) => onError(getAccessMessage(error))).finally(() => setLoading(false));
    }

    React.useEffect(load, [initialCategory]);

    async function loadHistoryPage(page: number) {
        setHistoryLoading(true);
        try {
            const { data } = await api.get<{ history: SettingsHistoryResponse }>(`/api/admin/settings/history?page=${page}`);
            setHistory(data.history.data ?? []);
            setHistoryPage(data.history.current_page ?? page);
            setHistoryLastPage(data.history.last_page ?? 1);
            setHistoryTotal(data.history.total ?? 0);
        } catch (error: any) {
            onError(getAccessMessage(error));
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
        try {
            await initializeCsrf();
            await api.put('/api/admin/settings', { settings, reason: reason || undefined });
            setMessage('Settings saved and audited.');
            showSuccess('Admin settings saved.');
            setReason('');
            load();
        } catch (error: any) {
            onError(getAccessMessage(error));
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

    const categories = [...new Set(Object.values(definitions).map((definition) => definition.category))];
    const visibleSettings = Object.entries(definitions).filter(([, definition]) => definition.category === category);
    return <section className="admin-section settings-panel">
        <div className="admin-section-heading">
            <div><p className="eyebrow">Governance</p><h2>Admin settings</h2></div>
            <span className="admin-filter">Database-backed and audited</span>
        </div>
        {loading ? <p className="admin-loading">Loading settings...</p> : <>
            <TabNav label="Settings category" value={category} onChange={setCategory} options={categories.map((item) => ({ value: item, label: categoryLabels[item] ?? item }))} />
            <form onSubmit={save}>
                <div className="settings-grid">
                    {visibleSettings.map(([key, definition]) => <label key={key} className="settings-field">
                        <span className="settings-label-text">{definition.label}</span>
                        {definition.type === 'boolean'
                            ? <input type="checkbox" checked={Boolean(settings[key])} onChange={(event) => updateValue(key, definition, event.target.checked)} />
                            : <input type={definition.type === 'string' ? 'text' : 'number'} min={definition.type === 'integer' || definition.type === 'decimal' ? 0 : undefined} step={definition.type === 'integer' ? 1 : definition.type === 'decimal' ? 0.01 : undefined} value={String(settings[key] ?? '')} onChange={(event) => updateValue(key, definition, event.target.value)} />}
                    </label>)}
                </div>
                <label className="settings-reason">Reason for change {category === 'finance' ? '(required to enable payouts)' : '(optional)'}<input value={reason} maxLength={255} onChange={(event) => setReason(event.target.value)} /></label>
                <div className="settings-actions"><button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save settings'}</button>{message && <span className="settings-success">{message}</span>}</div>
            </form>
            {category === 'distance' && <div className="tier-editor">
                <h3>Delivery rate tiers</h3>
                <form className="settings-grid" onSubmit={saveTier}>
                    <label>Name<input value={tier.name} onChange={(event) => setTier({ ...tier, name: event.target.value })} /></label>
                    <label>Minimum km<input type="number" min="0" step="0.01" value={String(tier.min_km)} onChange={(event) => setTier({ ...tier, min_km: event.target.value })} /></label>
                    <label>Maximum km<input type="number" min="0" step="0.01" value={String(tier.max_km)} onChange={(event) => setTier({ ...tier, max_km: event.target.value })} /></label>
                    <label>Base fee<input type="number" min="0" step="0.01" value={String(tier.base_fee)} onChange={(event) => setTier({ ...tier, base_fee: event.target.value })} /></label>
                    <label>Per km fee<input type="number" min="0" step="0.01" value={String(tier.fee_per_km)} onChange={(event) => setTier({ ...tier, fee_per_km: event.target.value })} /></label>
                    <label>Priority<input type="number" min="0" step="1" value={String(tier.priority)} onChange={(event) => setTier({ ...tier, priority: event.target.value })} /></label>
                    <button type="submit">Add delivery tier</button>
                </form>
                {tiers.length ? <div className="data-table-wrap"><table><thead><tr><th>Name</th><th>Range</th><th>Base</th><th>Per km</th><th>Action</th></tr></thead><tbody>{tiers.map((item) => <tr key={item.id}><td>{item.name ?? '-'}</td><td>{item.min_km} - {item.max_km ?? '+'} km</td><td>{item.base_fee}</td><td>{item.fee_per_km}</td><td><button type="button" onClick={() => deleteTier(item.id)}>Delete</button></td></tr>)}</tbody></table></div> : <p className="admin-empty">No delivery tiers configured.</p>}
            </div>}
            <section className="settings-history" aria-labelledby="settings-history-heading">
                <h3 className="settings-history-heading">
                    <button
                        type="button"
                        aria-expanded={historyOpen}
                        aria-controls="settings-history-content"
                        onClick={() => {
                            const nextOpen = !historyOpen;
                            setHistoryOpen(nextOpen);
                            if (nextOpen) void loadHistoryPage(1);
                        }}
                    >
                        <span>Recent changes</span><span className="settings-history-chevron" aria-hidden="true">{historyOpen ? '−' : '+'}</span>
                    </button>
                </h3>
                {historyOpen && <div id="settings-history-content" className="settings-history-content">
                    {historyLoading ? <p role="status">Loading recent changes...</p> : historyTotal ? <>
                        <p className="settings-history-count" role="status">{historyTotal} setting {historyTotal === 1 ? 'change' : 'changes'} recorded · page {historyPage} of {historyLastPage}</p>
                        <div className="data-table-wrap"><table><thead><tr><th>Setting</th><th>Before</th><th>After</th><th>Changed by</th><th>Time</th></tr></thead><tbody>{history.map((item) => <tr key={item.id}><td>{item.key}</td><td>{item.old_value ?? '-'}</td><td>{item.new_value}</td><td>{item.actor?.name ?? '-'}</td><td>{new Date(item.created_at).toLocaleString()}</td></tr>)}</tbody></table></div>
                        {historyLastPage > 1 && <Pagination page={historyPage} lastPage={historyLastPage} onChange={(page) => void loadHistoryPage(page)} label="Recent settings changes pages" />}
                    </> : <p className="admin-empty">No setting changes recorded.</p>}
                </div>}
            </section>
        </>}
    </section>;
}
