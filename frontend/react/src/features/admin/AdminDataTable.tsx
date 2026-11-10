import React from 'react';
import api from '../../lib/api';
import { Pagination } from '../../shared/components/Pagination';
import { LoadingSkeleton } from '../../shared/components/LoadingSkeleton';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';

type Column = { label: string; render: (row: Record<string, any>, refresh: () => void) => React.ReactNode };
type FilterTab = { label: string; value: string };
type SortOption = { label: string; value: string };
type AdminDataTableProps = { title: string; eyebrow: string; endpoint: string; collection: string; columns: Column[]; onError: (message: string) => void; controls?: React.ReactNode; filterParam?: string; filterLabel?: string; filterTabs?: FilterTab[]; verifiedParam?: string; sortOptions?: SortOption[]; countTabs?: boolean; searchPlaceholder?: string; initialSearch?: string; onInitialSearchApplied?: () => void; responsiveCards?: boolean };

export function AdminDataTable({ title, eyebrow, endpoint, collection, columns, onError, controls, filterParam, filterLabel = 'role', filterTabs, verifiedParam, sortOptions, countTabs = false, searchPlaceholder, initialSearch, onInitialSearchApplied, responsiveCards = false }: AdminDataTableProps) {
    const [rows, setRows] = React.useState<Record<string, any>[]>([]);
    const [total, setTotal] = React.useState(0);
    const [statusCounts, setStatusCounts] = React.useState<Record<string, number>>({});
    const [loading, setLoading] = React.useState(true);
    const [loadError, setLoadError] = React.useState('');
    const [page, setPage] = React.useState(1);
    const [search, setSearch] = React.useState('');
    const [filter, setFilter] = React.useState('');
    const [sort, setSort] = React.useState(sortOptions?.[0]?.value ?? '');
    const [verifiedOnly, setVerifiedOnly] = React.useState(false);
    const [revision, setRevision] = React.useState(0);
    const debouncedSearch = useDebouncedValue(search);

    React.useEffect(() => {
        if (!initialSearch) return;
        setSearch(initialSearch);
        setPage(1);
        onInitialSearchApplied?.();
    }, [initialSearch, onInitialSearchApplied]);

    React.useEffect(() => {
        if (search !== debouncedSearch) return undefined;
        let active = true;
        setLoading(true);
        setLoadError('');
        api.get<Record<string, any>>(`/api/${endpoint}`, { params: { page, search: debouncedSearch || undefined, per_page: 15, ...(filterParam ? { [filterParam]: filter || undefined } : {}), ...(sortOptions ? { sort } : {}), ...(verifiedParam && verifiedOnly ? { [verifiedParam]: 1 } : {}) } }).then((response) => {
            if (!active) return;
            const page = response.data[collection];
            setRows(page.data ?? page);
            setTotal(page.total ?? page.length);
            setPage(page.current_page ?? 1);
            if (countTabs) setStatusCounts(response.data.status_counts ?? {});
        }).catch((requestError: any) => { if (active) { const message = requestError.userMessage ?? `The ${title.toLowerCase()} could not be loaded.`; setLoadError(message); onError(message); } }).finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [endpoint, collection, onError, title, page, search, debouncedSearch, filterParam, filter, sort, sortOptions, verifiedParam, verifiedOnly, revision, countTabs]);

    return <section className="admin-section admin-data-table"><div className="admin-section-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><div className={`admin-filter${verifiedParam ? ' admin-filter-with-switch' : ''}`}><span>{total} records</span>{controls}{sortOptions && <label className="admin-sort-control">Sort by<select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}>{sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}{verifiedParam && <label className="admin-verified-switch"><span>Verified accounts only</span><input type="checkbox" role="switch" checked={verifiedOnly} onChange={(event) => { setVerifiedOnly(event.target.checked); setPage(1); }} /><span className="admin-verified-switch-track" aria-hidden="true" /></label>}</div></div>{filterParam && filterTabs && <div className="admin-data-tabs" role="group" aria-label={`Filter ${title} by ${filterLabel}`}>{filterTabs.map((tab) => <button key={tab.value || 'all'} type="button" aria-pressed={filter === tab.value} className={filter === tab.value ? 'active' : ''} onClick={() => { setFilter(tab.value); setPage(1); }}>{tab.label}{countTabs && <span className="admin-tab-count">{statusCounts[tab.value || 'all'] ?? (tab.value === '' ? total : 0)}</span>}</button>)}</div>}<div className="list-tools"><label className="control-search"><span className="sr-only">Search {title}</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder={searchPlaceholder ?? `Search ${title.toLowerCase()}`} /></label></div>{loading ? <LoadingSkeleton variant="table" count={5} columns={columns.length} label={`Loading ${title.toLowerCase()}`} /> : loadError ? <p className="admin-empty" role="alert">{loadError} <button type="button" onClick={() => setRevision((value) => value + 1)}>Try again</button></p> : <>{rows.length ? <div className={`data-table-wrap${responsiveCards ? ' admin-responsive-table' : ''}`} role={responsiveCards ? 'region' : undefined} aria-label={responsiveCards ? `${title} results` : undefined} tabIndex={responsiveCards ? 0 : undefined}><table><thead><tr>{columns.map((column) => <th key={column.label}>{column.label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id ?? index}>{columns.map((column) => <td key={column.label} data-label={responsiveCards ? column.label : undefined}>{column.render(row, () => setRevision((value) => value + 1))}</td>)}</tr>)}</tbody></table></div> : <p className="admin-empty">No {title.toLowerCase()} found.</p>}<Pagination page={page} lastPage={Math.ceil(total / 15)} onChange={setPage} /></>}</section>;
}
