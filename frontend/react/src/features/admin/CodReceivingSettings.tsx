import React from 'react';
import api from '../../lib/api';
import { confirmAction } from '../../lib/alerts';
import { Pagination } from '../../shared/components/Pagination';

type ReceivingMethod = {
    id: number;
    method_type: string;
    label: string;
    instructions: string;
    account_holder_masked: string | null;
    bank_name: string | null;
    account_number_masked: string | null;
    qr_url: string | null;
    status: string;
    configured_by: number;
    verified_by: number | null;
    verification_reason: string | null;
    histories?: { action: string; actor?: { name: string }; reason?: string; created_at: string }[];
};
type Destination = {
    id: number;
    destination_type: string;
    account_holder_masked: string;
    bank_name_masked: string | null;
    account_number_masked: string | null;
    wallet_number_masked: string | null;
    status: string;
    consent_version: string;
    consent_accepted_at: string;
    seller?: { id: number; name: string };
    effective_policy_version: string | null;
    effective_policy_acknowledged: boolean;
    effective_policy_acknowledged_at: string | null;
    submitted_at: string;
    verified_at: string | null;
    verified_by_name: string | null;
    verification_history: { action: string; actor: string | null; reason: string | null; created_at: string }[];
};
type Summary = {
    receiving_methods: { active_bank: number; active_qr: number; pending_verification: number };
    seller_destinations: { verified: number; pending_verification: number };
    manual_seller_payouts_enabled: boolean;
    payment_providers: {
        paymongo: {
            credentials_configured: boolean;
            test_mode_credentials: boolean;
            webhook_signing_configured: boolean;
            configuration_verified: boolean;
            qr_receiving_ready: boolean;
            seller_payouts_enabled: boolean;
            seller_payouts_status: string;
        };
    };
    seller_payout_policy: { effective_policy_id: number | null; effective_version: string | null; effective_date: string | null; draft_count: number; approved_count: number; published_count: number };
    manual_payout_prerequisites: { destination_approval_active: boolean; verified_destination_count: number; unmet: string[] };
};
type DestinationPage = { data: Destination[]; current_page: number; last_page: number; total: number };
type SellerPayoutPolicy = {
    id: number;
    version: string;
    effective_date: string;
    policy_text: string;
    status: 'DRAFT' | 'APPROVED' | 'PUBLISHED';
    has_supporting_document: boolean;
    supporting_document_url: string | null;
    created_at: string;
    approved_at: string | null;
    published_at: string | null;
    approval_reason: string | null;
    publication_reason: string | null;
    amendment_reason: string | null;
    based_on: { id: number; version: string; policy_text: string | null } | null;
    creator?: { name: string };
    approver?: { name: string } | null;
    publisher?: { name: string } | null;
    is_effective?: boolean;
};
type PayoutPolicyPage = { data: SellerPayoutPolicy[]; current_page: number; last_page: number; total: number };
const POLICY_SECTIONS = [
    { key: 'eligibility', label: 'Payout eligibility', guidance: 'State when an order and seller qualify. Current workflow facts to validate: completed COD order, payment reconciled, manual payouts enabled, effective policy acknowledged, and seller destination verified.' },
    { key: 'calculation', label: 'Payout calculation', guidance: 'State the approved calculation, including how discounts and the order fee snapshot apply. Current code computes merchandise subtotal minus the seller_fee recorded for that order.' },
    { key: 'timing', label: 'Payout timing', guidance: 'Preserve the approved weekend processing schedule with no cutoff. External settlement is not guaranteed during weekends; pending remains pending until confirmation.' },
    { key: 'destination_requirements', label: 'Payout destination requirements', guidance: 'State the actual supported destination and verification requirements. Current setup supports bank and GCash details, seller password confirmation, and admin review.' },
    { key: 'fees', label: 'Applicable fees', guidance: 'State which fees apply and how they are disclosed. The seller_fee is snapshotted per order from the configured seller_fee_rate; no approved fee policy document was found.' },
    { key: 'failed_returned', label: 'Failed or returned payouts', guidance: 'No approved failed/returned payout terms were found. Supply the actual handling, status and seller notification process.' },
    { key: 'dispute_corrections', label: 'Disputes and corrections', guidance: 'State the actual dispute, correction and reversal process, including required reasons and records. Current code requires admin reasons and retains audit history.' },
] as const;
type PolicySectionKey = typeof POLICY_SECTIONS[number]['key'];
type PolicySections = Record<PolicySectionKey, string>;
const EMPTY_POLICY_SECTIONS: PolicySections = {
    eligibility: '',
    calculation: '',
    timing: '',
    destination_requirements: '',
    fees: '',
    failed_returned: '',
    dispute_corrections: '',
};
const APPROVED_POLICY_SECTIONS: PolicySections = {
    eligibility: `An order may be included in a seller payout only when it is eligible under Farmgate’s order rules, the buyer’s payment has cleared or COD remittance has been reconciled and confirmed, the seller has acknowledged the effective policy and has an approved payout destination, and no unresolved refund, return, complaint, payment dispute, or other documented hold applies to the amount. Delivery completion alone does not mean payment has been received or a payout has been sent.`,
    calculation: `Farmgate’s current seller fee is 0%. The saved per-order seller_fee is authoritative; historical fees are not recalculated using current settings. Seller payout = saved product subtotal − saved seller_fee. Seller-funded discounts affect payout only to the extent already reflected in the saved product subtotal; the same discount is not deducted twice. The application does not persist or calculate separate seller credits, discretionary adjustments, or other deductions, and this policy does not promise them. Delivery fees are separate from product subtotal and excluded; they are neither added to nor deducted from this seller payout calculation.`,
    timing: `Farmgate processes eligible payout records on weekends (Saturday and Sunday), with no cutoff. This is a processing schedule, not a promise that an external bank or payment rail settles during weekends. A payout remains pending until the external transfer is confirmed and recorded by an authorized admin or, if a verified provider integration is later configured, until successful provider confirmation.`,
    destination_requirements: `Farmgate pays only to a payout destination verified for the seller. The seller must review and acknowledge the effective policy before setup. A submitted or changed destination remains pending until an authorized administrator verifies it. Supported seller destination forms currently include bank and GCash details; payout access is limited to the seller and authorized payout personnel, and the application masks the details.`,
    fees: `The current configured seller fee rate is 0%. Each order’s saved seller_fee is authoritative; for orders covered by the current setting it should be PHP 0.00 unless the saved order records otherwise. The applicable fee schedule and delivery-fee treatment are disclosed here. No new or undisclosed fee is applied to an existing order after checkout.`,
    failed_returned: `Farmgate does not currently have a configured and verified automated PayMongo seller payout integration. PayMongo payouts must not be represented as active until the actual account capability and integration are configured and verified. For a manual external transfer, an authorized administrator records it as paid only after confirming the transfer completed outside Farmgate and recording the external reference, amount, and date; a private receipt is optional. Failed, returned, or unverified transfers remain unpaid or need review; an administrator documents the outcome and notifies the seller without exposing full destination details.`,
    dispute_corrections: `Sellers may report a missing, delayed, incorrect, failed, or returned payout through Farmgate support. Farmgate reviews the payout record and available evidence, communicates the outcome, and documents any correction. An administrator must provide a reason for a status correction or override, and original transaction history must be preserved. The application does not calculate or record separate seller credits, discretionary amount adjustments, or additional deductions. Holds are limited to amounts reasonably related to an unresolved refund, return, complaint, reversal, suspected error, or legal requirement; unaffected amounts may continue where the system supports it.`,
};
function changedPolicySections(baseText: string, amendmentText: string): { label: string; previous: string; amended: string }[] {
    const base = parsePolicySections(baseText);
    const amendment = parsePolicySections(amendmentText);
    return POLICY_SECTIONS
        .filter(({ key }) => base[key].trim() !== amendment[key].trim())
        .map(({ key, label }) => ({ label, previous: base[key], amended: amendment[key] }));
}
function compilePolicyText(sections: PolicySections): string {
    return POLICY_SECTIONS.map(({ key, label }) => `${label}\n${sections[key].trim()}`).join('\n\n');
}

function parsePolicySections(text: string): PolicySections {
    const result = { ...EMPTY_POLICY_SECTIONS };
    let activeKey: PolicySectionKey | null = null;
    for (const line of text.split(/\r?\n/)) {
        const section = POLICY_SECTIONS.find((candidate) => candidate.label === line.trim());
        if (section) {
            activeKey = section.key;
        } else if (activeKey) {
            result[activeKey] = `${result[activeKey]}${result[activeKey] ? '\n' : ''}${line}`.trim();
        }
    }
    return result;
}
function missingPolicySections(sections: PolicySections): string[] {
    return POLICY_SECTIONS
        .filter(({ key }) => sections[key].trim().length < 20 || /\b(todo|tbd|placeholder|to be determined|fill in|not specified)\b|\[[^\]]+\]/i.test(sections[key]))
        .map(({ label }) => label);
}
function isCanonicalPolicyText(text: string): boolean {
    const sections = parsePolicySections(text);
    const normalizeLineEndings = (value: string) => value.replace(/\r\n?/g, '\n').trim();
    return missingPolicySections(sections).length === 0
        && normalizeLineEndings(compilePolicyText(sections)) === normalizeLineEndings(text);
}

export function CodReceivingSettings({
    onError,
    onOpenSystemSettings,
}: {
    onError: (message: string) => void;
    onOpenSystemSettings: () => void;
}) {
    const [methods, setMethods] = React.useState<ReceivingMethod[]>([]);
    const [destinations, setDestinations] = React.useState<DestinationPage | null>(null);
    const [summary, setSummary] = React.useState<Summary | null>(null);
    const [policies, setPolicies] = React.useState<PayoutPolicyPage | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [busy, setBusy] = React.useState(false);
    const [currentAdminId, setCurrentAdminId] = React.useState<number | null>(null);
    const [destinationPage, setDestinationPage] = React.useState(1);
    const [policyPage, setPolicyPage] = React.useState(1);
    const [methodType, setMethodType] = React.useState<'BANK_TRANSFER' | 'BANK_QR' | 'PAYMONGO_QR'>('BANK_TRANSFER');
    const [label, setLabel] = React.useState('');
    const [instructions, setInstructions] = React.useState('');
    const [accountHolder, setAccountHolder] = React.useState('');
    const [bankName, setBankName] = React.useState('');
    const [accountNumber, setAccountNumber] = React.useState('');
    const [qr, setQr] = React.useState<File | null>(null);
    const [verificationReason, setVerificationReason] = React.useState<Record<number, string>>({});
    const [confirmation, setConfirmation] = React.useState<Record<number, boolean>>({});
    const [message, setMessage] = React.useState('');
    const [policyVersion, setPolicyVersion] = React.useState('');
    const [policyEffectiveDate, setPolicyEffectiveDate] = React.useState('');
    const [policySections, setPolicySections] = React.useState<PolicySections>({ ...EMPTY_POLICY_SECTIONS });
    const [editingPolicyId, setEditingPolicyId] = React.useState<number | null>(null);
    const [amendmentBasePolicyId, setAmendmentBasePolicyId] = React.useState<number | null>(null);
    const [amendmentReason, setAmendmentReason] = React.useState('');
    const [policyReasons, setPolicyReasons] = React.useState<Record<number, string>>({});
    const [policyConfirmations, setPolicyConfirmations] = React.useState<Record<number, boolean>>({});
    const [payoutSettingReason, setPayoutSettingReason] = React.useState('');

    const refresh = React.useCallback(async () => {
        setLoading(true);
        try {
            const [methodsResponse, userResponse, summaryResponse, destinationResponse, policyResponse] = await Promise.all([
                api.get<{ methods: ReceivingMethod[] }>('/api/admin/cod/receiving-methods'),
                api.get<{ user: { id: number } }>('/api/auth/user'),
                api.get<Summary>('/api/admin/cod/summary'),
                api.get<{ destinations: DestinationPage }>(`/api/admin/seller-payout-destinations?page=${destinationPage}`),
                api.get<{ policies: PayoutPolicyPage }>(`/api/admin/seller-payout-policies?page=${policyPage}`),
            ]);
            setMethods(methodsResponse.data.methods);
            setCurrentAdminId(userResponse.data.user.id);
            setSummary(summaryResponse.data);
            setDestinations(destinationResponse.data.destinations);
            setPolicies(policyResponse.data.policies);
        } catch (error: any) {
            onError(error.userMessage ?? error.response?.data?.message ?? 'Payment settings could not be loaded.');
        } finally {
            setLoading(false);
        }
    }, [destinationPage, onError, policyPage]);

    React.useEffect(() => { void refresh(); }, [refresh]);

    async function save(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setBusy(true);
        setMessage('');
        try {
            const data = new FormData();
            data.set('method_type', methodType);
            data.set('label', label.trim());
            data.set('instructions', instructions.trim());
            data.set('account_holder', accountHolder.trim());
            data.set('bank_name', bankName.trim());
            data.set('account_number', accountNumber.trim());
            if (qr) data.set('qr', qr);
            const response = await api.post<{ message: string }>('/api/admin/cod/receiving-methods', data);
            setMessage(response.data.message);
            setLabel('');
            setInstructions('');
            setAccountHolder('');
            setBankName('');
            setAccountNumber('');
            setQr(null);
            await refresh();
        } catch (error: any) {
            onError(error.userMessage ?? error.response?.data?.message ?? 'Receiving method could not be saved.');
        } finally {
            setBusy(false);
        }
    }

    async function verifyMethod(method: ReceivingMethod) {
        const reason = verificationReason[method.id]?.trim() ?? '';
        if (!confirmation[method.id] || reason.length < 12) {
            onError('Confirm the destination is receive-only and enter how you verified that it belongs to Farmgate.');
            return;
        }
        setBusy(true);
        try {
            await api.post(`/api/admin/cod/receiving-methods/${method.id}/verify`, { reason, receiving_only_confirmed: true });
            await refresh();
        } catch (error: any) {
            onError(error.userMessage ?? error.response?.data?.message ?? 'Receiving method could not be verified.');
        } finally {
            setBusy(false);
        }
    }

    async function updateMethod(method: ReceivingMethod, data: FormData) {
        setBusy(true);
        setMessage('');
        try {
            const response = await api.put<{ message: string }>(`/api/admin/cod/receiving-methods/${method.id}`, data);
            setMessage(response.data.message);
            await refresh();
        } catch (error: any) {
            onError(error.userMessage ?? error.response?.data?.message ?? 'Receiving method could not be updated.');
        } finally {
            setBusy(false);
        }
    }

    async function deactivateMethod(method: ReceivingMethod) {
        const reason = verificationReason[method.id]?.trim() ?? '';
        if (reason.length < 8) {
            onError('Enter a reason of at least eight characters before disabling this method.');
            return;
        }
        setBusy(true);
        try {
            await api.post(`/api/admin/cod/receiving-methods/${method.id}/deactivate`, { reason });
            await refresh();
        } catch (error: any) {
            onError(error.userMessage ?? error.response?.data?.message ?? 'Receiving method could not be disabled.');
        } finally {
            setBusy(false);
        }
    }

    async function enableMethod(method: ReceivingMethod) {
        const reason = verificationReason[method.id]?.trim() ?? '';
        if (reason.length < 8) {
            onError('Enter a reason of at least eight characters before requesting reactivation.');
            return;
        }
        setBusy(true);
        try {
            await api.post(`/api/admin/cod/receiving-methods/${method.id}/enable`, { reason });
            await refresh();
        } catch (error: any) {
            onError(error.userMessage ?? error.response?.data?.message ?? 'Receiving method could not be re-enabled.');
        } finally {
            setBusy(false);
        }
    }

    async function decideDestination(destination: Destination, decision: 'verify' | 'reject') {
        const reason = verificationReason[destination.id]?.trim() ?? '';
        if (reason.length < 8) {
            onError('Enter a verification reason of at least eight characters.');
            return;
        }
        setBusy(true);
        try {
            await api.post(`/api/admin/seller-payout-destinations/${destination.id}/${decision}`, { reason });
            setMessage(decision === 'verify' ? 'Seller payout destination verified.' : 'Seller payout destination rejected.');
            await refresh();
        } catch (error: any) {
            onError(error.userMessage ?? error.response?.data?.message ?? 'Seller payout destination could not be updated.');
        } finally {
            setBusy(false);
        }
    }

    function editPolicy(policy: SellerPayoutPolicy) {
        setEditingPolicyId(policy.id);
        setAmendmentBasePolicyId(null);
        setPolicyVersion(policy.version);
        setPolicyEffectiveDate(policy.effective_date);
        setPolicySections(parsePolicySections(policy.policy_text));
    }

    function clearPolicyDraft() {
        setEditingPolicyId(null);
        setAmendmentBasePolicyId(null);
        setPolicyVersion('');
        setPolicyEffectiveDate('');
        setPolicySections({ ...EMPTY_POLICY_SECTIONS });
        setAmendmentReason('');
    }

    function startAmendment(base: SellerPayoutPolicy) {
        const numericVersion = base.version.match(/(\d+)\.(\d+)$/);
        const nextVersion = numericVersion ? `${numericVersion[1]}.${Number(numericVersion[2]) + 1}` : '1.1';
        setEditingPolicyId(null);
        setAmendmentBasePolicyId(base.id);
        setPolicyVersion(nextVersion);
        setPolicyEffectiveDate(new Date().toLocaleDateString('en-CA'));
        setPolicySections({ ...APPROVED_POLICY_SECTIONS });
        setPolicyConfirmations({});
        setAmendmentReason('Align the calculation and payout-status wording with the application’s saved order fee calculation and manual external transfer workflow.');
        setMessage(`Amendment draft based on version ${base.version}. The published version remains unchanged until version ${nextVersion} is approved and published.`);
    }

    async function savePolicy(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const missing = missingPolicySections(policySections);
        if (missing.length) {
            onError(`Complete these policy sections before saving the policy: ${missing.join('; ')}.`);
            return;
        }
        setBusy(true);
        setMessage('');
        try {
            let response: { data: { message: string; policy: SellerPayoutPolicy } };
            if (amendmentBasePolicyId && !editingPolicyId) {
                response = await api.post<{ message: string; policy: SellerPayoutPolicy }>(
                    `/api/admin/seller-payout-policies/${amendmentBasePolicyId}/amendments`,
                    {
                        version: policyVersion.trim(),
                        effective_date: policyEffectiveDate,
                        policy_sections: policySections,
                        amendment_reason: amendmentReason.trim(),
                    },
                );
            } else {
                const data = new FormData();
                data.set('version', policyVersion.trim());
                data.set('effective_date', policyEffectiveDate);
                data.set('policy_text', compilePolicyText(policySections));
                response = editingPolicyId
                    ? await api.post<{ message: string; policy: SellerPayoutPolicy }>(`/api/admin/seller-payout-policies/${editingPolicyId}/draft`, data)
                    : await api.post<{ message: string; policy: SellerPayoutPolicy }>('/api/admin/seller-payout-policies', data);
            }
            const policyId = response.data.policy.id;
            setEditingPolicyId(policyId);
            setMessage(response.data.message);
            clearPolicyDraft();
            await refresh();
        } catch (error: any) {
            onError(error.userMessage ?? error.response?.data?.message ?? 'Seller payout policy could not be saved.');
        } finally {
            setBusy(false);
        }
    }

    async function publishApprovedPolicy(policy: SellerPayoutPolicy) {
        const sections = parsePolicySections(policy.policy_text);
        const missing = missingPolicySections(sections);
        const reason = policyReasons[policy.id]?.trim() ?? '';
        if (missing.length) {
            onError(`This approved version is missing required terms: ${missing.join('; ')}. It cannot be published; create a complete amendment from the currently effective policy.`);
            return;
        }
        if (reason.length < 12) {
            onError('Enter a publication reason of at least twelve characters.');
            return;
        }
        if (!await confirmAction({
            title: `Publish seller payout policy ${policy.version}?`,
            text: 'Confirm that every section matches Farmgate’s actual approved payout process.',
            confirmText: 'Publish policy',
        })) return;

        setBusy(true);
        setMessage('');
        try {
            const response = await api.post<{ message: string }>(`/api/admin/seller-payout-policies/${policy.id}/publish`, {
                policy_sections: sections,
                confirmed_actual_terms: true,
                reason,
            });
            setPolicyReasons((current) => ({ ...current, [policy.id]: '' }));
            setPolicyConfirmations((current) => ({ ...current, [policy.id]: false }));
            setMessage(response.data.message);
            await refresh();
        } catch (error: any) {
            onError(error.userMessage ?? error.response?.data?.message ?? 'Seller payout policy could not be published.');
        } finally {
            setBusy(false);
        }
    }

    async function approveDraftPolicy(policy: SellerPayoutPolicy) {
        const sections = parsePolicySections(policy.policy_text);
        const reason = policyReasons[policy.id]?.trim() ?? '';
        if (missingPolicySections(sections).length || !policyConfirmations[policy.id]) {
            onError('Review the complete saved policy and confirm it accurately matches the supported payout behavior before approval.');
            return;
        }
        if (reason.length < 12) {
            onError('Enter an approval reason of at least twelve characters.');
            return;
        }
        if (!await confirmAction({
            title: `Approve payout policy ${policy.version}?`,
            text: 'Approval is attributed to your signed-in admin account. The current published version stays effective until this version is separately published.',
            confirmText: 'Approve policy',
        })) return;

        setBusy(true);
        try {
            const response = await api.post<{ message: string }>(`/api/admin/seller-payout-policies/${policy.id}/approve`, {
                policy_sections: sections,
                confirmed_actual_terms: true,
                reason,
            });
            setPolicyReasons((current) => ({ ...current, [policy.id]: '' }));
            setPolicyConfirmations((current) => ({ ...current, [policy.id]: false }));
            setMessage(response.data.message);
            await refresh();
        } catch (error: any) {
            onError(error.userMessage ?? error.response?.data?.message ?? 'Seller payout policy could not be approved.');
        } finally {
            setBusy(false);
        }
    }

    async function toggleManualPayouts() {
        const nextEnabled = !summary?.manual_seller_payouts_enabled;
        const reason = payoutSettingReason.trim();
        if (reason.length < 8) {
            onError('Enter an audit reason of at least eight characters to enable or disable manual payouts.');
            return;
        }
        if (!await confirmAction({
            title: nextEnabled ? 'Enable manual seller payouts?' : 'Disable manual seller payouts?',
            text: nextEnabled
                ? 'This allows authorized admins to record transfers only after they have been completed outside Farmgate.'
                : 'No new external payout records can be completed while this setting is disabled.',
            confirmText: nextEnabled ? 'Enable manual payouts' : 'Disable manual payouts',
            danger: !nextEnabled,
        })) return;

        setBusy(true);
        setMessage('');
        try {
            await api.put('/api/admin/settings/manual_seller_payouts_enabled', { value: nextEnabled, reason });
            setPayoutSettingReason('');
            setMessage(`Manual seller payout recording ${nextEnabled ? 'enabled' : 'disabled'} and audited.`);
            await refresh();
        } catch (error: any) {
            onError(error.userMessage ?? error.response?.data?.message ?? 'Manual payout setting could not be changed.');
        } finally {
            setBusy(false);
        }
    }

    const bankMethods = methods.filter((method) => method.method_type === 'BANK_TRANSFER');
    const qrMethods = methods.filter((method) => method.method_type === 'BANK_QR' || method.method_type === 'PAYMONGO_QR');

    return <section className="payments-settings-page" aria-labelledby="cod-receiving-settings-title">
        <div className="payments-page-heading">
            <div><p className="eyebrow">Admin · finance controls</p><h2 id="cod-receiving-settings-title">Payment and COD Settings</h2><p>Configure inbound methods and review seller payout destinations. This page does not initiate transfers.</p></div>
            <button type="button" className="seller-inline-action" onClick={() => void refresh()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
        </div>
        {message && <p className="payments-success" role="status">{message}</p>}
        {loading ? <p role="status">Loading payment configuration…</p> : <>
            <section className="payments-settings-card" aria-labelledby="payments-method-summary-title">
                <div className="payments-section-heading"><div><h3 id="payments-method-summary-title">Farmgate COD receiving</h3><p>Configure where riders send COD collections.</p></div></div>
                <div className="payments-configuration-grid">
                    <article><span>Active bank accounts</span><strong>{summary?.receiving_methods.active_bank ?? 0}</strong></article>
                    <article><span>Active bank QR codes</span><strong>{summary?.receiving_methods.active_qr ?? 0}</strong></article>
                    <article><span>Awaiting verification</span><strong>{summary?.receiving_methods.pending_verification ?? 0}</strong></article>
                </div>
                <details className="payments-provider-details">
                    <summary>PayMongo receiving setup · {summary?.payment_providers.paymongo.qr_receiving_ready ? 'Ready' : 'Setup required'}</summary>
                    <div className="payments-provider-status" role="status" aria-label="PayMongo configuration status">
                        <p>Server credentials <strong>{summary?.payment_providers.paymongo.credentials_configured ? 'Configured' : 'Missing'}</strong></p>
                        <p>Test-mode API key <strong>{summary?.payment_providers.paymongo.test_mode_credentials ? 'Valid test key' : 'Missing or not a test key'}</strong></p>
                        <p>Webhook secret <strong>{summary?.payment_providers.paymongo.webhook_signing_configured ? 'Configured' : 'Missing'}</strong></p>
                        <p>Provider account verification <strong>{summary?.payment_providers.paymongo.configuration_verified ? 'Complete' : 'Pending'}</strong></p>
                        <p className="payments-inline-note">Set PayMongo credentials on the server and verify the account before enabling its QR. Secrets are never shown here.</p>
                    </div>
                </details>
                <div className="payments-settings-subsection">
                    <h4>Bank accounts</h4>
                    {!bankMethods.length ? <p className="payments-inline-empty">No bank receiving method configured.</p> : bankMethods.map((method) => <ReceivingMethodCard key={method.id} method={method} currentAdminId={currentAdminId} busy={busy} reason={verificationReason[method.id] ?? ''} confirmed={confirmation[method.id] ?? false} setReason={(reason) => setVerificationReason((current) => ({ ...current, [method.id]: reason }))} setConfirmed={(checked) => setConfirmation((current) => ({ ...current, [method.id]: checked }))} onVerify={() => void verifyMethod(method)} onDeactivate={() => void deactivateMethod(method)} onEnable={() => void enableMethod(method)} onUpdate={(data) => void updateMethod(method, data)} />)}
                </div>
                <div className="payments-settings-subsection">
                    <h4>Receiving QR codes</h4>
                    <p className="payments-inline-note">Upload a bank receive-money QR or a configured PayMongo receiving QR. Riders enter the exact amount; Farmgate verifies receipt manually.</p>
                    {!qrMethods.length ? <p className="payments-inline-empty">No receive-only QR method configured.</p> : qrMethods.map((method) => <ReceivingMethodCard key={method.id} method={method} currentAdminId={currentAdminId} busy={busy} reason={verificationReason[method.id] ?? ''} confirmed={confirmation[method.id] ?? false} setReason={(reason) => setVerificationReason((current) => ({ ...current, [method.id]: reason }))} setConfirmed={(checked) => setConfirmation((current) => ({ ...current, [method.id]: checked }))} onVerify={() => void verifyMethod(method)} onDeactivate={() => void deactivateMethod(method)} onEnable={() => void enableMethod(method)} onUpdate={(data) => void updateMethod(method, data)} />)}
                </div>
                <details className="payments-configure-method">
                    <summary>Add receiving method</summary>
                    <form className="cod-receiving-form seller-account-form" onSubmit={(event) => void save(event)}>
                        <label>Receiving type<select value={methodType} onChange={(event) => setMethodType(event.target.value as 'BANK_TRANSFER' | 'BANK_QR' | 'PAYMONGO_QR')}><option value="BANK_TRANSFER">Bank account</option><option value="BANK_QR">Online banking QR</option><option value="PAYMONGO_QR">PayMongo receiving QR</option></select></label>
                        <label>Display label<input required maxLength={100} value={label} onChange={(event) => setLabel(event.target.value)} /></label>
                        <label>Rider instructions<textarea required maxLength={1000} value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label>
                        <label>Farmgate account holder<input required maxLength={120} value={accountHolder} onChange={(event) => setAccountHolder(event.target.value)} /></label>
                        <label>Bank or receiving institution<input required maxLength={100} value={bankName} onChange={(event) => setBankName(event.target.value)} /></label>
                        <label>Receiving account identifier<input required minLength={5} maxLength={40} autoComplete="off" value={accountNumber} onChange={(event) => setAccountNumber(event.target.value)} /></label>
                        {(methodType === 'BANK_QR' || methodType === 'PAYMONGO_QR') && <label>{methodType === 'PAYMONGO_QR' ? 'PayMongo receiving QR' : 'Bank receive-money QR'}<input required type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setQr(event.target.files?.[0] ?? null)} /></label>}
                        <p className="cod-receiving-form-note">New methods stay pending until another admin verifies them.</p>
                        <button className="seller-inline-action" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save inactive receiving method'}</button>
                    </form>
                </details>
            </section>

            <section className="payments-settings-card" aria-labelledby="seller-payout-policy-title">
                <div className="payments-section-heading"><div><h3 id="seller-payout-policy-title">Seller Payout Policy</h3><p>Initial policy terms must be entered by an authorized admin. Amendment drafts show the proposed terms beside the currently effective version; approval and publication remain separate audited actions.</p></div></div>
                <div className="payments-configuration-grid">
                    <article><span>Draft versions</span><strong>{summary?.seller_payout_policy.draft_count ?? 0}</strong></article>
                    <article><span>Approved, not published</span><strong>{summary?.seller_payout_policy.approved_count ?? 0}</strong></article>
                    <article><span>Published versions</span><strong>{summary?.seller_payout_policy.published_count ?? 0}</strong></article>
                    <article><span>Effective policy</span><strong>{summary?.seller_payout_policy.effective_version ?? 'None'}</strong></article>
                </div>
                {!policies?.data.length ? <p className="payments-inline-empty">No seller payout policy versions are stored. No version is created or published automatically. An authorized admin must enter and approve the actual current policy before an amendment can be based on it.</p> : <div className="payments-policy-list">
                    {policies.data.map((policy) => <article className="payments-policy-card" key={policy.id}>
                        <div className="payments-section-heading"><div><h4>Version {policy.version}</h4><span className={`status-pill ${policy.is_effective ? 'status-active' : ''}`}>{policy.is_effective ? 'Effective' : policy.status.replaceAll('_', ' ')}</span></div><span>Effective {new Date(`${policy.effective_date}T00:00:00`).toLocaleDateString()}</span></div>
                        {policy.based_on && <div className="payments-policy-comparison">
                            <strong>Amendment based on version {policy.based_on.version}</strong>
                            <p>{policy.amendment_reason}</p>
                            <details><summary>Compare changed terms</summary>
                                {changedPolicySections(policy.based_on.policy_text ?? '', policy.policy_text).map((change) => <section key={change.label}>
                                    <h5>{change.label}</h5><div><strong>Previous term</strong><p>{change.previous || 'No matching section in the source version.'}</p></div><div><strong>Amendment</strong><p>{change.amended}</p></div>
                                </section>)}
                            </details>
                        </div>}
                        <details><summary>Review policy text</summary><pre>{policy.policy_text}</pre></details>
                        {policy.supporting_document_url && <a href={policy.supporting_document_url} target="_blank" rel="noreferrer">View private supporting document</a>}
                        {!policy.supporting_document_url && <p className="payments-inline-note">The policy text is the approved source; no separate attachment is required.</p>}
                        <p className="payments-policy-audit">Created by {policy.creator?.name ?? 'Admin'} · {new Date(policy.created_at).toLocaleString()}</p>
                        {policy.approved_at && <p className="payments-policy-audit">Approved by {policy.approver?.name ?? 'Admin'} · {new Date(policy.approved_at).toLocaleString()} · {policy.approval_reason}</p>}
                        {policy.published_at && <p className="payments-policy-audit">Published by {policy.publisher?.name ?? 'Admin'} · {new Date(policy.published_at).toLocaleString()} · {policy.publication_reason}</p>}
                        {policy.status === 'DRAFT' && <div className="payments-policy-actions">
                            <button className="payments-text-button" type="button" disabled={busy} onClick={() => editPolicy(policy)}>Edit draft</button>
                            {!isCanonicalPolicyText(policy.policy_text) && <p className="payments-inline-note">This saved draft needs normalization before approval. Edit it, review each required section, save the draft, then approve the saved version.</p>}
                            <label>Approval reason<input maxLength={500} value={policyReasons[policy.id] ?? ''} onChange={(event) => setPolicyReasons((current) => ({ ...current, [policy.id]: event.target.value }))} placeholder="Required and recorded with the authenticated approver." /></label>
                            <label className="payments-policy-confirmation"><input type="checkbox" checked={policyConfirmations[policy.id] ?? false} onChange={(event) => setPolicyConfirmations((current) => ({ ...current, [policy.id]: event.target.checked }))} /><span>I reviewed this saved version and confirm it matches Farmgate’s supported payout calculation and approved terms.</span></label>
                            <button className="seller-inline-action" type="button" disabled={busy || !isCanonicalPolicyText(policy.policy_text) || !policyConfirmations[policy.id] || (policyReasons[policy.id]?.trim().length ?? 0) < 12} onClick={() => void approveDraftPolicy(policy)}>Approve this version</button>
                        </div>}
                        {policy.status === 'APPROVED' && <div className="payments-policy-actions">
                            <label>Publication reason<input maxLength={500} value={policyReasons[policy.id] ?? ''} onChange={(event) => setPolicyReasons((current) => ({ ...current, [policy.id]: event.target.value }))} /></label>
                            <button className="seller-inline-action" type="button" disabled={busy || (policyReasons[policy.id]?.trim().length ?? 0) < 12} onClick={() => void publishApprovedPolicy(policy)}>Publish approved policy</button>
                        </div>}
                        {policy.is_effective && <button className="payments-text-button" type="button" disabled={busy} onClick={() => startAmendment(policy)}>Create amendment based on this version</button>}
                    </article>)}
                </div>}
                {policies && policies.last_page > 1 && <Pagination page={policyPage} lastPage={policies.last_page} onChange={setPolicyPage} label="Seller payout policy pages" />}
                {(editingPolicyId !== null || amendmentBasePolicyId !== null || summary?.seller_payout_policy.published_count === 0) && <form className="payments-policy-form" onSubmit={(event) => void savePolicy(event)}>
                    <h4>{editingPolicyId ? 'Edit draft policy' : amendmentBasePolicyId ? `Create amendment to version ${policies?.data.find((item) => item.id === amendmentBasePolicyId)?.version ?? ''}` : 'Create initial policy draft'}</h4>
                    {amendmentBasePolicyId !== null && (() => {
                        const base = policies?.data.find((item) => item.id === amendmentBasePolicyId);
                        return base ? <div className="payments-policy-comparison" aria-live="polite">
                            <strong>Proposed amendment comparison · based on version {base.version}</strong>
                            <p>{amendmentReason}</p>
                            <details open><summary>Changed terms</summary>
                                {changedPolicySections(base.policy_text, compilePolicyText(policySections)).map((change) => <section key={change.label}>
                                    <h5>{change.label}</h5><div><strong>Currently approved</strong><p>{change.previous || 'No matching section in the source version.'}</p></div><div><strong>Proposed amendment</strong><p>{change.amended}</p></div>
                                </section>)}
                            </details>
                        </div> : <p className="payments-inline-empty">The source version is no longer available on this page. Refresh and select the effective version again.</p>;
                    })()}
                    <label>Version<input required maxLength={40} pattern="[A-Za-z0-9][A-Za-z0-9._\-]{0,39}" value={policyVersion} onChange={(event) => setPolicyVersion(event.target.value)} /></label>
                    <label>Effective date<input required type="date" min={new Date().toISOString().slice(0, 10)} value={policyEffectiveDate} onChange={(event) => setPolicyEffectiveDate(event.target.value)} /></label>
                    {amendmentBasePolicyId !== null && <label>Amendment reason<input required minLength={12} maxLength={500} value={amendmentReason} onChange={(event) => setAmendmentReason(event.target.value)} /></label>}
                    <div className="payments-policy-checklist" role="status">
                        <strong>Policy completeness</strong>
                        <ul>{POLICY_SECTIONS.map(({ key, label }) => <li key={key} className={missingPolicySections(policySections).includes(label) ? 'is-missing' : 'is-complete'}>{label}: {missingPolicySections(policySections).includes(label) ? 'missing or incomplete' : 'provided'}</li>)}</ul>
                    </div>
                    {POLICY_SECTIONS.map(({ key, label, guidance }) => <label key={key}>{label}<small>{guidance}</small><textarea required maxLength={10000} rows={4} value={policySections[key]} onChange={(event) => setPolicySections((current) => ({ ...current, [key]: event.target.value }))} placeholder={amendmentBasePolicyId !== null ? 'Review and confirm this amendment term.' : 'Enter the actual Farmgate-approved term; no term is prefilled.'} /></label>)}
                    <p className="payments-inline-note">Saving creates an immutable version lineage only after approval. Saving does not publish or change the seller-effective version. No payout transfer is initiated.</p>
                    <div className="payments-form-actions">
                        <button className="payments-text-button" type="submit" disabled={busy || missingPolicySections(policySections).length > 0 || (amendmentBasePolicyId !== null && amendmentReason.trim().length < 12)}>{busy ? 'Saving…' : editingPolicyId ? 'Save draft changes' : 'Save draft'}</button>
                        {editingPolicyId && <button className="payments-text-button" type="button" onClick={clearPolicyDraft}>Cancel editing</button>}
                        {amendmentBasePolicyId !== null && <button className="payments-text-button" type="button" onClick={clearPolicyDraft}>Cancel amendment</button>}
                    </div>
                </form>}
            </section>

            <section className="payments-settings-card" aria-labelledby="seller-payout-controls-title">
                <div className="payments-section-heading"><div><h3 id="seller-payout-controls-title">Seller payout controls</h3><span className={`status-pill ${summary?.manual_seller_payouts_enabled ? 'status-active' : ''}`}>{summary?.manual_seller_payouts_enabled ? 'Manual payout recording enabled' : 'Manual payout recording disabled'}</span></div></div>
                <p>Farmgate can record a payout completed outside the application. It cannot initiate a bank or PayMongo transfer.</p>
                <div className="payments-configuration-grid">
                    <article><span>Verified seller destinations</span><strong>{summary?.manual_payout_prerequisites.verified_destination_count ?? 0}</strong></article>
                    <article><span>Destinations awaiting verification</span><strong>{summary?.seller_destinations.pending_verification ?? 0}</strong></article>
                </div>
                {!summary?.manual_seller_payouts_enabled && <div className="payments-blocked-card" role="status">
                    <strong>{summary?.manual_payout_prerequisites.unmet.length ? 'Manual payout recording is blocked.' : 'Manual payout recording is currently disabled.'}</strong>
                    {summary?.manual_payout_prerequisites.unmet.length ? <ul>{summary.manual_payout_prerequisites.unmet.map((item) => <li key={item}>{item}</li>)}</ul> : <p>Prerequisites are met. An authorized admin can enable manual payout recording with an audit reason.</p>}
                    {!summary?.manual_payout_prerequisites.destination_approval_active && <p>Seller destination approval is not active.</p>}
                </div>}
                {summary?.manual_seller_payouts_enabled && <p className="payments-inline-note">The audited manual-payout setting is enabled. Every seller still needs an acknowledgment of the effective policy and an individually verified destination before external payout recording.</p>}
                <div className="payments-payout-toggle">
                    <label>Reason for {summary?.manual_seller_payouts_enabled ? 'disabling' : 'enabling'} manual payout recording<input minLength={8} maxLength={255} value={payoutSettingReason} onChange={(event) => setPayoutSettingReason(event.target.value)} /></label>
                    <button type="button" className="seller-inline-action" disabled={busy} onClick={() => void toggleManualPayouts()}>{summary?.manual_seller_payouts_enabled ? 'Disable manual payout recording' : 'Enable manual payout recording'}</button>
                    <button type="button" className="payments-text-button" onClick={onOpenSystemSettings}>Open full Finance settings and history</button>
                </div>
                <div className="payments-settings-subsection">
                    <h4>Seller destination review</h4>
                    {!destinations?.data.length ? <p className="payments-inline-empty">No seller payout destinations are awaiting review.</p> : <div className="data-table-wrap payments-table-wrap"><table className="data-table payments-table">
                        <thead><tr><th>Seller / submitted</th><th>Destination</th><th>Policy acknowledgment</th><th>Consent</th><th>Status</th><th>Review</th></tr></thead>
                        <tbody>{destinations.data.map((destination) => <tr key={destination.id}>
                            <td>{destination.seller?.name ?? 'Seller'}<small>{new Date(destination.submitted_at).toLocaleString()}</small></td>
                            <td>{destination.destination_type} · {destination.account_holder_masked} · {destination.bank_name_masked ?? 'GCash'} · {destination.account_number_masked ?? destination.wallet_number_masked}</td>
                            <td>{destination.effective_policy_version ? <>{destination.effective_policy_version} · {destination.effective_policy_acknowledged ? 'Acknowledged' : 'Not acknowledged'}{destination.effective_policy_acknowledged_at && <small>{new Date(destination.effective_policy_acknowledged_at).toLocaleString()}</small>}</> : 'No effective policy'}</td>
                            <td>{destination.consent_version}<small>{new Date(destination.consent_accepted_at).toLocaleString()}</small></td>
                            <td><span className="status-pill">{destination.status.replaceAll('_', ' ')}</span>{destination.verified_at && <small>Verified by {destination.verified_by_name ?? 'Admin'} · {new Date(destination.verified_at).toLocaleString()}</small>}</td>
                            <td>{destination.status === 'PENDING_VERIFICATION' ? <div className="payments-destination-review"><label>Decision reason<input maxLength={500} value={verificationReason[destination.id] ?? ''} onChange={(event) => setVerificationReason((current) => ({ ...current, [destination.id]: event.target.value }))} /></label><button className="seller-inline-action" type="button" disabled={busy} onClick={() => void decideDestination(destination, 'verify')}>Verify destination</button><button className="payments-text-button" type="button" disabled={busy} onClick={() => void decideDestination(destination, 'reject')}>Reject</button>{destination.verification_history.length > 0 && <details><summary>Decision history</summary>{destination.verification_history.map((item, index) => <small key={`${item.action}-${index}`}>{item.action} · {item.actor ?? 'Admin'} · {new Date(item.created_at).toLocaleString()} · {item.reason}</small>)}</details>}</div> : <details><summary>Decision history</summary>{destination.verification_history.length ? destination.verification_history.map((item, index) => <small key={`${item.action}-${index}`}>{item.action} · {item.actor ?? 'Admin'} · {new Date(item.created_at).toLocaleString()} · {item.reason}</small>) : <small>No review actions recorded.</small>}</details>}</td>
                        </tr>)}</tbody>
                    </table></div>}
                    {destinations && destinations.last_page > 1 && <Pagination page={destinationPage} lastPage={destinations.last_page} onChange={setDestinationPage} label="Seller payout destination pages" />}
                </div>
            </section>
        </>}
    </section>;
}

function ReceivingMethodCard({
    method, currentAdminId, busy, reason, confirmed, setReason, setConfirmed, onVerify, onDeactivate, onEnable, onUpdate,
}: {
    method: ReceivingMethod; currentAdminId: number | null; busy: boolean; reason: string; confirmed: boolean;
    setReason: (reason: string) => void; setConfirmed: (checked: boolean) => void; onVerify: () => void; onDeactivate: () => void;
    onEnable: () => void; onUpdate: (data: FormData) => void;
}) {
    const [label, setLabel] = React.useState(method.label);
    const [instructions, setInstructions] = React.useState(method.instructions);
    const [bankName, setBankName] = React.useState(method.bank_name ?? '');
    const [accountHolder, setAccountHolder] = React.useState('');
    const [accountNumber, setAccountNumber] = React.useState('');
    const [editReason, setEditReason] = React.useState('');
    const [qr, setQr] = React.useState<File | null>(null);
    const methodLabel = method.method_type === 'BANK_QR' || method.method_type === 'PAYMONGO_QR'
        ? method.method_type === 'PAYMONGO_QR' ? 'PayMongo receiving QR' : 'Online banking QR'
        : 'Bank account';

    return <article className="cod-receiving-method">
        <div className="payments-section-heading"><div><h5>{method.label}</h5><span className="status-pill">{method.status.replaceAll('_', ' ')}</span></div><span>{methodLabel}</span></div>
        <p>{method.instructions}</p>
        <dl><div><dt>Account holder</dt><dd>{method.account_holder_masked ?? '—'}</dd></div><div><dt>Bank / institution</dt><dd>{method.bank_name ?? '—'}</dd></div><div><dt>Account</dt><dd>{method.account_number_masked ?? '—'}</dd></div></dl>
        {method.qr_url && <a href={method.qr_url} target="_blank" rel="noreferrer">Review private receiving QR</a>}
        <details>
            <summary>Edit receiving details</summary>
            <form className="seller-account-form" onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData();
                data.set('label', label.trim());
                data.set('instructions', instructions.trim());
                data.set('bank_name', bankName.trim());
                data.set('reason', editReason.trim());
                if (accountHolder.trim()) data.set('account_holder', accountHolder.trim());
                if (accountNumber.trim()) data.set('account_number', accountNumber.trim());
                if (qr) data.set('qr', qr);
                onUpdate(data);
            }}>
                <label>Display label<input required maxLength={100} value={label} onChange={(event) => setLabel(event.target.value)} /></label>
                <label>Rider instructions<textarea required maxLength={1000} value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label>
                <label>Bank or institution<input required maxLength={100} value={bankName} onChange={(event) => setBankName(event.target.value)} /></label>
                <label>New account holder (optional)<input maxLength={120} value={accountHolder} onChange={(event) => setAccountHolder(event.target.value)} placeholder="Leave blank to keep current" /></label>
                <label>New receiving account number (optional)<input minLength={5} maxLength={40} autoComplete="off" value={accountNumber} onChange={(event) => setAccountNumber(event.target.value)} placeholder="Leave blank to keep current" /></label>
                {(method.method_type === 'BANK_QR' || method.method_type === 'PAYMONGO_QR') && <label>Replace receiving QR (optional)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setQr(event.target.files?.[0] ?? null)} /></label>}
                <label>Reason for edit<textarea required minLength={8} maxLength={1000} value={editReason} onChange={(event) => setEditReason(event.target.value)} /></label>
                <p className="payments-inline-note">Saving changes disables this method until a different admin verifies the updated details.</p>
                <button className="seller-inline-action" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes for verification'}</button>
            </form>
        </details>
        {method.status === 'PENDING_VERIFICATION' && <div className="cod-receiving-verification">
            <label>Verification evidence / reason<textarea minLength={12} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
            <label className="seller-payout-destination-consent"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>I verified this method receives funds only into a Farmgate-controlled account; it cannot initiate an outgoing transfer.</span></label>
            <button className="seller-inline-action" type="button" disabled={busy || method.configured_by === currentAdminId} onClick={onVerify}>Verify and activate</button>
            {method.configured_by === currentAdminId && <p role="status">A different admin must verify this receiving method.</p>}
        </div>}
        {method.status === 'ACTIVE' && <div className="cod-receiving-verification"><label>Reason to disable<input maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} /></label><button type="button" className="seller-inline-action" disabled={busy} onClick={onDeactivate}>Disable receiving method</button></div>}
        {method.status === 'DISABLED' && <div className="cod-receiving-verification"><label>Reason to re-enable<input maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} /></label><button type="button" className="seller-inline-action" disabled={busy} onClick={onEnable}>Request reactivation</button><p>A different admin must verify the method before riders can use it.</p></div>}
        {method.histories?.length ? <details><summary>Audit history</summary>{method.histories.map((entry, index) => <p key={`${entry.action}-${index}`}>{entry.action} · {entry.actor?.name ?? 'Admin'} · {new Date(entry.created_at).toLocaleString()} · {entry.reason}</p>)}</details> : null}
    </article>;
}
