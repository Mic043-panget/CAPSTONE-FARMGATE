import React from 'react';
import { ViewDetailsAction } from '../../shared/components/Button';
import api from '../../lib/api';
import { Pagination } from '../../shared/components/Pagination';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useAccessibleDialog } from '../../shared/hooks/useAccessibleDialog';

type AuditChange = { field: string; old: unknown; new: unknown };
type AuditRow = {
    id: number; created_at: string; action: string; method: string; route: string; request_url?: string;
    database_action: string; entity_type?: string; entity_id?: string | number; description?: string; reason?: string;
    status_code: number; ip_address?: string; user_agent?: string; actor?: { name: string; email: string; role: string };
    before_values?: Record<string, unknown>; after_values?: Record<string, unknown>; changed_fields?: AuditChange[];
    metadata?: Record<string, unknown>;
};
type AuditResponse = { audit_logs: { data: AuditRow[]; total: number; current_page: number; last_page: number } };

const roles = ['', 'ADMIN', 'BUYER', 'SELLER', 'RIDER'];
const databaseActions = ['', 'INSERT', 'UPDATE', 'DELETE', 'NONE'];
const formatValue = (value: unknown) => value === null || value === undefined ? '-' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const escapeHtml = (value: unknown) => formatValue(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character] ?? character));

export function AuditHistory({ onError, preparedBy, initialAuditId, onInitialAuditHandled }: {
    onError: (message: string) => void;
    preparedBy: string;
    initialAuditId?: number;
    onInitialAuditHandled?: () => void;
}) {
    const [rows, setRows] = React.useState<AuditRow[]>([]);
    const [total, setTotal] = React.useState(0);
    const [lastPage, setLastPage] = React.useState(1);
    const [page, setPage] = React.useState(1);
    const [loading, setLoading] = React.useState(true);
    const [perPage, setPerPage] = React.useState(25);
    const [filters, setFilters] = React.useState({ search: '', role: '', database_action: '', success: '', date_from: '', date_to: '' });
    const [sort, setSort] = React.useState('created_at');
    const [direction, setDirection] = React.useState('desc');
    const [selected, setSelected] = React.useState<AuditRow | null>(null);
    const [detailLoading, setDetailLoading] = React.useState(false);
    const [printing, setPrinting] = React.useState(false);
    const auditDialogRef = useAccessibleDialog<HTMLElement>(Boolean(selected), () => setSelected(null));
    const debouncedSearch = useDebouncedValue(filters.search);

    React.useEffect(() => {
        if (filters.search !== debouncedSearch) return undefined;
        let active = true;
        setLoading(true);
        api.get<AuditResponse>('/api/admin/audit-logs', { params: { ...filters, search: debouncedSearch, page, per_page: perPage, sort, direction, success: filters.success || undefined } })
            .then(({ data }) => { if (active) { setRows(data.audit_logs.data); setTotal(data.audit_logs.total); setLastPage(data.audit_logs.last_page); setPage(data.audit_logs.current_page); } })
            .catch((error: any) => { if (active) onError(error.userMessage ?? 'Audit history could not be loaded.'); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [filters, debouncedSearch, page, perPage, sort, direction, onError]);

    function updateFilter(key: string, value: string) {
        setFilters((current) => ({ ...current, [key]: value }));
        setPage(1);
    }

    function changeSort(column: string) {
        if (sort === column) setDirection((current) => current === 'asc' ? 'desc' : 'asc');
        else { setSort(column); setDirection('asc'); }
        setPage(1);
    }

    function header(label: string, column: string) {
        return <button type="button" className="audit-sort" onClick={() => changeSort(column)}>{label}{sort === column ? ` ${direction === 'asc' ? '↑' : '↓'}` : ''}</button>;
    }

    async function openAuditDetails(id: number) {
        setDetailLoading(true);
        try {
            const response = await api.get<{ audit_log: AuditRow }>(`/api/admin/audit-logs/${id}`);
            setSelected(response.data.audit_log);
        } catch (requestError: any) {
            onError(requestError.userMessage ?? 'The full audit event could not be loaded.');
        } finally {
            setDetailLoading(false);
        }
    }

    React.useEffect(() => {
        if (!initialAuditId) return;
        onInitialAuditHandled?.();
        void openAuditDetails(initialAuditId);
    }, [initialAuditId, onInitialAuditHandled]);

    async function printAuditReport() {
        const reportWindow = window.open('', '_blank');
        if (!reportWindow) {
            onError('Allow pop-ups to open the print-ready audit report.');
            return;
        }
        setPrinting(true);
        try {
            const reportResponse = await api.post<{
                generated_at: string;
                record_count: number;
                excluded_report_actions: boolean;
                audit_logs: AuditRow[];
            }>('/api/admin/audit-logs/report', {
                filters: {
                    ...filters,
                    search: debouncedSearch,
                    success: filters.success || undefined,
                    sort,
                    direction,
                },
            });
            const reportRows = reportResponse.data.audit_logs;
            const generated = new Date(reportResponse.data.generated_at);
            const tableRows = reportRows.map((row) => `<tr>
                <td>${escapeHtml(new Date(row.created_at).toLocaleString())}</td>
                <td>${escapeHtml(row.actor?.name ?? 'Guest')}<br>${escapeHtml(row.actor?.email ?? '-')}<br>${escapeHtml(row.actor?.role ?? '-')}</td>
                <td>${escapeHtml(row.action)}</td>
                <td>${escapeHtml(row.entity_type ?? '-')}</td>
                <td>${escapeHtml(row.description ?? '-')}<br>${escapeHtml((row.changed_fields ?? []).map((change) => `${change.field}: ${formatValue(change.old)} → ${formatValue(change.new)}`).join('; ') || '-')}</td>
                <td>${escapeHtml(row.status_code < 400 ? 'Success' : `Failed (${row.status_code})`)}</td>
            </tr>`).join('');
            reportWindow.document.open();
            reportWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Farmgate Security Audit Report</title><style>
                @page{size:landscape;margin:13mm 12mm 16mm;@bottom-right{content:"Page " counter(page) " of " counter(pages);font:8px Arial,sans-serif;color:#555}}
                *{box-sizing:border-box}body{color:#222;font:10px/1.35 Arial,sans-serif;margin:0}
                header{border-bottom:3px solid #185b44;margin-bottom:12px;padding-bottom:9px}
                .brand{color:#185b44;font-size:12px;font-weight:bold;letter-spacing:.08em}
                h1{color:#185b44;font-size:19px;margin:3px 0 7px}
                p{margin:3px 0}.meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 18px;margin-top:8px}
                table{border-collapse:collapse;table-layout:fixed;width:100%;font-size:8.5px}
                col.date{width:12%}col.actor{width:17%}col.action{width:13%}col.record{width:13%}col.details{width:35%}col.result{width:10%}
                thead{display:table-header-group}tfoot{display:table-footer-group}
                th,td{border:1px solid #87978f;padding:5px;text-align:left;vertical-align:top;overflow-wrap:anywhere;word-break:normal;white-space:pre-wrap}
                th{background:#e8f0ec;color:#193e30;font-size:8px}
                tr{break-inside:avoid;page-break-inside:avoid}
                .signature{margin-top:28px;max-width:320px;border-top:1px solid #333;padding-top:5px}
                .note{color:#555;font-size:8px;margin-top:8px}
                footer{border-top:1px solid #87978f;color:#555;font-size:8px;margin-top:12px;padding-top:5px}
                @media print{header{break-after:avoid}.signature{break-inside:avoid}footer{position:fixed;bottom:-10mm;left:0;right:0}}
            </style></head><body><header><div class="brand">FARMGATE · SECURITY</div><h1>Security Audit Report</h1><div class="meta">
                <span>Prepared by: ${escapeHtml(preparedBy)}</span><span>Generated: ${escapeHtml(generated.toLocaleString('en-PH', { timeZone: 'Asia/Manila' }))} (Asia/Manila)</span>
                <span>Matching audit events: ${reportResponse.data.record_count}</span><span>Applied filters: ${escapeHtml(Object.entries(filters).filter(([, value]) => value).map(([key, value]) => `${key.replaceAll('_', ' ')}: ${value}`).join(' · ') || 'None')}</span>
                </div></header><table><colgroup><col class="date"><col class="actor"><col class="action"><col class="record"><col class="details"><col class="result"></colgroup><thead><tr><th>Date &amp; time</th><th>Actor</th><th>Action</th><th>Affected record</th><th>Details and changes</th><th>Result</th></tr></thead><tbody>${tableRows || '<tr><td colspan="6">No audit records match the selected filters.</td></tr>'}</tbody></table><div class="signature">Prepared-by signature: ______________________________<br><span class="note">A typed name is not a verified electronic signature.</span></div><p class="note">Underlying audit records are preserved. Report-generation and report-export audit events are excluded from this snapshot to keep repeated reports stable.</p><footer>FARMGATE · SECURITY AUDIT · Generated ${escapeHtml(generated.toISOString())}</footer><script>window.addEventListener('load',()=>window.print())</script></body></html>`);
            reportWindow.document.close();
        } catch (requestError: any) {
            reportWindow.close();
            onError(requestError.userMessage ?? 'The audit report could not be prepared or recorded.');
        } finally {
            setPrinting(false);
        }
    }

    return <section className="admin-section audit-history">
        <div className="admin-section-heading"><div><p className="eyebrow">Security</p><h2>Audit History</h2></div><div><span className="record-count">{total} records</span><button type="button" onClick={() => void printAuditReport()} disabled={printing}>{printing ? 'Preparing report...' : 'Print audit report'}</button></div></div>
        <div className="audit-filters">
            <label className="audit-search-field">Search<input value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} placeholder="Actor, action, entity type, or entity ID" /></label>
            <label>Role<select value={filters.role} onChange={(event) => updateFilter('role', event.target.value)}>{roles.map((role) => <option key={role} value={role}>{role || 'All roles'}</option>)}</select></label>
            <label>Database action<select value={filters.database_action} onChange={(event) => updateFilter('database_action', event.target.value)}>{databaseActions.map((action) => <option key={action} value={action}>{action || 'All changes'}</option>)}</select></label>
            <label>Result<select value={filters.success} onChange={(event) => updateFilter('success', event.target.value)}><option value="">All results</option><option value="true">Success</option><option value="false">Failed</option></select></label>
            <label>Date from<input type="date" value={filters.date_from} onChange={(event) => updateFilter('date_from', event.target.value)} /></label>
            <label>Date to<input type="date" value={filters.date_to} onChange={(event) => updateFilter('date_to', event.target.value)} /></label>
        </div>
        {loading ? <p className="admin-loading">Loading audit history...</p> : <>
            {rows.length ? <div className="data-table-wrap"><table><thead><tr><th>{header('Date & time', 'created_at')}</th><th>{header('Actor', 'actor')}</th><th>{header('Role', 'role')}</th><th>{header('Action', 'action')}</th><th>{header('Database action', 'database_action')}</th><th>{header('Entity', 'entity_type')}</th><th>Description</th><th>Result</th><th>IP address</th><th>Review</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{new Date(row.created_at).toLocaleString()}</td><td>{row.actor?.name ?? 'Guest'}<small>{row.actor?.email ?? '-'}</small></td><td>{row.actor?.role ?? '-'}</td><td><span className="truncate-cell">{row.action}</span></td><td><span className={`status-pill audit-${row.database_action.toLowerCase()}`}>{row.database_action}</span></td><td>{row.entity_type ?? '-'}</td><td><span className="truncate-cell">{row.description ?? '-'}</span></td><td><span className={`status-pill ${row.status_code < 400 ? 'status-active' : 'status-rejected'}`}>{row.status_code < 400 ? 'Success' : 'Failed'}</span></td><td>{row.ip_address ?? '-'}</td><td><ViewDetailsAction contextLabel={`audit record ${row.id}`} loading={detailLoading} onClick={() => void openAuditDetails(row.id)} /></td></tr>)}</tbody></table></div> : <p className="admin-empty">No audit records match these filters.</p>}
            <div className="audit-pagination"><label>Rows<select value={perPage} onChange={(event) => { setPerPage(Number(event.target.value)); setPage(1); }}><option value="10">10</option><option value="25">25</option><option value="50">50</option><option value="100">100</option></select></label><Pagination page={page} lastPage={lastPage} onChange={setPage} /></div>
        </>}
        {selected && <div className="audit-modal-backdrop" role="presentation" onClick={() => setSelected(null)}><article ref={auditDialogRef} className="audit-modal" role="dialog" aria-modal="true" aria-labelledby="audit-detail-title" onClick={(event) => event.stopPropagation()}>
            <div className="audit-modal-heading"><div><p className="eyebrow">Read-only review</p><h3 id="audit-detail-title">{selected.entity_type ?? 'Audit'} record · {selected.action}</h3></div><button type="button" onClick={() => setSelected(null)} aria-label="Close audit details">Close</button></div>
            <div className="audit-detail-grid">
                <div><strong>Who</strong><span>{selected.actor?.name ?? 'Guest'} ({selected.actor?.email ?? '-'})</span></div><div><strong>Role</strong><span>{selected.actor?.role ?? '-'}</span></div>
                <div><strong>Date &amp; time</strong><span>{new Date(selected.created_at).toLocaleString()}</span></div><div><strong>Action</strong><span>{selected.action}</span></div>
                <div><strong>Database action</strong><span>{selected.database_action}</span></div><div><strong>Affected record</strong><span>{selected.entity_type ?? '-'} #{selected.entity_id ?? '-'}</span></div>
                <div><strong>Result</strong><span>{selected.status_code < 400 ? 'Success' : 'Failed'} ({selected.status_code})</span></div><div><strong>IP address</strong><span>{selected.ip_address ?? '-'}</span></div>
                <div><strong>Request method</strong><span>{selected.method}</span></div><div><strong>Request URL</strong><span>{selected.request_url ?? selected.route}</span></div>
                <div><strong>User agent</strong><span>{selected.user_agent ?? '-'}</span></div><div><strong>Reason</strong><span>{selected.reason ?? '-'}</span></div>
            </div>
            <p className="audit-description">{selected.description ?? '-'}</p>
            {selected.database_action !== 'NONE' && <div className="audit-changes"><h4>Database changes</h4>{selected.changed_fields?.length ? <div className="data-table-wrap"><table><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>{selected.changed_fields.map((change) => <tr key={change.field}><td>{change.field}</td><td>{formatValue(change.old)}</td><td>{formatValue(change.new)}</td></tr>)}</tbody></table></div> : <p>No field-level differences were captured.</p>}</div>}
            <details><summary>Full recorded context</summary><h4>Before values</h4><pre>{JSON.stringify(selected.before_values ?? {}, null, 2)}</pre><h4>After values</h4><pre>{JSON.stringify(selected.after_values ?? {}, null, 2)}</pre><h4>Metadata</h4><pre>{JSON.stringify(selected.metadata ?? {}, null, 2)}</pre></details>
        </article></div>}
    </section>;
}
