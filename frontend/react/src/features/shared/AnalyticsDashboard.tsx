import React from 'react';
import api from '../../lib/api';
import type { UserRole } from '../../shared/types';
import { AIChatPage, type ChatReportContext } from './AIChatPage';
import { Pagination } from '../../shared/components/Pagination';

type Analytics = {
    range: { from: string; to: string };
    summary: Record<string, number | null>;
    delivery_proof_summary?: { recorded: number; missing: number };
    series: { date: string; revenue: number; orders: number; units: number }[];
    growth_series: { date: string; sellers: number; buyers: number; listings: number; orders: number }[] | null;
    order_statuses: Record<string, number>;
    payment_statuses: Record<string, number>;
    listing_statuses: Record<string, number>;
    products: { id: number; name: string; category: string; revenue: number; units: number; listed_at: string }[];
    category_sales: { category: string; revenue: number; units: number }[];
    category_supply: { category: string; units: number }[];
    declining_products: { id: number; name: string; category: string; revenue: number; units: number; change: number; units_change: number }[];
    inventory: { id: number; name: string; category: string; quantity: number; status: string }[];
    low_stock: { id: number; name: string; category: string; quantity: number }[];
    seller_performance: { id: number; name: string; orders: number; sales: number }[];
    delayed_orders: { id: number; reference: string; status: string; total: number; created_at: string; age_hours: number }[];
    category_listings: { category: string; count: number }[];
    complaints: { total: number; open: number; resolved: number; average_resolution_hours: number | null } | null;
    filters: {
        categories: { id: number; name: string }[];
        products: { id: number; name: string }[];
        sellers: { id: number; name: string }[];
    };
    unavailable: Record<string, string>;
};

type AnalyticsDashboardProps = { role: Extract<UserRole, 'SELLER' | 'ADMIN'>; preparedBy?: string; onOpenOrder?: (orderId: number) => void };
type ChartData = { label: string; value: number; formatted?: string }[];
type ChartKind = 'bar' | 'donut';
type AnalyticsChart = { title: string; kind: ChartKind; values: ChartData; currencyValues?: boolean; unitLabel?: string; emptyMessage?: string; limit?: number };
type AnalyticsPrintRow = { id: string; cells: string[] };

function EditablePrintValue({ id, value, edits, onEdit }: {
    id: string;
    value: string;
    edits: Record<string, string>;
    onEdit: (id: string, value: string) => void;
}) {
    return <span
        className="analytics-print-editable-text"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label={`Edit print value ${id}`}
        onBlur={(event) => onEdit(id, event.currentTarget.textContent ?? '')}
    >{edits[id] ?? value}</span>;
}

function AnalyticsPrintTable({ title, unitLabel, headers, rows, excludedRows, edits, onToggleRow, onEdit, headingLevel = 3 }: {
    title: string;
    unitLabel?: string;
    headers: string[];
    rows: AnalyticsPrintRow[];
    excludedRows: Set<string>;
    edits: Record<string, string>;
    onToggleRow: (id: string) => void;
    onEdit: (id: string, value: string) => void;
    headingLevel?: 2 | 3;
}) {
    const hasIncludedRows = rows.some((row) => !excludedRows.has(row.id));

    return <section className="analytics-print-data-section" data-print-empty={!hasIncludedRows}>
        {headingLevel === 2 ? <h2>{title}</h2> : <h3>{title}</h3>}
        {unitLabel && <p className="analytics-print-note">{unitLabel}</p>}
        <table className="analytics-print-editable-table">
            <thead><tr><th className="analytics-print-select-column" aria-label="Include row"></th>{headers.map((header, index) => <th key={`${title}-header-${index}`}><EditablePrintValue id={`${title}:header:${index}`} value={header} edits={edits} onEdit={onEdit} /></th>)}</tr></thead>
            <tbody>{rows.map((row) => {
                const included = !excludedRows.has(row.id);

                return <tr key={row.id} className={included ? undefined : 'analytics-print-row-excluded'}>
                    <td className="analytics-print-select-column"><input type="checkbox" checked={included} onChange={() => onToggleRow(row.id)} aria-label={`Include ${row.cells[0] || title} in print`} /></td>
                    {row.cells.map((cell, index) => <td key={`${row.id}-cell-${index}`}><EditablePrintValue id={`${row.id}:cell:${index}`} value={cell} edits={edits} onEdit={onEdit} /></td>)}
                </tr>;
            })}</tbody>
        </table>
    </section>;
}

function AnalyticsPrintList({ title, rows, excludedRows, edits, onToggleRow, onEdit }: {
    title: string;
    rows: AnalyticsPrintRow[];
    excludedRows: Set<string>;
    edits: Record<string, string>;
    onToggleRow: (id: string) => void;
    onEdit: (id: string, value: string) => void;
}) {
    const hasIncludedRows = rows.some((row) => !excludedRows.has(row.id));

    return <section className="analytics-print-data-section" data-print-empty={!hasIncludedRows}>
        <h3>{title}</h3>
        <ul className="analytics-print-editable-list">{rows.map((row) => {
            const included = !excludedRows.has(row.id);

            return <li key={row.id} className={included ? undefined : 'analytics-print-row-excluded'}>
                <input type="checkbox" checked={included} onChange={() => onToggleRow(row.id)} aria-label={`Include ${row.cells[0]} in print`} />
                <EditablePrintValue id={`${row.id}:cell:0`} value={row.cells[0]} edits={edits} onEdit={onEdit} />
            </li>;
        })}</ul>
    </section>;
}

function localDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function dateRange(days: number): { from: string; to: string } {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - days + 1);
    return { from: localDate(from), to: localDate(to) };
}

const currency = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat('en-PH');

const productSortLabels: Record<string, string> = {
    revenue_desc: 'Sales · Highest first',
    revenue_asc: 'Sales · Lowest first',
    quantity_desc: 'Quantity sold · Most first',
    quantity_asc: 'Quantity sold · Fewest first',
    name_asc: 'Livestock listing name · A–Z',
    name_desc: 'Livestock listing name · Z–A',
    listed_newest: 'Date listed · Newest first',
    listed_oldest: 'Date listed · Oldest first',
};

function ProductSortControl({ sort, onChange }: { sort: string; onChange: (value: string) => void }) {
    return <label className="analytics-product-sort">Sort livestock listings
        <select aria-label="Sort livestock listings, affects the Top livestock listings chart and table only" value={sort} onChange={(event) => onChange(event.target.value)}>
            {Object.entries(productSortLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <small>Applies to the Top livestock listings chart and table only.</small>
    </label>;
}

const chartColors = ['#477a57', '#bd6945', '#527d9c', '#816497', '#b28b32', '#357c78', '#ae5263', '#627144'];
const statusColors: Record<string, string> = {
    ACTIVE: '#477a57',
    COMPLETED: '#357c78',
    CONFIRMED: '#527d9c',
    DRAFT: '#77817a',
    FAILED: '#ae5263',
    FULFILLING: '#816497',
    OPEN: '#bd6945',
    PAID: '#357c78',
    PENDING: '#b28b32',
    PENDING_CONFIRMATION: '#b28b32',
    PENDING_REVIEW: '#b28b32',
    PREPARING: '#527d9c',
    READY_FOR_PICKUP: '#357c78',
    REJECTED: '#ae5263',
    RESOLVED: '#477a57',
    UNDER_REVIEW: '#816497',
};

function chartColor(label: string): string {
    const statusColor = statusColors[label.toUpperCase().replaceAll(' ', '_')];
    if (statusColor) return statusColor;
    let hash = 0;
    for (const character of label.toLowerCase()) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    return chartColors[hash % chartColors.length];
}

function chartValue(item: ChartData[number], currencyValues: boolean): string {
    return item.formatted ?? (currencyValues ? currency.format(item.value) : integer.format(item.value));
}

function BarChart({ title, values, currencyValues = false, unitLabel, limit, emptyMessage, onExpand, headingControl, showExpand = true }: {
    title: string;
    values: ChartData;
    currencyValues?: boolean;
    unitLabel?: string;
    limit?: number;
    emptyMessage?: string;
    onExpand: () => void;
    headingControl?: React.ReactNode;
    showExpand?: boolean;
}) {
    const maximum = Math.max(1, ...values.map((item) => item.value));
    const visibleValues = limit ? values.slice(0, limit) : values;
    return <section className="analytics-card">
        <div className={`analytics-card-heading${showExpand ? headingControl ? ' analytics-card-heading-expand-control' : ' analytics-card-heading-expand' : ''}`}>
            <h3>{title}</h3>
            {(headingControl || showExpand) && <div className="analytics-chart-actions">{headingControl}{showExpand && <button type="button" onClick={onExpand} aria-label={`Open ${title} chart full view`}>Expand</button>}</div>}
        </div>
        {values.length ? <>
            {unitLabel && <p className="analytics-chart-unit">{unitLabel}</p>}
            <div className="analytics-bars" role="list" aria-label={`${title} horizontal bar chart`}>
            {visibleValues.map((item) => <div className="analytics-bar-row" role="listitem" key={item.label} aria-label={`${item.label}: ${chartValue(item, currencyValues)}`}>
                <span title={item.label}>{item.label}</span>
                {item.value > 0 ? <div className="analytics-bar-track" aria-hidden="true"><i style={{ width: `${item.value / maximum * 100}%`, backgroundColor: chartColor(item.label) }} /></div> : <span className="analytics-zero-bar" aria-hidden="true" />}
                <strong>{chartValue(item, currencyValues)}</strong>
            </div>)}
            </div>
            {limit && values.length > limit && <p className="analytics-chart-unit">Showing {integer.format(limit)} of {integer.format(values.length)} categories. Expand to view all.</p>}
        </> : <p className="analytics-empty">{emptyMessage ?? `No ${title.toLowerCase()} data for this selection.`}</p>}
    </section>;
}

function DonutChart({ title, values, currencyValues = false, unitLabel, emptyMessage, onExpand, showExpand = true }: {
    title: string;
    values: ChartData;
    currencyValues?: boolean;
    unitLabel?: string;
    emptyMessage?: string;
    onExpand: () => void;
    showExpand?: boolean;
}) {
    const total = values.reduce((sum, item) => sum + item.value, 0);
    const radius = 43;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;

    return <section className="analytics-card analytics-donut-card">
        <div className={`analytics-card-heading${showExpand ? ' analytics-card-heading-expand' : ''}`}><h3>{title}</h3>{showExpand && <button type="button" onClick={onExpand} aria-label={`Open ${title} chart full view`}>Expand</button>}</div>
        {unitLabel && <p className="analytics-chart-unit">{unitLabel}</p>}
        {total > 0 ? <>
            <div className="analytics-donut-layout">
                <svg className="analytics-donut" viewBox="0 0 120 120" role="img" aria-label={`${title} donut chart. Total ${chartValue({ label: 'total', value: total }, currencyValues)}.`}>
                    <title>{title}: {chartValue({ label: 'total', value: total }, currencyValues)}</title>
                    <circle className="analytics-donut-track" cx="60" cy="60" r={radius} />
                    {values.map((item, index) => {
                        const segment = item.value > 0 ? item.value / total * circumference : 0;
                        const circle = <circle
                            key={item.label}
                            className="analytics-donut-segment"
                            cx="60"
                            cy="60"
                            r={radius}
                            stroke={chartColor(item.label)}
                            strokeDasharray={`${segment} ${circumference - segment}`}
                            strokeDashoffset={-offset}
                        ><title>{item.label}: {chartValue(item, currencyValues)} ({(item.value / total * 100).toFixed(1)}%)</title></circle>;
                        offset += segment;
                        return circle;
                    })}
                    <text x="60" y="57" textAnchor="middle">{integer.format(values.filter((item) => item.value > 0).length)}</text>
                    <text className="analytics-donut-center-label" x="60" y="70" textAnchor="middle">total</text>
                </svg>
                <ul className="analytics-donut-legend" aria-label={`${title} legend`}>
                    {values.map((item, index) => <li key={item.label}>
                        <span className="analytics-donut-swatch" style={{ backgroundColor: chartColor(item.label) }} aria-hidden="true" />
                        <span className="analytics-donut-label">{item.label}</span>
                        <strong>{chartValue(item, currencyValues)}</strong>
                        <small>{total ? `${(item.value / total * 100).toFixed(1)}%` : '0%'}</small>
                    </li>)}
                </ul>
            </div>
            <p className="analytics-chart-unit">Total: {chartValue({ label: 'total', value: total }, currencyValues)}</p>
        </> : <p className="analytics-empty">{emptyMessage ?? (title === 'Sales by category' ? 'No sales recorded in this date range.' : `No ${title.toLowerCase()} data for this selection.`)}</p>}
    </section>;
}

type TrendMetric = 'revenue' | 'orders' | 'units';

function TrendChart({ values, metric, onMetricChange, onExpand, adminPresentation = false, showExpand = true }: { values: Analytics['series']; metric: TrendMetric; onMetricChange: (metric: TrendMetric) => void; onExpand: () => void; adminPresentation?: boolean; showExpand?: boolean }) {
    const width = 800;
    const height = 210;
    const label = metric === 'revenue' ? 'Gross sales' : metric === 'orders' ? 'Orders' : 'Units sold';
    const value = (item: Analytics['series'][number]) => item[metric];
    const max = Math.max(1, ...values.map(value));
    const pointX = (index: number) => values.length < 2 ? width / 2 : 72 + index * (width - 96) / (values.length - 1);
    const points = values.map((item, index) => `${pointX(index)},${height - 30 - value(item) / max * (height - 58)}`).join(' ');
    const areaPoints = values.length > 1 ? `${pointX(0)},${height - 30} ${points} ${pointX(values.length - 1)},${height - 30}` : '';
    const labelStep = Math.max(1, Math.ceil(values.length / 6));
    return <section className={`analytics-card analytics-trend${adminPresentation ? ' analytics-trend-admin' : ''}`}>
        <div className={`analytics-card-heading${showExpand ? ' analytics-card-heading-expand' : ''}`}><h3>{label} over time</h3>{showExpand && <button type="button" onClick={onExpand}>Expand</button>}</div>
        <div className="analytics-tabs" role="group" aria-label="Time series metric">{(['revenue', 'orders', 'units'] as const).map((item) => <button type="button" key={item} aria-pressed={metric === item} onClick={() => onMetricChange(item)}>{item === 'revenue' ? 'Sales' : item === 'orders' ? 'Orders' : 'Units'}</button>)}</div>
        <p className="analytics-chart-unit">{metric === 'revenue' ? 'Philippine pesos (₱)' : metric === 'orders' ? 'Orders' : 'Units sold'} · daily totals</p>
        {values.some((item) => value(item) > 0) ? <>
            <svg className="analytics-trend-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label} over time line chart from ${values[0]?.date} to ${values.at(-1)?.date}`}>
                <title>Daily {label.toLowerCase()} {metric === 'revenue' ? 'in Philippine pesos' : ''}</title>
                {[0, 0.5, 1].map((fraction) => {
                    const y = height - 30 - fraction * (height - 58);
                    const shown = metric === 'revenue' ? currency.format(max * fraction) : integer.format(max * fraction);
                    return <g key={fraction}><line className="analytics-grid-line" x1="64" y1={y} x2={width - 16} y2={y} /><text className="analytics-y-label" x="58" y={y + 4} textAnchor="end">{shown}</text></g>;
                })}
                {adminPresentation && areaPoints && <polygon className="analytics-trend-area" points={areaPoints} />}
                <polyline points={points} />
                {values.map((item, index) => {
                    const x = pointX(index);
                    const y = height - 30 - value(item) / max * (height - 58);
                    const shown = metric === 'revenue' ? currency.format(value(item)) : integer.format(value(item));
                    return <circle key={item.date} cx={x} cy={y} r="3"><title>{item.date}: {shown}</title></circle>;
                })}
                {values.map((item, index) => index % labelStep === 0 || index === values.length - 1
                    ? <text className="analytics-x-label" key={`${item.date}-label`} x={pointX(index)} y={height - 5} textAnchor="middle">{item.date.slice(5)}</text>
                    : null)}
            </svg>
            <ol className="sr-only">{values.map((item) => <li key={item.date}>{item.date}: {metric === 'revenue' ? currency.format(value(item)) : integer.format(value(item))}</li>)}</ol>
        </> : <p className="analytics-empty">{metric === 'revenue' ? 'No sales recorded in this date range.' : `No ${label.toLowerCase()} in this date range.`}</p>}
    </section>;
}

function GrowthChart({ values, onExpand, showExpand = true }: { values: NonNullable<Analytics['growth_series']>; onExpand: () => void; showExpand?: boolean }) {
    const metrics = [
        { key: 'sellers', label: 'Sellers' },
        { key: 'buyers', label: 'Buyers' },
        { key: 'listings', label: 'Listings' },
        { key: 'orders', label: 'Orders' },
    ] as const;
    const max = Math.max(1, ...values.flatMap((row) => metrics.map((metric) => row[metric.key])));
    return <section className="analytics-card analytics-growth">
        <div className={`analytics-card-heading${showExpand ? ' analytics-card-heading-expand' : ''}`}><h3>Marketplace activity over time</h3>{showExpand && <button type="button" onClick={onExpand}>Expand chart</button>}</div>
        <div className="analytics-growth-legend">{metrics.map((metric) => <span key={metric.key}>{metric.label}</span>)}</div>
        {values.some((row) => metrics.some((metric) => row[metric.key] > 0)) ? <div className="analytics-growth-bars">
            {values.filter((row) => metrics.some((metric) => row[metric.key] > 0)).map((row) => <div className="analytics-growth-day" key={row.date} title={row.date}>
                <div>{metrics.map((metric) => row[metric.key] > 0 ? <i key={metric.key} className={`growth-${metric.key}`} style={{ height: `${Math.max(2, row[metric.key] / max * 100)}%` }} title={`${metric.label}: ${row[metric.key]}`} /> : null)}</div><small>{row.date.slice(5)}</small>
            </div>)}
        </div> : <p className="analytics-empty">No marketplace activity in this date range.</p>}
    </section>;
}

function DataTable({ title, headers, rows, empty, headingControl }: { title: string; headers: string[]; rows: React.ReactNode[][]; empty: string; headingControl?: React.ReactNode }) {
    const pageSize = 5;
    const [page, setPage] = React.useState(1);
    const lastPage = Math.max(1, Math.ceil(rows.length / pageSize));
    const currentPage = Math.min(page, lastPage);
    const firstRowIndex = (currentPage - 1) * pageSize;
    const visibleRows = rows.slice(firstRowIndex, firstRowIndex + pageSize);

    return <section className="analytics-card analytics-table-card"><div className="analytics-card-heading"><h3>{title}</h3>{headingControl}</div>
        {rows.length ? <>
            <div className="analytics-table-scroll"><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{visibleRows.map((row, index) => <tr key={firstRowIndex + index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>
            {rows.length > pageSize && <div className="analytics-table-pagination">
                <span>Showing {firstRowIndex + 1}–{Math.min(firstRowIndex + pageSize, rows.length)} of {rows.length} records</span>
                <Pagination page={currentPage} lastPage={lastPage} onChange={setPage} label={`${title} pages`} />
            </div>}
        </> : <p className="analytics-empty">{empty}</p>}
    </section>;
}

function PrintTrend({ values, metric }: { values: Analytics['series']; metric: TrendMetric }) {
    const metricLabel = metric === 'revenue' ? 'Gross sales' : metric === 'orders' ? 'Orders' : 'Livestock quantity sold';
    const metricValue = (item: Analytics['series'][number]) => item[metric];
    const max = Math.max(1, ...values.map(metricValue));
    const points = values.map((item, index) => `${values.length < 2 ? 400 : 24 + index * 752 / (values.length - 1)},${175 - metricValue(item) / max * 145}`).join(' ');
    return <svg className="analytics-print-trend" viewBox="0 0 800 190" role="img" aria-label={`${metricLabel} by day`}>
        <title>{metricLabel} by day</title>
        <line x1="24" y1="175" x2="776" y2="175" />
        <polyline points={points} />
        <text x="24" y="188">{values[0]?.date ?? ''}</text><text x="660" y="188">{values.at(-1)?.date ?? ''}</text>
    </svg>;
}

export function AnalyticsDashboard({ role, preparedBy = '', onOpenOrder }: AnalyticsDashboardProps) {
    const [range, setRange] = React.useState(() => dateRange(30));
    const [preset, setPreset] = React.useState('30');
    const [categoryId, setCategoryId] = React.useState('');
    const [listingId, setListingId] = React.useState('');
    const [sellerId, setSellerId] = React.useState('');
    const [status, setStatus] = React.useState('');
    const [sort, setSort] = React.useState('revenue_desc');
    const [analytics, setAnalytics] = React.useState<Analytics | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [refreshVersion, setRefreshVersion] = React.useState(0);
    const hasLoadedAnalytics = React.useRef(false);
    const [error, setError] = React.useState('');
    const [printError, setPrintError] = React.useState('');
    const [printing, setPrinting] = React.useState(false);
    const [expanded, setExpanded] = React.useState<
        { title: string; type: 'trend' | 'growth' } | { title: string; type: 'chart'; chartKind: ChartKind } | null
    >(null);
    const [printPreview, setPrintPreview] = React.useState(false);
    const [excludedPrintRows, setExcludedPrintRows] = React.useState<Set<string>>(new Set());
    const [printEdits, setPrintEdits] = React.useState<Record<string, string>>({});
    const printSelectionInitialized = React.useRef(false);
    const [analysisOpen, setAnalysisOpen] = React.useState(false);
    const [trendMetric, setTrendMetric] = React.useState<TrendMetric>('revenue');

    React.useEffect(() => {
        const refresh = () => {
            if (document.visibilityState !== 'hidden') {
                setRefreshVersion((current) => current + 1);
            }
        };
        const interval = window.setInterval(refresh, 30000);
        window.addEventListener('focus', refresh);
        document.addEventListener('visibilitychange', refresh);

        return () => {
            window.clearInterval(interval);
            window.removeEventListener('focus', refresh);
            document.removeEventListener('visibilitychange', refresh);
        };
    }, []);

    React.useEffect(() => {
        if (range.from && range.to && range.to < range.from) {
            setError('End date must be on or after the start date.');
            setAnalytics(null);
            setLoading(false);
            return undefined;
        }
        let active = true;
        if (!hasLoadedAnalytics.current) setLoading(true);
        setError('');
        api.get<Analytics>('/api/analytics', {
            params: {
                ...range,
                category_id: categoryId || undefined,
                listing_id: listingId || undefined,
                seller_id: role === 'ADMIN' ? sellerId || undefined : undefined,
                status: status || undefined,
                sort,
            },
        }).then((response) => {
            if (active) {
                setAnalytics(response.data);
                hasLoadedAnalytics.current = true;
            }
        }).catch((requestError: { userMessage?: string }) => {
            if (active) setError(requestError.userMessage ?? 'Analytics could not be loaded.');
        }).finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [categoryId, listingId, range, refreshVersion, role, sellerId, sort, status]);

    const summary = analytics?.summary;
    const statusChart = Object.entries(analytics?.order_statuses ?? {}).map(([label, value]) => ({ label: label.replaceAll('_', ' '), value }));
    const listingStatusChart = Object.entries(analytics?.listing_statuses ?? {}).map(([label, value]) => ({ label: label.replaceAll('_', ' '), value }));
    const paymentChart = Object.entries(analytics?.payment_statuses ?? {}).map(([label, value]) => ({ label, value }));
    const productChart = (analytics?.products ?? []).map((product) => ({ label: product.name, value: product.revenue, formatted: `${currency.format(product.revenue)} · quantity ${integer.format(product.units)}` }));
    const categoryChart = (analytics?.category_listings ?? []).map((item) => ({ label: item.category, value: item.count })).sort((left, right) => right.value - left.value);
    const salesCategoryChart = (analytics?.category_sales ?? []).map((item) => ({ label: item.category, value: item.revenue }));
    const supplyCategoryChart = (analytics?.category_supply ?? []).map((item) => ({ label: item.category, value: item.units, formatted: `Quantity ${integer.format(item.units)}` }));
    const selectedFilterNames = [
        categoryId ? `Category: ${analytics?.filters.categories.find((item) => String(item.id) === categoryId)?.name ?? categoryId}` : '',
        listingId ? `Livestock listing: ${analytics?.filters.products.find((item) => String(item.id) === listingId)?.name ?? listingId}` : '',
        sellerId ? `Seller: ${analytics?.filters.sellers.find((item) => String(item.id) === sellerId)?.name ?? sellerId}` : '',
        status ? `Status: ${status.replaceAll('_', ' ')}` : '',
    ].filter(Boolean);
    const reportTitle = role === 'ADMIN' ? 'Marketplace analytics report' : 'Seller analytics report';

    function setPresetRange(value: string) {
        setPreset(value);
        if (value === 'custom') return;
        setRange(dateRange(Number(value)));
    }

    const printMetricRows = summary ? [
        { id: 'metric-gross-sales', label: 'Gross sales', value: currency.format(summary.gross_sales ?? 0), note: 'Completed order subtotal', visible: (summary.gross_sales ?? 0) > 0 },
        { id: 'metric-orders', label: 'Orders', value: integer.format(summary.orders ?? 0), note: (summary.completed_orders ?? 0) > 0 ? `${integer.format(summary.completed_orders ?? 0)} completed` : '', visible: (summary.orders ?? 0) > 0 },
        { id: 'metric-units-sold', label: 'Units sold', value: integer.format(summary.units_sold ?? 0), note: 'Completed orders', visible: (summary.units_sold ?? 0) > 0 },
        { id: 'metric-average-order-value', label: 'Average order value', value: currency.format(summary.average_order_value ?? 0), note: 'Completed orders', visible: (summary.average_order_value ?? 0) > 0 },
        { id: 'metric-fees', label: 'Fees', value: summary.fees == null ? '' : currency.format(summary.fees), note: 'Recorded seller fees', visible: (summary.fees ?? 0) > 0 },
        { id: 'metric-net-payout', label: 'Estimated net payout', value: summary.net_payout == null ? '' : currency.format(summary.net_payout), note: 'Sales less recorded seller fees', visible: (summary.net_payout ?? 0) > 0 },
        { id: 'metric-discounts', label: 'Recorded discounts', value: summary.discounts == null ? '' : currency.format(summary.discounts), note: 'Promotion codes are not recorded', visible: (summary.discounts ?? 0) > 0 },
        { id: 'metric-proof-recorded', label: 'Delivered with proof', value: integer.format(analytics?.delivery_proof_summary?.recorded ?? 0), note: 'Proof photo and recipient confirmation saved in the selected date range', visible: (analytics?.delivery_proof_summary?.recorded ?? 0) > 0 },
        { id: 'metric-proof-missing', label: 'Delivered missing proof', value: integer.format(analytics?.delivery_proof_summary?.missing ?? 0), note: 'Legacy deliveries may predate the proof requirement', visible: (analytics?.delivery_proof_summary?.missing ?? 0) > 0 },
        { id: 'metric-fulfillment-time', label: 'Average fulfillment time', value: summary.average_fulfillment_hours == null ? '' : `${integer.format(summary.average_fulfillment_hours)} hours`, note: 'Completed order history', visible: (summary.average_fulfillment_hours ?? 0) > 0 },
        {
            id: 'metric-buyers',
            label: 'New / returning buyers',
            value: [
                (summary.new_customers ?? 0) > 0 ? `${integer.format(summary.new_customers ?? 0)} new` : '',
                (summary.returning_customers ?? 0) > 0 ? `${integer.format(summary.returning_customers ?? 0)} returning` : '',
            ].filter(Boolean).join(' · '),
            note: (summary.repeat_purchase_rate ?? 0) > 0 ? `Repeat purchase rate: ${summary.repeat_purchase_rate}%` : '',
            visible: (summary.new_customers ?? 0) > 0 || (summary.returning_customers ?? 0) > 0,
        },
        ...(role === 'ADMIN' ? [
            {
                id: 'metric-active-accounts',
                label: 'Active sellers / buyers',
                value: [
                    (summary.active_sellers ?? 0) > 0 ? `${integer.format(summary.active_sellers ?? 0)} sellers` : '',
                    (summary.buyers ?? 0) > 0 ? `${integer.format(summary.buyers ?? 0)} buyers` : '',
                ].filter(Boolean).join(' · '),
                note: 'Current marketplace accounts',
                visible: (summary.active_sellers ?? 0) > 0 || (summary.buyers ?? 0) > 0,
            },
            { id: 'metric-active-listings', label: 'Active livestock listings', value: integer.format(summary.products ?? 0), note: 'Currently active listings', visible: (summary.products ?? 0) > 0 },
            {
                id: 'metric-payment-rates',
                label: 'Payment success / failure',
                value: [
                    (summary.payment_success_rate ?? 0) > 0 ? `${summary.payment_success_rate}% success` : '',
                    (summary.payment_failure_rate ?? 0) > 0 ? `${summary.payment_failure_rate}% failed` : '',
                ].filter(Boolean).join(' · '),
                note: 'Among paid or failed payment attempts',
                visible: (summary.payment_success_rate ?? 0) > 0 || (summary.payment_failure_rate ?? 0) > 0,
            },
            {
                id: 'metric-refunds',
                label: 'Refunds issued',
                value: [
                    (summary.refunds_issued_count ?? 0) > 0 ? `${integer.format(summary.refunds_issued_count ?? 0)} issued` : '',
                    (summary.refunds_issued_amount ?? 0) > 0 ? currency.format(summary.refunds_issued_amount ?? 0) : '',
                ].filter(Boolean).join(' · '),
                note: (summary.refunds_action_required ?? 0) > 0 ? `${integer.format(summary.refunds_action_required ?? 0)} awaiting return, manual action, or admin reconciliation` : '',
                visible: (summary.refunds_issued_count ?? 0) > 0 || (summary.refunds_issued_amount ?? 0) > 0 || (summary.refunds_action_required ?? 0) > 0,
            },
        ] : []),
    ].filter((row) => row.visible) : [];

    const charts: AnalyticsChart[] = [
        { title: 'Orders by status', kind: 'bar', values: statusChart, unitLabel: 'Orders · filtered date range', emptyMessage: 'No orders recorded in this date range.' },
        { title: 'Top livestock listings by sales', kind: 'bar', values: productChart, currencyValues: true, unitLabel: 'Sales in Philippine pesos (₱) · quantity sold shown beside sales', emptyMessage: 'No sales recorded in this date range.' },
        { title: 'Listings by status', kind: 'donut', values: listingStatusChart, unitLabel: 'Current listings by status' },
        { title: 'Listings by category', kind: 'bar', values: categoryChart, unitLabel: 'Current listing count', emptyMessage: 'No listings match this selection.', limit: 6 },
        { title: 'Sales by category', kind: 'donut', values: salesCategoryChart, currencyValues: true, unitLabel: 'Completed sales in Philippine pesos (₱)', emptyMessage: 'No sales recorded in this date range.' },
        { title: 'Active supply by category', kind: 'bar', values: supplyCategoryChart, unitLabel: 'Available livestock quantity in active listings', emptyMessage: 'No active supply matches this selection.' },
        ...(role === 'ADMIN' ? [{ title: 'Payments by status', kind: 'bar' as const, values: paymentChart, unitLabel: 'Payment count · filtered date range', emptyMessage: 'No payment records in this date range.' }] : []),
    ];
    const adminInventoryChart: AnalyticsChart = {
        title: 'Inventory by category',
        kind: 'donut',
        values: (analytics?.category_supply ?? []).map((item) => ({ label: item.category, value: item.units })),
        unitLabel: 'Available livestock quantity in active listings',
        emptyMessage: 'No active supply matches this selection.',
    };
    const trendTitle = trendMetric === 'revenue' ? 'Gross sales over time' : trendMetric === 'orders' ? 'Orders over time' : 'Livestock quantity sold over time';
    const trendData = (analytics?.series ?? []).filter((item) => item.revenue > 0 || item.orders > 0 || item.units > 0);
    const trendRows: AnalyticsPrintRow[] = trendData.map((item) => ({
        id: `trend-${item.date}`,
        cells: [
            item.date,
            item.revenue > 0 ? currency.format(item.revenue) : '',
            item.orders > 0 ? integer.format(item.orders) : '',
            item.units > 0 ? integer.format(item.units) : '',
        ],
    }));
    const trendHeaders = [
        'Date',
        ...(trendData.some((item) => item.revenue > 0) ? ['Gross sales'] : []),
        ...(trendData.some((item) => item.orders > 0) ? ['Orders'] : []),
        ...(trendData.some((item) => item.units > 0) ? ['Livestock quantity'] : []),
    ];
    const printableCharts = charts.map((chart) => {
        const values = chart.values.filter((item) => item.value > 0);
        const total = values.reduce((sum, item) => sum + item.value, 0);

        return {
            chart,
            rows: values.map((item) => ({
                id: `chart-${chart.title}-${item.label}`,
                cells: [
                    item.label,
                    chartValue(item, chart.currencyValues ?? false),
                    ...(chart.kind === 'donut' ? [`${(item.value / total * 100).toFixed(1)}%`] : []),
                ],
            })),
        };
    });
    const growthData = (analytics?.growth_series ?? []).filter((item) => item.sellers > 0 || item.buyers > 0 || item.listings > 0 || item.orders > 0);
    const growthHeaders = [
        'Date',
        ...(growthData.some((item) => item.sellers > 0) ? ['Sellers'] : []),
        ...(growthData.some((item) => item.buyers > 0) ? ['Buyers'] : []),
        ...(growthData.some((item) => item.listings > 0) ? ['Listings'] : []),
        ...(growthData.some((item) => item.orders > 0) ? ['Orders'] : []),
    ];
    const growthRows: AnalyticsPrintRow[] = growthData.map((item) => ({
        id: `growth-${item.date}`,
        cells: [
            item.date,
            ...(growthHeaders.includes('Sellers') ? [item.sellers > 0 ? integer.format(item.sellers) : ''] : []),
            ...(growthHeaders.includes('Buyers') ? [item.buyers > 0 ? integer.format(item.buyers) : ''] : []),
            ...(growthHeaders.includes('Listings') ? [item.listings > 0 ? integer.format(item.listings) : ''] : []),
            ...(growthHeaders.includes('Orders') ? [item.orders > 0 ? integer.format(item.orders) : ''] : []),
        ],
    }));
    const productData = (analytics?.products ?? []).filter((item) => item.revenue > 0 || item.units > 0);
    const productHeaders = [
        'Livestock listing',
        'Category',
        ...(productData.some((item) => item.revenue > 0) ? ['Sales'] : []),
        ...(productData.some((item) => item.units > 0) ? ['Quantity sold'] : []),
        'Date listed',
    ];
    const productRows: AnalyticsPrintRow[] = productData.map((item) => ({
        id: `product-${item.id}`,
        cells: [
            item.name,
            item.category,
            ...(productHeaders.includes('Sales') ? [item.revenue > 0 ? currency.format(item.revenue) : ''] : []),
            ...(productHeaders.includes('Quantity sold') ? [item.units > 0 ? integer.format(item.units) : ''] : []),
            new Date(item.listed_at).toLocaleDateString(),
        ],
    }));
    const lowStockRows: AnalyticsPrintRow[] = (analytics?.low_stock ?? [])
        .filter((item) => item.quantity > 0)
        .map((item) => ({ id: `low-stock-${item.id}`, cells: [item.name, item.category, integer.format(item.quantity)] }));
    const inventoryRows: AnalyticsPrintRow[] = (analytics?.inventory ?? [])
        .filter((item) => item.quantity > 0)
        .map((item) => ({ id: `inventory-${item.id}`, cells: [item.name, item.category, integer.format(item.quantity), item.status.replaceAll('_', ' ')] }));
    const sellerRows: AnalyticsPrintRow[] = (analytics?.seller_performance ?? [])
        .filter((item) => item.orders > 0 || item.sales > 0)
        .map((item) => ({ id: `seller-${item.id}`, cells: [item.name, item.orders > 0 ? integer.format(item.orders) : '', item.sales > 0 ? currency.format(item.sales) : ''] }));
    const complaintRows: AnalyticsPrintRow[] = analytics?.complaints ? [
        ...(analytics.complaints.total > 0 ? [{ id: 'complaint-total', cells: ['Total', integer.format(analytics.complaints.total)] }] : []),
        ...(analytics.complaints.open > 0 ? [{ id: 'complaint-open', cells: ['Open', integer.format(analytics.complaints.open)] }] : []),
        ...(analytics.complaints.resolved > 0 ? [{ id: 'complaint-resolved', cells: ['Resolved', integer.format(analytics.complaints.resolved)] }] : []),
        ...(analytics.complaints.average_resolution_hours != null && analytics.complaints.average_resolution_hours > 0
            ? [{ id: 'complaint-average-resolution', cells: ['Average hours to resolve', new Intl.NumberFormat('en-PH', { maximumFractionDigits: 1 }).format(analytics.complaints.average_resolution_hours)] }]
            : []),
    ] : [];
    const delayedData = (analytics?.delayed_orders ?? []).filter((item) => item.age_hours > 0 || item.total > 0);
    const delayedHeaders = [
        'Order',
        'Status',
        ...(delayedData.some((item) => item.age_hours > 0) ? ['Age'] : []),
        ...(delayedData.some((item) => item.total > 0) ? ['Total'] : []),
    ];
    const delayedRows: AnalyticsPrintRow[] = delayedData.map((item) => ({
        id: `delayed-${item.id}`,
        cells: [
            item.reference,
            item.status.replaceAll('_', ' '),
            ...(delayedHeaders.includes('Age') ? [item.age_hours > 0 ? `${integer.format(item.age_hours)} hours` : ''] : []),
            ...(delayedHeaders.includes('Total') ? [item.total > 0 ? currency.format(item.total) : ''] : []),
        ],
    }));
    const decliningData = (analytics?.declining_products ?? []).filter((item) => item.change !== 0 || item.units_change !== 0);
    const decliningHeaders = [
        'Livestock listing',
        ...(decliningData.some((item) => item.change !== 0) ? ['Sales change'] : []),
        ...(decliningData.some((item) => item.units_change !== 0) ? ['Quantity change'] : []),
    ];
    const decliningRows: AnalyticsPrintRow[] = decliningData.map((item) => ({
        id: `declining-${item.id}`,
        cells: [
            item.name,
            ...(decliningHeaders.includes('Sales change') ? [item.change !== 0 ? currency.format(item.change) : ''] : []),
            ...(decliningHeaders.includes('Quantity change') ? [item.units_change !== 0 ? integer.format(item.units_change) : ''] : []),
        ],
    }));
    const unavailableRows: AnalyticsPrintRow[] = Object.values(analytics?.unavailable ?? {})
        .map((reason, index) => ({ id: `unavailable-${index}`, cells: [reason] }));
    const allPrintRowIds = [
        ...printMetricRows.map((row) => row.id),
        ...trendRows.map((row) => row.id),
        ...printableCharts.flatMap(({ rows }) => rows.map((row) => row.id)),
        ...growthRows.map((row) => row.id),
        ...productRows.map((row) => row.id),
        ...lowStockRows.map((row) => row.id),
        ...inventoryRows.map((row) => row.id),
        ...sellerRows.map((row) => row.id),
        ...complaintRows.map((row) => row.id),
        ...delayedRows.map((row) => row.id),
        ...decliningRows.map((row) => row.id),
        ...unavailableRows.map((row) => row.id),
    ];
    const isPrintRowIncluded = (id: string) => !excludedPrintRows.has(id);
    const hasIncludedPrintRows = (rows: AnalyticsPrintRow[]) => rows.some((row) => isPrintRowIncluded(row.id));

    function togglePrintRow(id: string) {
        setExcludedPrintRows((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    function openPrintPreview() {
        if (!printSelectionInitialized.current) {
            setExcludedPrintRows(new Set(unavailableRows.map((row) => row.id)));
            printSelectionInitialized.current = true;
        }
        setPrintPreview(true);
    }

    function editPrintValue(id: string, value: string) {
        setPrintEdits((current) => current[id] === value ? current : { ...current, [id]: value });
    }

    async function printAnalyticsReport() {
        setPrintError('');
        setPrinting(true);
        try {
            if (role === 'ADMIN') {
                await api.post('/api/admin/reports/export-audit', {
                    report_type: 'analytics',
                    record_count: analytics?.summary.orders ?? 0,
                    filters: {
                        from: range.from,
                        to: range.to,
                        category_id: categoryId || undefined,
                        listing_id: listingId || undefined,
                        seller_id: sellerId || undefined,
                        status: status || undefined,
                        sort,
                    },
                });
            }
            window.print();
        } catch (requestError: any) {
            setPrintError(requestError.userMessage ?? 'The analytics report could not be recorded for printing.');
        } finally {
            setPrinting(false);
        }
    }

    return <section className={`analytics-dashboard${role === 'ADMIN' || role === 'SELLER' ? ' analytics-dashboard-admin' : ''}`} aria-labelledby="analytics-title">
        <div className="analytics-dashboard-overview">
            <header className="analytics-header">
                <div><p className="eyebrow">{role === 'ADMIN' ? 'Marketplace analytics' : 'Business analytics'}</p><h2 id="analytics-title">{role === 'ADMIN' ? 'Marketplace performance' : 'Sales and inventory'}</h2><p className="analytics-description">{role === 'ADMIN' ? 'Track marketplace activity, sales, and fulfillment.' : 'Track sales, orders, and inventory for your business.'}</p></div>
                <div className="analytics-actions"><button type="button" onClick={() => setAnalysisOpen(true)} disabled={!analytics || loading}>Analyze with AI</button><button type="button" onClick={openPrintPreview} disabled={!analytics || loading}>Print report</button></div>
            </header>
            <div className="analytics-controls" aria-label="Analytics filters">
                <label>Date range<select aria-label="Date range preset" value={preset} onChange={(event) => setPresetRange(event.target.value)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last 12 months</option><option value="custom">Custom</option></select></label>
                {preset === 'custom' && <>
                    <label>Start date<input type="date" value={range.from} onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))} /></label>
                    <label>End date<input type="date" value={range.to} onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))} /></label>
                </>}
                <label>Category<select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setListingId(''); }}><option value="">All categories</option>{analytics?.filters.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <label>Livestock listing<select value={listingId} onChange={(event) => setListingId(event.target.value)}><option value="">All livestock listings</option>{analytics?.filters.products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                {role === 'ADMIN' && <label>Seller<select value={sellerId} onChange={(event) => setSellerId(event.target.value)}><option value="">All sellers</option>{analytics?.filters.sellers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
                <label>Order status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{['PENDING_CONFIRMATION', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'FULFILLING', 'COMPLETED', 'CANCELLED', 'REJECTED'].map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
            </div>
            {loading && <p className="analytics-state" aria-live="polite">Loading analytics...</p>}
            {error && <p className="analytics-state error" role="alert">{error}</p>}
            {!error && analytics && <div className="analytics-dashboard-overview-results">
                <div className="analytics-metrics analytics-primary-metrics">
                <article><span>Gross sales</span><strong>{currency.format(summary?.gross_sales ?? 0)}</strong><small>Completed order subtotal</small></article>
                <article><span>Orders</span><strong>{integer.format(summary?.orders ?? 0)}</strong><small>{integer.format(summary?.completed_orders ?? 0)} completed</small></article>
                <article><span>Units sold</span><strong>{integer.format(summary?.units_sold ?? 0)}</strong><small>Completed orders</small></article>
                <article><span>Average order value</span><strong>{currency.format(summary?.average_order_value ?? 0)}</strong><small>Completed orders</small></article>
                </div>
                <details className="analytics-more-metrics"><summary>More metrics</summary><div className="analytics-metrics">
                <article><span>Fees</span><strong>{summary?.fees == null ? 'Unavailable' : currency.format(summary.fees)}</strong><small>Recorded seller fees</small></article>
                <article><span>Estimated net payout</span><strong>{summary?.net_payout == null ? 'Unavailable' : currency.format(summary.net_payout)}</strong><small>Sales less recorded seller fees</small></article>
                <article><span>Recorded discounts</span><strong>{summary?.discounts == null ? 'Unavailable' : currency.format(summary.discounts)}</strong><small>Promotion codes are not recorded</small></article>
                <article><span>Delivered with proof</span><strong>{integer.format(analytics.delivery_proof_summary?.recorded ?? 0)}</strong><small>Proof photo and recipient confirmation saved in the selected date range</small></article>
                <article><span>Delivered missing proof</span><strong>{integer.format(analytics.delivery_proof_summary?.missing ?? 0)}</strong><small>Legacy deliveries may predate the proof requirement</small></article>
                <article><span>Avg. fulfillment time</span><strong>{summary?.average_fulfillment_hours == null ? 'Unavailable' : `${integer.format(summary.average_fulfillment_hours)} hours`}</strong><small>Completed order history</small></article>
                <article><span>New / returning buyers</span><strong>{integer.format(summary?.new_customers ?? 0)} / {integer.format(summary?.returning_customers ?? 0)}</strong><small>Repeat purchase rate: {summary?.repeat_purchase_rate == null ? 'Unavailable' : `${summary.repeat_purchase_rate}%`}</small></article>
                {role === 'ADMIN' && <>
                    <article><span>Active sellers / buyers</span><strong>{integer.format(summary?.active_sellers ?? 0)} / {integer.format(summary?.buyers ?? 0)}</strong><small>Current marketplace accounts</small></article>
                    <article><span>Active livestock listings</span><strong>{integer.format(summary?.products ?? 0)}</strong><small>Currently active listings</small></article>
                    <article><span>Payment success / failure</span><strong>{summary?.payment_success_rate == null ? 'Unavailable' : `${summary.payment_success_rate}% / ${summary.payment_failure_rate}%`}</strong><small>Among paid or failed payment attempts</small></article>
                    <article><span>Refunds issued</span><strong>{integer.format(summary?.refunds_issued_count ?? 0)} · {currency.format(summary?.refunds_issued_amount ?? 0)}</strong><small>{integer.format(summary?.refunds_action_required ?? 0)} awaiting return, manual action, or admin reconciliation</small></article>
                </>}
                </div></details>
            </div>}
        </div>
        {!error && analytics && <>
            <section className="analytics-visualizations" aria-labelledby="analytics-visualizations-title">
            <div className="analytics-section-heading"><p className="eyebrow">Performance and inventory mix</p><h3 id="analytics-visualizations-title">Visual overview</h3><p>Sales charts use the selected period. Listing and supply charts show current inventory.</p></div>
            {role === 'ADMIN' && <div className="analytics-admin-featured">
                <TrendChart values={analytics.series} metric={trendMetric} onMetricChange={setTrendMetric} onExpand={() => setExpanded({ title: trendTitle, type: 'trend' })} adminPresentation />
                <DonutChart title={adminInventoryChart.title} values={adminInventoryChart.values} unitLabel={adminInventoryChart.unitLabel} emptyMessage={adminInventoryChart.emptyMessage} onExpand={() => setExpanded({ title: adminInventoryChart.title, type: 'chart', chartKind: adminInventoryChart.kind })} />
            </div>}
            <div className={`analytics-chart-grid${role === 'ADMIN' ? ' analytics-admin-chart-grid' : ''}`}>
                {role !== 'ADMIN' && <TrendChart values={analytics.series} metric={trendMetric} onMetricChange={setTrendMetric} onExpand={() => setExpanded({ title: trendTitle, type: 'trend' })} />}
                {charts.filter((chart) => role !== 'ADMIN' || chart.title !== 'Active supply by category').map((chart) => {
                    const productSort = chart.title === 'Top livestock listings by sales' ? <ProductSortControl sort={sort} onChange={setSort} /> : undefined;
                    const onExpand = () => setExpanded({ title: chart.title, type: 'chart', chartKind: chart.kind });
                    return chart.kind === 'donut'
                        ? <DonutChart key={chart.title} title={chart.title} values={chart.values} currencyValues={chart.currencyValues} unitLabel={chart.unitLabel} emptyMessage={chart.emptyMessage} onExpand={onExpand} />
                        : <BarChart key={chart.title} title={chart.title} values={chart.values} currencyValues={chart.currencyValues} unitLabel={chart.unitLabel} emptyMessage={chart.emptyMessage} limit={chart.limit} headingControl={productSort} onExpand={onExpand} />;
                })}
                {role === 'ADMIN' && analytics.growth_series && <GrowthChart values={analytics.growth_series} onExpand={() => setExpanded({ title: 'Marketplace activity over time', type: 'growth' })} />}
            </div>
            </section>
            <div className="analytics-detail-grid">
                <div className="analytics-section-heading analytics-details-heading"><p className="eyebrow">Record-level detail</p><h3>Livestock listings and availability</h3><p>Livestock sales follow the selected period; availability and listing status show current inventory.</p></div>
                <DataTable title="Top livestock listings by sales and quantity" headers={['Livestock listing', 'Category', 'Sales', 'Quantity sold', 'Date listed']} rows={analytics.products.map((item) => [item.name, item.category, currency.format(item.revenue), integer.format(item.units), new Date(item.listed_at).toLocaleDateString()])} empty="No sales recorded in this date range." headingControl={<ProductSortControl sort={sort} onChange={setSort} />} />
                <DataTable title="Low livestock availability (3 or fewer units)" headers={['Livestock listing', 'Category', 'Available']} rows={analytics.low_stock.map((item) => [item.name, item.category, `${integer.format(item.quantity)} units`])} empty="No low-availability livestock listings." />
                <DataTable title="Active livestock listings" headers={['Livestock listing', 'Category', 'Available', 'Status']} rows={analytics.inventory.map((item) => [item.name, item.category, `${integer.format(item.quantity)} units`, item.status.replaceAll('_', ' ')])} empty="No active listings in this selection." />
                {role === 'ADMIN' && <DataTable title="Seller performance" headers={['Seller', 'Orders', 'Gross sales']} rows={analytics.seller_performance.map((item) => [item.name, integer.format(item.orders), currency.format(item.sales)])} empty="No seller orders in this period." />}
                {role === 'ADMIN' && analytics.complaints && <DataTable title="Complaints and resolution" headers={['Total', 'Open', 'Resolved', 'Avg. hours to resolve']} rows={[[integer.format(analytics.complaints.total), integer.format(analytics.complaints.open), integer.format(analytics.complaints.resolved), analytics.complaints.average_resolution_hours == null ? 'Unavailable' : integer.format(analytics.complaints.average_resolution_hours)]]} empty="No complaints in this period." />}
                <DataTable title="Delayed orders (open for 48+ hours)" headers={['Order', 'Status', 'Age', 'Total']} rows={analytics.delayed_orders.map((item) => [item.reference, item.status.replaceAll('_', ' '), `${integer.format(item.age_hours)} hours`, currency.format(item.total)])} empty="No delayed open orders." />
                <DataTable title="Livestock listings declining vs previous equal period" headers={['Livestock listing', 'Sales change', 'Quantity change']} rows={analytics.declining_products.map((item) => [item.name, currency.format(item.change), integer.format(item.units_change)])} empty="No livestock listings have lower sales than the previous equal period." />
            </div>
            <details className="analytics-unavailable"><summary>About this data</summary><p>Some measures are unavailable because FarmGate does not record the underlying events:</p><ul>{Object.values(analytics.unavailable).map((reason) => <li key={reason}>{reason}</li>)}</ul></details>
        </>}
        {expanded && <div className="analytics-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setExpanded(null); }}>
            <section className="analytics-modal" role="dialog" aria-modal="true" aria-labelledby="analytics-chart-full-title">
                <header><div><h2 id="analytics-chart-full-title">{expanded.type === 'trend' ? trendTitle : expanded.title}</h2><p>{range.from} to {range.to} · {selectedFilterNames.join(' · ') || 'No filters'}{expanded.title === 'Top livestock listings by sales' ? ` · Sort livestock listings: ${productSortLabels[sort]}` : ''}</p></div><button type="button" onClick={() => setExpanded(null)}>Close</button></header>
                {expanded.type === 'trend' && <TrendChart values={analytics?.series ?? []} metric={trendMetric} onMetricChange={setTrendMetric} onExpand={() => setExpanded(null)} adminPresentation={role === 'ADMIN'} showExpand={false} />}
                {expanded.type === 'growth' && analytics?.growth_series && <GrowthChart values={analytics.growth_series} onExpand={() => setExpanded(null)} showExpand={false} />}
                {expanded.type === 'chart' && (() => {
                    const chart = expanded.title === adminInventoryChart.title ? adminInventoryChart : charts.find((item) => item.title === expanded.title);
                    if (!chart) return null;
                    return chart.kind === 'donut'
                        ? <DonutChart title={chart.title} values={chart.values} currencyValues={chart.currencyValues} unitLabel={chart.unitLabel} emptyMessage={chart.emptyMessage} onExpand={() => setExpanded(null)} showExpand={false} />
                        : <BarChart title={chart.title} values={chart.values} currencyValues={chart.currencyValues} unitLabel={chart.unitLabel} emptyMessage={chart.emptyMessage} limit={undefined} headingControl={chart.title === 'Top livestock listings by sales' ? <ProductSortControl sort={sort} onChange={setSort} /> : undefined} onExpand={() => setExpanded(null)} showExpand={false} />;
                })()}
            </section>
        </div>}
        {printPreview && analytics && <div className="analytics-modal-backdrop" role="presentation">
            <section className="analytics-modal analytics-print-preview" role="dialog" aria-modal="true" aria-labelledby="analytics-print-preview-title">
                <header><div><h2 id="analytics-print-preview-title">Print preview</h2><p>Review the report before printing.</p></div><button type="button" onClick={() => setPrintPreview(false)}>Close</button></header>
                {printError && <p className="analytics-state error" role="alert">{printError}</p>}
                <div className="analytics-print-editor">
                    <div><strong>Customize this print copy</strong><p>Uncheck rows to leave them out. Select a value to edit it. Changes here do not modify FarmGate records.</p></div>
                    <div className="analytics-print-editor-actions">
                        <button type="button" onClick={() => setExcludedPrintRows(new Set())}>Select all rows</button>
                        <button type="button" disabled={!allPrintRowIds.length} onClick={() => setExcludedPrintRows(new Set(allPrintRowIds))}>Clear row selection</button>
                    </div>
                </div>
                <div className="analytics-print-report">
                    <header className="analytics-print-cover">
                        <div className="analytics-print-brand-row"><strong className="analytics-print-brand">FARM<span>GATE</span></strong><span className="analytics-print-document-type">Business report</span></div>
                        <h1>{reportTitle}</h1>
                        <p className="analytics-print-subtitle">Sales, order activity, and livestock inventory</p>
                        <dl className="analytics-print-meta">
                            <div><dt>Prepared by</dt><dd><EditablePrintValue id="meta-prepared-by" value={preparedBy || role} edits={printEdits} onEdit={editPrintValue} /></dd></div>
                            <div><dt>Report role</dt><dd><EditablePrintValue id="meta-role" value={role} edits={printEdits} onEdit={editPrintValue} /></dd></div>
                            <div><dt>Reporting period</dt><dd><EditablePrintValue id="meta-period" value={`${range.from} to ${range.to}`} edits={printEdits} onEdit={editPrintValue} /></dd></div>
                            {(analytics.summary.orders ?? 0) > 0 && <div><dt>Orders represented</dt><dd>{integer.format(analytics.summary.orders ?? 0)}</dd></div>}
                            <div><dt>Generated</dt><dd>{new Date().toLocaleString()}</dd></div>
                            <div><dt>Livestock sort</dt><dd>{productSortLabels[sort]}</dd></div>
                            <div className="analytics-print-meta-wide"><dt>Filters</dt><dd>{selectedFilterNames.join(' · ') || 'None'}</dd></div>
                        </dl>
                    </header>
                    {printMetricRows.length > 0 && <AnalyticsPrintTable
                        title="Dashboard metrics"
                        headingLevel={2}
                        headers={['Metric', 'Result', 'Basis']}
                        rows={printMetricRows.map((row) => ({ id: row.id, cells: [row.label, row.value, row.note] }))}
                        excludedRows={excludedPrintRows}
                        edits={printEdits}
                        onToggleRow={togglePrintRow}
                        onEdit={editPrintValue}
                    />}
                    {(hasIncludedPrintRows(trendRows) || printableCharts.some(({ rows }) => hasIncludedPrintRows(rows)) || hasIncludedPrintRows(growthRows)) && <>
                        <h2>Performance and inventory mix</h2>
                        {trendRows.length > 0 && <AnalyticsPrintTable
                            title={trendTitle}
                            unitLabel={`${trendMetric === 'revenue' ? 'Philippine pesos (₱)' : trendMetric === 'orders' ? 'Orders' : 'Units sold'} · daily totals`}
                            headers={trendHeaders}
                            rows={trendRows}
                            excludedRows={excludedPrintRows}
                            edits={printEdits}
                            onToggleRow={togglePrintRow}
                            onEdit={editPrintValue}
                        />}
                        {trendData.some((item) => item[trendMetric] > 0 && isPrintRowIncluded(`trend-${item.date}`)) && <PrintTrend
                            values={trendData.filter((item) => item[trendMetric] > 0 && isPrintRowIncluded(`trend-${item.date}`))}
                            metric={trendMetric}
                        />}
                        {printableCharts.map(({ chart, rows }) => rows.length > 0 && <AnalyticsPrintTable
                            key={chart.title}
                            title={chart.title}
                            unitLabel={chart.unitLabel}
                            headers={[chart.kind === 'donut' ? 'Category / status' : 'Item', chart.currencyValues ? 'Sales' : 'Count / quantity', ...(chart.kind === 'donut' ? ['Share'] : [])]}
                            rows={rows}
                            excludedRows={excludedPrintRows}
                            edits={printEdits}
                            onToggleRow={togglePrintRow}
                            onEdit={editPrintValue}
                        />)}
                        {growthRows.length > 0 && <AnalyticsPrintTable
                            title="Marketplace activity over time"
                            headers={growthHeaders}
                            rows={growthRows}
                            excludedRows={excludedPrintRows}
                            edits={printEdits}
                            onToggleRow={togglePrintRow}
                            onEdit={editPrintValue}
                        />}
                    </>}
                    {[
                        productRows,
                        lowStockRows,
                        inventoryRows,
                        ...(role === 'ADMIN' ? [sellerRows, complaintRows] : []),
                        delayedRows,
                        decliningRows,
                    ].some(hasIncludedPrintRows) && <>
                        <h2>Record-level detail</h2>
                        {productRows.length > 0 && <AnalyticsPrintTable title="Top livestock listings by sales and quantity" headers={productHeaders} rows={productRows} excludedRows={excludedPrintRows} edits={printEdits} onToggleRow={togglePrintRow} onEdit={editPrintValue} />}
                        {lowStockRows.length > 0 && <AnalyticsPrintTable title="Low livestock availability (3 or fewer units)" headers={['Livestock listing', 'Category', 'Available']} rows={lowStockRows} excludedRows={excludedPrintRows} edits={printEdits} onToggleRow={togglePrintRow} onEdit={editPrintValue} />}
                        {inventoryRows.length > 0 && <AnalyticsPrintTable title="Active livestock listings" headers={['Livestock listing', 'Category', 'Available', 'Status']} rows={inventoryRows} excludedRows={excludedPrintRows} edits={printEdits} onToggleRow={togglePrintRow} onEdit={editPrintValue} />}
                        {role === 'ADMIN' && sellerRows.length > 0 && <AnalyticsPrintTable title="Seller performance" headers={['Seller', 'Orders', 'Gross sales']} rows={sellerRows} excludedRows={excludedPrintRows} edits={printEdits} onToggleRow={togglePrintRow} onEdit={editPrintValue} />}
                        {role === 'ADMIN' && complaintRows.length > 0 && <AnalyticsPrintTable title="Complaints and resolution" headers={['Measure', 'Result']} rows={complaintRows} excludedRows={excludedPrintRows} edits={printEdits} onToggleRow={togglePrintRow} onEdit={editPrintValue} />}
                        {delayedRows.length > 0 && <AnalyticsPrintTable title="Delayed orders (open for 48+ hours)" headers={delayedHeaders} rows={delayedRows} excludedRows={excludedPrintRows} edits={printEdits} onToggleRow={togglePrintRow} onEdit={editPrintValue} />}
                        {decliningRows.length > 0 && <AnalyticsPrintTable title="Livestock listings declining vs previous equal period" headers={decliningHeaders} rows={decliningRows} excludedRows={excludedPrintRows} edits={printEdits} onToggleRow={togglePrintRow} onEdit={editPrintValue} />}
                    </>}
                    {unavailableRows.length > 0 && <AnalyticsPrintList title="About this data" rows={unavailableRows} excludedRows={excludedPrintRows} edits={printEdits} onToggleRow={togglePrintRow} onEdit={editPrintValue} />}
                    <section className="analytics-print-signatures" aria-labelledby="analytics-print-signatures-title">
                        <div className="analytics-print-signatures-heading"><div><h2 id="analytics-print-signatures-title">Review and acknowledgment</h2><p>Complete by hand on the printed copy, where required.</p></div><span>Report record</span></div>
                        <div className="analytics-print-signature-grid">
                            <div className="analytics-print-signature">
                                <span className="analytics-print-signature-role">Prepared by</span>
                                <div className="analytics-print-signature-line" aria-hidden="true"></div>
                                <strong>{preparedBy || role}</strong>
                                <span>Printed name · {role}</span>
                                <div className="analytics-print-date-line"><span>Signature</span><span>Date</span></div>
                            </div>
                            <div className="analytics-print-signature">
                                <span className="analytics-print-signature-role">Reviewed by (optional)</span>
                                <div className="analytics-print-signature-line" aria-hidden="true"></div>
                                <strong className="analytics-print-blank">Name and title</strong>
                                <span>Authorized reviewer</span>
                                <div className="analytics-print-date-line"><span>Signature</span><span>Date</span></div>
                            </div>
                        </div>
                        <p className="analytics-print-signature-note">A typed name is not a verified electronic signature. Review or signature does not change the underlying Farmgate records.</p>
                    </section>
                    <footer><span>FARMGATE · {reportTitle}</span><span>Generated {new Date().toISOString()}</span></footer>
                </div>
                <div className="analytics-print-actions"><button type="button" disabled={printing} onClick={() => void printAnalyticsReport()}>{printing ? 'Preparing report...' : 'Print report'}</button></div>
            </section>
        </div>}
        {analysisOpen && analytics && <div className="analytics-modal-backdrop">
            <section className="analytics-modal analytics-ai-modal" role="dialog" aria-modal="true" aria-labelledby="analytics-ai-title">
                <header><div><h2 id="analytics-ai-title">Analyze selected report with AI</h2><p>{range.from} to {range.to} · {selectedFilterNames.join(' · ')}</p></div><button type="button" onClick={() => setAnalysisOpen(false)}>Close</button></header>
                <AIChatPage role={role} onOpenOrder={onOpenOrder} reportContext={{ type: 'sales', title: `${reportTitle} (${selectedFilterNames.join(', ') || 'all livestock listings'})`, from: range.from, to: range.to, status: status || undefined, category_id: categoryId ? Number(categoryId) : undefined, listing_id: listingId ? Number(listingId) : undefined, seller_id: role === 'ADMIN' && sellerId ? Number(sellerId) : undefined } satisfies ChatReportContext} />
            </section>
        </div>}
    </section>;
}
