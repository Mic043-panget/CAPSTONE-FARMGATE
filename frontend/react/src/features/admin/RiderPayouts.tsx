import React from 'react';
import api from '../../lib/api';
import { confirmAction } from '../../lib/alerts';
import { Pagination } from '../../shared/components/Pagination';

type Earning = {
    id: number;
    reference: string;
    delivery_reference: string;
    order_reference: string;
    rider?: { id: number; name: string };
    completed_at: string | null;
    delivery_fee_cents: number;
    gross_amount_cents: number;
    deductions_cents: number;
    adjustment_cents: number;
    net_amount_cents: number;
    eligibility_status: string;
    eligibility_reason: string;
    payout_status: string;
    calculation_snapshot?: Record<string, unknown>;
    history?: { action: string; actor: string; reason: string; created_at: string }[];
};
type Destination = {
    id: number;
    rider?: { id: number; name: string };
    destination_type: string;
    account_holder_masked: string;
    bank_name_masked: string | null;
    account_number_masked: string | null;
    wallet_number_masked: string | null;
    status: string;
};
type Payout = {
    id: number;
    reference: string;
    rider?: { id: number; name: string } | null;
    amount_cents: number;
    status: string;
    method: string;
    destination: Destination | null;
    transfer_reference_masked: string | null;
    transfer_date: string | null;
    receipt_url: string | null;
    earnings: { reference: string; delivery_reference: string; order_reference: string; amount_cents: number }[];
    history?: { action: string; from_status: string | null; to_status: string; reason: string; actor: string | null; created_at: string }[];
};
type Method = { id: number; method_type: 'BANK' | 'GCASH'; status: string; configured_by: number; verified_by: number | null };
type Page<T> = { data: T[]; current_page: number; last_page: number; total: number };
type Tab = 'earnings' | 'payouts' | 'destinations' | 'methods';

const money = (cents: number) => `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const readable = (status: string) => status.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
const reasons = {
    processing: 'An authorized administrator recorded that the external transfer process has started. This does not mean Farmgate sent money.',
};

export function RiderPayouts({ onError }: { onError: (message: string) => void }) {
    const [tab, setTab] = React.useState<Tab>('earnings');
    const [status, setStatus] = React.useState('');
    const [search, setSearch] = React.useState('');
    const [sort, setSort] = React.useState('newest');
    const [pageNumber, setPageNumber] = React.useState(1);
    const [earnings, setEarnings] = React.useState<Page<Earning> | null>(null);
    const [payouts, setPayouts] = React.useState<Page<Payout> | null>(null);
    const [destinations, setDestinations] = React.useState<Page<Destination> | null>(null);
    const [methods, setMethods] = React.useState<Method[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [loadError, setLoadError] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [expanded, setExpanded] = React.useState<number | null>(null);
    const [manualForm, setManualForm] = React.useState<{ id: number; reference: string; amount: string; date: string; reason: string; receipt: File | null } | null>(null);
    const [methodReason, setMethodReason] = React.useState('');
    const [destinationReasons, setDestinationReasons] = React.useState<Record<number, string>>({});

    const refresh = React.useCallback(async () => {
        setLoading(true);
        setLoadError('');
        const params = new URLSearchParams({ page: String(pageNumber), per_page: '10', sort, search });
        if (status) params.set('status', status);
        try {
            if (tab === 'earnings') {
                const response = await api.get<{ earnings: Page<Earning> }>(`/api/admin/rider-earnings?${params}`);
                setEarnings(response.data.earnings);
            } else if (tab === 'payouts') {
                const response = await api.get<{ payouts: Page<Payout> }>(`/api/admin/rider-payouts?${params}`);
                setPayouts(response.data.payouts);
            } else if (tab === 'destinations') {
                const response = await api.get<{ destinations: Page<Destination> }>(`/api/admin/rider-payout-destinations?page=${pageNumber}`);
                setDestinations(response.data.destinations);
            } else {
                const response = await api.get<{ methods: Method[] }>('/api/admin/rider-payout-methods');
                setMethods(response.data.methods);
            }
        } catch (error: any) {
            const message = error.userMessage ?? error.response?.data?.message ?? 'Rider payout data could not be loaded.';
            setLoadError(message);
            onError(message);
        } finally {
            setLoading(false);
        }
    }, [onError, pageNumber, search, sort, status, tab]);

    React.useEffect(() => { void refresh(); }, [refresh]);

    async function runAction(action: () => Promise<unknown>, success: string) {
        setBusy(true);
        try {
            await action();
            await refresh();
            setMethodReason('');
        } catch (error: any) {
            onError(error.userMessage ?? error.response?.data?.message ?? success);
        } finally {
            setBusy(false);
        }
    }

    async function createPayout(earning: Earning) {
        const reason = window.prompt(`Reason for creating a payout for delivery ${earning.delivery_reference}:`);
        if (!reason?.trim()) return;
        const idempotencyKey = crypto.randomUUID();
        await runAction(() => api.post('/api/admin/rider-payouts', {
            earning_id: earning.id,
            reason: reason.trim(),
            idempotency_key: idempotencyKey,
        }), 'Rider payout could not be created.');
    }

    async function markProcessing(payout: Payout) {
        if (!await confirmAction({
            title: 'Mark this payout as processing?',
            text: 'Record that the payout is being processed through an external bank or e-wallet transfer. Farmgate will not send money.',
            confirmText: 'Mark processing',
        })) return;
        await runAction(() => api.post(`/api/admin/rider-payouts/${payout.id}/status`, { status: 'PROCESSING', reason: reasons.processing }), 'Payout could not be moved to processing.');
    }

    async function confirmTransfer(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!manualForm) return;
        const amountCents = Math.round(Number(manualForm.amount) * 100);
        if (!Number.isSafeInteger(amountCents) || amountCents < 1 || !manualForm.receipt) {
            onError('Enter the exact external transfer amount and attach the private receipt.');
            return;
        }
        const formData = new FormData();
        formData.append('transfer_reference', manualForm.reference.trim());
        formData.append('amount_cents', String(amountCents));
        formData.append('transfer_date', manualForm.date);
        formData.append('reason', manualForm.reason.trim());
        formData.append('receipt', manualForm.receipt);
        await runAction(() => api.post(`/api/admin/rider-payouts/${manualForm.id}/manual-confirm`, formData), 'External transfer could not be recorded.');
        setManualForm(null);
    }

    async function configureMethod(methodType: 'BANK' | 'GCASH') {
        if (!methodReason.trim()) {
            onError('Enter why this rider payout method is being configured.');
            return;
        }
        await runAction(() => api.post('/api/admin/rider-payout-methods', { method_type: methodType, reason: methodReason.trim() }), 'Payout method could not be configured.');
    }

    async function decideDestination(destination: Destination, decision: 'VERIFIED' | 'REJECTED') {
        const reason = destinationReasons[destination.id]?.trim();
        if (!reason) {
            onError('Enter a reason for the destination verification decision.');
            return;
        }
        await runAction(() => api.post(`/api/admin/rider-payout-destinations/${destination.id}/verify`, { decision, reason }), 'Destination decision could not be saved.');
    }

    const rows = tab === 'earnings' ? earnings : tab === 'payouts' ? payouts : destinations;

    return <section className="rider-payout-admin" aria-labelledby="rider-payout-admin-title">
        <div className="payments-page-heading">
            <div><p className="eyebrow">Admin operations</p><h2 id="rider-payout-admin-title">Rider payouts</h2><p>Track rider earnings, destination verification, and manual payouts.</p></div>
        </div>
        <div className="payments-notice" role="note"><strong>External transfers require independent admin confirmation.</strong><span>Farmgate does not initiate rider payouts. Manual transfers must be completed outside the app and confirmed by a different administrator.</span></div>
        <details className="payments-how-it-works rider-payout-how-it-works">
            <summary>How payouts work</summary>
            <p>Earnings use the saved delivery calculation snapshot. Eligible earnings can be paid individually to a verified destination; there are no scheduled runs or combined batches. Record only a transfer already completed externally, with its exact amount, reference, date, and private receipt. A different authorized administrator must confirm it.</p>
        </details>
        <div className="admin-promotions-tabs rider-payout-tabs" role="tablist" aria-label="Rider payout operations">
            {([
                ['earnings', 'Earnings ledger'],
                ['payouts', 'Payout queue'],
                ['destinations', 'Destinations'],
                ['methods', 'Payout methods'],
            ] as const).map(([id, title]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => { setTab(id); setPageNumber(1); setStatus(''); }}>{title}</button>)}
        </div>
        {tab !== 'methods' && <>
            {tab !== 'destinations' && <div className="admin-data-controls">
                <label>Search<input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPageNumber(1); }} placeholder="Rider, payout, delivery, or order reference" /></label>
                <label>Status<select value={status} onChange={(event) => { setStatus(event.target.value); setPageNumber(1); }}>
                    <option value="">All statuses</option>
                    {(tab === 'earnings'
                        ? ['PENDING_ELIGIBILITY', 'READY', 'IN_PAYOUT', 'PAID', 'NEEDS_REVIEW', 'NOT_ELIGIBLE']
                        : ['PENDING', 'PROCESSING', 'PAID', 'FAILED', 'NEEDS_REVIEW']).map((item) => <option key={item} value={item}>{readable(item)}</option>)}
                </select></label>
                <label>Sort<select value={sort} onChange={(event) => setSort(event.target.value)}>
                    <option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="amount_desc">Amount: high to low</option><option value="amount_asc">Amount: low to high</option>
                </select></label>
            </div>}
            {loading ? <p className="payments-loading" role="status">Loading rider payout records…</p>
                : loadError ? <p className="payments-load-error" role="alert">{loadError} <button type="button" onClick={() => void refresh()}>Try again</button></p>
                    : <>
            {tab === 'earnings' && <div className="admin-table-scroll"><table className="admin-data-table"><thead><tr><th>Rider</th><th>Delivery / order</th><th>Completed</th><th>Delivery fee</th><th>Gross</th><th>Deductions</th><th>Net</th><th>Eligibility / payout</th><th>Action</th></tr></thead><tbody>
                {(earnings?.data ?? []).map((earning) => <React.Fragment key={earning.id}><tr className="rider-payout-mobile-card rider-payout-earning-card">
                    <td className="rider-payout-card-identity" data-label="Rider"><div className="rider-payout-card-person"><span className="rider-payout-card-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.7" /><path d="M5.5 19c.5-3.1 2.8-4.8 6.5-4.8s6 1.7 6.5 4.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg></span><span><strong>{earning.rider?.name ?? `Rider ${earning.rider?.id ?? ''}`}</strong></span></div></td>
                    <td className="rider-payout-card-reference" data-label="Delivery / order"><span>{earning.delivery_reference}</span><small>{earning.order_reference}</small><small>{earning.reference}</small></td>
                    <td className="rider-payout-card-completed" data-label="Completed">{earning.completed_at ? new Date(earning.completed_at).toLocaleString() : '—'}</td>
                    <td className="rider-payout-card-fee" data-label="Delivery fee">{money(earning.delivery_fee_cents)}</td><td className="rider-payout-card-gross" data-label="Gross">{money(earning.gross_amount_cents)}</td>
                    <td className="rider-payout-card-deductions" data-label="Deductions">{money(earning.deductions_cents)}{earning.adjustment_cents ? ` · adj. ${money(earning.adjustment_cents)}` : ''}</td>
                    <td className="rider-payout-card-net" data-label="Net">{money(earning.net_amount_cents)}</td>
                    <td className="rider-payout-card-status" data-label="Eligibility / payout"><span className="status-pill">{readable(earning.eligibility_status)}</span><small>{earning.eligibility_reason}</small></td>
                    <td className="rider-payout-card-actions" data-label="Actions"><button type="button" className="payments-text-button" aria-expanded={expanded === earning.id} onClick={() => setExpanded(expanded === earning.id ? null : earning.id)}>Details</button>
                        {earning.eligibility_status === 'READY' && earning.payout_status === 'AVAILABLE' && earning.rider && <button className="seller-inline-action" type="button" disabled={busy} onClick={() => void createPayout(earning)}>Create payout for delivery</button>}
                        {['PENDING_ELIGIBILITY', 'NEEDS_REVIEW'].includes(earning.eligibility_status) && <button className="payments-text-button" type="button" disabled={busy} onClick={() => {
                            const decision = window.prompt('Enter APPROVE or REJECT after reviewing the verified delivery evidence:');
                            if (decision !== 'APPROVE' && decision !== 'REJECT') return;
                            const reason = window.prompt('Document the eligibility decision:');
                            if (!reason?.trim()) return;
                            void runAction(() => api.post(`/api/admin/rider-earnings/${earning.id}/review`, { decision, reason }), 'Earning eligibility could not be decided.');
                        }}>Review</button>}
                        {['READY', 'NEEDS_REVIEW', 'PENDING_ELIGIBILITY'].includes(earning.eligibility_status) && earning.payout_status === 'AVAILABLE' && <button className="payments-text-button" type="button" disabled={busy} onClick={() => {
                            const cents = Number(window.prompt('Adjustment in cents (positive or negative):', '0'));
                            const reason = window.prompt('Document the reason for this manual adjustment:');
                            if (!Number.isSafeInteger(cents) || cents === 0 || !reason?.trim()) return;
                            void runAction(() => api.post(`/api/admin/rider-earnings/${earning.id}/adjustment`, { adjustment_cents: cents, reason }), 'Earning adjustment could not be saved.');
                        }}>Adjust</button>}</td>
                </tr>{expanded === earning.id && <tr className="rider-payout-expanded-row"><td colSpan={9}><details open className="rider-payout-detail"><summary>Frozen calculation and audit history</summary>
                        <pre>{JSON.stringify(earning.calculation_snapshot ?? {}, null, 2)}</pre>
                        <ol>{(earning.history ?? []).map((item, index) => <li key={`${item.action}-${index}`}>{readable(item.action)} · {item.actor} · {item.reason}</li>)}</ol>
                    </details></td></tr>}</React.Fragment>)}
                {!earnings?.data.length && <tr className="rider-payout-empty-row"><td colSpan={9} className="payments-table-empty">No earnings match this view.</td></tr>}
            </tbody></table></div>}
            {tab === 'payouts' && <div className="admin-table-scroll"><table className="admin-data-table"><thead><tr><th>Payout / rider</th><th>Amount</th><th>Destination</th><th>Status</th><th>Transfer record</th><th>Actions / details</th></tr></thead><tbody>
                {(payouts?.data ?? []).map((payout) => <React.Fragment key={payout.id}><tr className="rider-payout-mobile-card rider-payout-record-card">
                    <td className="rider-payout-card-identity" data-label="Payout / rider"><div className="rider-payout-card-person"><span className="rider-payout-card-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M4.5 7.5h15v11h-15zM4.5 10.5h15M8 15h3" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" /><path d="M7 4.5h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg></span><span><strong>{payout.reference}</strong><span>{payout.rider?.name ?? 'Rider'}</span><small>{payout.method}</small></span></div></td>
                    <td className="rider-payout-card-amount" data-label="Amount">{money(payout.amount_cents)}</td>
                    <td className="rider-payout-card-destination" data-label="Destination">{payout.destination ? `${payout.destination.destination_type} · ${payout.destination.account_holder_masked} · ${payout.destination.account_number_masked ?? payout.destination.wallet_number_masked}` : 'Unavailable'}</td>
                    <td className="rider-payout-card-status" data-label="Status"><span className="status-pill">{readable(payout.status)}</span></td>
                    <td className="rider-payout-card-transfer" data-label="Transfer record">{payout.transfer_reference_masked ?? 'Not recorded'}{payout.transfer_date && <small>{payout.transfer_date}</small>}{payout.receipt_url && <a href={payout.receipt_url}>Private receipt</a>}</td>
                    <td className="rider-payout-card-actions" data-label="Actions"><button type="button" className="payments-text-button" aria-expanded={expanded === payout.id} onClick={() => setExpanded(expanded === payout.id ? null : payout.id)}>Details</button>
                        {['PENDING', 'NEEDS_REVIEW'].includes(payout.status) && <button type="button" className="seller-inline-action" disabled={busy} onClick={() => void markProcessing(payout)}>Record external transfer started</button>}
                        {payout.status === 'PROCESSING' && <><button type="button" className="seller-inline-action" disabled={busy} onClick={() => setManualForm({ id: payout.id, reference: '', amount: (payout.amount_cents / 100).toFixed(2), date: new Date().toISOString().slice(0, 10), reason: '', receipt: null })}>Confirm completed transfer</button>
                            <button type="button" className="payments-text-button" disabled={busy} onClick={() => {
                                const reason = window.prompt('Document why this external transfer failed:');
                                if (reason?.trim()) void runAction(() => api.post(`/api/admin/rider-payouts/${payout.id}/status`, { status: 'FAILED', reason }), 'Payout could not be marked failed.');
                            }}>Mark failed</button></>}
                        {expanded === payout.id && <details open className="rider-payout-detail"><summary>Delivery and audit history</summary>
                            <ul>{payout.earnings.map((item) => <li key={item.reference}>{item.delivery_reference} · {item.order_reference} · {money(item.amount_cents)}</li>)}</ul>
                            <ol>{(payout.history ?? []).map((item, index) => <li key={`${item.action}-${index}`}>{readable(item.action)} · {item.actor ?? 'System'} · {item.reason}</li>)}</ol>
                        </details>}</td>
                </tr>{manualForm?.id === payout.id && <tr className="rider-payout-expanded-row"><td colSpan={6}><form className="seller-account-form rider-manual-transfer-form" onSubmit={(event) => void confirmTransfer(event)}>
                    <h4>Record an externally completed transfer</h4><p>Confirm only after independently checking that the transfer completed outside Farmgate. This action records payment; it does not initiate a transfer.</p>
                    <label>External transfer reference<input required minLength={4} maxLength={120} value={manualForm.reference} onChange={(event) => setManualForm({ ...manualForm, reference: event.target.value })} /></label>
                    <label>Transferred amount (PHP)<input required type="number" min="0.01" step="0.01" value={manualForm.amount} onChange={(event) => setManualForm({ ...manualForm, amount: event.target.value })} /></label>
                    <label>Transfer date<input required type="date" max={new Date().toISOString().slice(0, 10)} value={manualForm.date} onChange={(event) => setManualForm({ ...manualForm, date: event.target.value })} /></label>
                    <label>Private transfer receipt<input required type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setManualForm({ ...manualForm, receipt: event.target.files?.[0] ?? null })} /></label>
                    <label>Independent confirmation reason<textarea required minLength={8} maxLength={500} value={manualForm.reason} onChange={(event) => setManualForm({ ...manualForm, reason: event.target.value })} /></label>
                    <button className="seller-inline-action" type="submit" disabled={busy}>{busy ? 'Recording…' : 'Confirm external payment'}</button>
                    <button className="payments-text-button" type="button" onClick={() => setManualForm(null)}>Cancel</button>
                </form></td></tr>}</React.Fragment>)}
                {!payouts?.data.length && <tr className="rider-payout-empty-row"><td colSpan={6} className="payments-table-empty">No payouts match this view.</td></tr>}
            </tbody></table></div>}
            {tab === 'destinations' && <div className="admin-table-scroll"><table className="admin-data-table"><thead><tr><th>Rider</th><th>Destination</th><th>Account holder</th><th>Status</th><th>Verification decision</th></tr></thead><tbody>
                {(destinations?.data ?? []).map((destination) => <tr className="rider-payout-mobile-card rider-payout-destination-card" key={destination.id}><td className="rider-payout-card-identity" data-label="Rider"><div className="rider-payout-card-person"><span className="rider-payout-card-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.7" /><path d="M5.5 19c.5-3.1 2.8-4.8 6.5-4.8s6 1.7 6.5 4.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg></span><span><strong>{destination.rider?.name ?? 'Rider'}</strong></span></div></td>
                    <td className="rider-payout-card-destination" data-label="Destination">{destination.destination_type} · {destination.bank_name_masked ?? destination.account_number_masked ?? destination.wallet_number_masked}</td>
                    <td className="rider-payout-card-holder" data-label="Account holder">{destination.account_holder_masked}</td>
                    <td className="rider-payout-card-status" data-label="Status"><span className="rider-payout-destination-status">{readable(destination.status)}</span></td>
                    <td className="rider-payout-card-actions" data-label="Verification decision">{destination.status === 'PENDING_VERIFICATION' && <><label>Reason<input maxLength={500} value={destinationReasons[destination.id] ?? ''} onChange={(event) => setDestinationReasons({ ...destinationReasons, [destination.id]: event.target.value })} /></label>
                        <button className="seller-inline-action" type="button" disabled={busy} onClick={() => void decideDestination(destination, 'VERIFIED')}>Verify</button>
                        <button className="payments-text-button" type="button" disabled={busy} onClick={() => void decideDestination(destination, 'REJECTED')}>Reject</button></>}</td></tr>)}
                {!destinations?.data.length && <tr className="rider-payout-empty-row"><td colSpan={5} className="payments-table-empty">No rider destinations to review.</td></tr>}
            </tbody></table></div>}
            {rows && <div className="rider-delivery-pagination"><span>Page {rows.current_page} of {rows.last_page} · {rows.total} records</span><Pagination page={rows.current_page} lastPage={rows.last_page} onChange={setPageNumber} label="Rider payout pagination" /></div>}
                    </>}
        </>}
        {tab === 'methods' && (loading ? <p className="payments-loading" role="status">Loading rider payout methods…</p>
            : loadError ? <p className="payments-load-error" role="alert">{loadError} <button type="button" onClick={() => void refresh()}>Try again</button></p>
                : <section className="rider-payout-method-config">
            <h3>Configured methods</h3><p>A method is offered to riders only after one authorized admin configures it and another authorized admin verifies it.</p>
            <label>Configuration reason<input maxLength={500} value={methodReason} onChange={(event) => setMethodReason(event.target.value)} /></label>
            {(['BANK', 'GCASH'] as const).map((methodType) => {
                const configured = methods.find((item) => item.method_type === methodType);
                return <article key={methodType}><strong>{methodType === 'GCASH' ? 'GCash e-wallet' : 'Bank account'}</strong><span>{configured ? readable(configured.status) : 'Not configured'}</span>
                    {!configured || configured.status !== 'ACTIVE' ? <button className="seller-inline-action" type="button" disabled={busy} onClick={() => {
                        if (configured?.status === 'PENDING_VERIFICATION') {
                            if (!methodReason.trim()) { onError('Enter a reason for verifying this method.'); return; }
                            void runAction(() => api.post(`/api/admin/rider-payout-methods/${configured.id}/verify`, { reason: methodReason.trim() }), 'Payout method could not be verified.');
                        } else void configureMethod(methodType);
                    }}>{configured?.status === 'PENDING_VERIFICATION' ? 'Verify (different admin required)' : `Configure ${methodType}`}</button> : <span>Active and verified</span>}
                </article>;
            })}
        </section>)}
    </section>;
}
