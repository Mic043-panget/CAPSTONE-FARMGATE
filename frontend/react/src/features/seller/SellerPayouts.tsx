import React from 'react';
import api from '../../lib/api';
import { LoadingSkeleton } from '../../shared/components/LoadingSkeleton';
import { Pagination } from '../../shared/components/Pagination';

type Payout = {
    id: number;
    amount_cents: number;
    method: string;
    external_reference: string | null;
    status: string;
    paid_at: string | null;
    provider_status: string | null;
    receipt_url: string | null;
    order?: { order_reference: string };
};
type PayoutPage = { data: Payout[]; current_page: number; last_page: number };
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

export function SellerPayouts({ onError }: { onError: (message: string) => void }) {
    const [payouts, setPayouts] = React.useState<PayoutPage | null>(null);
    const [destination, setDestination] = React.useState<Destination | null>(null);
    const [consent, setConsent] = React.useState<DestinationConsent | null>(null);
    const [policy, setPolicy] = React.useState<SellerPayoutPolicy | null>(null);
    const [policyMessage, setPolicyMessage] = React.useState('');
    const [page, setPage] = React.useState(1);
    const [loading, setLoading] = React.useState(true);
    const [destinationLoading, setDestinationLoading] = React.useState(true);
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
        api.get<{ payouts: PayoutPage }>(`/api/seller/payouts?page=${page}`)
            .then((response) => { if (active) setPayouts(response.data.payouts); })
            .catch((error: any) => { if (active) onError(error.userMessage ?? error.response?.data?.message ?? 'Payout history could not be loaded.'); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [page, onError]);

    React.useEffect(() => {
        let active = true;
        api.get<{ destination: Destination | null; consent: DestinationConsent }>('/api/seller/payout-destination')
            .then((response) => {
                if (!active) return;
                setDestination(response.data.destination);
                setConsent(response.data.consent);
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
            setAccountHolder('');
            setBankName('');
            setAccountNumber('');
            setWalletNumber('');
            setCurrentPassword('');
            setConsentAccepted(false);
            setSaveMessage(response.data.message);
        } catch (error: any) {
            onError(error.userMessage ?? error.response?.data?.message ?? 'Payout destination could not be saved.');
        } finally {
            setSavingDestination(false);
        }
    }

    return <section className="seller-work-section seller-payouts-page" aria-labelledby="seller-payouts-title">
        <div className="seller-work-heading"><div><p className="eyebrow">COD remittance ledger</p><h2 id="seller-payouts-title">Seller payouts</h2></div></div>
        <p className="seller-payouts-intro">Farmgate records externally completed payouts after COD remittance reconciliation. Recording a payout does not mean Farmgate sent the transfer.</p>
        <section className="seller-payout-policy" aria-labelledby="seller-payout-policy-title">
            {policyLoading ? <LoadingSkeleton variant="list" count={1} label="Loading seller payout policy" /> : policy ? <details className="seller-payout-policy-details" open={!policy.acknowledged}>
                <summary aria-controls={`seller-payout-policy-content-${policy.id}`}>
                    <span className="seller-payout-policy-summary-title"><span className="eyebrow">Policy review</span><h3 id="seller-payout-policy-title">Seller payout policy</h3></span>
                    <span className="seller-payout-policy-meta"><strong>Version {policy.version}</strong><span>Effective {new Date(`${policy.effective_date}T00:00:00`).toLocaleDateString()}</span><span className="status-pill">{policy.acknowledged ? 'Acknowledged' : 'Review required'}</span></span>
                    <span className="seller-payout-policy-toggle" aria-hidden="true"></span>
                </summary>
                <div className="seller-payout-policy-content" id={`seller-payout-policy-content-${policy.id}`}>
                    <pre className="seller-payout-policy-text">{policy.policy_text}</pre>
                    {policy.supporting_document_url && <a href={policy.supporting_document_url} target="_blank" rel="noreferrer">View supporting policy document</a>}
                    {policy.acknowledged
                        ? <p role="status">Acknowledged{policy.acknowledged_at ? ` on ${new Date(policy.acknowledged_at).toLocaleString()}` : ''}. Policy acknowledgment is required before payout details can be added or used.</p>
                        : <div className="seller-payout-policy-ack">
                            <label className="seller-payout-destination-consent"><input type="checkbox" checked={policyAcknowledged} onChange={(event) => setPolicyAcknowledged(event.target.checked)} /><span>I have reviewed and acknowledge seller payout policy version {policy.version}.</span></label>
                            <button className="seller-payout-destination-submit" type="button" disabled={!policyAcknowledged || acknowledgingPolicy} onClick={() => void acknowledgePolicy()}>{acknowledgingPolicy ? 'Saving acknowledgment…' : 'Acknowledge policy'}</button>
                        </div>}
                </div>
            </details> : <p className="seller-empty">{policyMessage || 'Payout details are unavailable until an effective payout policy is published.'}</p>}
        </section>
        <section className="seller-payout-destination seller-payout-panel" aria-labelledby="payout-destination-title">
            <div className="seller-work-heading"><div><p className="eyebrow">Destination setup</p><h3 id="payout-destination-title">Payout destination</h3></div></div>
            {destinationLoading ? <LoadingSkeleton variant="list" count={1} label="Loading payout destination" /> : <>
                {destination && <div className="seller-payout-destination-summary" aria-live="polite">
                    <p><strong>Verification status:</strong> <span className="status-pill">{destination.status.replaceAll('_', ' ')}</span></p>
                    <p><strong>Destination:</strong> {destination.destination_type === 'BANK' ? 'Bank transfer' : 'GCash'}</p>
                    <p><strong>Account holder:</strong> {destination.account_holder_masked}</p>
                    {destination.destination_type === 'BANK'
                        ? <><p><strong>Bank:</strong> {destination.bank_name_masked}</p><p><strong>Account:</strong> {destination.account_number_masked}</p></>
                        : <p><strong>GCash number:</strong> {destination.wallet_number_masked}</p>}
                    <p>Only masked details are shown. Replacing the destination submits it for administrator verification again.</p>
                </div>}
                {consent && policy?.acknowledged && <form className="seller-payout-destination-form" onSubmit={saveDestination}>
                    <div className="seller-payout-destination-notice" role="note">
                        <strong>Operational notice · {consent.version}</strong>
                        <p>{consent.notice}</p>
                    </div>
                    <label className="seller-payout-destination-consent">
                        <input type="checkbox" checked={consentAccepted} onChange={(event) => setConsentAccepted(event.target.checked)} />
                        <span>I have read and acknowledge this operational notice.</span>
                    </label>
                    <fieldset disabled={!consentAccepted || savingDestination || !policy?.acknowledged}>
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
                    {saveMessage && <p role="status">{saveMessage}</p>}
                </form>}
                {!policyLoading && policy && !policy.acknowledged && <p className="seller-empty">Acknowledge the effective payout policy above before adding or using payout details.</p>}
            </>}
        </section>
        <section className="seller-payout-history" aria-labelledby="seller-payout-history-title">
            <div className="seller-work-heading"><div><p className="eyebrow">Transfer records</p><h3 id="seller-payout-history-title">Payout history</h3></div></div>
            {loading ? <LoadingSkeleton variant="list" count={3} label="Loading seller payout history" />
                : !payouts?.data.length ? <p className="seller-empty">No payouts have been recorded for your account.</p>
                    : <div className="data-table-wrap"><table className="data-table">
                    <thead><tr><th>Order</th><th>Amount</th><th>Destination type</th><th>External transfer reference</th><th>Status</th><th>External transfer date</th><th>Receipt</th></tr></thead>
                    <tbody>{payouts.data.map((payout) => <tr key={payout.id}>
                        <td>{payout.order?.order_reference ?? 'Order'}</td>
                        <td>PHP {(payout.amount_cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td>{payout.method.replaceAll('_', ' ')}</td>
                        <td>{payout.external_reference ?? '—'}</td>
                        <td><span className="status-pill">{payout.status === 'PAID' ? 'External transfer recorded' : payout.status === 'PROCESSING' ? 'External process reported' : payout.status.replaceAll('_', ' ')}</span>{['PAID', 'PROCESSING'].includes(payout.status) && <small>Farmgate records the external status and does not initiate the transfer.</small>}{payout.provider_status && <small>{payout.provider_status}</small>}</td>
                        <td>{payout.paid_at ? new Date(payout.paid_at).toLocaleString() : 'Not paid'}</td>
                        <td>{payout.receipt_url ? <a href={payout.receipt_url} target="_blank" rel="noreferrer">View private receipt</a> : '—'}</td>
                    </tr>)}</tbody>
                </table></div>}
        </section>
        {payouts && payouts.last_page > 1 && <Pagination page={payouts.current_page} lastPage={payouts.last_page} onChange={setPage} />}
    </section>;
}
