import React from 'react';
import api from '../../lib/api';
import { LoadingSkeleton } from '../../shared/components/LoadingSkeleton';
import { Pagination } from '../../shared/components/Pagination';

type Payout = {
    id: number;
    created_at: string;
    amount_cents: number;
    method: string;
    status: string;
    paid_at: string | null;
    provider_status: string | null;
    receipt_url: string | null;
    order?: { order_reference: string };
};
type PayoutPage = { data: Payout[]; current_page: number; last_page: number; total: number; from: number | null; to: number | null };
type PayoutSummaryItem = { count: number; amount_cents: number };
type PayoutSummary = { total: PayoutSummaryItem; pending: PayoutSummaryItem; processing: PayoutSummaryItem; paid: PayoutSummaryItem };
type DestinationType = 'BANK' | 'GCASH';
type Destination = {
    id: number;
    destination_type: DestinationType;
    account_holder_masked: string;
    bank_name_masked: string | null;
    account_number_masked: string | null;
    wallet_number_masked: string | null;
    status: string;
    consent_version: string;
    consent_accepted_at: string;
    verified_at: string | null;
};
type DestinationConsent = { version: string; notice: string };
type SellerPayoutPolicy = {
    id: number;
    version: string;
    effective_date: string;
    policy_text: string;
    status: string;
    supporting_document_url: string | null;
    acknowledged: boolean;
    acknowledged_at?: string | null;
};

function PayoutIcon({ name }: { name: 'receipt' | 'bank' | 'calendar' | 'search' | 'filter' | 'sort' | 'shield' | 'coins' | 'hourglass' | 'refresh' | 'checkCircle' | 'document' | 'edit' | 'info' }) {
    const paths = {
        receipt: <><path d="M5 3.5h14v17l-3-2-4 2-4-2-3 2z" /><path d="M8 8h8M8 12h8M8 16h4" /></>,
        bank: <><path d="m3 9 9-5 9 5" /><path d="M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18M4 9h16" /></>,
        calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M7.5 3v4M16.5 3v4M3.5 9h17" /></>,
        search: <><circle cx="10.8" cy="10.8" r="6.3" /><path d="m15.5 15.5 4.2 4.2" /></>,
        filter: <><path d="M4 6h16M7 12h10M10 18h4" /></>,
        sort: <><path d="M7 4v16M4 7l3-3 3 3M17 20V4m-3 13 3 3 3-3" /></>,
        shield: <><path d="M12 3 19 6v5c0 4.7-3 8-7 10-4-2-7-5.3-7-10V6z" /><path d="m9 12 2 2 4-4" /></>,
        coins: <><ellipse cx="9" cy="7" rx="5.5" ry="2.5" /><path d="M3.5 7v4c0 1.4 2.5 2.5 5.5 2.5M14.5 7v2" /><path d="M3.5 11v4c0 1.4 2.5 2.5 5.5 2.5" /><ellipse cx="15" cy="14" rx="5.5" ry="2.5" /><path d="M9.5 14v4c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5v-4" /></>,
        hourglass: <><path d="M6 3h12M6 21h12M7 3c0 5 5 5 5 9s-5 4-5 9M17 3c0 5-5 5-5 9s5 4 5 9" /></>,
        refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.5 9a7 7 0 0 1 11.7-2L20 12M4 12l2.8 5a7 7 0 0 0 11.7-2" /></>,
        checkCircle: <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16.5 9" /></>,
        document: <><path d="M6 3.5h8l4 4V20H6z" /><path d="M14 3.5V8h4M9 12h6M9 16h6" /></>,
        edit: <><path d="m4 16.5-.8 4.3 4.3-.8L19 8.5 15.5 5z" /><path d="m13.8 6.7 3.5 3.5M4 21h16" /></>,
        info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
    };

    return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export function SellerPayouts({ onError }: { onError: (message: string) => void }) {
    const [payouts, setPayouts] = React.useState<PayoutPage | null>(null);
    const [summary, setSummary] = React.useState<PayoutSummary | null>(null);
    const [destination, setDestination] = React.useState<Destination | null>(null);
    const [consent, setConsent] = React.useState<DestinationConsent | null>(null);
    const [policy, setPolicy] = React.useState<SellerPayoutPolicy | null>(null);
    const [policyMessage, setPolicyMessage] = React.useState('');
    const [page, setPage] = React.useState(1);
    const [search, setSearch] = React.useState('');
    const [statusFilter, setStatusFilter] = React.useState('');
    const [sort, setSort] = React.useState('newest');
    const [expandedPayoutId, setExpandedPayoutId] = React.useState<number | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [payoutError, setPayoutError] = React.useState('');
    const [retryCount, setRetryCount] = React.useState(0);
    const [destinationLoading, setDestinationLoading] = React.useState(true);
    const [editingDestination, setEditingDestination] = React.useState(false);
    const [destinationType, setDestinationType] = React.useState<DestinationType>('BANK');
    const [accountHolder, setAccountHolder] = React.useState('');
    const [bankName, setBankName] = React.useState('');
    const [accountNumber, setAccountNumber] = React.useState('');
    const [walletNumber, setWalletNumber] = React.useState('');
    const [currentPassword, setCurrentPassword] = React.useState('');
    const [consentAccepted, setConsentAccepted] = React.useState(false);
    const [savingDestination, setSavingDestination] = React.useState(false);
    const [saveMessage, setSaveMessage] = React.useState('');
    const [policyLoading, setPolicyLoading] = React.useState(true);
    const [policyAcknowledged, setPolicyAcknowledged] = React.useState(false);
    const [acknowledgingPolicy, setAcknowledgingPolicy] = React.useState(false);

    React.useEffect(() => {
        let active = true;
        setLoading(true);
        setPayoutError('');
        const params = new URLSearchParams({ page: String(page), sort });
        if (search.trim()) params.set('search', search.trim());
        if (statusFilter) params.set('status', statusFilter);
        api.get<{ payouts: PayoutPage; summary: PayoutSummary }>(`/api/seller/payouts?${params.toString()}`)
            .then((response) => {
                if (!active) return;
                setPayouts(response.data.payouts);
                setSummary(response.data.summary);
            })
            .catch((error: any) => {
                if (!active) return;
                const message = error.userMessage ?? error.response?.data?.message ?? 'Payout history could not be loaded.';
                setPayoutError(message);
                onError(message);
            })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [page, retryCount, search, sort, statusFilter, onError]);

    React.useEffect(() => {
        let active = true;
        api.get<{ destination: Destination | null; consent: DestinationConsent }>('/api/seller/payout-destination')
            .then((response) => {
                if (!active) return;
                setDestination(response.data.destination);
                setConsent(response.data.consent);
                setDestinationType(response.data.destination?.destination_type ?? 'BANK');
            })
            .catch((error: any) => {
                if (active) onError(error.userMessage ?? error.response?.data?.message ?? 'Payout destination could not be loaded.');
            })
            .finally(() => { if (active) setDestinationLoading(false); });
        return () => { active = false; };
    }, [onError]);

    React.useEffect(() => {
        let active = true;
        api.get<{ policy: SellerPayoutPolicy | null; status_message: string | null }>('/api/seller/payout-policy')
            .then((response) => {
                if (!active) return;
                setPolicy(response.data.policy);
                setPolicyMessage(response.data.status_message ?? '');
            })
            .catch((error: any) => {
                if (active) onError(error.userMessage ?? error.response?.data?.message ?? 'Seller payout policy could not be loaded.');
            })
            .finally(() => { if (active) setPolicyLoading(false); });
        return () => { active = false; };
    }, [onError]);

    async function acknowledgePolicy() {
        if (!policy || !policyAcknowledged) return;
        setAcknowledgingPolicy(true);
        try {
            const response = await api.post<{ acknowledged_at: string }>(`/api/seller/payout-policy/${policy.id}/acknowledge`, { acknowledged: true });
            setPolicy({ ...policy, acknowledged: true, acknowledged_at: response.data.acknowledged_at });
        } catch (error: any) {
            onError(error.userMessage ?? error.response?.data?.message ?? 'Payout policy acknowledgment could not be saved.');
        } finally {
            setAcknowledgingPolicy(false);
        }
    }

    async function saveDestination(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!consent || !consentAccepted || !policy?.acknowledged) return;
        setSavingDestination(true);
        setSaveMessage('');
        try {
            const response = await api.put<{ message: string; destination: Destination }>('/api/seller/payout-destination', {
                destination_type: destinationType,
                account_holder: accountHolder,
                ...(destinationType === 'BANK'
                    ? { bank_name: bankName, account_number: accountNumber }
                    : { wallet_number: walletNumber }),
                current_password: currentPassword,
                consent_accepted: true,
                consent_version: consent.version,
                payout_policy_id: policy.id,
            });
            setDestination(response.data.destination);
            setDestinationType(response.data.destination.destination_type);
            setAccountHolder('');
            setBankName('');
            setAccountNumber('');
            setWalletNumber('');
            setCurrentPassword('');
            setConsentAccepted(false);
            setSaveMessage(response.data.message);
            setEditingDestination(false);
        } catch (error: any) {
            onError(error.userMessage ?? error.response?.data?.message ?? 'Payout destination could not be saved.');
        } finally {
            setSavingDestination(false);
        }
    }

    return <section className="seller-work-section seller-payouts-page" aria-label="Seller payouts">
        <div className="seller-payout-summary-grid" aria-label="Payout totals" aria-busy={!summary}>
            {([
                { key: 'total', label: 'Total payouts', icon: 'coins', tone: 'orange' },
                { key: 'pending', label: 'Pending', icon: 'hourglass', tone: 'orange' },
                { key: 'processing', label: 'Processing', icon: 'refresh', tone: 'green' },
                { key: 'paid', label: 'Paid', icon: 'checkCircle', tone: 'green' },
            ] as const).map(({ key, label, icon, tone }) => (
                <article className={`seller-payout-summary-card seller-payout-summary-card-${tone}`} key={key}>
                    <span className="seller-payout-summary-icon"><PayoutIcon name={icon} /></span>
                    <div><p>{label}</p><strong>{summary ? `₱${(summary[key].amount_cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</strong><small>{summary ? `${summary[key].count} ${summary[key].count === 1 ? 'payout' : 'payouts'}` : 'Loading totals'}</small></div>
                </article>
            ))}
        </div>
        <section className="seller-payout-overview" aria-labelledby="seller-payouts-title">
            <header className="seller-payout-overview-heading">
                <div><h2 id="seller-payouts-title">Seller payouts</h2><p>Manage your payout policy and destination.</p></div>
            </header>
            <aside className="seller-payouts-intro" role="note">
                <PayoutIcon name="info" />
                <p>Payouts are recorded after COD reconciliation. Farmgate does not send transfers.</p>
            </aside>
            <section className="seller-payout-policy" aria-label="Seller payout policy">
                {policyLoading ? <LoadingSkeleton variant="list" count={1} label="Loading seller payout policy" /> : policy ? <details className="seller-payout-policy-details">
                    <summary className="seller-payout-policy-summary" aria-controls={`seller-payout-policy-content-${policy.id}`}>
                        <span className="seller-payout-row-icon"><PayoutIcon name="document" /></span>
                        <span className="seller-payout-row-title"><span className="eyebrow">Payout policy</span><strong>Seller payout policy</strong></span>
                        <span className="seller-payout-policy-meta"><strong>Version {policy.version}</strong><span>Effective {new Date(`${policy.effective_date}T00:00:00`).toLocaleDateString()}</span></span>
                        <span className={`seller-payout-policy-status ${policy.acknowledged ? 'is-acknowledged' : 'is-pending'}`}>{policy.acknowledged ? <PayoutIcon name="checkCircle" /> : <PayoutIcon name="hourglass" />}{policy.acknowledged ? 'Acknowledged' : 'Review required'}</span>
                        <span className="seller-payout-policy-toggle">View policy</span>
                    </summary>
                    <div className="seller-payout-policy-content" id={`seller-payout-policy-content-${policy.id}`}>
                        <pre className="seller-payout-policy-text">{policy.policy_text}</pre>
                        {policy.supporting_document_url && <a href={policy.supporting_document_url} target="_blank" rel="noreferrer">View supporting policy document</a>}
                        {policy.acknowledged
                            ? <p role="status">Acknowledged{policy.acknowledged_at ? ` on ${new Date(policy.acknowledged_at).toLocaleString()}` : ''}.</p>
                            : <div className="seller-payout-policy-ack">
                                <label className="seller-payout-destination-consent"><input type="checkbox" checked={policyAcknowledged} onChange={(event) => setPolicyAcknowledged(event.target.checked)} /><span>I have reviewed and acknowledge seller payout policy version {policy.version}.</span></label>
                                <button className="seller-payout-destination-submit" type="button" disabled={!policyAcknowledged || acknowledgingPolicy} onClick={() => void acknowledgePolicy()}>{acknowledgingPolicy ? 'Saving acknowledgment…' : 'Acknowledge policy'}</button>
                            </div>}
                    </div>
                </details> : <p className="seller-empty">{policyMessage || 'Payout details are unavailable until an effective payout policy is published.'}</p>}
            </section>
            <section className="seller-payout-destination seller-payout-panel" aria-label="Payout destination">
                {destinationLoading ? <LoadingSkeleton variant="list" count={1} label="Loading payout destination" /> : <>
                    <div className="seller-payout-destination-row">
                        <div className="seller-payout-destination-kind">
                            <span className="seller-payout-row-icon"><PayoutIcon name="bank" /></span>
                            <span className="seller-payout-row-title"><span className="eyebrow">Payout destination</span><strong id="payout-destination-title">{destination?.destination_type === 'GCASH' ? 'GCash' : destination ? 'Bank transfer' : 'Not set'}</strong></span>
                        </div>
                        {destination ? <div className="seller-payout-destination-summary" aria-live="polite">
                            <p><strong>Account holder</strong><span>{destination.account_holder_masked}</span></p>
                            {destination.destination_type === 'BANK'
                                ? <><p><strong>Bank</strong><span>{destination.bank_name_masked}</span></p><p><strong>Account</strong><span>{destination.account_number_masked}</span></p></>
                                : <p><strong>GCash number</strong><span>{destination.wallet_number_masked}</span></p>}
                        </div> : <p className="seller-payout-destination-not-set">No payout destination has been added.</p>}
                        <div className="seller-payout-destination-actions">
                            {destination && <span className={`seller-payout-policy-status ${destination.status === 'VERIFIED' ? 'is-acknowledged' : 'is-pending'}`}><PayoutIcon name={destination.status === 'VERIFIED' ? 'checkCircle' : 'hourglass'} />{destination.status.replaceAll('_', ' ')}</span>}
                            {consent && policy?.acknowledged && <button className="seller-payout-update-button" type="button" aria-expanded={editingDestination} onClick={() => setEditingDestination(!editingDestination)}>
                                <PayoutIcon name="edit" />{destination ? 'Update destination' : 'Add destination'}
                            </button>}
                        </div>
                    </div>
                    {!policyLoading && policy && !policy.acknowledged && <p className="seller-payout-destination-hint">Acknowledge the payout policy to manage your destination.</p>}
                    {editingDestination && consent && policy?.acknowledged && <form className="seller-payout-destination-form" onSubmit={saveDestination}>
                        <div className="seller-payout-cod-notice" role="note"><strong>Operational notice · {consent.version}</strong><p>{consent.notice}</p></div>
                        <label className="seller-payout-destination-consent">
                            <input type="checkbox" checked={consentAccepted} onChange={(event) => setConsentAccepted(event.target.checked)} />
                            <span>I have read and acknowledge this operational notice.</span>
                        </label>
                        <fieldset disabled={!consentAccepted || savingDestination || !policy.acknowledged}>
                            <legend>Destination details</legend>
                            <label>Destination type
                                <select value={destinationType} onChange={(event) => setDestinationType(event.target.value as DestinationType)}>
                                    <option value="BANK">Bank transfer</option>
                                    <option value="GCASH">GCash</option>
                                </select>
                            </label>
                            <label>Account holder name
                                <input value={accountHolder} onChange={(event) => setAccountHolder(event.target.value)} autoComplete="off" maxLength={120} required />
                            </label>
                            {destinationType === 'BANK' ? <>
                                <label>Bank name
                                    <input value={bankName} onChange={(event) => setBankName(event.target.value)} autoComplete="off" maxLength={100} required />
                                </label>
                                <label>Bank account number
                                    <input value={accountNumber} onChange={(event) => setAccountNumber(event.target.value)} autoComplete="off" inputMode="text" maxLength={40} required />
                                </label>
                            </> : <label>GCash mobile number
                                <input value={walletNumber} onChange={(event) => setWalletNumber(event.target.value)} autoComplete="off" inputMode="tel" maxLength={24} required />
                            </label>}
                            <label>Confirm with your current password
                                <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required />
                            </label>
                            <button className="seller-payout-destination-submit" type="submit" disabled={savingDestination}>
                                {savingDestination ? 'Saving…' : destination ? 'Save and request verification' : 'Save destination'}
                            </button>
                        </fieldset>
                    </form>}
                    {saveMessage && <p className="seller-payout-save-message" role="status">{saveMessage}</p>}
                </>}
            </section>
        </section>
        <section className="seller-payout-history" aria-labelledby="seller-payout-history-title">
            <div className="seller-work-heading"><div className="seller-payout-section-title"><span><PayoutIcon name="calendar" /></span><div><p className="eyebrow">Transfer records</p><h3 id="seller-payout-history-title">Payout history</h3></div></div></div>
            <div className="seller-payout-history-controls">
                <label className="seller-payout-search"><span><PayoutIcon name="search" />Search by order reference</span><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search reference" /></label>
                <label><span><PayoutIcon name="filter" />Status</span><select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}>
                    <option value="">All statuses</option>
                    <option value="PENDING_SETUP">Pending setup</option><option value="PENDING">Pending</option><option value="PROCESSING">Processing</option><option value="FAILED">Failed</option><option value="PAID">Paid</option><option value="RETURNED">Returned</option><option value="DISPUTED">Disputed</option>
                </select></label>
                <label><span><PayoutIcon name="sort" />Sort by</span><select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}>
                    <option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="amount_desc">Amount: high to low</option><option value="amount_asc">Amount: low to high</option>
                </select></label>
            </div>
            {loading ? <LoadingSkeleton variant="list" count={3} label="Loading seller payout history" />
                : payoutError ? <div className="seller-payout-error" role="alert"><p>{payoutError}</p><button className="seller-payout-details-button" type="button" onClick={() => setRetryCount((count) => count + 1)}>Retry</button></div>
                : !payouts?.data.length ? <p className="seller-empty">{search || statusFilter ? 'No payouts match these filters.' : 'No payouts have been recorded for your account.'}</p>
                    : <>
                        <p className="seller-payout-result-count" aria-live="polite">Showing {payouts.from ?? 0}–{payouts.to ?? 0} of {payouts.total} payouts</p>
                        <div className="data-table-wrap seller-payout-table-wrap"><table className="data-table seller-payout-table">
                            <thead><tr><th>Reference</th><th>Date</th><th>Amount</th><th>Method</th><th>Status</th><th>Action</th></tr></thead>
                            <tbody>{payouts.data.map((payout) => <React.Fragment key={payout.id}>
                                <tr>
                                    <td>{payout.order?.order_reference ?? 'Payout record'}</td>
                                    <td><span className="seller-payout-value-with-icon"><PayoutIcon name="calendar" />{new Date(payout.created_at).toLocaleDateString()}</span></td>
                                    <td>PHP {(payout.amount_cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                    <td><span className="seller-payout-value-with-icon"><PayoutIcon name="bank" />{payout.method.replaceAll('_', ' ')}</span></td>
                                    <td><span className="seller-payout-status"><PayoutIcon name="shield" /><span className="status-pill" data-status={payout.status.toLowerCase()}>{payout.status === 'PAID' ? 'Externally marked paid' : payout.status === 'PROCESSING' ? 'Processing reported' : payout.status.replaceAll('_', ' ')}</span></span></td>
                                    <td><button className="seller-payout-details-button" type="button" aria-expanded={expandedPayoutId === payout.id} onClick={() => setExpandedPayoutId(expandedPayoutId === payout.id ? null : payout.id)}>{expandedPayoutId === payout.id ? 'Hide details' : 'View details'}</button></td>
                                </tr>
                                {expandedPayoutId === payout.id && <tr className="seller-payout-detail-row"><td colSpan={6}>
                                    <div className="seller-payout-detail-grid">
                                        <p><strong>Order reference</strong><span>{payout.order?.order_reference ?? 'Not available'}</span></p>
                                        <p><strong>Recorded date</strong><span>{new Date(payout.created_at).toLocaleString()}</span></p>
                                        <p><strong>Status</strong><span>{payout.status.replaceAll('_', ' ')}</span></p>
                                        <p><strong>External transfer date</strong><span>{payout.paid_at ? new Date(payout.paid_at).toLocaleString() : 'Not recorded'}</span></p>
                                        {payout.provider_status && <p><strong>Reported channel status</strong><span>{payout.provider_status}</span></p>}
                                        {payout.receipt_url && <p><strong>Receipt</strong><a href={payout.receipt_url} target="_blank" rel="noreferrer">View secure receipt</a></p>}
                                    </div>
                                </td></tr>}
                            </React.Fragment>)}</tbody>
                        </table></div>
                        <div className="seller-payout-mobile-list">
                            {payouts.data.map((payout) => <article className="seller-payout-mobile-card" key={payout.id}>
                                <div className="seller-payout-mobile-card-heading"><span className="seller-payout-mobile-reference">{payout.order?.order_reference ?? 'Payout record'}</span><span className="seller-payout-status"><PayoutIcon name="shield" /><span className="status-pill" data-status={payout.status.toLowerCase()}>{payout.status === 'PAID' ? 'Externally marked paid' : payout.status === 'PROCESSING' ? 'Processing reported' : payout.status.replaceAll('_', ' ')}</span></span></div>
                                <div className="seller-payout-mobile-card-values">
                                    <p><span><PayoutIcon name="calendar" />Date</span><strong>{new Date(payout.created_at).toLocaleDateString()}</strong></p>
                                    <p><span><PayoutIcon name="receipt" />Amount</span><strong>PHP {(payout.amount_cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></p>
                                    <p><span><PayoutIcon name="bank" />Method</span><strong>{payout.method.replaceAll('_', ' ')}</strong></p>
                                </div>
                                <button className="seller-payout-details-button" type="button" aria-expanded={expandedPayoutId === payout.id} onClick={() => setExpandedPayoutId(expandedPayoutId === payout.id ? null : payout.id)}>{expandedPayoutId === payout.id ? 'Hide details' : 'View details'}</button>
                                {expandedPayoutId === payout.id && <div className="seller-payout-mobile-details">
                                    <p><strong>External transfer date:</strong> {payout.paid_at ? new Date(payout.paid_at).toLocaleString() : 'Not recorded'}</p>
                                    {payout.provider_status && <p><strong>Reported channel status:</strong> {payout.provider_status}</p>}
                                    {payout.receipt_url && <a href={payout.receipt_url} target="_blank" rel="noreferrer">View secure receipt</a>}
                                </div>}
                            </article>)}
                        </div>
                    </>}
        </section>
        {payouts && payouts.last_page > 1 && <Pagination page={payouts.current_page} lastPage={payouts.last_page} onChange={setPage} />}
    </section>;
}
