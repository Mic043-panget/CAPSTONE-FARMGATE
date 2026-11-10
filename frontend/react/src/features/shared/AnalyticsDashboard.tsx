import React from 'react';
import api from '../../lib/api';
import type { UserRole } from '../../shared/types';
import { AIChatPage, type ChatReportContext } from './AIChatPage';

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

function BarChart({ title, values, currencyValues = false, unitLabel, limit, emptyMessage, onExpand, headingControl }: {
    title: string;
    values: ChartData;
    currencyValues?: boolean;
    unitLabel?: string;
    limit?: number;
    emptyMessage?: string;
    onExpand: () => void;
    headingControl?: React.ReactNode;
}) {
    const maximum = Math.max(1, ...values.map((item) => item.value));
    const visibleValues = limit ? values.slice(0, limit) : values;
    return <section className="analytics-card">
        <div className="analytics-card-heading"><h3>{title}</h3><div className="analytics-chart-actions">{headingControl}<button type="button" onClick={onExpand} aria-label={`Open ${title} chart full view`}>Expand</button></div></div>
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

function DonutChart({ title, values, currencyValues = false, unitLabel, emptyMessage, onExpand }: {
    title: string;
    values: ChartData;
    currencyValues?: boolean;
    unitLabel?: string;
    emptyMessage?: string;
    onExpand: () => void;
}) {
    const total = values.reduce((sum, item) => sum + item.value, 0);
    const radius = 43;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;

    return <section className="analytics-card analytics-donut-card">
        <div className="analytics-card-heading"><h3>{title}</h3><button type="button" onClick={onExpand} aria-label={`Open ${title} chart full view`}>Expand</button></div>
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

function TrendChart({ values, metric, onMetricChange, onExpand }: { values: Analytics['series']; metric: TrendMetric; onMetricChange: (metric: TrendMetric) => void; onExpand: () => void }) {
    const width = 800;
    const height = 210;
    const label = metric === 'revenue' ? 'Gross sales' : metric === 'orders' ? 'Orders' : 'Units sold';
    const value = (item: Analytics['series'][number]) => item[metric];
    const max = Math.max(1, ...values.map(value));
    const pointX = (index: number) => values.length < 2 ? width / 2 : 72 + index * (width - 96) / (values.length - 1);
    const points = values.map((item, index) => `${pointX(index)},${height - 30 - value(item) / max * (height - 58)}`).join(' ');
    const labelStep = Math.max(1, Math.ceil(values.length / 6));
    return <section className="analytics-card analytics-trend">
        <div className="analytics-card-heading"><h3>{label} over time</h3><button type="button" onClick={onExpand}>Expand</button></div>
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

function GrowthChart({ values, onExpand }: { values: NonNullable<Analytics['growth_series']>; onExpand: () => void }) {
    const metrics = [
        { key: 'sellers', label: 'Sellers' },
        { key: 'buyers', label: 'Buyers' },
        { key: 'listings', label: 'Listings' },
        { key: 'orders', label: 'Orders' },
    ] as const;
    const max = Math.max(1, ...values.flatMap((row) => metrics.map((metric) => row[metric.key])));
    return <section className="analytics-card analytics-growth">
        <div className="analytics-card-heading"><h3>Marketplace activity over time</h3><button type="button" onClick={onExpand}>Expand chart</button></div>
        <div className="analytics-growth-legend">{metrics.map((metric) => <span key={metric.key}>{metric.label}</span>)}</div>
        {values.some((row) => metrics.some((metric) => row[metric.key] > 0)) ? <div className="analytics-growth-bars">
            {values.filter((row) => metrics.some((metric) => row[metric.key] > 0)).map((row) => <div className="analytics-growth-day" key={row.date} title={row.date}>
                <div>{metrics.map((metric) => row[metric.key] > 0 ? <i key={metric.key} className={`growth-${metric.key}`} style={{ height: `${Math.max(2, row[metric.key] / max * 100)}%` }} title={`${metric.label}: ${row[metric.key]}`} /> : null)}</div><small>{row.date.slice(5)}</small>
            </div>)}
        </div> : <p className="analytics-empty">No marketplace activity in this date range.</p>}
    </section>;
}

function DataTable({ title, headers, rows, empty, headingControl }: { title: string; headers: string[]; rows: React.ReactNode[][]; empty: string; headingControl?: React.ReactNode }) {
    return <section className="analytics-card analytics-table-card"><div className="analytics-card-heading"><h3>{title}</h3>{headingControl}</div>
        {rows.length ? <div className="analytics-table-scroll"><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div> : <p className="analytics-empty">{empty}</p>}
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
        ['Gross sales', currency.format(summary.gross_sales ?? 0), 'Completed order subtotal'],
        ['Orders', integer.format(summary.orders ?? 0), `${integer.format(summary.completed_orders ?? 0)} completed`],
        ['Units sold', integer.format(summary.units_sold ?? 0), 'Completed orders'],
        ['Average order value', currency.format(summary.average_order_value ?? 0), 'Completed orders'],
        ['Fees', summary.fees == null ? 'Unavailable' : currency.format(summary.fees), 'Recorded seller fees'],
        ['Estimated net payout', summary.net_payout == null ? 'Unavailable' : currency.format(summary.net_payout), 'Sales less recorded seller fees'],
        ['Recorded discounts', summary.discounts == null ? 'Unavailable' : currency.format(summary.discounts), 'Promotion codes are not recorded'],
        ['Delivered with proof', integer.format(analytics?.delivery_proof_summary?.recorded ?? 0), 'Proof photo and recipient confirmation saved in the selected date range'],
        ['Delivered missing proof', integer.format(analytics?.delivery_proof_summary?.missing ?? 0), 'Legacy deliveries may predate the proof requirement'],
        ['Average fulfillment time', summary.average_fulfillment_hours == null ? 'Unavailable' : `${integer.format(summary.average_fulfillment_hours)} hours`, 'Completed order history'],
        ['New / returning buyers', `${integer.format(summary.new_customers ?? 0)} / ${integer.format(summary.returning_customers ?? 0)}`, `Repeat purchase rate: ${summary.repeat_purchase_rate == null ? 'Unavailable' : `${summary.repeat_purchase_rate}%`}`],
        ...(role === 'ADMIN' ? [
            ['Active sellers / buyers', `${integer.format(summary.active_sellers ?? 0)} / ${integer.format(summary.buyers ?? 0)}`, 'Current marketplace accounts'],
            ['Active livestock listings', integer.format(summary.products ?? 0), 'Currently active listings'],
            ['Payment success / failure', summary.payment_success_rate == null ? 'Unavailable' : `${summary.payment_success_rate}% / ${summary.payment_failure_rate}%`, 'Among paid or failed payment attempts'],
            ['Refunds issued', `${integer.format(summary.refunds_issued_count ?? 0)} · ${currency.format(summary.refunds_issued_amount ?? 0)}`, `${integer.format(summary.refunds_action_required ?? 0)} awaiting return, manual action, or admin reconciliation`],
        ] : []),
    ] : [];

    const charts: AnalyticsChart[] = [
        { title: 'Orders by status', kind: 'bar', values: statusChart, unitLabel: 'Orders · filtered date range', emptyMessage: 'No orders recorded in this date range.' },
        { title: 'Top livestock listings by sales', kind: 'bar', values: productChart, currencyValues: true, unitLabel: 'Sales in Philippine pesos (₱) · quantity sold shown beside sales', emptyMessage: 'No sales recorded in this date range.' },
        { title: 'Listings by status', kind: 'donut', values: listingStatusChart, unitLabel: 'Current listings by status' },
        { title: 'Listings by category', kind: 'bar', values: categoryChart, unitLabel: 'Current listing count', emptyMessage: 'No listings match this selection.', limit: 6 },
        { title: 'Sales by category', kind: 'donut', values: salesCategoryChart, currencyValues: true, unitLabel: 'Completed sales in Philippine pesos (₱)', emptyMessage: 'No sales recorded in this date range.' },
        { title: 'Active supply by category', kind: 'bar', values: supplyCategoryChart, unitLabel: 'Available livestock quantity in active listings', emptyMessage: 'No active supply matches this selection.' },
        ...(role === 'ADMIN' ? [{ title: 'Payments by status', kind: 'bar' as const, values: paymentChart, unitLabel: 'Payment count · filtered date range', emptyMessage: 'No payment records in this date range.' }] : []),
    ];
    const trendTitle = trendMetric === 'revenue' ? 'Gross sales over time' : trendMetric === 'orders' ? 'Orders over time' : 'Livestock quantity sold over time';

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

    return <section className="analytics-dashboard" aria-labelledby="analytics-title">
        <header className="analytics-header">
            <div><p className="eyebrow">{role === 'ADMIN' ? 'Marketplace analytics' : 'Business analytics'}</p><h2 id="analytics-title">{role === 'ADMIN' ? 'Marketplace performance' : 'Sales and inventory'}</h2><p className="analytics-description">{role === 'ADMIN' ? 'Track marketplace activity, sales, and fulfillment.' : 'Track sales, orders, and inventory for your business.'}</p></div>
            <div className="analytics-actions"><button type="button" onClick={() => setAnalysisOpen(true)} disabled={!analytics || loading}>Analyze with AI</button><button type="button" onClick={() => setPrintPreview(true)} disabled={!analytics || loading}>Print report</button></div>
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
        {!error && analytics && <>
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
            <section className="analytics-visualizations" aria-labelledby="analytics-visualizations-title">
            <div className="analytics-section-heading"><p className="eyebrow">Performance and inventory mix</p><h3 id="analytics-visualizations-title">Visual overview</h3><p>Sales charts use the selected period. Listing and supply charts show current inventory.</p></div>
            <div className="analytics-chart-grid">
                <TrendChart values={analytics.series} metric={trendMetric} onMetricChange={setTrendMetric} onExpand={() => setExpanded({ title: trendTitle, type: 'trend' })} />
                {charts.map((chart) => {
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
                {expanded.type === 'trend' && <TrendChart values={analytics?.series ?? []} metric={trendMetric} onMetricChange={setTrendMetric} onExpand={() => setExpanded(null)} />}
                {expanded.type === 'growth' && analytics?.growth_series && <GrowthChart values={analytics.growth_series} onExpand={() => setExpanded(null)} />}
                {expanded.type === 'chart' && (() => {
                    const chart = charts.find((item) => item.title === expanded.title);
                    if (!chart) return null;
                    return chart.kind === 'donut'
                        ? <DonutChart title={chart.title} values={chart.values} currencyValues={chart.currencyValues} unitLabel={chart.unitLabel} emptyMessage={chart.emptyMessage} onExpand={() => setExpanded(null)} />
                        : <BarChart title={chart.title} values={chart.values} currencyValues={chart.currencyValues} unitLabel={chart.unitLabel} emptyMessage={chart.emptyMessage} limit={undefined} headingControl={chart.title === 'Top livestock listings by sales' ? <ProductSortControl sort={sort} onChange={setSort} /> : undefined} onExpand={() => setExpanded(null)} />;
                })()}
            </section>
        </div>}
        {printPreview && analytics && <div className="analytics-modal-backdrop" role="presentation">
            <section className="analytics-modal analytics-print-preview" role="dialog" aria-modal="true" aria-labelledby="analytics-print-preview-title">
                <header><div><h2 id="analytics-print-preview-title">Print preview</h2><p>Review the report before printing.</p></div><button type="button" onClick={() => setPrintPreview(false)}>Close</button></header>
        {printError && <p className="analytics-state error" role="alert">{printError}</p>}
        <div className="analytics-print-report">
                    <header className="analytics-print-cover">
                        <div className="analytics-print-brand-row"><strong className="analytics-print-brand">FARM<span>GATE</span></strong><span className="analytics-print-document-type">Business report</span></div>
                        <h1>{reportTitle}</h1>
                        <p className="analytics-print-subtitle">Sales, order activity, and livestock inventory</p>
                        <dl className="analytics-print-meta">
                            <div><dt>Prepared by</dt><dd>{preparedBy || role}</dd></div>
                            <div><dt>Report role</dt><dd>{role}</dd></div>
                            <div><dt>Reporting period</dt><dd>{range.from} to {range.to}</dd></div>
                            <div><dt>Orders represented</dt><dd>{integer.format(analytics.summary.orders ?? 0)}</dd></div>
                            <div><dt>Generated</dt><dd>{new Date().toLocaleString()}</dd></div>
                            <div><dt>Livestock sort</dt><dd>{productSortLabels[sort]}</dd></div>
                            <div className="analytics-print-meta-wide"><dt>Filters</dt><dd>{selectedFilterNames.join(' · ') || 'None'}</dd></div>
                        </dl>
                    </header>
                    <h2>Dashboard metrics</h2>
                    <table><thead><tr><th>Metric</th><th>Result</th><th>Basis</th></tr></thead><tbody>{printMetricRows.map(([label, value, note]) => <tr key={label}><th>{label}</th><td>{value}</td><td>{note}</td></tr>)}</tbody></table>
                    <h2>Performance and inventory mix</h2>
                    <p className="analytics-print-note">Sales charts use the selected period. Listing and supply charts show current inventory.</p>
                    <h3>{trendTitle}</h3>
                    <p className="analytics-print-note">{trendMetric === 'revenue' ? 'Philippine pesos (₱)' : trendMetric === 'orders' ? 'Orders' : 'Units sold'} · daily totals</p>
                    <table><thead><tr><th>Date</th><th>Gross sales</th><th>Orders</th><th>Livestock quantity</th></tr></thead><tbody>{analytics.series.map((item) => <tr key={item.date}><td>{item.date}</td><td>{currency.format(item.revenue)}</td><td>{integer.format(item.orders)}</td><td>{integer.format(item.units)}</td></tr>)}</tbody></table>
                    {analytics.series.some((item) => item[trendMetric] > 0) ? <PrintTrend values={analytics.series} metric={trendMetric} /> : <p className="analytics-print-note">{trendMetric === 'revenue' ? 'No sales recorded in this date range.' : `No ${trendMetric === 'orders' ? 'orders' : 'livestock quantity'} in this date range.`}</p>}
                    {charts.map((chart) => <section className="analytics-print-data-section" key={chart.title}>
                        <h3>{chart.title}</h3>
                        {chart.unitLabel && <p className="analytics-print-note">{chart.unitLabel}</p>}
                        {chart.values.length ? <table>
                            <thead><tr><th>{chart.kind === 'donut' ? 'Category / status' : 'Item'}</th><th>{chart.currencyValues ? 'Sales' : 'Count / quantity'}</th>{chart.kind === 'donut' && <th>Share</th>}</tr></thead>
                            <tbody>{chart.values.map((item) => {
                                const total = chart.values.reduce((sum, entry) => sum + entry.value, 0);
                                return <tr key={item.label}><td>{item.label}</td><td>{chartValue(item, chart.currencyValues ?? false)}</td>{chart.kind === 'donut' && <td>{total ? `${(item.value / total * 100).toFixed(1)}%` : '0%'}</td>}</tr>;
                            })}</tbody>
                        </table> : <p className="analytics-print-note">{chart.emptyMessage ?? `No ${chart.title.toLowerCase()} data for this selection.`}</p>}
                    </section>)}
                    {role === 'ADMIN' && analytics.growth_series && <section className="analytics-print-data-section">
                        <h3>Marketplace activity over time</h3>
                        <table><thead><tr><th>Date</th><th>Sellers</th><th>Buyers</th><th>Listings</th><th>Orders</th></tr></thead><tbody>{analytics.growth_series.map((item) => <tr key={item.date}><td>{item.date}</td><td>{integer.format(item.sellers)}</td><td>{integer.format(item.buyers)}</td><td>{integer.format(item.listings)}</td><td>{integer.format(item.orders)}</td></tr>)}</tbody></table>
                    </section>}
                    <h2>Record-level detail</h2>
                    <p className="analytics-print-note">Livestock sales follow the selected period; availability and listing status show current inventory.</p>
                    <section className="analytics-print-data-section"><h3>Top livestock listings by sales and quantity</h3>
                        {analytics.products.length ? <table><thead><tr><th>Livestock listing</th><th>Category</th><th>Sales</th><th>Quantity sold</th><th>Date listed</th></tr></thead><tbody>{analytics.products.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.category}</td><td>{currency.format(item.revenue)}</td><td>{integer.format(item.units)}</td><td>{new Date(item.listed_at).toLocaleDateString()}</td></tr>)}</tbody></table> : <p className="analytics-print-note">No sales recorded in this date range.</p>}
                    </section>
                    <section className="analytics-print-data-section"><h3>Low livestock availability (3 or fewer units)</h3>
                        {analytics.low_stock.length ? <table><thead><tr><th>Livestock listing</th><th>Category</th><th>Available</th></tr></thead><tbody>{analytics.low_stock.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.category}</td><td>{integer.format(item.quantity)} units</td></tr>)}</tbody></table> : <p className="analytics-print-note">No low-availability livestock listings.</p>}
                    </section>
                    <section className="analytics-print-data-section"><h3>Active livestock listings</h3>
                        {analytics.inventory.length ? <table><thead><tr><th>Livestock listing</th><th>Category</th><th>Available</th><th>Status</th></tr></thead><tbody>{analytics.inventory.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.category}</td><td>{integer.format(item.quantity)} units</td><td>{item.status.replaceAll('_', ' ')}</td></tr>)}</tbody></table> : <p className="analytics-print-note">No active listings in this selection.</p>}
                    </section>
                    {role === 'ADMIN' && <section className="analytics-print-data-section"><h3>Seller performance</h3>
                        {analytics.seller_performance.length ? <table><thead><tr><th>Seller</th><th>Orders</th><th>Gross sales</th></tr></thead><tbody>{analytics.seller_performance.map((item) => <tr key={item.id}><td>{item.name}</td><td>{integer.format(item.orders)}</td><td>{currency.format(item.sales)}</td></tr>)}</tbody></table> : <p className="analytics-print-note">No seller orders in this period.</p>}
                    </section>}
                    {role === 'ADMIN' && analytics.complaints && <section className="analytics-print-data-section"><h3>Complaints and resolution</h3>
                        <table><thead><tr><th>Total</th><th>Open</th><th>Resolved</th><th>Average hours to resolve</th></tr></thead><tbody><tr><td>{integer.format(analytics.complaints.total)}</td><td>{integer.format(analytics.complaints.open)}</td><td>{integer.format(analytics.complaints.resolved)}</td><td>{analytics.complaints.average_resolution_hours == null ? 'Unavailable' : integer.format(analytics.complaints.average_resolution_hours)}</td></tr></tbody></table>
                    </section>}
                    <section className="analytics-print-data-section"><h3>Delayed orders (open for 48+ hours)</h3>
                        {analytics.delayed_orders.length ? <table><thead><tr><th>Order</th><th>Status</th><th>Age</th><th>Total</th></tr></thead><tbody>{analytics.delayed_orders.map((item) => <tr key={item.id}><td>{item.reference}</td><td>{item.status.replaceAll('_', ' ')}</td><td>{integer.format(item.age_hours)} hours</td><td>{currency.format(item.total)}</td></tr>)}</tbody></table> : <p className="analytics-print-note">No delayed open orders.</p>}
                    </section>
                    <section className="analytics-print-data-section"><h3>Livestock listings declining vs previous equal period</h3>
                        {analytics.declining_products.length ? <table><thead><tr><th>Livestock listing</th><th>Sales change</th><th>Quantity change</th></tr></thead><tbody>{analytics.declining_products.map((item) => <tr key={item.id}><td>{item.name}</td><td>{currency.format(item.change)}</td><td>{integer.format(item.units_change)}</td></tr>)}</tbody></table> : <p className="analytics-print-note">No livestock listings have lower sales than the previous equal period.</p>}
                    </section>
                    <section className="analytics-print-data-section"><h3>About this data</h3><p className="analytics-print-note">Some measures are unavailable because FarmGate does not record the underlying events:</p><ul>{Object.values(analytics.unavailable).map((reason) => <li key={reason}>{reason}</li>)}</ul></section>
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
