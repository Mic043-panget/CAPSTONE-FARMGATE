import React from 'react';
import api, { initializeCsrf } from '../../lib/api';
import { showSuccess } from '../../lib/alerts';
import { renderPolicyMarkdown, RiderPolicyPackagePreview } from './RiderPolicyPackagePreview';

type PolicyDraft = {
    id?: number;
    version: string | null;
    effective_date: string;
    privacy_contact: string;
    privacy_content: string;
    terms_content: string;
    safety_content: string;
    retention_content: string;
    package_appendix: string;
    status: 'DRAFT' | 'PUBLISHED';
    published_at?: string | null;
    approved_at?: string | null;
    approved_by?: string | null;
    published_by?: string | null;
    last_saved_at?: string | null;
    missing_documents: string[];
};

type PolicyAuditEntry = {
    action: string;
    actor: string;
    created_at: string | null;
    version: string | null;
    effective_date: string | null;
    changed_fields?: string[];
};

const emptyDraft: PolicyDraft = {
    version: null,
    effective_date: '',
    privacy_contact: '',
    privacy_content: '',
    terms_content: '',
    safety_content: '',
    retention_content: '',
    package_appendix: '',
    status: 'DRAFT',
    missing_documents: ['Privacy notice', 'Rider terms', 'Safety policy', 'Retention and secure disposal schedule'],
};

function normalizePolicy(policy: Partial<PolicyDraft> | null | undefined): PolicyDraft {
    return {
        ...emptyDraft,
        ...policy,
        version: policy?.version ?? null,
        effective_date: policy?.effective_date ?? '',
        privacy_contact: policy?.privacy_contact ?? '',
        privacy_content: policy?.privacy_content ?? '',
        terms_content: policy?.terms_content ?? '',
        safety_content: policy?.safety_content ?? '',
        retention_content: policy?.retention_content ?? '',
        package_appendix: policy?.package_appendix ?? '',
        missing_documents: policy?.missing_documents ?? emptyDraft.missing_documents,
    };
}

const policyFields: { key: 'privacy_content' | 'terms_content' | 'safety_content' | 'retention_content'; label: string }[] = [
    { key: 'privacy_content', label: 'Privacy Notice' },
    { key: 'terms_content', label: 'Rider Terms' },
    { key: 'safety_content', label: 'Safety Policy' },
    { key: 'retention_content', label: 'Retention & Secure Disposal Schedule' },
];

function requestMessage(error: any): string {
    const validation = Object.values(error.response?.data?.errors ?? {}).flat()[0];
    return error.userMessage ?? (typeof validation === 'string' ? validation : null)
        ?? error.response?.data?.message ?? 'Rider policy action could not be completed.';
}

export function RiderPolicyPublication({ onError }: { onError: (message: string) => void }) {
    const [policy, setPolicy] = React.useState<PolicyDraft>(emptyDraft);
    const [auditHistory, setAuditHistory] = React.useState<PolicyAuditEntry[]>([]);
    const [hasDraft, setHasDraft] = React.useState(false);
    const [reviewConfirmed, setReviewConfirmed] = React.useState(false);
    const [publishConfirmed, setPublishConfirmed] = React.useState(false);
    const [dirty, setDirty] = React.useState(false);
    const [loading, setLoading] = React.useState(true);
    const [saving, setSaving] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const [errorMessage, setErrorMessage] = React.useState('');
    const [previewFields, setPreviewFields] = React.useState<Record<string, boolean>>({});
    const savingRef = React.useRef(false);

    async function load() {
        setLoading(true);
        try {
            const response = await api.get<{ policy: PolicyDraft | null; has_draft: boolean; audit_history: PolicyAuditEntry[] }>('/api/admin/rider-policies');
            setPolicy(normalizePolicy(response.data.policy));
            setHasDraft(response.data.has_draft);
            setAuditHistory(response.data.audit_history);
            setReviewConfirmed(false);
            setPublishConfirmed(false);
            setDirty(false);
            setErrorMessage('');
        } catch (error: any) {
            setErrorMessage(requestMessage(error));
            onError(requestMessage(error));
        } finally {
            setLoading(false);
        }
    }

    React.useEffect(() => { void load(); }, []);

    function update(key: keyof PolicyDraft, value: string) {
        setPolicy((current) => ({ ...current, [key]: value, approved_at: null, approved_by: null }));
        setDirty(true);
        setReviewConfirmed(false);
        setPublishConfirmed(false);
    }

    function startDraft() {
        setPolicy(emptyDraft);
        setAuditHistory([]);
        setHasDraft(false);
        setReviewConfirmed(false);
        setPublishConfirmed(false);
        setDirty(true);
        setMessage('New draft started. No policy text or effective date has been prefilled.');
    }

    async function saveDraft(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        setMessage('');
        setErrorMessage('');
        try {
            await initializeCsrf();
            const response = await api.put<{ policy: PolicyDraft; audit_history: PolicyAuditEntry[] }>('/api/admin/rider-policies/draft', {
                policy_id: hasDraft ? policy.id : undefined,
                version: policy.version?.trim() || null,
                effective_date: policy.effective_date || null,
                privacy_contact: policy.privacy_contact.trim() || null,
                privacy_content: policy.privacy_content || null,
                terms_content: policy.terms_content || null,
                safety_content: policy.safety_content || null,
                retention_content: policy.retention_content || null,
                package_appendix: policy.package_appendix || null,
            });
            setPolicy(normalizePolicy(response.data.policy));
            setHasDraft(true);
            setAuditHistory(response.data.audit_history);
            setDirty(false);
            setReviewConfirmed(false);
            setPublishConfirmed(false);
            setMessage('Draft saved and recorded in audit history. Saving does not publish policies or open rider registration.');
            showSuccess('Rider policy draft saved.');
        } catch (error: any) {
            setErrorMessage(requestMessage(error));
            onError(requestMessage(error));
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    }

    async function publish() {
        if (!policy.id || policy.status !== 'DRAFT' || !publishConfirmed || !policy.approved_at || dirty || !canPublish || savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        setMessage('');
        setErrorMessage('');
        try {
            await initializeCsrf();
            const response = await api.post<{ policy: PolicyDraft }>(`/api/admin/rider-policies/${policy.id}/publish`, {
                publish_confirmed: true,
            });
            setPolicy(normalizePolicy(response.data.policy));
            setHasDraft(false);
            setPublishConfirmed(false);
            await load();
            setMessage('Policy version published and audited. Registration opens only when its effective date has arrived and system registration settings permit it.');
            showSuccess('Rider policy version published.');
        } catch (error: any) {
            setErrorMessage(requestMessage(error));
            onError(requestMessage(error));
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    }

    async function approve() {
        if (!policy.id || policy.status !== 'DRAFT' || !reviewConfirmed || dirty || !canApprove || savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        setMessage('');
        setErrorMessage('');
        try {
            await initializeCsrf();
            await api.post(`/api/admin/rider-policies/${policy.id}/approve`, { approval_confirmed: true });
            await load();
            setMessage('Policy package approval recorded in audit history. Registration remains closed until it is published and effective.');
            showSuccess('Rider policy package approved.');
        } catch (error: any) {
            setErrorMessage(requestMessage(error));
            onError(requestMessage(error));
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    }

    const documentIssues = policyFields.flatMap(({ key, label }) => {
        const content = policy[key];
        const withoutLinks = content.replace(/\[[^\]]+\]\(https:\/\/[^)\s]+\)/g, '');
        if (!content.trim()) return [`${label}: content is missing`];
        if (content.trim().length < 200) return [`${label}: needs at least 200 characters`];
        if (/\[[^\]\r\n]+\]/.test(withoutLinks)) return [`${label}: unresolved placeholder remains`];
        return [];
    });
    const versionValid = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(policy.version ?? '');
    const dateValid = Boolean(policy.effective_date) && new Date(`${policy.effective_date}T00:00:00`) >= new Date(new Date().toDateString());
    const contactValid = Boolean(policy.privacy_contact.trim()) && policy.privacy_contact.trim().length >= 5;
    const completenessBlockers = [
        ...(!versionValid ? ['Enter a valid policy version (letters, numbers, dot, underscore, or hyphen).'] : []),
        ...(!dateValid ? ['Set an effective date that is today or later.'] : []),
        ...(!contactValid ? ['Enter the approved privacy contact (at least 5 characters).'] : []),
        ...documentIssues,
        ...(dirty ? ['Save the latest changes before approval or publication.'] : []),
    ];
    const blockers = [...completenessBlockers, ...(!policy.approved_at ? ['An authorized admin must approve the saved package.'] : [])];
    const canApprove = completenessBlockers.length === 0;
    const canPublish = blockers.length === 0;
    const displayedBlockers = publishConfirmed ? blockers : [...blockers, 'Confirm publication of this approved package.'];

    return <section className="admin-section rider-policy-admin">
        <header className="admin-section-heading">
            <div><p className="eyebrow">Governance · Rider onboarding</p><h2>Rider policy publication</h2></div>
            <span className={`status-pill ${policy.status === 'PUBLISHED' ? 'is-approved' : ''}`}>{policy.status === 'PUBLISHED' ? 'Published' : hasDraft ? 'Draft · unpublished' : 'Not published'}</span>
        </header>
        <p className="rider-policy-admin-intro">Saving stores unfinished work as a draft. It never publishes policies, sets an effective date, or opens rider registration.</p>
        {loading ? <p className="admin-loading" role="status">Loading rider policy status…</p> : <>
            {errorMessage && <p className="rider-policy-error" role="alert">{errorMessage}</p>}
            <section className="rider-policy-requirements" aria-labelledby="rider-policy-requirements-title">
                <h3 id="rider-policy-requirements-title">Draft requirements</h3>
                <p>Registration remains closed until this complete package is approved, published, and effective.</p>
                <ul>
                    <li className={versionValid ? 'is-ready' : ''}>{versionValid ? 'Version entered' : 'Add a valid policy version'}</li>
                    <li className={dateValid ? 'is-ready' : ''}>{dateValid ? 'Effective date set' : 'Effective date required'}</li>
                    <li className={contactValid ? 'is-ready' : ''}>{contactValid ? 'Privacy contact entered' : 'Privacy contact required'}</li>
                    {policyFields.map(({ key, label }) => {
                        const content = policy[key];
                        const withoutLinks = content.replace(/\[[^\]]+\]\(https:\/\/[^)\s]+\)/g, '');
                        const ready = content.trim().length >= 200 && !/\[[^\]\r\n]+\]/.test(withoutLinks);
                        return <li className={ready ? 'is-ready' : ''} key={key}>{ready ? `${label} complete` : `${label} is missing or incomplete`}</li>;
                    })}
                    <li className={policy.approved_at ? 'is-ready' : ''}>{policy.approved_at ? `Approved by ${policy.approved_by ?? 'admin'}` : 'Authorized admin approval required'}</li>
                </ul>
            </section>
            {policy.status !== 'PUBLISHED' && <RiderPolicyPackagePreview />}
            <aside className="rider-policy-missing-documents" role="note">
                <strong>The complete supplied package is loaded for review.</strong>
                <p>The four rider-facing documents are separated below. Its administrative adoption, publication, and acknowledgment procedure is retained as a reference appendix. Registration remains closed unless separately enabled in system settings.</p>
            </aside>
            {policy.status === 'PUBLISHED' && <aside className="rider-policy-published-notice" role="status">
                Published version <strong>{policy.version}</strong> · Effective {policy.effective_date || 'date not set'} · Approved by {policy.approved_by ?? 'administrator unavailable'} · Published by {policy.published_by ?? 'administrator unavailable'} · Published {policy.published_at ? new Date(policy.published_at).toLocaleString() : 'time unavailable'}.
            </aside>}
            {policy.status === 'PUBLISHED' && <div className="rider-policy-published-documents">
                {policyFields.map(({ key, label }) => <details key={key}><summary>{label}</summary><div>{renderPolicyMarkdown(policy[key])}</div></details>)}
                <details><summary>Administrative adoption and acknowledgment appendix</summary><div>{renderPolicyMarkdown(policy.package_appendix)}</div></details>
            </div>}
            {!hasDraft && policy.status === 'PUBLISHED' && <button className="rider-policy-new-draft" type="button" onClick={startDraft}>Start a new draft version</button>}
            {policy.status === 'DRAFT' ? <form className="rider-policy-admin-form" onSubmit={(event) => void saveDraft(event)}>
                <div className="rider-policy-admin-meta">
                    <label>Policy version<input maxLength={40} value={policy.version ?? ''} onChange={(event) => update('version', event.target.value)} placeholder="Enter an approved version" /></label>
                    <label>Effective date<input type="date" value={policy.effective_date} onChange={(event) => update('effective_date', event.target.value)} /></label>
                    <label>Privacy contact<input maxLength={255} value={policy.privacy_contact} onChange={(event) => update('privacy_contact', event.target.value)} placeholder="Approved privacy contact" /></label>
                </div>
                {policyFields.map(({ key, label }) => {
                    const content = policy[key];
                    const withoutLinks = content.replace(/\[[^\]]+\]\(https:\/\/[^)\s]+\)/g, '');
                    const missing = !content.trim();
                    const unresolved = /\[[^\]\r\n]+\]/.test(withoutLinks);
                    const previewOpen = Boolean(previewFields[key]);
                    return <details className="rider-policy-editor" key={key}>
                        <summary>
                            <span>{label}</span>
                            <small>{content.length.toLocaleString()} characters · {missing ? 'Missing content' : unresolved ? 'Resolve placeholders' : content.trim().length < 200 ? 'Below publish minimum' : 'Content added'}</small>
                        </summary>
                        <div className="rider-policy-editor-body">
                            <label htmlFor={`rider-policy-${key}`}>Approved {label.toLowerCase()} text</label>
                            <textarea id={`rider-policy-${key}`} maxLength={50000} rows={9} value={content} onChange={(event) => update(key, event.target.value)} placeholder={`Enter the approved ${label.toLowerCase()} text. Saving an incomplete draft is allowed; unresolved placeholders block publication.`} />
                            <div className="rider-policy-editor-tools">
                                <span aria-live="polite">{content.length.toLocaleString()} / 50,000 characters · publish minimum 200</span>
                                <button type="button" aria-expanded={previewOpen} onClick={() => setPreviewFields((current) => ({ ...current, [key]: !current[key] }))}>{previewOpen ? 'Hide preview' : 'Preview'}</button>
                            </div>
                            {previewOpen && <div className="rider-policy-document-preview" aria-label={`${label} preview`}>{content.trim() ? renderPolicyMarkdown(content) : <p>No content to preview.</p>}</div>}
                        </div>
                    </details>;
                })}
                <details className="rider-policy-editor">
                    <summary>
                        <span>Administrative adoption and acknowledgment appendix</span>
                        <small>{policy.package_appendix.length.toLocaleString()} characters · internal reference</small>
                    </summary>
                    <div className="rider-policy-editor-body">
                        <label htmlFor="rider-policy-package-appendix">Package cover, adoption procedure, approval form, and acknowledgment</label>
                        <textarea id="rider-policy-package-appendix" maxLength={50000} rows={9} value={policy.package_appendix} onChange={(event) => update('package_appendix', event.target.value)} />
                        <span aria-live="polite">{policy.package_appendix.length.toLocaleString()} / 50,000 characters</span>
                    </div>
                </details>
                <p className="rider-registration-note">Manual review only. Selfie collection, OCR, and face matching remain disabled by default. This draft package is not legal advice or legal approval.</p>
                <div className="rider-policy-actions">
                    <div className="rider-policy-action-buttons">
                        <button type="submit" disabled={saving || !dirty && hasDraft}>{saving ? 'Saving…' : 'Save draft'}</button>
                    </div>
                    {policy.last_saved_at && <p className="rider-policy-last-saved">Last saved {new Date(policy.last_saved_at).toLocaleString()}</p>}
                    <h3>Publication requirements</h3>
                    <ul>{displayedBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
                    {canPublish && <p role="status">All publication requirements are satisfied.</p>}
                    <div className="rider-policy-approval">
                    {policy.approved_at ? <p role="status">Approved by {policy.approved_by ?? 'an administrator'} on {new Date(policy.approved_at).toLocaleString()}. {dirty ? 'Changes must be saved and approved again.' : 'Registration remains closed until publication and the effective date.'}</p>
                        : <div className="rider-policy-confirmation">
                            <label><input type="checkbox" checked={reviewConfirmed} disabled={!policy.id || !hasDraft || !canApprove || saving} onChange={(event) => setReviewConfirmed(event.target.checked)} /> I have reviewed and approve the complete policy texts, effective date, and privacy contact for the actual Farmgate service.</label>
                            <button type="button" disabled={!policy.id || !hasDraft || saving || !reviewConfirmed || !canApprove} onClick={() => void approve()}>{saving ? 'Approving…' : 'Approve policy package'}</button>
                        </div>}
                    <div className="rider-policy-confirmation">
                        <label><input type="checkbox" checked={publishConfirmed} disabled={!policy.id || !hasDraft || !policy.approved_at || dirty || !canPublish || saving} onChange={(event) => setPublishConfirmed(event.target.checked)} /> Publish this approved policy package as the official version on its effective date.</label>
                        <button type="button" className="rider-policy-publish-button" disabled={!policy.id || !hasDraft || saving || !publishConfirmed || !policy.approved_at || dirty || !canPublish} onClick={() => void publish()}>{saving ? 'Publishing…' : 'Publish policy package'}</button>
                    </div>
                    </div>
                </div>
                {message && <p className="rider-registration-note" role="status">{message}</p>}
            </form> : <div className="rider-policy-admin-empty">
                <p>No editable draft is selected. Registration remains blocked unless an effective, complete published version exists and rider registration is enabled.</p>
                {policy.missing_documents.length > 0 && <p>Incomplete required documents: {policy.missing_documents.join(', ')}.</p>}
                {message && <p role="status">{message}</p>}
            </div>}
            {!!auditHistory.length && <section className="rider-policy-audit-history" aria-labelledby="rider-policy-audit-title">
                <h3 id="rider-policy-audit-title">Policy audit history</h3>
                <ol>{auditHistory.map((entry, index) => <li key={`${entry.action}-${entry.created_at}-${index}`}>
                    <strong>{entry.action.replaceAll('.', ' ')}</strong> · {entry.actor} · {entry.version ?? 'Version unavailable'} · Effective {entry.effective_date ?? 'not set'} · {entry.created_at ? new Date(entry.created_at).toLocaleString() : 'Time unavailable'}
                    {entry.changed_fields?.length ? <span> · Updated: {entry.changed_fields.join(', ')}</span> : null}
                </li>)}</ol>
            </section>}
        </>}
    </section>;
}
