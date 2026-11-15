import React from 'react';
import api from '../../lib/api';
import { Pagination } from '../../shared/components/Pagination';

type RiderEarning = {
    id: number;
    delivery_fee_cents: number;
    percentage_snapshot: string;
    amount_cents: number;
    calculated_at: string;
    delivery: { delivery_reference: string; status: string; delivery_verified_at: string | null };
    order: { order_reference: string; delivery_fee: string };
    payout: { amount_cents: number; status: string; paid_at: string | null } | null;
};
type EarningsPage = { data: RiderEarning[]; current_page: number; last_page: number; total: number };
type EarningsResponse = {
    configuration_status: 'CONFIGURED' | 'NOT_CONFIGURED';
    earnings: EarningsPage;
    summary: { earned_cents: number; pending_payout_cents: number; paid_payout_cents: number };
};

function money(cents: number): string {
    return `PHP ${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function RiderEarningsPanel() {
    const [page, setPage] = React.useState(1);
    const [data, setData] = React.useState<EarningsResponse | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState('');

    const refresh = React.useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const response = await api.get<EarningsResponse>('/api/rider/earnings', { params: { page } });
            setData(response.data);
        } catch (requestError: any) {
            setError(requestError.userMessage ?? requestError.response?.data?.message ?? 'Rider earnings could not be loaded.');
        } finally {
            setLoading(false);
        }
    }, [page]);

    React.useEffect(() => { void refresh(); }, [refresh]);

    return <section className="rider-cod-remittance" aria-labelledby="rider-earnings-title">
        <div className="rider-cod-remittance-heading"><p className="eyebrow">Rider payments</p><h2 id="rider-earnings-title">Earnings</h2></div>
        {error && <p className="rider-delivery-error" role="alert">{error} <button type="button" onClick={() => void refresh()}>Try again</button></p>}
        {loading && !data ? <p role="status">Loading rider earnings…</p> : data && <>
            {data.configuration_status === 'NOT_CONFIGURED' && <div className="payments-blocked-card" role="status">
                <strong>Not configured</strong>
                <p>Farmgate has not saved an approved rider earnings percentage and cap option. Earnings and payouts are disabled until an authorized admin configures both.</p>
            </div>}
            <div className="rider-metric-grid" aria-live="polite">
                <article><span>Total earned</span><strong>{money(data.summary.earned_cents)}</strong></article>
                <article><span>Pending manual payout</span><strong>{money(data.summary.pending_payout_cents)}</strong></article>
                <article><span>Recorded as paid</span><strong>{money(data.summary.paid_payout_cents)}</strong></article>
            </div>
            {data.earnings.data.length === 0 ? <p className="rider-empty">No verified delivery earnings have been recorded.</p>
                : <div className="data-table-wrap"><table><thead><tr><th>Order</th><th>Delivery</th><th>Saved delivery fee</th><th>Rate snapshot</th><th>Earned</th><th>Payout</th><th>Verified</th></tr></thead><tbody>
                    {data.earnings.data.map((earning) => <tr key={earning.id}>
                        <td>{earning.order.order_reference}</td>
                        <td>{earning.delivery.delivery_reference}</td>
                        <td>{money(earning.delivery_fee_cents)}</td>
                        <td>{earning.percentage_snapshot}%</td>
                        <td>{money(earning.amount_cents)}</td>
                        <td>{earning.payout?.status ?? 'No payout due'}</td>
                        <td>{earning.delivery.delivery_verified_at ? new Date(earning.delivery.delivery_verified_at).toLocaleString() : '—'}</td>
                    </tr>)}
                </tbody></table></div>}
            {(data.earnings.last_page ?? 1) > 1 && <Pagination page={data.earnings.current_page} lastPage={data.earnings.last_page} onChange={setPage} label="Rider earnings pages" />}
            <p className="payments-inline-note">Payouts are recorded manually only after an external transfer is completed. Farmgate does not initiate transfers.</p>
        </>}
    </section>;
}
