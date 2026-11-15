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
        <header className="rider-payout-operations-heading">
            <div>
                <p className="eyebrow">Admin · Payments</p>
                <h3 id="rider-payout-operations-title">Rider earnings &amp; payouts</h3>
                <p>Set an auditable per-delivery rate, then reconcile external transfers only after payment is complete.</p>
            </div>
            <span className={`rider-payout-config-state${isConfigured ? ' is-configured' : ''}`} role="status">
                <span className="rider-payout-config-indicator" aria-hidden="true" />
                {isConfigured ? 'Configured' : 'Not configured'}
            </span>
        </header>
        {loading ? <p role="status">Loading rider payout settings…</p> : <>
            <div className={`rider-payout-config-notice${isConfigured ? ' is-configured' : ''}`} role="status">
                <strong>{isConfigured ? 'Earnings are enabled' : 'Payouts are disabled'}</strong>
                {!isConfigured
                    ? <p>Save a percentage and an explicit cap option to enable rider earnings. No default rate or cap is applied.</p>
                    : <p>Saved by {setting?.updater?.name ?? 'an authorized admin'} on {setting?.updated_at ? new Date(setting.updated_at).toLocaleString() : '—'}. New deliveries use a frozen copy of these settings.</p>}
                <small>The legacy maximum-compensation setting is not used here.</small>
            </div>

            <section className="rider-payout-subsection" aria-labelledby="rider-earnings-settings-title">
                <div className="rider-payout-subsection-heading">
                    <div><h4 id="rider-earnings-settings-title">Earnings rules</h4><p>Changes apply to future deliveries; saved earnings are never repriced.</p></div>
                </div>
                <form className="rider-earnings-settings-form" onSubmit={(event) => void saveSettings(event)} aria-busy={saving}>
                    <div className="rider-earnings-settings-fields">
                        <label className="rider-payout-field">Rider earnings percentage
                            <span className="rider-payout-percentage-control"><input type="number" min="0" max="100" step="0.01" required value={percentage} onChange={(event) => setPercentage(event.target.value)} /><span aria-hidden="true">%</span></span>
                            <small>Applied to the delivery fee saved on each order.</small>
                        </label>
                        <label className="rider-payout-field">Maximum-compensation cap
                            <select value={capScope} onChange={(event) => {
                                setCapScope(event.target.value);
                                if (event.target.value === 'NO_CAP') setCapAmount('');
                            }}>
                                <option value="">Choose an option</option>
                                <option value="NO_CAP">No cap</option>
                                <option value="PER_DELIVERY">Cap per delivery</option>
                                <option value="PER_PAYOUT">Cap per payout</option>
                            </select>
                            <small>Choose explicitly; a blank value does not mean no cap.</small>
                        </label>
                        {capScope !== 'NO_CAP' && <label className="rider-payout-field">Cap amount (PHP)
                            <input type="number" min="0.01" step="0.01" required value={capAmount} onChange={(event) => setCapAmount(event.target.value)} />
                            <small>Enter the maximum compensation amount.</small>
                        </label>}
                        {capScope === 'PER_PAYOUT' && <p className="payments-inline-note rider-payout-cap-note">Payouts are per delivery, so this cap applies to each individual delivery payout.</p>}
                        <label className="rider-payout-field rider-payout-reason-field">Reason for this configuration
                            <textarea minLength={8} maxLength={255} required value={settingReason} onChange={(event) => setSettingReason(event.target.value)} placeholder="Explain why this rate and cap are being set." />
                            <small>Required for the audit history (at least 8 characters).</small>
                        </label>
                    </div>
                    <div className="rider-payout-settings-actions">
                        <button type="submit" disabled={saving}>{saving ? 'Saving settings…' : 'Save earnings rules'}</button>
                        {success && <p className="rider-payout-success" role="status">{success}</p>}
                    </div>
                </form>
            </section>

            <section className="rider-payout-subsection" aria-labelledby="rider-earnings-history-title">
                <div className="rider-payout-subsection-heading">
                    <div><h4 id="rider-earnings-history-title">Configuration history</h4><p>Audited changes to the rider earnings rate and cap.</p></div>
                </div>
                {history.length === 0 ? <div className="payments-empty-state rider-payout-empty-state"><strong>No configuration changes yet</strong><span>When an administrator saves earnings rules, the change and reason will appear here.</span></div>
                    : <div className="data-table-wrap rider-payout-history-table-wrap"><table><thead><tr><th>Changed by</th><th>Percentage</th><th>Cap</th><th>Reason</th><th>Time</th></tr></thead><tbody>
                        {history.map((item) => <tr key={item.id}>
                            <td>{item.actor?.name ?? '—'}</td>
                            <td>{item.old_percentage === null ? 'Not configured' : `${item.old_percentage}%`} → {item.new_percentage}%</td>
                            <td>{item.new_cap_scope === 'NO_CAP' ? 'No cap' : `${item.new_cap_scope === 'PER_PAYOUT' ? 'Per payout' : 'Per delivery'} · PHP ${item.new_cap_amount ?? '—'}`}</td>
                            <td>{item.reason}</td>
                            <td>{new Date(item.created_at).toLocaleString()}</td>
                        </tr>)}
                    </tbody></table></div>}
            </section>

            <section className="rider-payout-subsection" aria-labelledby="rider-payout-queue-title">
                <div className="rider-payout-subsection-heading">
                    <div><h4 id="rider-payout-queue-title">Pending manual payouts</h4><p>Record a payout only after independently confirming the external transfer is complete.</p></div>
                    <span className="rider-payout-count">{pendingPayouts?.total ?? 0} pending</span>
                </div>
                {queueRows.length === 0 ? <div className="payments-empty-state rider-payout-empty-state"><strong>No pending payouts</strong><span>Eligible delivery payouts will appear here for reconciliation.</span></div> : queueRows.map((payout) => {
                    const form = payoutForms[payout.id] ?? {
                        amount: (payout.amount_cents / 100).toFixed(2),
                        method: 'BANK_TRANSFER',
                        externalReference: '',
                        paidAt: new Date().toISOString().slice(0, 10),
                        reason: '',
                        externallyCompleted: false,
                    };
                    return <article className="rider-payout-record" key={payout.id}>
                        <div className="rider-payout-record-heading">
                            <div><p className="eyebrow">Delivery payout</p><h5>{payout.earning.delivery.delivery_reference}</h5><p>Order {payout.earning.order.order_reference} · {payout.rider.name}</p></div>
                            <strong>{money(payout.amount_cents)}</strong>
                        </div>
                        <p className="rider-payout-record-rate">{payout.earning.percentage_snapshot}% of saved delivery fee</p>
                        <div className="rider-payout-payment-fields">
                            <label className="rider-payout-field">Amount (PHP)<input type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => updatePayoutForm(payout, { amount: event.target.value })} /><small>Must match the payout amount exactly.</small></label>
                            <label className="rider-payout-field">Method<select value={form.method} onChange={(event) => updatePayoutForm(payout, { method: event.target.value })}>
                                <option value="BANK_TRANSFER">Bank transfer</option><option value="GCASH">GCash</option><option value="CASH">Cash</option><option value="OTHER">Other</option>
                            </select></label>
                            <label className="rider-payout-field">External transfer reference<input value={form.externalReference} onChange={(event) => updatePayoutForm(payout, { externalReference: event.target.value })} /><small>Enter the reference from the external payment provider.</small></label>
                            <label className="rider-payout-field">Transfer date<input type="date" value={form.paidAt} onChange={(event) => updatePayoutForm(payout, { paidAt: event.target.value })} /></label>
                            <label className="rider-payout-field rider-payout-reason-field">Reason<input minLength={8} maxLength={500} value={form.reason} onChange={(event) => updatePayoutForm(payout, { reason: event.target.value })} /></label>
                        </div>
                        <label className="seller-payout-destination-consent rider-payout-confirmation"><input type="checkbox" checked={form.externallyCompleted} onChange={(event) => updatePayoutForm(payout, { externallyCompleted: event.target.checked })} /><span>I independently confirm this transfer was already completed outside Farmgate. Recording it will not send money.</span></label>
                        <div className="rider-payout-record-actions"><button type="button" className="seller-inline-action" disabled={saving} onClick={() => void confirmPayout(payout)}>Record completed transfer</button></div>
                    </article>;
                })}
                {(pendingPayouts?.last_page ?? 1) > 1 && <Pagination page={pendingPayouts?.current_page ?? 1} lastPage={pendingPayouts?.last_page ?? 1} onChange={setPendingPage} label="Pending rider payouts pages" />}
            </section>

            <section className="rider-payout-subsection" aria-labelledby="rider-payout-history-title">
                <div className="rider-payout-subsection-heading">
                    <div><h4 id="rider-payout-history-title">Recorded external payouts</h4><p>History of transfers confirmed as externally paid.</p></div>
                </div>
                {recordedRows.length === 0 ? <div className="payments-empty-state rider-payout-empty-state"><strong>No paid payouts yet</strong><span>Confirmed external transfers will be listed here with their delivery and audit details.</span></div>
                    : <div className="data-table-wrap rider-payout-history-table-wrap"><table><thead><tr><th>Order</th><th>Rider</th><th>Amount</th><th>Method</th><th>Recorded by</th><th>Paid at</th></tr></thead><tbody>
                        {recordedRows.map((payout) => <tr key={payout.id}>
                            <td>{payout.earning.order.order_reference}</td><td>{payout.rider.name}</td><td>{money(payout.amount_cents)}</td><td>{payout.method}</td><td>{payout.recorder?.name ?? '—'}</td><td>{payout.paid_at ? new Date(payout.paid_at).toLocaleDateString() : '—'}</td>
                        </tr>)}
                    </tbody></table></div>}
                {(recordedPayouts?.last_page ?? 1) > 1 && <Pagination page={recordedPayouts?.current_page ?? 1} lastPage={recordedPayouts?.last_page ?? 1} onChange={setRecordedPage} label="Recorded rider payouts pages" />}
            </section>
        </>}
    </section>;
}
