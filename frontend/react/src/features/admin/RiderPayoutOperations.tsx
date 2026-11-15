import React from 'react';
import api, { initializeCsrf } from '../../lib/api';
import { confirmAction } from '../../lib/alerts';
import { Pagination } from '../../shared/components/Pagination';

type Setting = {
    percentage: string | null;
    cap_scope: 'NO_CAP' | 'PER_DELIVERY' | 'PER_PAYOUT' | null;
    cap_amount: string | null;
    change_reason: string | null;
    updated_at: string | null;
    updater?: { id: number; name: string } | null;
};
type SettingHistory = {
    id: number;
    old_percentage: string | null;
    new_percentage: string;
    old_cap_scope: string | null;
    new_cap_scope: string;
    old_cap_amount: string | null;
    new_cap_amount: string | null;
    reason: string;
    created_at: string;
    actor?: { id: number; name: string } | null;
};
type Payout = {
    id: number;
    amount_cents: number;
    status: 'PENDING' | 'PAID';
    method: string | null;
    paid_at: string | null;
    created_at: string;
    rider: { id: number; name: string };
    recorder?: { id: number; name: string } | null;
    earning: {
        percentage_snapshot: string;
        order: { order_reference: string };
        delivery: { delivery_reference: string };
    };
};
type Page<T> = { data: T[]; current_page: number; last_page: number; total: number };
type PayoutForm = {
    amount: string;
    method: string;
    externalReference: string;
    paidAt: string;
    reason: string;
    externallyCompleted: boolean;
};

function money(cents: number): string {
    return `PHP ${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function parseCents(value: string): number | null {
    const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value.trim());
    if (!match) return null;
    const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
    return Number.isSafeInteger(cents) ? cents : null;
}

export function RiderPayoutOperations({ onError }: { onError: (message: string) => void }) {
    const [setting, setSetting] = React.useState<Setting | null>(null);
    const [settingConfigured, setSettingConfigured] = React.useState(false);
    const [history, setHistory] = React.useState<SettingHistory[]>([]);
    const [percentage, setPercentage] = React.useState('');
    const [capScope, setCapScope] = React.useState('');
    const [capAmount, setCapAmount] = React.useState('');
    const [settingReason, setSettingReason] = React.useState('');
    const [pendingPayouts, setPendingPayouts] = React.useState<Page<Payout> | null>(null);
    const [recordedPayouts, setRecordedPayouts] = React.useState<Page<Payout> | null>(null);
    const [pendingPage, setPendingPage] = React.useState(1);
    const [recordedPage, setRecordedPage] = React.useState(1);
    const [payoutForms, setPayoutForms] = React.useState<Record<number, PayoutForm>>({});
    const [loading, setLoading] = React.useState(true);
    const [saving, setSaving] = React.useState(false);
    const [success, setSuccess] = React.useState('');

    const refresh = React.useCallback(async () => {
        setLoading(true);
        try {
            const [settingsResponse, pendingResponse, recordedResponse] = await Promise.all([
                api.get<{ setting: Setting | null; configured: boolean; history: SettingHistory[] }>('/api/admin/rider-earnings/settings'),
                api.get<{ payouts: Page<Payout> }>('/api/admin/rider-payouts', { params: { group: 'queue', page: pendingPage } }),
                api.get<{ payouts: Page<Payout> }>('/api/admin/rider-payouts', { params: { group: 'recorded', page: recordedPage } }),
            ]);
            const nextSetting = settingsResponse.data.setting;
            setSetting(nextSetting);
            setSettingConfigured(settingsResponse.data.configured);
            setHistory(settingsResponse.data.history);
            setPercentage(nextSetting?.percentage ?? '');
            setCapScope(nextSetting?.cap_scope ?? '');
            setCapAmount(nextSetting?.cap_amount ?? '');
            setPendingPayouts(pendingResponse.data.payouts);
            setRecordedPayouts(recordedResponse.data.payouts);
        } catch (error: any) {
            onError(error.userMessage ?? error.response?.data?.message ?? 'Rider earnings settings and payouts could not be loaded.');
        } finally {
            setLoading(false);
        }
    }, [onError, pendingPage, recordedPage]);

    React.useEffect(() => { void refresh(); }, [refresh]);

    async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const numericPercentage = Number(percentage);
        if (!/^(?:0|[1-9]\d?)(?:\.\d{1,2})?$|^100(?:\.0{1,2})?$/.test(percentage.trim())
            || !Number.isFinite(numericPercentage)
            || numericPercentage < 0
            || numericPercentage > 100) {
            onError('Enter an earnings percentage from 0% to 100%, with at most two decimal places.');
            return;
        }
        if (!capScope) {
            onError('Choose an explicit cap option before saving rider earnings.');
            return;
        }
        if (capScope !== 'NO_CAP' && (parseCents(capAmount) === null || parseCents(capAmount)! <= 0)) {
            onError('Enter a positive cap amount for a per-delivery or per-payout cap. Zero does not mean no cap.');
            return;
        }
        if (capScope === 'NO_CAP' && capAmount.trim() !== '') {
            onError('Leave the cap amount blank when selecting no cap.');
            return;
        }
        if (settingReason.trim().length < 8) {
            onError('Enter an audit reason of at least eight characters.');
            return;
        }

        setSaving(true);
        setSuccess('');
        try {
            await initializeCsrf();
            await api.put('/api/admin/rider-earnings/settings', {
                percentage: percentage.trim(),
                cap_scope: capScope,
                cap_amount: capScope === 'NO_CAP' ? null : capAmount.trim(),
                reason: settingReason.trim(),
            });
            setSettingReason('');
            setSuccess('Rider earnings settings saved and audited. Existing delivery snapshots were not changed.');
            await refresh();
        } catch (error: any) {
            onError(error.userMessage ?? error.response?.data?.message ?? 'Rider earnings settings could not be saved.');
        } finally {
            setSaving(false);
        }
    }

    function updatePayoutForm(payout: Payout, changes: Partial<PayoutForm>) {
        const current = payoutForms[payout.id] ?? {
            amount: (payout.amount_cents / 100).toFixed(2),
            method: 'BANK_TRANSFER',
            externalReference: '',
            paidAt: new Date().toISOString().slice(0, 10),
            reason: '',
            externallyCompleted: false,
        };
        setPayoutForms((forms) => ({ ...forms, [payout.id]: { ...current, ...changes } }));
    }

    async function confirmPayout(payout: Payout) {
        const form = payoutForms[payout.id];
        const amountCents = parseCents(form?.amount ?? '');
        if (amountCents === null
            || amountCents !== payout.amount_cents
            || !form?.method
            || form.externalReference.trim().length < 4
            || !form.paidAt
            || form.reason.trim().length < 8
            || !form.externallyCompleted) {
            onError('Enter the exact payout amount, transfer method, reference, date, reason, and confirm the transfer was already completed outside Farmgate.');
            return;
        }
        if (!await confirmAction({
            title: 'Record externally completed rider payout?',
            text: `Confirm that ${money(amountCents)} was already transferred outside Farmgate. This action records the transfer only; Farmgate will not send money.`,
            confirmText: 'Record external transfer',
        })) return;

        setSaving(true);
        setSuccess('');
        try {
            await api.post(`/api/admin/rider-payouts/${payout.id}/manual-confirm`, {
                amount_cents: amountCents,
                method: form.method,
                external_reference: form.externalReference.trim(),
                paid_at: form.paidAt,
                reason: form.reason.trim(),
                externally_completed_confirmed: true,
            });
            setSuccess('Externally completed rider payout recorded. Farmgate did not initiate a transfer.');
            await refresh();
        } catch (error: any) {
            onError(error.userMessage ?? error.response?.data?.message ?? 'The rider payout could not be recorded.');
        } finally {
            setSaving(false);
        }
    }

    const queueRows = pendingPayouts?.data ?? [];
    const recordedRows = recordedPayouts?.data ?? [];
    const isConfigured = settingConfigured;

    return <section className="payments-settings-card rider-payout-operations" aria-labelledby="rider-payout-operations-title">
        <div className="payments-section-heading">
            <div><h3 id="rider-payout-operations-title">Rider earnings and payouts</h3><p>Configure audited rates, review per-delivery amounts, and record only transfers already completed outside Farmgate.</p></div>
            <span className={`status-pill${isConfigured ? ' status-active' : ''}`}>{isConfigured ? 'Configured' : 'Not configured'}</span>
        </div>
        {loading ? <p role="status">Loading rider payout settings…</p> : <>
            <div className="payments-blocked-card" role="status">
                {!isConfigured
                    ? <p>Rider earnings and payouts are blocked until an authorized admin saves both a percentage and an explicit cap option. No rate or cap was seeded.</p>
                    : <p>Configuration saved by {setting?.updater?.name ?? 'an authorized admin'} on {setting?.updated_at ? new Date(setting.updated_at).toLocaleString() : '—'}. Each later delivery uses its own immutable settings snapshot.</p>}
                <p>The existing legacy maximum-compensation setting is not used. A cap applies only after this screen explicitly saves its amount and scope.</p>
            </div>
            <form className="settings-grid" onSubmit={(event) => void saveSettings(event)} aria-busy={saving}>
                <label className="settings-field">Rider earnings percentage
                    <span><input type="number" min="0" max="100" step="0.01" required value={percentage} onChange={(event) => setPercentage(event.target.value)} /> %</span>
                </label>
                <label className="settings-field">Maximum-compensation cap
                    <select value={capScope} onChange={(event) => {
                        setCapScope(event.target.value);
                        if (event.target.value === 'NO_CAP') setCapAmount('');
                    }}>
                        <option value="">Choose an option</option>
                        <option value="NO_CAP">No cap</option>
                        <option value="PER_DELIVERY">Cap per delivery</option>
                        <option value="PER_PAYOUT">Cap per payout</option>
                    </select>
                </label>
                {capScope !== 'NO_CAP' && <label className="settings-field">Cap amount (PHP)
                    <input type="number" min="0.01" step="0.01" required value={capAmount} onChange={(event) => setCapAmount(event.target.value)} />
                </label>}
                {capScope === 'PER_PAYOUT' && <p className="payments-inline-note">Payouts are per delivery, so this cap applies to each single-delivery payout.</p>}
                <label className="settings-reason">Reason for this earnings and cap configuration (required)
                    <input minLength={8} maxLength={255} required value={settingReason} onChange={(event) => setSettingReason(event.target.value)} />
                </label>
                <div className="settings-actions"><button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save rider earnings settings'}</button>{success && <span className="settings-success" role="status">{success}</span>}</div>
            </form>

            <section aria-labelledby="rider-earnings-history-title">
                <h4 id="rider-earnings-history-title">Configuration audit history</h4>
                {history.length === 0 ? <p className="admin-empty">No rider earnings settings have been saved.</p>
                    : <div className="data-table-wrap"><table><thead><tr><th>Changed by</th><th>Percentage</th><th>Cap</th><th>Reason</th><th>Time</th></tr></thead><tbody>
                        {history.map((item) => <tr key={item.id}>
                            <td>{item.actor?.name ?? '—'}</td>
                            <td>{item.old_percentage === null ? 'Not configured' : `${item.old_percentage}%`} → {item.new_percentage}%</td>
                            <td>{item.new_cap_scope === 'NO_CAP' ? 'No cap' : `${item.new_cap_scope === 'PER_PAYOUT' ? 'Per payout' : 'Per delivery'} · PHP ${item.new_cap_amount ?? '—'}`}</td>
                            <td>{item.reason}</td>
                            <td>{new Date(item.created_at).toLocaleString()}</td>
                        </tr>)}
                    </tbody></table></div>}
            </section>

            <section aria-labelledby="rider-payout-queue-title">
                <div className="payments-section-heading"><div><h4 id="rider-payout-queue-title">Pending manual payouts</h4><p>These are records only. Confirm payment after the external transfer has actually completed.</p></div></div>
                {queueRows.length === 0 ? <p className="admin-empty">No pending rider payouts.</p> : queueRows.map((payout) => {
                    const form = payoutForms[payout.id] ?? {
                        amount: (payout.amount_cents / 100).toFixed(2),
                        method: 'BANK_TRANSFER',
                        externalReference: '',
                        paidAt: new Date().toISOString().slice(0, 10),
                        reason: '',
                        externallyCompleted: false,
                    };
                    return <article className="payments-settings-card" key={payout.id}>
                        <h5>{payout.earning.order.order_reference} · {payout.earning.delivery.delivery_reference}</h5>
                        <p>{payout.rider.name} · {money(payout.amount_cents)} · {payout.earning.percentage_snapshot}% of saved delivery fee</p>
                        <div className="settings-grid">
                            <label>Amount (PHP)<input type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => updatePayoutForm(payout, { amount: event.target.value })} /></label>
                            <label>Method<select value={form.method} onChange={(event) => updatePayoutForm(payout, { method: event.target.value })}>
                                <option value="BANK_TRANSFER">Bank transfer</option><option value="GCASH">GCash</option><option value="CASH">Cash</option><option value="OTHER">Other</option>
                            </select></label>
                            <label>External transfer reference<input value={form.externalReference} onChange={(event) => updatePayoutForm(payout, { externalReference: event.target.value })} /></label>
                            <label>Transfer date<input type="date" value={form.paidAt} onChange={(event) => updatePayoutForm(payout, { paidAt: event.target.value })} /></label>
                            <label>Reason<input minLength={8} maxLength={500} value={form.reason} onChange={(event) => updatePayoutForm(payout, { reason: event.target.value })} /></label>
                        </div>
                        <label className="seller-payout-destination-consent"><input type="checkbox" checked={form.externallyCompleted} onChange={(event) => updatePayoutForm(payout, { externallyCompleted: event.target.checked })} /><span>I confirm this transfer was already completed outside Farmgate. This action will only record it.</span></label>
                        <button type="button" className="seller-inline-action" disabled={saving} onClick={() => void confirmPayout(payout)}>Record external payment</button>
                    </article>;
                })}
                {(pendingPayouts?.last_page ?? 1) > 1 && <Pagination page={pendingPayouts?.current_page ?? 1} lastPage={pendingPayouts?.last_page ?? 1} onChange={setPendingPage} label="Pending rider payouts pages" />}
            </section>

            <section aria-labelledby="rider-payout-history-title">
                <div className="payments-section-heading"><div><h4 id="rider-payout-history-title">Recorded external payouts</h4></div></div>
                {recordedRows.length === 0 ? <p className="admin-empty">No rider payouts have been recorded as externally paid.</p>
                    : <div className="data-table-wrap"><table><thead><tr><th>Order</th><th>Rider</th><th>Amount</th><th>Method</th><th>Recorded by</th><th>Paid at</th></tr></thead><tbody>
                        {recordedRows.map((payout) => <tr key={payout.id}>
                            <td>{payout.earning.order.order_reference}</td><td>{payout.rider.name}</td><td>{money(payout.amount_cents)}</td><td>{payout.method}</td><td>{payout.recorder?.name ?? '—'}</td><td>{payout.paid_at ? new Date(payout.paid_at).toLocaleDateString() : '—'}</td>
                        </tr>)}
                    </tbody></table></div>}
                {(recordedPayouts?.last_page ?? 1) > 1 && <Pagination page={recordedPayouts?.current_page ?? 1} lastPage={recordedPayouts?.last_page ?? 1} onChange={setRecordedPage} label="Recorded rider payouts pages" />}
            </section>
        </>}
    </section>;
}
