import React from 'react';
import api from '../../lib/api';
import { LoadingSkeleton } from '../../shared/components/LoadingSkeleton';
import { Pagination } from '../../shared/components/Pagination';

type Payout = {
    reference: string;
    status: string;
    amount_cents: number;
    date: string | null;
    destination: { destination_type: string; account_number_masked: string | null; wallet_number_masked: string | null } | null;
    receipt_url: string | null;
};
type Earning = {
    id: number;
    reference: string;
    delivery_reference: string;
    order_reference: string;
    completed_at: string | null;
    net_amount_cents: number;
    eligibility_status: string;
    eligibility_reason: string;
    payout_status: string;
    payout: Payout | null;
    payout_history: Payout[];
};
type Page<T> = { data: T[]; current_page: number; last_page: number; total: number };
type EarningsResponse = {
    earnings: Page<Earning>;
    summary: { available_cents: number; pending_cents: number; paid_cents: number };
};
type ChartPeriod = 'this_month' | 'last_month' | 'all_recent';
type ChartPoint = { label: string; amount: number; sortKey: number };

const money = (cents: number) => `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const label = (value: string) => value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
const formatDate = (value: string | null) => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
};

function EarningsIcon({ name }: { name: 'wallet' | 'pending' | 'paid' | 'overview' | 'history' | 'delivery' | 'summary' }) {
    return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {name === 'wallet' ? <><path d="M4 6.5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12" /><path d="M15 11h6v5h-6a2.5 2.5 0 0 1 0-5Z" /><circle cx="16" cy="13.5" r=".5" fill="currentColor" /></>
            : name === 'pending' ? <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>
                : name === 'paid' ? <><circle cx="12" cy="12" r="9" /><path d="m7.5 12.5 3 3 6-7" /></>
                    : name === 'overview' ? <><path d="M4 19V9M10 19V5M16 19v-7M22 19H2" /></>
                        : name === 'history' ? <><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 12h7M9 16h7" /></>
                            : name === 'delivery' ? <><path d="M3 7h11v11H3zM14 11h4l3 3v4h-7" /><circle cx="7.5" cy="18" r="1.5" /><circle cx="18" cy="18" r="1.5" /></>
                                : <><ellipse cx="12" cy="6" rx="7.5" ry="3" /><path d="M4.5 6v4c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6M4.5 10v4c0 1.7 3.4 3 7.5 3M4.5 14v4c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-4" /></>}
    </svg>;
}

function chartPoints(earnings: Earning[], period: ChartPeriod, now = new Date()): ChartPoint[] {
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const selected = earnings.flatMap((earning) => {
        if (earning.eligibility_status !== 'READY' || !earning.completed_at) return [];
        const date = new Date(earning.completed_at);
        if (Number.isNaN(date.getTime())) return [];
        if (period === 'this_month' && (date < startOfThisMonth || date >= startOfNextMonth)) return [];
        if (period === 'last_month' && (date < startOfLastMonth || date >= startOfThisMonth)) return [];
        return [{ date, amount: earning.net_amount_cents }];
    });

    if (period === 'all_recent') {
        const groups = new Map<string, ChartPoint>();
        selected.forEach(({ date, amount }) => {
            const sortKey = date.getFullYear() * 12 + date.getMonth();
            const key = String(sortKey);
            const current = groups.get(key);
            groups.set(key, {
                label: date.toLocaleDateString('en-PH', { month: 'short', year: '2-digit' }),
                amount: (current?.amount ?? 0) + amount,
                sortKey,
            });
        });
        return [...groups.values()].sort((first, second) => first.sortKey - second.sortKey);
    }

    const firstOfMonth = period === 'this_month' ? startOfThisMonth : startOfLastMonth;
    const daysInMonth = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth() + 1, 0).getDate();
    const weeks: ChartPoint[] = Array.from({ length: 5 }, (_, index) => ({
        label: '',
        amount: 0,
        sortKey: index,
    }));
    selected.forEach(({ date, amount }) => {
        const weekIndex = Math.min(4, Math.floor((date.getDate() - 1) / 7));
        weeks[weekIndex].amount += amount;
    });
    return weeks.map((week) => ({
        ...week,
        label: `${week.sortKey * 7 + 1}–${Math.min((week.sortKey + 1) * 7, daysInMonth)} ${firstOfMonth.toLocaleDateString('en-PH', { month: 'short' })}`,
    }));
}

function payoutMethod(payout: Payout): string {
    if (payout.destination?.destination_type === 'BANK') return 'Bank';
    if (payout.destination?.destination_type === 'GCASH') return 'GCash';
    return '—';
}

function payoutStatusClass(status: string): string {
    if (status === 'PAID') return 'is-paid';
    if (status === 'PENDING' || status === 'PROCESSING') return 'is-pending';
    if (status === 'FAILED' || status === 'RETURNED' || status === 'DISPUTED') return 'is-attention';
    return '';
}

export function RiderEarningsPage({ onError }: { onError: (message: string) => void }) {
    const [page, setPage] = React.useState<EarningsResponse | null>(null);
    const [pageNumber, setPageNumber] = React.useState(1);
    const [reloadVersion, setReloadVersion] = React.useState(0);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState('');
    const [activeTab, setActiveTab] = React.useState<'overview' | 'history'>('overview');
    const [period, setPeriod] = React.useState<ChartPeriod>('this_month');

    React.useEffect(() => {
        let active = true;
        setLoading(true);
        setError('');
        setPage(null);
        api.get<EarningsResponse>(`/api/rider/earnings?page=${pageNumber}`)
            .then((response) => { if (active) setPage(response.data); })
            .catch((requestError: any) => {
                if (!active) return;
                const message = requestError.userMessage ?? requestError.response?.data?.message ?? 'Rider earnings could not be loaded.';
                setError(message);
                onError(message);
            })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [onError, pageNumber, reloadVersion]);

    const earnings = page?.earnings.data ?? [];
    const eligibleEarnings = earnings.filter((earning) => earning.eligibility_status === 'READY');
    const eligibleTotal = eligibleEarnings.reduce((total, earning) => total + earning.net_amount_cents, 0);
    const points = chartPoints(earnings, period);
    const maxChartAmount = Math.max(0, ...points.map((point) => point.amount));
    const payoutRows = React.useMemo(() => {
        const byReference = new Map<string, Payout>();
        earnings.forEach((earning) => {
            const payouts = [...earning.payout_history, ...(earning.payout ? [earning.payout] : [])];
            payouts.forEach((payout) => {
                if (!byReference.has(payout.reference)) byReference.set(payout.reference, payout);
            });
        });
        return [...byReference.values()].sort((first, second) => (second.date ?? '').localeCompare(first.date ?? ''));
    }, [earnings]);

    function handleTabKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const nextTab = event.key === 'Home' ? 'overview'
            : event.key === 'End' ? 'history'
                : event.key === 'ArrowRight' ? (activeTab === 'overview' ? 'history' : 'overview')
                    : (activeTab === 'overview' ? 'history' : 'overview');
        setActiveTab(nextTab);
        event.currentTarget.querySelector<HTMLButtonElement>(`[data-earnings-tab="${nextTab}"]`)?.focus();
    }

    return <section className="seller-work-section rider-earnings-page" aria-label="Rider earnings and payout history" aria-busy={loading}>
        {error && <div className="rider-earnings-error" role="alert"><p>{error}</p><button type="button" onClick={() => setReloadVersion((version) => version + 1)}>Try again</button></div>}
        {loading && !page ? <LoadingSkeleton variant="table" count={4} label="Loading your rider earnings" /> : page && <>
            <div className="rider-earnings-summary" aria-live="polite">
                <article className="is-available"><span className="rider-earnings-card-icon"><EarningsIcon name="wallet" /></span><span>Available earnings</span><strong>{money(page.summary.available_cents)}</strong></article>
                <article><span className="rider-earnings-card-icon"><EarningsIcon name="pending" /></span><span>Pending review / eligibility</span><strong>{money(page.summary.pending_cents)}</strong></article>
                <article><span className="rider-earnings-card-icon"><EarningsIcon name="paid" /></span><span>Paid total</span><strong>{money(page.summary.paid_cents)}</strong></article>
            </div>

            <div className="rider-earnings-tabs" role="tablist" aria-label="Rider earnings sections" onKeyDown={handleTabKeyDown}>
                <button id="rider-earnings-overview-tab" type="button" role="tab" data-earnings-tab="overview" aria-selected={activeTab === 'overview'} aria-controls="rider-earnings-overview-panel" tabIndex={activeTab === 'overview' ? 0 : -1} onClick={() => setActiveTab('overview')}><EarningsIcon name="overview" />Overview</button>
                <button id="rider-earnings-history-tab" type="button" role="tab" data-earnings-tab="history" aria-selected={activeTab === 'history'} aria-controls="rider-earnings-history-panel" tabIndex={activeTab === 'history' ? 0 : -1} onClick={() => setActiveTab('history')}><EarningsIcon name="history" />Payout History</button>
            </div>

            <div id="rider-earnings-overview-panel" className="rider-earnings-overview" role="tabpanel" aria-labelledby="rider-earnings-overview-tab" tabIndex={0} hidden={activeTab !== 'overview'}>
                <section className="rider-earnings-panel rider-earnings-chart-panel" aria-labelledby="rider-earnings-chart-title">
                    <div className="rider-earnings-panel-heading">
                        <div><span className="rider-earnings-panel-icon"><EarningsIcon name="overview" /></span><h3 id="rider-earnings-chart-title">Earnings overview</h3></div>
                        <label className="rider-earnings-period">Period
                            <select value={period} onChange={(event) => {
                                const nextPeriod = event.currentTarget.value;
                                if (nextPeriod === 'this_month' || nextPeriod === 'last_month' || nextPeriod === 'all_recent') setPeriod(nextPeriod);
                            }}>
                                <option value="this_month">This month</option>
                                <option value="last_month">Last month</option>
                                <option value="all_recent">All recent records</option>
                            </select>
                        </label>
                    </div>
                    {points.some((point) => point.amount > 0) ? <>
                        <div className="rider-earnings-chart" role="list" aria-label="Eligible delivery earnings by period">
                            {points.map((point) => <div className="rider-earnings-chart-column" role="listitem" aria-label={`${point.label}: ${money(point.amount)}`} key={`${period}-${point.sortKey}`}>
                                <span className="rider-earnings-chart-value">{money(point.amount)}</span>
                                <div className="rider-earnings-chart-track" aria-hidden="true"><span style={{ height: `${Math.max(4, (point.amount / maxChartAmount) * 100)}%` }} /></div>
                                <span className="rider-earnings-chart-label">{point.label}</span>
                            </div>)}
                        </div>
                        <p className="rider-earnings-chart-note">Eligible delivery earnings from the records on this page.</p>
                    </> : <div className="rider-earnings-chart-empty"><span><EarningsIcon name="summary" /></span><strong>No eligible earnings in this period</strong><p>Verified eligible delivery earnings will appear here.</p></div>}
                </section>

                <section className="rider-earnings-panel rider-earnings-breakdown" aria-labelledby="rider-earnings-summary-title">
                    <div className="rider-earnings-panel-heading"><div><span className="rider-earnings-panel-icon"><EarningsIcon name="summary" /></span><h3 id="rider-earnings-summary-title">Earnings summary</h3></div></div>
                    <dl>
                        <div><dt><EarningsIcon name="delivery" />Eligible deliveries on this page</dt><dd>{eligibleEarnings.length}</dd></div>
                        <div><dt><EarningsIcon name="wallet" />Eligible earnings on this page</dt><dd>{money(eligibleTotal)}</dd></div>
                        <div className="is-total"><dt>Available earnings</dt><dd>{money(page.summary.available_cents)}</dd></div>
                    </dl>
                    <p className="rider-earnings-summary-note">Available, pending, and paid totals reflect your full account. Delivery counts and chart totals reflect the current earnings page.</p>
                </section>
            </div>
            <section id="rider-earnings-history-panel" className="rider-earnings-panel rider-earnings-history" role="tabpanel" aria-labelledby="rider-earnings-history-tab" tabIndex={0} hidden={activeTab !== 'history'}>
                <div className="rider-earnings-panel-heading">
                    <div><span className="rider-earnings-panel-icon"><EarningsIcon name="history" /></span><div><h3>Payout History</h3><p>Recorded payout attempts linked to the earning records on this page.</p></div></div>
                    <span className="rider-earnings-record-count">{payoutRows.length} {payoutRows.length === 1 ? 'payout' : 'payouts'}</span>
                </div>
                {payoutRows.length > 0 ? <div className="rider-earnings-table-wrap"><table className="rider-earnings-table">
                    <thead><tr><th>Reference</th><th>Date</th><th>Amount</th><th>Method</th><th>Status</th><th>Details / receipt</th></tr></thead>
                    <tbody>{payoutRows.map((payout) => {
                        const destination = payout.destination?.account_number_masked ?? payout.destination?.wallet_number_masked;
                        return <tr key={payout.reference}>
                            <td data-label="Reference"><strong>{payout.reference}</strong></td>
                            <td data-label="Date">{formatDate(payout.date)}</td>
                            <td data-label="Amount"><strong>{money(payout.amount_cents)}</strong></td>
                            <td data-label="Method">{payoutMethod(payout)}</td>
                            <td data-label="Status"><span className={`rider-earnings-status ${payoutStatusClass(payout.status)}`}>{label(payout.status)}</span></td>
                            <td data-label="Details / receipt"><details className="rider-earnings-payout-details">
                                <summary>View details</summary>
                                <div><span>Method</span><strong>{payoutMethod(payout)}</strong>{destination && <><span>Destination</span><strong>{destination}</strong></>}{payout.receipt_url && <a href={payout.receipt_url} target="_blank" rel="noreferrer">View private receipt</a>}</div>
                            </details></td>
                        </tr>;
                    })}</tbody>
                </table></div> : <div className="rider-earnings-history-empty"><EarningsIcon name="history" /><strong>No payout records on this page</strong><p>When payouts are recorded for these earnings, their references and status will appear here.</p></div>}
            </section>

            <div className="rider-earnings-pagination">
                <span>Showing {earnings.length} of {page.earnings.total} earning records · page {page.earnings.current_page} of {page.earnings.last_page}</span>
                {page.earnings.last_page > 1 && <Pagination page={page.earnings.current_page} lastPage={page.earnings.last_page} onChange={setPageNumber} label="Earnings pagination" />}
            </div>
            <p className="rider-earnings-policy-note">Payouts are marked paid only after an administrator records independent transfer confirmation. Farmgate does not initiate transfers.</p>
        </>}
    </section>;
}
