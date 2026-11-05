import React from 'react';
import api from '../../lib/api';
import { Pagination } from '../../shared/components/Pagination';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';

type AuditChange = { field: string; old: unknown; new: unknown };
type AuditRow = {
    id: number; created_at: string; action: string; method: string; route: string; request_url?: string;
    database_action: string; entity_type?: string; entity_id?: string | number; description?: string; reason?: string;
    status_code: number; ip_address?: string; user_agent?: string; actor?: { name: string; email: string; role: string };
    before_values?: Record<string, unknown>; after_values?: Record<string, unknown>; changed_fields?: AuditChange[];
};
type AuditResponse = { audit_logs: { data: AuditRow[]; total: number; current_page: number; last_page: number } };

const roles = ['', 'ADMIN', 'BUYER', 'SELLER', 'RIDER'];
const databaseActions = ['', 'INSERT', 'UPDATE', 'DELETE', 'NONE'];
const formatValue = (value: unknown) => value === null || value === undefined ? '-' : typeof value === 'object' ? JSON.stringify(value) : String(value);

export function AuditHistory({ onError }: { onError: (message: string) => void }) {
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

    return <section className="admin-section audit-history">
        <div className="admin-section-heading"><div><p className="eyebrow">Security</p><h2>Audit History</h2></div><span className="record-count">{total} records</span></div>
        <div className="audit-filters">
            <label className="audit-search-field">Search<input value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} placeholder="Actor, action, entity type, or entity ID" /></label>
            <label>Role<select value={filters.role} onChange={(event) => updateFilter('role', event.target.value)}>{roles.map((role) => <option key={role} value={role}>{role || 'All roles'}</option>)}</select></label>
            <label>Database action<select value={filters.database_action} onChange={(event) => updateFilter('database_action', event.target.value)}>{databaseActions.map((action) => <option key={action} value={action}>{action || 'All changes'}</option>)}</select></label>
            <label>Result<select value={filters.success} onChange={(event) => updateFilter('success', event.target.value)}><option value="">All results</option><option value="true">Success</option><option value="false">Failed</option></select></label>
            <label>Date from<input type="date" value={filters.date_from} onChange={(event) => updateFilter('date_from', event.target.value)} /></label>
            <label>Date to<input type="date" value={filters.date_to} onChange={(event) => updateFilter('date_to', event.target.value)} /></label>
        </div>
        {loading ? <p className="admin-loading">Loading audit history...</p> : <>
            {rows.length ? <div className="data-table-wrap"><table><thead><tr><th>{header('Date & time', 'created_at')}</th><th>{header('Actor', 'actor')}</th><th>{header('Role', 'role')}</th><th>{header('Action', 'action')}</th><th>{header('Database action', 'database_action')}</th><th>{header('Entity', 'entity_type')}</th><th>Description</th><th>Result</th><th>IP address</th><th>Review</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{new Date(row.created_at).toLocaleString()}</td><td>{row.actor?.name ?? 'Guest'}<small>{row.actor?.email ?? '-'}</small></td><td>{row.actor?.role ?? '-'}</td><td><span className="truncate-cell">{row.action}</span></td><td><span className={`status-pill audit-${row.database_action.toLowerCase()}`}>{row.database_action}</span></td><td>{row.entity_type ? `${row.entity_type} #${row.entity_id ?? '-'}` : '-'}</td><td><span className="truncate-cell">{row.description ?? '-'}</span></td><td><span className={`status-pill ${row.status_code < 400 ? 'status-active' : 'status-rejected'}`}>{row.status_code < 400 ? 'Success' : 'Failed'}</span></td><td>{row.ip_address ?? '-'}</td><td><button type="button" onClick={() => setSelected(row)}>View</button></td></tr>)}</tbody></table></div> : <p className="admin-empty">No audit records match these filters.</p>}
            <div className="audit-pagination"><label>Rows<select value={perPage} onChange={(event) => { setPerPage(Number(event.target.value)); setPage(1); }}><option value="10">10</option><option value="25">25</option><option value="50">50</option><option value="100">100</option></select></label><Pagination page={page} lastPage={lastPage} onChange={setPage} /></div>
        </>}
        {selected && <div className="audit-modal-backdrop" role="presentation" onClick={() => setSelected(null)}><article className="audit-modal" role="dialog" aria-modal="true" aria-labelledby="audit-detail-title" onClick={(event) => event.stopPropagation()}><div className="audit-modal-heading"><div><p className="eyebrow">Read-only review</p><h3 id="audit-detail-title">Audit record #{selected.id}</h3></div><button type="button" onClick={() => setSelected(null)} aria-label="Close audit details">Close</button></div><div className="audit-detail-grid"><div><strong>Who</strong><span>{selected.actor?.name ?? 'Guest'} ({selected.actor?.email ?? '-'})</span></div><div><strong>Role</strong><span>{selected.actor?.role ?? '-'}</span></div><div><strong>Date & time</strong><span>{new Date(selected.created_at).toLocaleString()}</span></div><div><strong>Action</strong><span>{selected.action}</span></div><div><strong>Database action</strong><span>{selected.database_action}</span></div><div><strong>Entity</strong><span>{selected.entity_type ?? '-'} #{selected.entity_id ?? '-'}</span></div><div><strong>Result</strong><span>{selected.status_code < 400 ? 'Success' : 'Failed'} ({selected.status_code})</span></div><div><strong>IP address</strong><span>{selected.ip_address ?? '-'}</span></div><div><strong>Request method</strong><span>{selected.method}</span></div><div><strong>Request URL</strong><span>{selected.request_url ?? selected.route}</span></div><div><strong>User agent</strong><span>{selected.user_agent ?? '-'}</span></div><div><strong>Reason</strong><span>{selected.reason ?? '-'}</span></div></div><p className="audit-description">{selected.description ?? '-'}</p>{selected.database_action !== 'NONE' && <div className="audit-changes"><h4>Database changes</h4><div className="data-table-wrap"><table><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>{(selected.changed_fields ?? []).map((change) => <tr key={change.field}><td>{change.field}</td><td>{formatValue(change.old)}</td><td>{formatValue(change.new)}</td></tr>)}</tbody></table></div></div>}</article></div>}
    </section>;
}
