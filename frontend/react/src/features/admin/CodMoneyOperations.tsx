import React from 'react';
import { ViewDetailsAction } from '../../shared/components/Button';
import api from '../../lib/api';
import { confirmAction } from '../../lib/alerts';
import { Pagination } from '../../shared/components/Pagination';

type SummaryMetric = { count: number; amount_cents: number };
type Summary = {
    remittances_awaiting_review: SummaryMetric;
    confirmed_cod_received: SummaryMetric;
    seller_payouts_pending: SummaryMetric;
    recorded_payouts: SummaryMetric;
};
type Remittance = {
    id: number;
    reference: string;
    method_type: string;
    status: 'SUBMITTED' | 'DISPUTED' | 'RECONCILED';
    expected_amount_cents: number;
    received_amount_cents: number | null;
    reconciliation_reason: string | null;
    submitted_at: string;
    evidence_url: string | null;
    receiver_name: string | null;
    transaction_reference: string | null;
    receiving_method?: { label: string };
    rider?: { name: string };
    collections_count: number;
    collections?: {
        expected_amount_cents: number;
        collected_amount_cents: number;
        status: string;
        proof_url: string | null;
        order?: { order_reference: string; total_amount?: string | number };
        delivery?: { delivery_reference: string };
    }[];
    histories?: { action: string; expected_amount_cents: number; received_amount_cents: number | null; reason: string | null; created_at: string; actor?: { name: string } }[];
};
type Payout = {
    id: number;
    amount_cents: number;
    method: string;
    status: string;
    external_reference: string | null;
    paid_at: string | null;
    provider_status: string | null;
    receipt_url: string | null;
    destination_masked: { type: string; account_holder: string; institution: string; identifier: string | null; status: string } | null;
    seller_payout_eligible: boolean;
    eligibility_unmet: string[];
    order?: { order_reference: string };
    seller?: { name: string };
    recorder?: { id: number; name: string };
    histories?: { action: string; from_status: string | null; to_status: string; reason: string | null; created_at: string; actor?: { name: string } }[];
};
type Page<T> = { data: T[]; current_page: number; last_page: number; total: number };
type PayoutForm = { reference: string; amount: string; paidDate: string; reason: string; receipt: File | null };

function amount(cents: number | null | undefined): string {
    return `PHP ${((cents ?? 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function parseCents(input: string): number | null {
    const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(input.trim());
    if (!match) return null;
    const value = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
    return Number.isSafeInteger(value) ? value : null;
}

function pageQuery(page: number, search: string, extra: Record<string, string>): URLSearchParams {
    const params = new URLSearchParams({ page: String(page), per_page: '10', ...extra });
    if (search.trim()) params.set('search', search.trim());
    return params;
}

function metricLabel(metric: SummaryMetric | undefined): string {
    if (!metric) return '—';
    return `${metric.count.toLocaleString()} · ${amount(metric.amount_cents)}`;
}

export function CodMoneyOperations({ onError, onOpenSettings }: { onError: (message: string) => void; onOpenSettings: () => void }) {
    const [summary, setSummary] = React.useState<Summary | null>(null);
    const [remittances, setRemittances] = React.useState<Page<Remittance> | null>(null);
    const [payoutQueue, setPayoutQueue] = React.useState<Page<Payout> | null>(null);
    const [recordedPayouts, setRecordedPayouts] = React.useState<Page<Payout> | null>(null);
    const [searchInput, setSearchInput] = React.useState('');
    const [search, setSearch] = React.useState('');
    const [remittanceStatus, setRemittanceStatus] = React.useState('');
    const [remittanceMethod, setRemittanceMethod] = React.useState('');
    const [remittanceSort, setRemittanceSort] = React.useState('newest');
    const [payoutQueueStatus, setPayoutQueueStatus] = React.useState('');
    const [recordedStatus, setRecordedStatus] = React.useState('');
    const [payoutSort, setPayoutSort] = React.useState('newest');
    const [remittancePage, setRemittancePage] = React.useState(1);
    const [queuePage, setQueuePage] = React.useState(1);
    const [recordedPage, setRecordedPage] = React.useState(1);
    const [expandedRemittance, setExpandedRemittance] = React.useState<number | null>(null);
    const [receivedAmounts, setReceivedAmounts] = React.useState<Record<number, string>>({});
    const [reasons, setReasons] = React.useState<Record<number, string>>({});
    const [verificationConfirmed, setVerificationConfirmed] = React.useState<Record<number, boolean>>({});
    const [payoutForms, setPayoutForms] = React.useState<Record<number, PayoutForm>>({});
    const [payoutsEnabled, setPayoutsEnabled] = React.useState(false);
    const [loading, setLoading] = React.useState(true);
    const [refreshing, setRefreshing] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [loadError, setLoadError] = React.useState('');
    const [success, setSuccess] = React.useState('');

    React.useEffect(() => {
        const timer = window.setTimeout(() => {
            setSearch(searchInput.trim());
            setRemittancePage(1);
            setQueuePage(1);
            setRecordedPage(1);
        }, 250);
        return () => window.clearTimeout(timer);
    }, [searchInput]);

    const refresh = React.useCallback(async () => {
        setLoadError('');
        setRefreshing(true);
        try {
            const [summaryResponse, remittanceResponse, queueResponse, recordedResponse, settingsResponse] = await Promise.all([
                api.get<Summary>('/api/admin/cod/summary'),
                api.get<{ remittances: Page<Remittance> }>('/api/admin/cod/remittances', {
                    params: pageQuery(remittancePage, search, { status: remittanceStatus, method: remittanceMethod, sort: remittanceSort }),
                }),
                api.get<{ payouts: Page<Payout> }>('/api/admin/seller-payouts', {
                    params: pageQuery(queuePage, search, { group: 'queue', status: payoutQueueStatus, sort: payoutSort }),
                }),
                api.get<{ payouts: Page<Payout> }>('/api/admin/seller-payouts', {
                    params: pageQuery(recordedPage, search, { group: 'recorded', status: recordedStatus, sort: payoutSort }),
                }),
                api.get<{ settings: Record<string, unknown> }>('/api/admin/settings'),
            ]);
            setSummary(summaryResponse.data);
            setRemittances(remittanceResponse.data.remittances);
            setPayoutQueue(queueResponse.data.payouts);
            setRecordedPayouts(recordedResponse.data.payouts);
            setPayoutsEnabled(Boolean(settingsResponse.data.settings.manual_seller_payouts_enabled));
        } catch (requestError: any) {
            setLoadError(requestError.userMessage ?? requestError.response?.data?.message ?? 'Payments records could not be loaded.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [payoutQueueStatus, payoutSort, queuePage, recordedPage, recordedStatus, remittanceMethod, remittancePage, remittanceSort, remittanceStatus, search]);

    React.useEffect(() => { void refresh(); }, [refresh]);

    async function reconcile(remittance: Remittance) {
        const received = parseCents(receivedAmounts[remittance.id] ?? (remittance.expected_amount_cents / 100).toFixed(2));
        if (received === null || (reasons[remittance.id]?.trim().length ?? 0) < 8 || verificationConfirmed[remittance.id] !== true) {
            onError('Enter the amount actually verified, an eight-character review note, and confirm that you checked the actual handover or incoming transaction.');
            return;
        }
        setBusy(true);
        setSuccess('');
        try {
            await api.post(`/api/admin/cod/remittances/${remittance.id}/reconcile`, {
                received_amount_cents: received,
                reason: reasons[remittance.id].trim(),
                verification_confirmed: true,
            });
            setSuccess('Remittance review saved. Buyer payment and payout states were updated only if the batch was fully reconciled.');
            await refresh();
        } catch (error: any) {
            onError(error.userMessage ?? error.response?.data?.message ?? 'The remittance could not be reconciled.');
        } finally {
            setBusy(false);
        }
    }

    async function confirmPayout(payout: Payout) {
        const form = payoutForms[payout.id];
        const amountCents = parseCents(form?.amount ?? '');
        if (amountCents === null || !form?.paidDate || !form.reference.trim() || form.reason.trim().length < 8) {
            onError('Enter the exact externally transferred amount, transfer date, reference, and audit reason.');
            return;
        }
        if (amountCents !== payout.amount_cents) {
            onError('The externally transferred amount must match the payout amount due exactly.');
            return;
        }
        if (!await confirmAction({
            title: 'Record externally completed payout?',
            text: `Confirm that PHP ${(amountCents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })} was already transferred outside Farmgate to the displayed verified destination. A different authorized admin must confirm your report. Farmgate will not send the transfer.`,
            confirmText: 'Record external transfer',
        })) return;
        setBusy(true);
        setSuccess('');
        try {
            const data = new FormData();
            data.set('external_reference', form.reference.trim());
            data.set('reason', form.reason.trim());
            data.set('amount_cents', String(amountCents));
            data.set('paid_at', form.paidDate);
            data.set('externally_completed_confirmed', '1');
            if (form.receipt) data.set('receipt', form.receipt);
            await api.post(`/api/admin/seller-payouts/${payout.id}/manual-confirm`, data);
            setSuccess('Externally completed payout recorded. Farmgate did not initiate the transfer.');
            await refresh();
        } catch (error: any) {
            onError(error.userMessage ?? error.response?.data?.message ?? 'The payout could not be recorded.');
        } finally {
            setBusy(false);
        }
    }

    async function changePayoutStatus(payout: Payout, status: 'PENDING' | 'FAILED' | 'RETURNED' | 'DISPUTED') {
        const reason = payoutForms[payout.id]?.reason?.trim() ?? '';
        if (reason.length < 8) {
            onError('Enter a reason of at least eight characters before changing payout status.');
            return;
        }
        setBusy(true);
        setSuccess('');
        try {
            await api.post(`/api/admin/seller-payouts/${payout.id}/status`, { status, reason });
            setSuccess(`Payout status updated to ${status.replaceAll('_', ' ').toLowerCase()}.`);
            await refresh();
        } catch (error: any) {
            onError(error.userMessage ?? error.response?.data?.message ?? 'Payout status could not be updated.');
        } finally {
            setBusy(false);
        }
    }

    function updatePayoutForm(payout: Payout, changes: Partial<PayoutForm>) {
        const current = payoutForms[payout.id] ?? { reference: '', amount: (payout.amount_cents / 100).toFixed(2), paidDate: '', reason: '', receipt: null };
        setPayoutForms((forms) => ({ ...forms, [payout.id]: { ...current, ...changes } }));
    }

    const remittanceRows = remittances?.data ?? [];
    const queueRows = payoutQueue?.data ?? [];
    const recordedRows = recordedPayouts?.data ?? [];

    return <section className="seller-work-section cod-money-operations" aria-labelledby="cod-money-title">
        <div className="payments-page-heading">
            <div><p className="eyebrow">Admin · COD operations</p><h2 id="cod-money-title">COD reconciliation</h2><p>Review incoming rider remittances and track seller payouts. Transfers are manual only.</p></div>
            <button className="seller-inline-action" type="button" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>
        </div>
        <details className="payments-how-it-works">
            <summary>How COD payments work</summary>
            <p>Riders report cash collected and submit remittance proof. Proof is evidence, not receipt confirmation. Admins must verify actual receipt before buyer COD payment becomes paid; a separate seller payout is then created from the order’s snapshotted fee. Farmgate does not initiate PayMongo or bank payouts.</p>
        </details>

        {loadError && <p className="seller-error" role="alert">{loadError}</p>}
        {success && <p className="payments-success" role="status">{success}</p>}
        {loading ? <p role="status">Loading payment records…</p> : <>
            <section className="payments-summary-grid" aria-label="COD workflow summary">
                <article className="payments-summary-card"><span>Remittances awaiting review</span><strong>{metricLabel(summary?.remittances_awaiting_review)}</strong></article>
                <article className="payments-summary-card"><span>Confirmed COD received</span><strong>{metricLabel(summary?.confirmed_cod_received)}</strong></article>
                <article className="payments-summary-card"><span>Seller payouts pending</span><strong>{metricLabel(summary?.seller_payouts_pending)}</strong></article>
                <article className="payments-summary-card"><span>Recorded payouts</span><strong>{metricLabel(summary?.recorded_payouts)}</strong></article>
            </section>

            <div className="payments-global-search">
                <label>Search payment records<input type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Remittance, order, delivery, or seller" /></label>
            </div>
            <section className="payments-list-section" aria-labelledby="payments-remittances-title">
                <div className="payments-section-heading"><div><h3 id="payments-remittances-title">Rider cash remittances</h3><p>Search and review submitted cash or transfer batches.</p></div></div>
                <div className="payments-table-controls">
                    <label>Status<select value={remittanceStatus} onChange={(event) => { setRemittanceStatus(event.target.value); setRemittancePage(1); }}><option value="">All statuses</option><option value="SUBMITTED">Submitted</option><option value="DISPUTED">Needs review</option><option value="RECONCILED">Reconciled</option></select></label>
                    <label>Method<select value={remittanceMethod} onChange={(event) => { setRemittanceMethod(event.target.value); setRemittancePage(1); }}><option value="">All methods</option><option value="CASH_HANDOVER">Cash handover</option><option value="BANK_TRANSFER">Bank transfer</option><option value="BANK_QR">Online banking QR</option></select></label>
                    <label>Sort<select value={remittanceSort} onChange={(event) => { setRemittanceSort(event.target.value); setRemittancePage(1); }}><option value="newest">Newest submitted</option><option value="oldest">Oldest submitted</option><option value="amount_desc">Amount: high to low</option><option value="amount_asc">Amount: low to high</option><option value="reference_asc">Reference: A–Z</option><option value="reference_desc">Reference: Z–A</option></select></label>
                </div>
                {!remittanceRows.length ? <div className="payments-empty-state"><strong>No remittances match this view.</strong><span>Remittances appear here after riders submit collected COD cash for review.</span></div> : <div className="data-table-wrap payments-table-wrap"><table className="data-table payments-table">
                    <thead><tr><th>Reference</th><th>Order</th><th>Rider</th><th>Amount collected</th><th>Method</th><th>Submitted</th><th>Status</th><th>Details</th></tr></thead>
                    <tbody>{remittanceRows.map((item) => {
                        const orders = [...new Set(item.collections?.map((collection) => collection.order?.order_reference).filter(Boolean) ?? [])];
                        return <React.Fragment key={item.id}>
                            <tr>
                                <td><strong>{item.reference}</strong></td>
                                <td>{orders.length ? orders.join(', ') : `${item.collections_count} order(s)`}</td>
                                <td>{item.rider?.name ?? 'Rider'}</td>
                                <td>{amount(item.collections?.reduce((total, collection) => total + collection.collected_amount_cents, 0) ?? item.expected_amount_cents)}</td>
                                <td>{['BANK_QR', 'PAYMONGO_QR'].includes(item.method_type) ? 'Online banking QR' : item.method_type.replaceAll('_', ' ')}</td>
                                <td>{new Date(item.submitted_at).toLocaleString()}</td>
                                <td><span className={`status-pill status-${item.status.toLowerCase()}`}>{item.status.replaceAll('_', ' ')}</span></td>
                                <td><ViewDetailsAction className="payments-text-button" contextLabel={`remittance ${item.reference}`} expanded={expandedRemittance === item.id} controls={`remittance-details-${item.id}`} onClick={() => setExpandedRemittance((current) => current === item.id ? null : item.id)} /></td>
                            </tr>
                            {expandedRemittance === item.id && <tr id={`remittance-details-${item.id}`} className="payments-detail-row"><td colSpan={8}>
                                <div className="payments-detail-grid">
                                    <section><h4>Submitted remittance</h4><p>Expected: {amount(item.expected_amount_cents)} · Actually received: {item.received_amount_cents === null ? 'Not confirmed' : amount(item.received_amount_cents)}</p><p>Method: {['BANK_QR', 'PAYMONGO_QR'].includes(item.method_type) ? 'Online banking QR' : item.method_type.replaceAll('_', ' ')}{item.receiving_method?.label ? ` · ${item.receiving_method.label}` : ''}</p>{item.receiver_name && <p>Reported receiver: {item.receiver_name}</p>}{item.transaction_reference && <p>Transaction reference: {item.transaction_reference}</p>}{item.evidence_url ? <a href={item.evidence_url} target="_blank" rel="noreferrer">View private remittance proof</a> : <p>No remittance proof attached.</p>}<p className="payments-evidence-note">Uploaded proof does not verify that Farmgate received funds.</p></section>
                                    <section><h4>Order and delivery context</h4>{item.collections?.map((collection, index) => <article className="payments-context-item" key={`${collection.order?.order_reference ?? 'order'}-${index}`}><strong>{collection.order?.order_reference ?? 'Order reference unavailable'}</strong><span>Delivery: {collection.delivery?.delivery_reference ?? 'Unavailable'} · buyer due {amount(collection.order?.total_amount ? Math.round(Number(collection.order.total_amount) * 100) : collection.expected_amount_cents)}</span><span>Rider collected {amount(collection.collected_amount_cents)} · {collection.status.replaceAll('_', ' ')}</span>{collection.proof_url ? <a href={collection.proof_url} target="_blank" rel="noreferrer">View private collection proof</a> : <span>No collection proof attached</span>}</article>)}</section>
                                    <section><h4>Review history</h4>{item.histories?.length ? item.histories.map((history, index) => <p className="payments-history-entry" key={`${history.action}-${index}`}><strong>{history.action.replaceAll('_', ' ')}</strong> · {history.received_amount_cents === null ? 'No receipt amount recorded' : `${amount(history.received_amount_cents)} received`} · {history.actor?.name ?? 'Admin'} · {new Date(history.created_at).toLocaleString()}<br />{history.reason ?? 'No note'}</p>) : <p>No review actions recorded.</p>}</section>
                                </div>
                                {(item.status === 'SUBMITTED' || item.status === 'DISPUTED') && <div className="payments-review-panel">
                                    <h4>Review actual receipt</h4>
                                    <div className="payments-review-controls">
                                        <label>Funds actually received (PHP)<input inputMode="decimal" value={receivedAmounts[item.id] ?? (item.expected_amount_cents / 100).toFixed(2)} onChange={(event) => setReceivedAmounts((current) => ({ ...current, [item.id]: event.target.value }))} /></label>
                                        <label>Verification note (required)<input value={reasons[item.id] ?? ''} minLength={8} maxLength={1000} onChange={(event) => setReasons((current) => ({ ...current, [item.id]: event.target.value }))} /></label>
                                    </div>
                                    <label className="cod-reconcile-confirm"><input type="checkbox" checked={verificationConfirmed[item.id] ?? false} onChange={(event) => setVerificationConfirmed((current) => ({ ...current, [item.id]: event.target.checked }))} /><span>I independently verified the actual handover or incoming transaction. I am not relying on uploaded proof alone.</span></label>
                                    <button className="seller-inline-action" type="button" disabled={busy || !verificationConfirmed[item.id]} onClick={() => void reconcile(item)}>{item.status === 'DISPUTED' ? 'Save verified resolution' : 'Confirm receipt and reconcile'}</button>
                                </div>}
                            </td></tr>}
                        </React.Fragment>;
                    })}</tbody>
                </table></div>}
                {remittances && remittances.last_page > 1 && <Pagination page={remittancePage} lastPage={remittances.last_page} onChange={setRemittancePage} label="COD remittance pages" />}
            </section>

            <PayoutTable
                title="Seller payout queue"
                description="Unpaid payouts created after COD reconciliation. Status actions are audited; this page never initiates a transfer."
                rows={queueRows}
                total={payoutQueue?.total ?? 0}
                page={queuePage}
                lastPage={payoutQueue?.last_page ?? 1}
                onPage={setQueuePage}
                status={payoutQueueStatus}
                onStatus={(value) => { setPayoutQueueStatus(value); setQueuePage(1); }}
                sort={payoutSort}
                onSort={(value) => { setPayoutSort(value); setQueuePage(1); setRecordedPage(1); }}
                payoutsEnabled={payoutsEnabled}
                payoutForms={payoutForms}
                busy={busy}
                updatePayoutForm={updatePayoutForm}
                confirmPayout={(payout) => void confirmPayout(payout)}
                changePayoutStatus={(payout, status) => void changePayoutStatus(payout, status)}
                onOpenSettings={onOpenSettings}
            />
            <section className="payments-list-section" aria-labelledby="payments-recorded-title">
                <div className="payments-section-heading"><div><h3 id="payments-recorded-title">Recorded payouts</h3><p>Completed, returned, or disputed payout records and receipts.</p></div></div>
                <div className="payments-table-controls">
                    <label>Status<select value={recordedStatus} onChange={(event) => { setRecordedStatus(event.target.value); setRecordedPage(1); }}><option value="">All recorded statuses</option><option value="PAID">Paid</option><option value="RETURNED">Returned</option><option value="DISPUTED">Disputed</option></select></label>
                    <label>Sort<select value={payoutSort} onChange={(event) => { setPayoutSort(event.target.value); setRecordedPage(1); }}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="amount_desc">Amount: high to low</option><option value="amount_asc">Amount: low to high</option></select></label>
                </div>
                {!recordedRows.length ? <div className="payments-empty-state"><strong>No recorded payouts match this view.</strong><span>When an admin records an externally completed transfer with evidence, it appears here.</span></div> : <div className="data-table-wrap payments-table-wrap"><table className="data-table payments-table">
                    <thead><tr><th>Payout</th><th>Order</th><th>Seller</th><th>Amount</th><th>Transfer reference</th><th>Date</th><th>Status</th><th>Receipt</th></tr></thead>
                    <tbody>{recordedRows.map((payout) => <tr key={payout.id}>
                        <td>PO-{payout.id}</td><td>{payout.order?.order_reference ?? 'Order'}</td><td>{payout.seller?.name ?? 'Seller'}</td>
                        <td>{amount(payout.amount_cents)}</td><td>{payout.external_reference ?? '—'}</td><td>{payout.paid_at ? new Date(payout.paid_at).toLocaleString() : 'Not paid'}</td>
                        <td><span className={`status-pill status-${payout.status.toLowerCase()}`}>{payout.status === 'PAID' ? 'External transfer recorded' : payout.status === 'PROCESSING' ? 'External process reported' : payout.status}</span>{payout.status === 'PROCESSING' && <small>Farmgate has not initiated the transfer.</small>}</td>
                        <td>{payout.receipt_url ? <a href={payout.receipt_url} target="_blank" rel="noreferrer">View private receipt</a> : 'No receipt attached'}{payout.status === 'PAID' && <><label>Correction / reversal reason<input maxLength={500} value={payoutForms[payout.id]?.reason ?? ''} onChange={(event) => updatePayoutForm(payout, { reason: event.target.value })} /></label><button className="seller-inline-action" type="button" disabled={busy} onClick={() => changePayoutStatus(payout, 'RETURNED')}>Record returned transfer</button><button className="payments-text-button" type="button" disabled={busy} onClick={() => changePayoutStatus(payout, 'DISPUTED')}>Flag dispute</button></>}</td>
                    </tr>)}</tbody>
                </table></div>}
                {recordedPayouts && recordedPayouts.last_page > 1 && <Pagination page={recordedPage} lastPage={recordedPayouts.last_page} onChange={setRecordedPage} label="Recorded payout pages" />}
            </section>
        </>}
    </section>;
}

function PayoutTable({
    title, description, rows, total, page, lastPage, onPage, status, onStatus, sort, onSort, payoutsEnabled, payoutForms, busy,
    updatePayoutForm, confirmPayout, changePayoutStatus, onOpenSettings,
}: {
    title: string; description: string; rows: Payout[]; total: number; page: number; lastPage: number; onPage: (page: number) => void;
    status: string; onStatus: (status: string) => void; sort: string; onSort: (sort: string) => void;
    payoutsEnabled: boolean; payoutForms: Record<number, PayoutForm>; busy: boolean;
    updatePayoutForm: (payout: Payout, changes: Partial<PayoutForm>) => void;
    confirmPayout: (payout: Payout) => void;
    changePayoutStatus: (payout: Payout, status: 'PENDING' | 'FAILED' | 'RETURNED' | 'DISPUTED') => void;
    onOpenSettings: () => void;
}) {
    return <section className="payments-list-section" aria-labelledby="payments-payout-queue-title">
        <div className="payments-section-heading"><div><h3 id="payments-payout-queue-title">{title}</h3><p>{description}</p></div><span className="admin-filter">{total} records</span></div>
        <div className="payments-table-controls">
            <label>Status<select value={status} onChange={(event) => onStatus(event.target.value)}><option value="">All queue statuses</option><option value="PENDING_SETUP">Needs destination setup</option><option value="PENDING">Pending</option><option value="PROCESSING">Processing</option><option value="FAILED">Failed</option></select></label>
            <label>Sort<select value={sort} onChange={(event) => onSort(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="amount_desc">Amount: high to low</option><option value="amount_asc">Amount: low to high</option></select></label>
        </div>
        {!rows.length ? <div className="payments-empty-state"><strong>No payouts in the queue.</strong><span>Payout records appear after a COD remittance is fully reconciled. A verified seller destination is required before external payment can be recorded.</span></div> : <div className="data-table-wrap payments-table-wrap"><table className="data-table payments-table">
            <thead><tr><th>Payout</th><th>Order</th><th>Seller</th><th>Amount due</th><th>Destination</th><th>Status</th><th>Available action</th></tr></thead>
            <tbody>{rows.map((payout) => {
                const form = payoutForms[payout.id] ?? { reference: '', amount: (payout.amount_cents / 100).toFixed(2), paidDate: '', reason: '', receipt: null };
                return <tr key={payout.id}>
                    <td>PO-{payout.id}</td><td>{payout.order?.order_reference ?? 'Order'}</td><td>{payout.seller?.name ?? 'Seller'}</td><td>{amount(payout.amount_cents)}</td>
                    <td>{payout.destination_masked ? `${payout.destination_masked.type} · ${payout.destination_masked.institution} · ${payout.destination_masked.account_holder} · ${payout.destination_masked.identifier ?? ''} · ${payout.destination_masked.status}` : 'Verified destination required'}</td>
                    <td><span className={`status-pill status-${payout.status.toLowerCase()}`}>{payout.status === 'PROCESSING' ? 'External process reported' : payout.status.replaceAll('_', ' ')}</span>{payout.status === 'PROCESSING' && <small>Farmgate has not initiated the transfer.</small>}{payout.provider_status && <small>{payout.provider_status}</small>}{payout.histories?.length ? <details><summary>History</summary>{payout.histories.map((entry, index) => <small key={`${entry.action}-${index}`}>{entry.action.replaceAll('_', ' ')} · {entry.actor?.name ?? 'Admin'} · {entry.reason}</small>)}</details> : null}</td>
                    <td>
                        {payout.status === 'PENDING_SETUP' ? <div className="payments-eligibility-block"><strong>Not eligible to record</strong><ul>{(payout.eligibility_unmet.length ? payout.eligibility_unmet : ['The seller must acknowledge the effective policy and have a verified destination.']).map((item) => <li key={item}>{item}</li>)}</ul><button className="payments-text-button" type="button" onClick={onOpenSettings}>Review policy and destination controls</button></div> : <>
                            <label>Action reason<input maxLength={500} value={form.reason} onChange={(event) => updatePayoutForm(payout, { reason: event.target.value })} /></label>
                            {['PENDING', 'PROCESSING'].includes(payout.status) && payoutsEnabled && payout.seller_payout_eligible && <div className="payments-action-form">
                                <strong>Verified destination: {payout.destination_masked ? `${payout.destination_masked.type} · ${payout.destination_masked.institution} · ${payout.destination_masked.account_holder} · ${payout.destination_masked.identifier}` : 'Unavailable'}</strong>
                                <p>Amount due: {amount(payout.amount_cents)}. Enter only a transfer that has already been completed externally. A different admin from the payout recorder must verify and record it.</p>
                                {payout.recorder?.name && <small>Payout recorded by: {payout.recorder.name}</small>}
                                <label>Amount externally transferred (PHP)<input inputMode="decimal" value={form.amount} onChange={(event) => updatePayoutForm(payout, { amount: event.target.value })} /></label>
                                <label>External transfer date<input type="date" max={new Date().toISOString().slice(0, 10)} value={form.paidDate} onChange={(event) => updatePayoutForm(payout, { paidDate: event.target.value })} /></label>
                                <label>Transfer reference<input maxLength={100} value={form.reference} onChange={(event) => updatePayoutForm(payout, { reference: event.target.value })} /></label>
                                <label>Private receipt (optional)<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => updatePayoutForm(payout, { receipt: event.target.files?.[0] ?? null })} /></label>
                                <button className="seller-inline-action" type="button" disabled={busy} onClick={() => confirmPayout(payout)}>Record externally completed payout</button>
                            </div>}
                            {payoutsEnabled && !payout.seller_payout_eligible && <div className="payments-eligibility-block"><strong>Seller prerequisites are not met</strong><ul>{payout.eligibility_unmet.map((item) => <li key={item}>{item}</li>)}</ul></div>}
                            {!payoutsEnabled && ['PENDING', 'PROCESSING'].includes(payout.status) && <button className="payments-text-button" type="button" onClick={onOpenSettings}>Resolve payout setup</button>}
                            {['PENDING', 'PROCESSING'].includes(payout.status) && <button className="seller-inline-action" type="button" disabled={busy} onClick={() => changePayoutStatus(payout, 'FAILED')}>Record failed external payout</button>}
                            {['PENDING', 'PROCESSING'].includes(payout.status) && <button className="payments-text-button" type="button" disabled={busy} onClick={() => changePayoutStatus(payout, 'DISPUTED')}>Flag dispute</button>}
                            {['FAILED', 'RETURNED', 'DISPUTED'].includes(payout.status) && <button className="seller-inline-action" type="button" disabled={busy} onClick={() => changePayoutStatus(payout, 'PENDING')}>Resolve and return to payout queue</button>}
                        </>}
                    </td>
                </tr>;
            })}</tbody>
        </table></div>}
        {lastPage > 1 && <Pagination page={page} lastPage={lastPage} onChange={onPage} label="Seller payout queue pages" />}
    </section>;
}
