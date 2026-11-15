import React from 'react';
import api from '../../lib/api';
import { LoadingSkeleton } from '../../shared/components/LoadingSkeleton';
import { Pagination } from '../../shared/components/Pagination';

type Earning = {
    id: number;
    reference: string;
    delivery_reference: string;
    order_reference: string;
    completed_at: string | null;
    delivery_fee_cents: number;
    gross_amount_cents: number;
    deductions_cents: number;
    adjustment_cents: number;
    net_amount_cents: number;
    eligibility_status: string;
    eligibility_reason: string;
    payout_status: string;
    payout_reference: string | null;
    payout_history: {
        reference: string;
        status: string;
        amount_cents: number;
        date: string | null;
        destination: { destination_type: string; account_number_masked: string | null; wallet_number_masked: string | null } | null;
        receipt_url: string | null;
    }[];
};
type Page<T> = { data: T[]; current_page: number; last_page: number; total: number };
type EarningsResponse = {
    earnings: Page<Earning>;
    summary: { available_cents: number; pending_cents: number; paid_cents: number };
};

const money = (cents: number) => `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const label = (value: string) => value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());

export function RiderEarningsPage({ onError }: { onError: (message: string) => void }) {
    const [page, setPage] = React.useState<EarningsResponse | null>(null);
    const [pageNumber, setPageNumber] = React.useState(1);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        let active = true;
        setLoading(true);
        api.get<EarningsResponse>(`/api/rider/earnings?page=${pageNumber}`)
            .then((response) => { if (active) setPage(response.data); })
            .catch((error: any) => { if (active) onError(error.userMessage ?? error.response?.data?.message ?? 'Rider earnings could not be loaded.'); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [onError, pageNumber]);

    return <section className="seller-work-section rider-earnings-page" aria-labelledby="rider-earnings-title">
        <div className="seller-work-heading"><div><p className="eyebrow">Rider payments</p><h2 id="rider-earnings-title">Earnings &amp; payout history</h2></div></div>
        <div className="rider-earnings-summary" aria-live="polite">
            <article><span>Available</span><strong>{page ? money(page.summary.available_cents) : '—'}</strong></article>
            <article><span>Pending review / eligibility</span><strong>{page ? money(page.summary.pending_cents) : '—'}</strong></article>
            <article><span>Paid</span><strong>{page ? money(page.summary.paid_cents) : '—'}</strong></article>
        </div>
        <p className="rider-settings-field-note">Each eligible delivery has its own payout record after administrator approval and external transfer confirmation. COD cash collected is tracked separately and is never counted as earnings. Buyer payment status does not determine rider compensation.</p>
        {loading && !page ? <LoadingSkeleton variant="table" count={4} label="Loading your rider earnings" /> : page?.earnings.data.length ? <div className="admin-table-scroll">
            <table className="admin-data-table">
                <thead><tr><th>Delivery / order</th><th>Completed</th><th>Gross delivery fee</th><th>Rider gross</th><th>Deductions / adjustment</th><th>Net earnings</th><th>Status / payout</th></tr></thead>
                <tbody>{page.earnings.data.map((earning) => <tr key={earning.id}>
                    <td><strong>{earning.delivery_reference}</strong><br />Order {earning.order_reference}<small>{earning.reference}</small></td>
                    <td>{earning.completed_at ? new Date(earning.completed_at).toLocaleDateString() : '—'}</td>
                    <td>{money(earning.delivery_fee_cents)}</td>
                    <td>{money(earning.gross_amount_cents)}</td>
                    <td>{money(earning.deductions_cents)}{earning.adjustment_cents ? <><br />Adjustment {money(earning.adjustment_cents)}</> : null}</td>
                    <td><strong>{money(earning.net_amount_cents)}</strong></td>
                    <td><span className="status-pill">{label(earning.eligibility_status === 'READY' ? earning.payout_status : earning.eligibility_status)}</span>
                        {earning.payout_history.map((payout) => <React.Fragment key={payout.reference}><br /><span>{payout.reference}</span><br /><span>{label(payout.status)} · {payout.date ? new Date(payout.date).toLocaleDateString() : '—'} · {money(payout.amount_cents)}</span>
                            {payout.destination && <small>{payout.destination.destination_type} · {payout.destination.account_number_masked ?? payout.destination.wallet_number_masked}</small>}
                            {payout.receipt_url && <a href={payout.receipt_url}>Download private receipt</a>}</React.Fragment>)}
                        {earning.eligibility_status !== 'READY' && <small>{earning.eligibility_reason}</small>}
                    </td>
                </tr>)}</tbody>
            </table>
        </div> : <p className="rider-empty">No completed delivery earnings are available yet.</p>}
        {page && page.earnings.total > 0 && <div className="rider-delivery-pagination"><span>Page {page.earnings.current_page} of {page.earnings.last_page} · {page.earnings.total} earnings</span><Pagination page={page.earnings.current_page} lastPage={page.earnings.last_page} onChange={setPageNumber} label="Earnings pagination" /></div>}
    </section>;
}
