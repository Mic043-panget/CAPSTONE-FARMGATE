import React from 'react';
import api from '../../lib/api';
import type { ReportResponse, UserRole } from '../../shared/types';
import { Pagination } from '../../shared/components/Pagination';
import { LoadingSkeleton } from '../../shared/components/LoadingSkeleton';
import { TabNav } from '../../shared/components/TabNav';
import type { ChatReportContext } from './AIChatPage';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { formatCsvDateTime, formatCsvStatus, type CsvColumn } from '../../lib/csvExport';
import { FarmgateDetailDialog } from './FarmgateDetailDialog';
import { ViewDetailsAction } from '../../shared/components/Button';

function dateInTimezone(date: Date, timezone: string): string {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function shiftedDate(date: string, days: number): string {
    const [year, month, day] = date.split('-').map(Number);
    const shifted = new Date(Date.UTC(year, month - 1, day + days));
    return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

function distanceMethodLabel(method: unknown): string {
    if (method === 'OSRM_BARANGAY_ESTIMATE') return 'Barangay-level road distance estimate';
    if (method === 'OSRM_ROAD_ROUTE') return 'OSRM road route';
    return typeof method === 'string' ? method.toLowerCase().replaceAll('_', ' ') : 'Distance method not recorded';
}

function escapePrintText(value: unknown): string {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character] ?? character));
}

function reportFieldLabel(field: string): string {
    return field
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replaceAll('_', ' ')
        .replace(/\b\w/g, (character) => character.toUpperCase());
}

function ReportDetailValue({ value, field, timezone }: { value: unknown; field: string; timezone: string }): React.ReactNode {
    if (value === null || value === undefined || value === '') return '—';
    if (Array.isArray(value)) {
        return value.length
            ? <ul className="report-detail-list">{value.map((item, index) => <li key={`${field}-${index}`}><ReportDetailValue value={item} field={field} timezone={timezone} /></li>)}</ul>
            : '—';
    }
    if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>);
        return entries.length
            ? <dl className="report-detail-nested">{entries.map(([key, nestedValue]) => <div key={key}><dt>{reportFieldLabel(key)}</dt><dd><ReportDetailValue value={nestedValue} field={key} timezone={timezone} /></dd></div>)}</dl>
            : '—';
    }
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'string' && (field.endsWith('_at') || field.endsWith('_date')) && !Number.isNaN(Date.parse(value))) {
        return new Intl.DateTimeFormat('en-PH', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
            timeZone: timezone,
        }).format(new Date(value));
    }
    if (typeof value === 'string' && /(status|role|method|type)$/.test(field)) {
        return value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
    }
    return String(value);
}

type ReportPanelProps = {
    role: UserRole;
    onError: (message: string) => void;
    onAnalyze?: (report: ChatReportContext) => void;
    title?: string;
    hideTypeSelector?: boolean;
    preparedBy?: string;
};

export function ReportPanel({ role, onError, onAnalyze, title, hideTypeSelector = false, preparedBy = 'Not provided' }: ReportPanelProps) {
    const reportTypes = role === 'ADMIN' ? ['sales', 'transactions', 'users', 'complaints'] : role === 'SELLER' ? ['sales', 'transactions', 'listings', 'deliveries'] : role === 'RIDER' ? ['deliveries'] : ['transactions', 'deliveries'];
    const [reportType, setReportType] = React.useState(reportTypes[0]);
    const [reportRows, setReportRows] = React.useState<Record<string, any>[]>([]);
    const [reportTotal, setReportTotal] = React.useState(0);
    const [proofSummary, setProofSummary] = React.useState<ReportResponse['proof_summary']>(null);
    const [reportSearch, setReportSearch] = React.useState('');
    const [reportStatus, setReportStatus] = React.useState('');
    const [reportFrom, setReportFrom] = React.useState('');
    const [reportTo, setReportTo] = React.useState('');
    const [orderStatus, setOrderStatus] = React.useState('');
    const [paymentStatus, setPaymentStatus] = React.useState('');
    const [paymentMethod, setPaymentMethod] = React.useState('');
    const [userRole, setUserRole] = React.useState('');
    const [accountStatus, setAccountStatus] = React.useState('');
    const [complaintType, setComplaintType] = React.useState('');
    const [resolutionStatus, setResolutionStatus] = React.useState('');
    const [amountMin, setAmountMin] = React.useState('');
    const [amountMax, setAmountMax] = React.useState('');
    const [reportTimezone, setReportTimezone] = React.useState('Asia/Manila');
    const [reportLoading, setReportLoading] = React.useState(false);
    const [reportError, setReportError] = React.useState('');
    const [reportRevision, setReportRevision] = React.useState(0);
    const [exporting, setExporting] = React.useState(false);
    const [page, setPage] = React.useState(1);
    const [reportSort, setReportSort] = React.useState('created_at');
    const [reportDirection, setReportDirection] = React.useState<'asc' | 'desc'>('desc');
    const [selectedReportRow, setSelectedReportRow] = React.useState<Record<string, any> | null>(null);
    const debouncedSearch = useDebouncedValue(reportSearch);
    const isAdminReport = role === 'ADMIN' && ['sales', 'transactions', 'users', 'complaints'].includes(reportType);

    React.useEffect(() => {
        const refresh = () => {
            if (document.visibilityState !== 'hidden') {
                setReportRevision((current) => current + 1);
            }
        };
        window.addEventListener('focus', refresh);
        document.addEventListener('visibilitychange', refresh);

        return () => {
            window.removeEventListener('focus', refresh);
            document.removeEventListener('visibilitychange', refresh);
        };
    }, []);

    function closeReportDetails() {
        setSelectedReportRow(null);
    }

    function activeFilters(search = reportSearch): Record<string, string | number | undefined> {
        const filters: Record<string, string | number | undefined> = {
            search: search.trim() || undefined,
            from: reportFrom || undefined,
            to: reportTo || undefined,
        };
        if (isAdminReport) {
            if (reportType === 'sales' || reportType === 'transactions') {
                filters.order_status = orderStatus || undefined;
                filters.payment_status = paymentStatus || undefined;
                if (reportType === 'transactions') filters.payment_method = paymentMethod || undefined;
                filters.amount_min = amountMin || undefined;
                filters.amount_max = amountMax || undefined;
            } else if (reportType === 'users') {
                filters.role = userRole || undefined;
                filters.account_status = accountStatus || undefined;
            } else if (reportType === 'complaints') {
                filters.status = orderStatus || undefined;
                filters.complaint_type = complaintType.trim() || undefined;
                filters.resolution_status = resolutionStatus || undefined;
            }
        } else {
            filters.status = reportStatus || undefined;
        }
        if (role === 'RIDER' && reportType === 'deliveries') {
            filters.sort = reportSort;
            filters.direction = reportDirection;
        }
        return filters;
    }

    React.useEffect(() => {
        if ((reportFrom && reportTo && reportTo < reportFrom) || (amountMin !== '' && amountMax !== '' && Number(amountMin) > Number(amountMax))) {
            setReportRows([]);
            setReportTotal(0);
            setReportError('');
            setReportLoading(false);
            return undefined;
        }
        if (reportSearch !== debouncedSearch) return undefined;
        let active = true;
        setReportLoading(true);
        setReportError('');
        api.get<ReportResponse>(`/api/reports/${reportType}`, { params: { ...activeFilters(debouncedSearch), per_page: 15, page } })
            .then((response) => {
                if (active) {
                    setReportRows(response.data.data.data);
                    setReportTotal(response.data.data.total);
                    setProofSummary(response.data.proof_summary ?? null);
                    if (response.data.timezone) setReportTimezone(response.data.timezone);
                }
            })
            .catch(() => {
                if (active) {
                    setReportRows([]);
                    setReportTotal(0);
                    setReportError('The report could not be loaded. Please try again.');
                    onError('The report could not be loaded.');
                }
            })
            .finally(() => { if (active) setReportLoading(false); });
        return () => { active = false; };
    }, [onError, reportFrom, reportSearch, debouncedSearch, reportStatus, reportTo, reportType, page, orderStatus, paymentStatus, paymentMethod, userRole, accountStatus, complaintType, resolutionStatus, amountMin, amountMax, reportSort, reportDirection, reportRevision]);

    const reportTitle = reportType === 'transactions' ? 'Transactions' : reportType === 'listings' ? 'Livestock listings' : reportType[0].toUpperCase() + reportType.slice(1);
    const selectedRecordReference = selectedReportRow
        ? selectedReportRow.payment_reference ?? selectedReportRow.case_reference ?? selectedReportRow.delivery_reference ?? selectedReportRow.order_reference ?? selectedReportRow.order?.order_reference ?? selectedReportRow.name ?? selectedReportRow.id
        : null;

    const orderStatuses = [
        ['PENDING_CONFIRMATION', 'Pending confirmation'],
        ['CONFIRMED', 'Confirmed'],
        ['PREPARING', 'Preparing'],
        ['READY_FOR_PICKUP', 'Ready for pickup'],
        ['FULFILLING', 'Fulfilling'],
        ['COMPLETED', 'Completed'],
        ['CANCELLED', 'Cancelled'],
        ['REJECTED', 'Rejected'],
    ];
    const complaintStatuses = [
        ['OPEN', 'Open'],
        ['UNDER_REVIEW', 'Under review'],
        ['RESOLVED', 'Resolved'],
        ['REJECTED', 'Rejected'],
    ];
    const statusOptions = reportType === 'sales'
        ? [['COMPLETED', 'Completed']]
        : reportType === 'transactions'
            ? orderStatuses
            : reportType === 'complaints'
                ? complaintStatuses
                : reportType === 'users'
                    ? [['VERIFIED', 'Verified email'], ['UNVERIFIED', 'Unverified email']]
                            : reportType === 'deliveries' && role === 'RIDER'
                                ? [
                                    ['RIDER_ACCEPTED', 'Rider accepted'],
                                    ['PICKUP_PENDING', 'Pickup pending'],
                                    ['PICKED_UP', 'Picked up'],
                                    ['IN_TRANSIT', 'In transit'],
                                    ['DELIVERED', 'Delivered'],
                                    ['FAILED', 'Failed'],
                                    ['CANCELLED', 'Cancelled'],
                                ]
                            : [];

    function displayDate(value: unknown): string {
        if (typeof value !== 'string' || !value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '—';
        return new Intl.DateTimeFormat('en-PH', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
            timeZone: reportTimezone,
        }).format(date);
    }

    function displayMoney(value: unknown): string {
        if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—';
        return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value));
    }

    function changeReportSort(sort: string) {
        if (sort === reportSort) {
            setReportDirection((direction) => direction === 'asc' ? 'desc' : 'asc');
        } else {
            setReportSort(sort);
            setReportDirection('asc');
        }
        setPage(1);
    }

    function displayStatus(value: unknown): string {
        if (value === null || value === undefined || value === '') return '—';
        const status = typeof value === 'object' && value !== null && 'value' in value
            ? String(value.value)
            : String(value);
        return status.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
    }

    function tableColumns(): { header: string; render: (row: Record<string, any>) => React.ReactNode; sortKey?: string }[] {
        const orderStatus = (row: Record<string, any>) => displayStatus(row.status);
        if (reportType === 'sales') return [
            { header: 'Payment Reference', render: (row) => row.payment_reference ?? '—' },
            { header: 'Order Reference', render: (row) => row.order_reference ?? '—' },
            { header: 'Buyer', render: (row) => row.buyer?.name ?? '—' },
            { header: 'Total Amount (₱)', render: (row) => displayMoney(row.total_amount) },
            { header: 'Delivery Fee (₱)', render: (row) => displayMoney(row.delivery_fee) },
            { header: 'Delivery Distance', render: (row) => row.delivery_distance_km === null || row.delivery_distance_km === undefined ? '—' : `${Number(row.delivery_distance_km).toFixed(2)} km · ${distanceMethodLabel(row.delivery_distance_method)}` },
            { header: 'Payment Status', render: (row) => displayStatus(row.payment_status) },
            { header: 'Order Status', render: orderStatus },
            { header: 'Date', render: (row) => displayDate(row.created_at) },
        ];
        if (reportType === 'transactions') return [
            { header: 'Payment Reference', render: (row) => row.payment_reference ?? '—' },
            { header: 'Order Reference', render: (row) => row.order_reference ?? '—' },
            { header: 'Type', render: (row) => displayStatus(row.payment_method) },
            { header: 'Amount (₱)', render: (row) => displayMoney(row.total_amount) },
            { header: 'Delivery Fee (₱)', render: (row) => displayMoney(row.delivery_fee) },
            { header: 'Delivery Distance', render: (row) => row.delivery_distance_km === null || row.delivery_distance_km === undefined ? '—' : `${Number(row.delivery_distance_km).toFixed(2)} km · ${distanceMethodLabel(row.delivery_distance_method)}` },
            { header: 'Payment Status', render: (row) => displayStatus(row.payment_status) },
            { header: 'Order Status', render: orderStatus },
            { header: 'Date', render: (row) => displayDate(row.created_at) },
        ];
        if (reportType === 'users') return [
            { header: 'Name', render: (row) => row.name ?? '—' },
            { header: 'Phone', render: (row) => row.phone_number ?? '—' },
            { header: 'Role', render: (row) => displayStatus(row.role) },
            { header: 'Email Verification', render: (row) => row.email_verified_at ? 'Verified' : 'Unverified' },
            { header: 'Date Registered', render: (row) => displayDate(row.created_at) },
        ];
        if (reportType === 'complaints') return [
            { header: 'Case Reference', render: (row) => row.case_reference ?? '—' },
            { header: 'Order Reference', render: (row) => row.order?.order_reference ?? '—' },
            { header: 'Case Type', render: (row) => row.case_type?.replaceAll('_', ' ') ?? 'COMPLAINT' },
            { header: 'Submitted By', render: (row) => row.opener?.name ?? '—' },
            { header: 'Reason', render: (row) => row.reason ?? '—' },
            { header: 'Complaint Status', render: orderStatus },
            { header: 'Refund Status', render: (row) => row.refund_status?.replaceAll('_', ' ') ?? '—' },
            { header: 'Approved Refund (PHP)', render: (row) => row.approved_refund_amount ?? '—' },
            { header: 'Date Submitted', render: (row) => displayDate(row.created_at) },
        ];
        if (reportType === 'deliveries' && role === 'RIDER') return [
            { header: 'Delivery Reference', render: (row) => row.delivery_reference ?? '—' },
            { header: 'Order reference', sortKey: 'order_reference', render: (row) => row.order_reference ?? '—' },
            { header: 'Status', sortKey: 'status', render: orderStatus },
            { header: 'Proof', render: (row) => row.has_delivery_proof ? 'Photo + recipient confirmation' : 'Missing' },
            { header: 'Photo captured', render: (row) => displayDate(row.proof_captured_at) },
            { header: 'Pickup area', render: (row) => row.pickup_area ?? '—' },
            { header: 'Delivery area', render: (row) => row.dropoff_area ?? '—' },
            { header: 'Assigned', sortKey: 'assigned_at', render: (row) => displayDate(row.assigned_at) },
            { header: 'Pickup verified', sortKey: 'pickup_verified_at', render: (row) => displayDate(row.pickup_verified_at) },
            { header: 'Delivered', sortKey: 'delivery_verified_at', render: (row) => displayDate(row.delivery_verified_at) },
        ];
        if (reportType === 'deliveries') return [
            { header: 'Delivery Reference', render: (row) => row.delivery_reference ?? '—' },
            { header: 'Order reference', render: (row) => row.order?.order_reference ?? '—' },
            { header: 'Status', render: orderStatus },
            { header: 'Proof', render: (row) => row.has_delivery_proof ? 'Photo + recipient confirmation' : 'Missing' },
            { header: 'Photo captured', render: (row) => displayDate(row.proof_captured_at) },
            { header: 'Delivered', render: (row) => displayDate(row.delivery_verified_at) },
            { header: 'Created', render: (row) => displayDate(row.created_at) },
        ];
        return [
            { header: 'Status', render: orderStatus },
            { header: 'Date', render: (row) => displayDate(row.created_at) },
            { header: 'Details', render: (row) => row.name ?? row.total_amount ?? row.order?.order_reference ?? row.order_reference ?? row.email ?? '—' },
        ];
    }

    function exportColumns(): CsvColumn<Record<string, any>>[] {
        const statusValue = (row: Record<string, any>) => row.status;
        const dateColumn = (header: string, value: keyof Record<string, any>): CsvColumn<Record<string, any>> => ({ header, value, format: 'dateTime' });
        const statusColumn: CsvColumn<Record<string, any>> = { header: 'Status', value: statusValue, format: 'status' };
        const columns: Record<string, CsvColumn<Record<string, any>>[]> = {
            sales: [
                { header: 'Payment Reference', value: 'payment_reference' },
                { header: 'Order Reference', value: 'order_reference' },
                { header: 'Buyer', value: (row) => row.buyer?.name },
                { header: 'Seller', value: (row) => row.seller?.name },
                statusColumn,
                { header: 'Payment Method', value: 'payment_method' },
                { header: 'Payment Status', value: 'payment_status', format: 'status' },
                { header: 'Subtotal (PHP)', value: 'subtotal_amount', format: 'currency' },
                { header: 'Delivery Fee (PHP)', value: 'delivery_fee', format: 'currency' },
                { header: 'Delivery Distance (km)', value: 'delivery_distance_km', format: 'number' },
                { header: 'Distance Method', value: (row) => distanceMethodLabel(row.delivery_distance_method) },
                { header: 'Seller Fee (PHP)', value: 'seller_fee', format: 'currency' },
                { header: 'Discount (PHP)', value: 'discount_amount', format: 'currency' },
                { header: 'Total (PHP)', value: 'total_amount', format: 'currency' },
                dateColumn('Created At (UTC)', 'created_at'),
            ],
            transactions: [
                { header: 'Payment Reference', value: 'payment_reference' },
                { header: 'Order Reference', value: 'order_reference' },
                { header: 'Buyer', value: (row) => row.buyer?.name },
                { header: 'Seller', value: (row) => row.seller?.name },
                statusColumn,
                { header: 'Payment Method', value: 'payment_method' },
                { header: 'Payment Status', value: 'payment_status', format: 'status' },
                { header: 'Subtotal (PHP)', value: 'subtotal_amount', format: 'currency' },
                { header: 'Delivery Fee (PHP)', value: 'delivery_fee', format: 'currency' },
                { header: 'Delivery Distance (km)', value: 'delivery_distance_km', format: 'number' },
                { header: 'Distance Method', value: (row) => distanceMethodLabel(row.delivery_distance_method) },
                { header: 'Platform Fee (PHP)', value: 'platform_fee', format: 'currency' },
                { header: 'Order Processing Fee (PHP)', value: 'order_processing_fee', format: 'currency' },
                { header: 'Transaction Fee (PHP)', value: 'transaction_fee', format: 'currency' },
                { header: 'Buyer Service Fee (PHP)', value: 'buyer_service_fee', format: 'currency' },
                { header: 'Seller Fee (PHP)', value: 'seller_fee', format: 'currency' },
                { header: 'Discount (PHP)', value: 'discount_amount', format: 'currency' },
                { header: 'Total (PHP)', value: 'total_amount', format: 'currency' },
                dateColumn('Created At (UTC)', 'created_at'),
            ],
            listings: [
                { header: 'Livestock Listing Name', value: 'name' },
                { header: 'Category', value: (row) => row.category?.name },
                { header: 'Seller', value: (row) => row.seller?.name },
                { header: 'Breed', value: 'breed' },
                { header: 'Sex', value: 'sex' },
                { header: 'Age (Months)', value: 'age_months', format: 'number' },
                { header: 'Estimated Weight (kg)', value: 'estimated_weight_kg', format: 'number' },
                { header: 'Quantity', value: 'quantity', format: 'number' },
                { header: 'Pricing Type', value: (row) => row.pricing_type?.value ?? row.pricing_type, format: 'status' },
                { header: 'Price Per Head (PHP)', value: 'price_per_head', format: 'currency' },
                { header: 'Price Per Kilo (PHP)', value: 'price_per_kilo', format: 'currency' },
                statusColumn,
                dateColumn('Created At (UTC)', 'created_at'),
            ],
            sellers: [],
            buyers: [],
            riders: [],
            users: [
                { header: 'Name', value: 'name' },
                { header: 'Phone', value: 'phone_number' },
                { header: 'Email', value: 'email' },
                { header: 'Role', value: 'role', format: 'status' },
                { header: 'Email Verification', value: (row) => row.email_verified_at ? 'Verified' : 'Unverified' },
                dateColumn('Joined At (UTC)', 'created_at'),
            ],
            categories: [
                { header: 'Name', value: 'name' },
                { header: 'Slug', value: 'slug' },
                { header: 'Active', value: 'is_active', format: 'boolean' },
                { header: 'Livestock Listing Count', value: 'listings_count', format: 'number' },
                dateColumn('Created At (UTC)', 'created_at'),
            ],
            deliveries: role === 'RIDER' ? [
                { header: 'Delivery Reference', value: 'delivery_reference' },
                { header: 'Order Reference', value: 'order_reference' },
                statusColumn,
                { header: 'Proof Recorded', value: 'has_delivery_proof', format: 'boolean' },
                { header: 'Recipient Confirmed', value: 'recipient_confirmed', format: 'boolean' },
                dateColumn('Photo Captured At', 'proof_captured_at'),
                { header: 'Pickup Area', value: 'pickup_area' },
                { header: 'Delivery Area', value: 'dropoff_area' },
                dateColumn('Assigned At', 'assigned_at'),
                dateColumn('Pickup Verified At', 'pickup_verified_at'),
                dateColumn('Delivered At', 'delivery_verified_at'),
            ] : [
                { header: 'Delivery Reference', value: 'delivery_reference' },
                { header: 'Order Reference', value: (row) => row.order?.order_reference },
                { header: 'Rider', value: (row) => row.rider?.name },
                statusColumn,
                { header: 'Proof Recorded', value: 'has_delivery_proof', format: 'boolean' },
                { header: 'Recipient Confirmed', value: 'recipient_confirmed', format: 'boolean' },
                dateColumn('Photo Captured At (UTC)', 'proof_captured_at'),
                dateColumn('Assigned At (UTC)', 'assigned_at'),
                dateColumn('Created At (UTC)', 'created_at'),
            ],
            complaints: [
                { header: 'Case Reference', value: 'case_reference' },
                { header: 'Order Reference', value: (row) => row.order?.order_reference },
                { header: 'Case Type', value: 'case_type' },
                { header: 'Reason', value: 'reason' },
                { header: 'Description', value: 'description' },
                statusColumn,
                { header: 'Refund Status', value: 'refund_status' },
                { header: 'Requested Refund (PHP)', value: 'requested_amount', format: 'currency' },
                { header: 'Approved Refund (PHP)', value: 'approved_refund_amount', format: 'currency' },
                { header: 'Opened By', value: (row) => row.opener?.name },
                { header: 'Respondent', value: (row) => row.respondent?.name },
                { header: 'Resolution', value: 'resolution_reason' },
                { header: 'Resolved By', value: (row) => row.resolver?.name },
                dateColumn('Resolved At (UTC)', 'resolved_at'),
                dateColumn('Created At (UTC)', 'created_at'),
            ],
        };

        if (['sellers', 'buyers', 'riders'].includes(reportType)) return columns.users;
        return columns[reportType] ?? [];
    }

    function reportFilters(search = reportSearch): Record<string, string | number | undefined> {
        return {
            ...activeFilters(search),
            sort: reportSort,
            direction: reportDirection,
            per_page: 100,
        };
    }

    async function fetchAllReportRows(filters: Record<string, string | number | undefined>) {
        const firstPage = await api.get<ReportResponse>(`/api/reports/${reportType}`, { params: { ...filters, page: 1 } });
        const rows = [...firstPage.data.data.data];
        for (let currentPage = 2; currentPage <= firstPage.data.data.last_page; currentPage += 1) {
            const response = await api.get<ReportResponse>(`/api/reports/${reportType}`, { params: { ...filters, page: currentPage } });
            rows.push(...response.data.data.data);
        }
        return { rows, total: firstPage.data.data.total };
    }

    function reportCellValue(row: Record<string, any>, column: CsvColumn<Record<string, any>>) {
        const value = typeof column.value === 'function' ? column.value(row) : row[column.value];
        if (value === null || value === undefined) return '';
        if (column.format === 'status') return formatCsvStatus(value);
        if (column.format === 'boolean') {
            return value === true || value === 1 || value === '1' || value === 'true'
                ? 'Yes'
                : value === false || value === 0 || value === '0' || value === 'false' ? 'No' : '';
        }
        if (column.format === 'dateTime') {
            const date = value instanceof Date ? value : new Date(String(value));
            return Number.isNaN(date.getTime()) ? String(value) : date;
        }
        if (column.format === 'number' || column.format === 'currency') {
            if (typeof value === 'string' && value.trim() === '') return '';
            const number = typeof value === 'number' ? value : Number(String(value).trim());
            return Number.isFinite(number) ? number : '';
        }
        if (typeof value === 'object') return JSON.stringify(value) ?? '';
        return value;
    }

    async function exportSpreadsheet() {
        setExporting(true);
        try {
            const filters = reportFilters();
            const { rows, total } = await fetchAllReportRows(filters);
            const columns = exportColumns();
            const ExcelJS = await import('exceljs');
            const workbook = new ExcelJS.Workbook();
            workbook.creator = preparedBy;
            workbook.created = new Date();
            workbook.subject = `${reportTitle} report`;
            workbook.title = `Farmgate ${reportTitle} Report`;
            workbook.company = 'Farmgate';
            const sheet = workbook.addWorksheet('Report', {
                views: [{ state: 'frozen', ySplit: 9, showGridLines: false }],
                pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
            });
            const generatedAt = new Date();
            const filterSummary = Object.entries(filters)
                .filter(([key, value]) => value !== undefined && key !== 'per_page')
                .map(([key, value]) => `${key.replaceAll('_', ' ')}: ${String(value)}`)
                .join(' · ') || 'None';
            sheet.mergeCells('A1', `${String.fromCharCode(64 + Math.min(columns.length, 26))}1`);
            sheet.getCell('A1').value = 'FARMGATE';
            sheet.getCell('A1').font = { bold: true, size: 18, color: { argb: 'FF185B44' } };
            sheet.mergeCells('A2', `${String.fromCharCode(64 + Math.min(columns.length, 26))}2`);
            sheet.getCell('A2').value = `${reportTitle} Report`;
            sheet.getCell('A2').font = { bold: true, size: 14, color: { argb: 'FF1D3028' } };
            sheet.addRow([`Generated: ${generatedAt.toLocaleString()}`]);
            sheet.addRow([`Prepared by: ${preparedBy}`]);
            sheet.addRow([`Filters: ${filterSummary}`]);
            sheet.addRow([`Records: ${total}`]);
            sheet.addRow(['Signature: ____________________________________     Date: ____________________']);
            sheet.addRow(['Typed name is not a verified electronic signature.']);
            sheet.addRow([]);
            const dataHeaderRow = 9;
            sheet.addTable({
                name: `Farmgate${reportType.replace(/[^a-z0-9]/gi, '')}Report`,
                ref: `A${dataHeaderRow}`,
                headerRow: true,
                totalsRow: false,
                style: { theme: 'TableStyleMedium4', showRowStripes: true },
                columns: columns.map((column) => ({ name: column.header, filterButton: true })),
                rows: rows.map((row) => columns.map((column) => reportCellValue(row, column))),
            });
            const worksheetColumnWidths = columns.map((column, index) => {
                const maxLength = rows.reduce((max, row) => {
                    const value = reportCellValue(row, column);
                    return Math.max(max, String(value instanceof Date ? formatCsvDateTime(value) : value).length);
                }, column.header.length);
                return Math.max(12, Math.min(42, maxLength + 2));
            });
            sheet.columns = columns.map((column, index) => ({
                key: `column${index + 1}`,
                width: worksheetColumnWidths[index],
                style: {
                    alignment: { vertical: 'top', wrapText: true },
                    ...(column.format === 'dateTime' ? { numFmt: 'yyyy-mm-dd hh:mm' } : {}),
                    ...(column.format === 'currency' ? { numFmt: '"₱"#,##0.00;[Red]-"₱"#,##0.00' } : {}),
                    ...(column.format === 'number' ? { numFmt: '#,##0.##' } : {}),
                },
            }));
            sheet.getRow(dataHeaderRow).height = 32;
            sheet.getRow(dataHeaderRow).font = { bold: true, color: { argb: 'FFFFFFFF' } };
            sheet.getRow(dataHeaderRow).alignment = { vertical: 'middle', wrapText: true };
            rows.forEach((row, index) => {
                const excelRow = sheet.getRow(dataHeaderRow + index + 1);
                const longestCell = columns.reduce((max, column, columnIndex) => {
                    const value = reportCellValue(row, column);
                    const text = String(value instanceof Date ? formatCsvDateTime(value) : value);
                    return Math.max(max, Math.ceil(text.length / Math.max(1, worksheetColumnWidths[columnIndex] - 2)));
                }, 1);
                excelRow.height = Math.min(90, Math.max(20, longestCell * 15));
            });
            sheet.pageSetup.printTitlesRow = `${dataHeaderRow}:${dataHeaderRow}`;
            sheet.pageSetup.horizontalCentered = true;
            sheet.headerFooter.oddFooter = '&LFarmgate · Confidential&CPage &P of &N&RPrepared by: ' + preparedBy.replace(/[&]/g, '&&');
            sheet.getCell(`A${dataHeaderRow + rows.length + 2}`).value = 'Farmgate report · Signature and date above are for authorized review only.';
            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            const dateRange = reportFrom || reportTo ? `${reportFrom || 'beginning'}_to_${reportTo || 'present'}` : 'all_dates';
            const safeReportTitle = reportTitle.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
            link.href = url;
            link.download = `Farmgate_${safeReportTitle}_Report_${dateRange}.xlsx`;
            document.body.append(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 0);
            if (role === 'ADMIN') {
                await api.post('/api/admin/reports/export-audit', { report_type: reportType, record_count: total, filters });
            }
        } catch (requestError: any) {
            onError(requestError.userMessage ?? 'The spreadsheet report could not be prepared. Please try again.');
        } finally {
            setExporting(false);
        }
    }

    async function printReport() {
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            onError('Allow pop-ups to open the print-ready report.');
            return;
        }
        setExporting(true);
        try {
            const filters = reportFilters();
            const { rows, total } = await fetchAllReportRows(filters);
            const columns = exportColumns();
            if (role === 'ADMIN') {
                await api.post('/api/admin/reports/export-audit', {
                    report_type: reportType,
                    record_count: total,
                    filters,
                });
            }
            const headerCells = columns.map((column) => `<th>${escapePrintText(column.header)}</th>`).join('');
            const bodyRows = rows.map((row) => `<tr>${columns.map((column) => {
                const value = reportCellValue(row, column);
                return `<td>${escapePrintText(value instanceof Date ? formatCsvDateTime(value) : value)}</td>`;
            }).join('')}</tr>`).join('');
            const columnWidths = columns.map((column) => {
                const longestValue = rows.reduce((longest, row) => Math.max(longest, String(reportCellValue(row, column)).length), column.header.length);
                return Math.max(8, Math.min(20, Math.ceil(longestValue / 8)));
            });
            const totalColumnWidth = columnWidths.reduce((sum, width) => sum + width, 0) || 1;
            const columnGroup = columnWidths.map((width) => `<col style="width:${(width / totalColumnWidth * 100).toFixed(2)}%">`).join('');
            const generatedAt = new Date();
            const filterSummary = Object.entries(filters).filter(([key, value]) => value !== undefined && key !== 'per_page').map(([key, value]) => `${key.replaceAll('_', ' ')}: ${String(value)}`).join(' · ');
            printWindow.document.open();
            printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Farmgate ${escapePrintText(reportTitle)} Report</title><style>
                @page{size:landscape;margin:14mm 12mm 18mm;@bottom-right{content:"Page " counter(page) " of " counter(pages);font:9px Arial,sans-serif;color:#51645b}}body{color:#1d3028;font:10px Arial,sans-serif}header{border-bottom:3px solid #185b44;margin-bottom:14px;padding-bottom:10px}h1{color:#185b44;margin:0 0 7px}h2{font-size:16px;margin:0}.meta{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin:12px 0}table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:8.5px}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}th,td{border:1px solid #8a9b91;padding:4px;text-align:left;vertical-align:top;white-space:normal;word-break:normal;overflow-wrap:anywhere;hyphens:auto}th{background:#e8f0ec}td{line-height:1.25}.signature{margin-top:26px;width:300px;border-top:1px solid #333;padding-top:6px}.note{font-size:9px;margin-top:8px}.footer{border-top:1px solid #8a9b91;color:#51645b;font-size:9px;margin-top:12px;padding-top:8px}@media screen{body{max-width:1400px;margin:24px auto;padding:0 16px}table{font-size:10px}}@media print{.no-print{display:none}}
            </style></head><body><header><h1>FARMGATE</h1><h2>${escapePrintText(reportTitle)} Report</h2><div class="meta"><span>Prepared by: ${escapePrintText(preparedBy)}</span><span>Generated: ${escapePrintText(generatedAt.toLocaleString())}</span><span>Records: ${total}</span><span>Filters: ${escapePrintText(filterSummary || 'None')}</span></div></header><table><colgroup>${columnGroup}</colgroup><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows || `<tr><td colspan="${columns.length}">No records match the selected filters.</td></tr>`}</tbody></table><div class="signature">Signature: ________________________________ &nbsp; Date: ____________________</div><p class="note">Typed name is not a verified electronic signature. This report reflects records available to the signed-in ${escapePrintText(role.toLowerCase())} account at generation time.</p><footer class="footer">FARMGATE · ${escapePrintText(reportTitle)} · ${escapePrintText(generatedAt.toISOString())}</footer><script>window.addEventListener('load',()=>window.print())</script></body></html>`);
            printWindow.document.close();
        } catch (requestError: any) {
            printWindow.close();
            onError(requestError.userMessage ?? 'The print-ready report could not be prepared.');
        } finally {
            setExporting(false);
        }
    }

    function applyDatePreset(preset: 'today' | '7days' | '30days' | 'month') {
        const today = dateInTimezone(new Date(), reportTimezone);
        const [year, month] = today.split('-');
        const start = preset === 'today' ? today
            : preset === '7days' ? shiftedDate(today, -6)
                : preset === '30days' ? shiftedDate(today, -29)
                    : `${year}-${month}-01`;
        setReportFrom(start);
        setReportTo(today);
        setPage(1);
    }

    function clearFilters() {
        setReportSearch('');
        setReportStatus('');
        setReportFrom('');
        setReportTo('');
        setOrderStatus('');
        setPaymentStatus('');
        setPaymentMethod('');
        setUserRole('');
        setAccountStatus('');
        setComplaintType('');
        setResolutionStatus('');
        setAmountMin('');
        setAmountMax('');
        setReportSort('created_at');
        setReportDirection('desc');
        setPage(1);
    }

    const invalidDateRange = Boolean(reportFrom && reportTo && reportTo < reportFrom);
    const invalidAmountRange = amountMin !== '' && amountMax !== '' && Number(amountMin) > Number(amountMax);

    return <section className="report-panel" aria-label={title ?? 'Reports'}>
        <div className="report-heading"><div><p className="eyebrow">Operations</p><h2>{title ?? 'Reports'}</h2></div><div className="report-heading-actions">{['ADMIN', 'SELLER'].includes(role) && <><button type="button" onClick={() => void exportSpreadsheet()} disabled={exporting || reportLoading || invalidDateRange || invalidAmountRange}>{exporting ? 'Preparing spreadsheet...' : 'Export Excel'}</button><button type="button" onClick={() => void printReport()} disabled={exporting || reportLoading || invalidDateRange || invalidAmountRange}>{exporting ? 'Preparing report...' : 'Print / Save PDF'}</button></>}{(onAnalyze || isAdminReport) && <div className="report-analyze-actions">{onAnalyze && <button type="button" disabled={invalidDateRange || invalidAmountRange} onClick={() => {
            const filters = activeFilters(reportSearch);
            onAnalyze({
                type: reportType,
                title: reportTitle,
                from: reportFrom || undefined,
                to: reportTo || undefined,
                status: typeof filters.status === 'string' ? filters.status : undefined,
                search: reportSearch.trim() || undefined,
                order_status: typeof filters.order_status === 'string' ? filters.order_status : undefined,
                payment_status: typeof filters.payment_status === 'string' ? filters.payment_status : undefined,
                payment_method: typeof filters.payment_method === 'string' ? filters.payment_method : undefined,
                role: typeof filters.role === 'string' ? filters.role : undefined,
                account_status: typeof filters.account_status === 'string' ? filters.account_status : undefined,
                complaint_type: typeof filters.complaint_type === 'string' ? filters.complaint_type : undefined,
                resolution_status: typeof filters.resolution_status === 'string' ? filters.resolution_status : undefined,
                amount_min: typeof filters.amount_min === 'string' ? filters.amount_min : undefined,
                amount_max: typeof filters.amount_max === 'string' ? filters.amount_max : undefined,
                requestId: Date.now(),
            });
        }}>Analyze with AI</button>}{isAdminReport && <button className="report-clear-filters" type="button" onClick={clearFilters}>Clear filters</button>}</div>}</div></div>
        {!hideTypeSelector && <TabNav label="Report type" value={reportType} onChange={(value) => {
            setReportType(value);
            setReportStatus('');
            setOrderStatus('');
            setPaymentStatus('');
            setPaymentMethod('');
            setUserRole('');
            setAccountStatus('');
            setComplaintType('');
            setResolutionStatus('');
            setAmountMin('');
            setAmountMax('');
            setPage(1);
        }} options={reportTypes.map((type) => ({ value: type, label: type[0].toUpperCase() + type.slice(1) }))} />}
        <div className="report-controls">
            <label>Search<input value={reportSearch} onChange={(event) => { setReportSearch(event.target.value); setPage(1); }} placeholder={role === 'RIDER' && reportType === 'deliveries' ? 'Order reference' : isAdminReport ? ({
                sales: 'Order reference, buyer, seller, payment reference',
                transactions: 'Transaction/order reference, payer, payee, type',
                users: 'Name, email, user ID, phone, role',
                complaints: 'Complaint/order reference, complainant, type',
            }[reportType] ?? 'Search records') : 'Search records'} /></label>
            {!isAdminReport && statusOptions.length > 0 && <label>Status<select value={reportStatus} onChange={(event) => { setReportStatus(event.target.value); setPage(1); }}><option value="">All statuses</option>{statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
            {role !== 'ADMIN' && statusOptions.length === 0 && ['sales', 'transactions', 'listings', 'deliveries'].includes(reportType) && !(role === 'RIDER' && reportType === 'deliveries') && <label>Status<input value={reportStatus} onChange={(event) => { setReportStatus(event.target.value); setPage(1); }} placeholder="Any status" /></label>}
            <label>Start date<input type="date" value={reportFrom} max={reportTo || undefined} onChange={(event) => { setReportFrom(event.target.value); setPage(1); }} /></label>
            <label>End date<input type="date" value={reportTo} min={reportFrom || undefined} onChange={(event) => { setReportTo(event.target.value); setPage(1); }} /></label>
            {isAdminReport && <label>Date range<select value="" onChange={(event) => {
                if (event.target.value) applyDatePreset(event.target.value as 'today' | '7days' | '30days' | 'month');
            }}>
                <option value="">Choose range</option>
                <option value="today">Today</option>
                <option value="7days">Last 7 days</option>
                <option value="30days">Last 30 days</option>
                <option value="month">This month</option>
            </select></label>}
        </div>
        {isAdminReport && <>
            <details className="report-advanced-filters">
                <summary>Advanced filters</summary>
                <div className="report-controls report-advanced-controls">
                    {(reportType === 'sales' || reportType === 'transactions') && <>
                        <label>Order status<select value={orderStatus} onChange={(event) => { setOrderStatus(event.target.value); setPage(1); }}>
                            <option value="">All order statuses</option>
                            {(reportType === 'sales' ? orderStatuses.filter(([value]) => value === 'COMPLETED') : orderStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select></label>
                        <label>Payment status<select value={paymentStatus} onChange={(event) => { setPaymentStatus(event.target.value); setPage(1); }}>
                            <option value="">All payment statuses</option>
                            {['PENDING', 'PAID', 'UNPAID', 'FAILED'].map((value) => <option key={value} value={value}>{displayStatus(value)}</option>)}
                        </select></label>
                        {reportType === 'transactions' && <label>Payment method<select value={paymentMethod} onChange={(event) => { setPaymentMethod(event.target.value); setPage(1); }}>
                            <option value="">All payment methods</option>
                            {['COD', 'GCASH', 'CARD', 'GOOGLE_PAY'].map((value) => <option key={value} value={value}>{displayStatus(value)}</option>)}
                        </select></label>}
                        <label>Minimum amount (₱)<input type="number" min="0" step="0.01" value={amountMin} onChange={(event) => { setAmountMin(event.target.value); setPage(1); }} /></label>
                        <label>Maximum amount (₱)<input type="number" min={amountMin || '0'} step="0.01" value={amountMax} onChange={(event) => { setAmountMax(event.target.value); setPage(1); }} /></label>
                    </>}
                    {reportType === 'users' && <>
                        <label>Role<select value={userRole} onChange={(event) => { setUserRole(event.target.value); setPage(1); }}>
                            <option value="">All roles</option>
                            {['ADMIN', 'SELLER', 'BUYER', 'RIDER'].map((value) => <option key={value} value={value}>{displayStatus(value)}</option>)}
                        </select></label>
                        <label>Email verification<select value={accountStatus} onChange={(event) => { setAccountStatus(event.target.value); setPage(1); }}>
                            <option value="">All verification states</option>
                            <option value="VERIFIED">Verified</option>
                            <option value="UNVERIFIED">Unverified</option>
                        </select></label>
                    </>}
                    {reportType === 'complaints' && <>
                        <label>Complaint status<select value={orderStatus} onChange={(event) => { setOrderStatus(event.target.value); setPage(1); }}>
                            <option value="">All complaint statuses</option>
                            {complaintStatuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select></label>
                        <label>Complaint type / reason<input value={complaintType} onChange={(event) => { setComplaintType(event.target.value); setPage(1); }} placeholder="Search complaint reason" /></label>
                        <label>Resolution status<select value={resolutionStatus} onChange={(event) => { setResolutionStatus(event.target.value); setPage(1); }}>
                            <option value="">All resolution states</option>
                            <option value="RESOLVED">Resolved</option>
                            <option value="UNRESOLVED">Unresolved</option>
                        </select></label>
                    </>}
                </div>
            </details>
        </>}
        {invalidDateRange && <p className="report-filter-error" role="alert">End date must be on or after the start date.</p>}
        {invalidAmountRange && <p className="report-filter-error" role="alert">Maximum amount must be at least the minimum amount.</p>}
        <p className="report-count">{reportLoading ? 'Loading report...' : `${reportTotal} records · ${reportTitle}`}</p>
        {reportType === 'deliveries' && proofSummary && <p className="report-count" role="status">Proof recorded: {proofSummary.with_proof} · Delivered without proof: {proofSummary.delivered_without_proof}</p>}
        {reportLoading ? <LoadingSkeleton variant="table" count={6} columns={tableColumns().length + 1} label="Loading report data" /> : <div className="report-table-wrap"><table className="report-table"><thead><tr>{tableColumns().map((column) => <th key={column.header} aria-sort={column.sortKey && column.sortKey === reportSort ? reportDirection === 'asc' ? 'ascending' : 'descending' : undefined}>
            {role === 'RIDER' && column.sortKey
                ? <button type="button" className="report-sort-button" onClick={() => changeReportSort(column.sortKey!)}>{column.header}{column.sortKey === reportSort ? (reportDirection === 'asc' ? ' ▲' : ' ▼') : ' ↕'}</button>
                : column.header}
        </th>)}<th>Details</th></tr></thead><tbody>{reportRows.map((row) => <tr key={row.id}>{tableColumns().map((column) => <td key={column.header}>{column.render(row)}</td>)}<td><ViewDetailsAction className="report-view-action" contextLabel={`report record ${String(row.id)}`} onClick={() => setSelectedReportRow(row)} /></td></tr>)}</tbody></table>{!reportRows.length && <p className="empty-state" role={reportError ? 'alert' : undefined}>{reportError ? <>{reportError} <button type="button" onClick={() => setReportRevision((revision) => revision + 1)}>Try again</button></> : role === 'RIDER' && reportType === 'deliveries' ? 'No deliveries match your filters.' : 'No records match these filters.'}</p>}</div>}
        <Pagination page={page} lastPage={Math.ceil(reportTotal / 15)} onChange={setPage} />
        {selectedReportRow && <FarmgateDetailDialog
            eyebrow={`${reportTitle} record`}
            title="Record details"
            description={`${selectedRecordReference ? `Reference ${selectedRecordReference} · ` : ''}Complete information included in this report row.`}
            onClose={closeReportDetails}
            className="report-detail-modal"
            contentClassName="report-detail-fields-wrap"
        >
            <dl className="report-detail-fields">{Object.entries(selectedReportRow).map(([field, value]) => <div key={field}><dt>{reportFieldLabel(field)}</dt><dd><ReportDetailValue value={value} field={field} timezone={reportTimezone} /></dd></div>)}</dl>
        </FarmgateDetailDialog>}
    </section>;
}
