import React from 'react';
import api, { initializeCsrf } from '../../lib/api';
import { confirmAction } from '../../lib/alerts';
import { Pagination } from '../../shared/components/Pagination';
import { LoadingSkeleton } from '../../shared/components/LoadingSkeleton';
import { FarmgateDetailDialog } from './FarmgateDetailDialog';
import { ViewDetailsAction } from '../../shared/components/Button';

type CalendarRole = 'BUYER' | 'SELLER' | 'RIDER' | 'ADMIN';
type CalendarEntry = {
    id: string;
    record_id: number;
    source_type: 'EVENT' | 'PROMOTION' | 'DELIVERY';
    title: string;
    description: string;
    category: string;
    discount_type?: 'PERCENTAGE' | 'FIXED';
    discount_value?: string;
    starts_at: string;
    ends_at: string;
    timezone: string;
    location: string | null;
    online_url: string | null;
    image_url: string | null;
    audience: string;
    status: string;
    workflow_status?: string;
    creator: string | null;
    creator_id: number | null;
    promotion_id: number | null;
    calendar_event_id?: number | null;
    can_manage: boolean;
    href: string | null;
    order_reference?: string;
};
type CalendarResponse = { data: CalendarEntry[]; current_page: number; last_page: number; total: number; timezone: string };
type EventHistory = { id: number; action: string; reason: string | null; created_at: string; actor?: { name: string } | null };
type FormFields = {
    title: string;
    description: string;
    category: string;
    starts_at: string;
    ends_at: string;
    timezone: string;
    location: string;
    online_url: string;
    audience: string;
    promotion_id: string;
};

const categories = [
    ['FARMGATE_EVENT', 'Farmgate event'],
    ['PROMOTION_CAMPAIGN', 'Promotion campaign'],
    ['SELLER_EVENT', 'Seller event'],
    ['ADMIN_ACTIVITY', 'Other activity'],
];

function localDateTime(value: Date): string {
    const pad = (part: number) => String(part).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function dateOnly(value: Date): string {
    const pad = (part: number) => String(part).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function startOfMonth(value: Date): Date {
    return new Date(value.getFullYear(), value.getMonth(), 1);
}

function displayDate(value: string, timezone?: string): string {
    return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone });
}

function dateKeyInTimezone(value: Date, timezone: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(value);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
}

function localDateTimeInTimezone(value: Date, timezone: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(value);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

function zonedDateTimeToIso(value: string, timezone: string): string {
    const [date, time] = value.split('T');
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    const utcValue = Date.UTC(year, month - 1, day, hour, minute);
    const localParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(new Date(utcValue));
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(localParts.find((item) => item.type === type)?.value ?? 0);
    const representedAsUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'));
    return new Date(utcValue + utcValue - representedAsUtc).toISOString();
}

function initialFields(role: CalendarRole): FormFields {
    const start = new Date();
    start.setDate(start.getDate() + 1);
    start.setMinutes(0, 0, 0);
    const end = new Date(start);
    end.setHours(end.getHours() + 1);
    return {
        title: '',
        description: '',
        category: role === 'SELLER' ? 'SELLER_EVENT' : 'FARMGATE_EVENT',
        starts_at: localDateTime(start),
        ends_at: localDateTime(end),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Manila',
        location: '',
        online_url: '',
        audience: role === 'SELLER' ? 'PUBLIC' : 'PUBLIC',
        promotion_id: '',
    };
}

export function SystemCalendar({ role, onError, onOpenDelivery }: {
    role: CalendarRole;
    onError: (message: string) => void;
    onOpenDelivery?: (deliveryId: number, orderReference?: string) => void;
}) {
    const [month, setMonth] = React.useState(() => startOfMonth(new Date()));
    const [entries, setEntries] = React.useState<CalendarEntry[]>([]);
    const [page, setPage] = React.useState(1);
    const [lastPage, setLastPage] = React.useState(1);
    const [total, setTotal] = React.useState(0);
    const [category, setCategory] = React.useState('');
    const [status, setStatus] = React.useState('');
    const [search, setSearch] = React.useState('');
    const [audience, setAudience] = React.useState('');
    const [creatorId, setCreatorId] = React.useState('');
    const [dateFrom, setDateFrom] = React.useState(() => dateOnly(startOfMonth(new Date())));
    const [dateTo, setDateTo] = React.useState(() => dateOnly(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)));
    const [view, setView] = React.useState<'month' | 'list'>('month');
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState('');
    const [revision, setRevision] = React.useState(0);
    const [form, setForm] = React.useState<FormFields>(() => initialFields(role));
    const [editing, setEditing] = React.useState<CalendarEntry | null>(null);
    const [image, setImage] = React.useState<File | null>(null);
    const [saving, setSaving] = React.useState(false);
    const [expandedHistory, setExpandedHistory] = React.useState<number | null>(null);
    const [history, setHistory] = React.useState<EventHistory[]>([]);
    const [historyLoading, setHistoryLoading] = React.useState(false);
    const [focusEntryId, setFocusEntryId] = React.useState('');
    const [selectedEntry, setSelectedEntry] = React.useState<CalendarEntry | null>(null);
    const [formOpen, setFormOpen] = React.useState(false);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Manila';

    React.useEffect(() => {
        let current = true;
        setLoading(true);
        setError('');
        api.get<CalendarResponse>('/api/calendar', {
            params: {
                from: dateFrom,
                to: dateTo,
                category: category || undefined,
                status: status || undefined,
                audience: role === 'ADMIN' ? audience || undefined : undefined,
                creator_id: role === 'ADMIN' ? creatorId || undefined : undefined,
                search: search.trim() || undefined,
                timezone: timeZone,
                page,
                per_page: 100,
            },
        }).then(({ data }) => {
            if (!current) return;
            setEntries(data.data);
            setLastPage(data.last_page);
            setTotal(data.total);
        }).catch((requestError: any) => {
            if (current) setError(requestError.userMessage ?? requestError.response?.data?.message ?? 'The calendar could not be loaded. Check your connection and try again.');
        }).finally(() => { if (current) setLoading(false); });
        return () => { current = false; };
    }, [audience, category, creatorId, dateFrom, dateTo, page, revision, role, search, status, timeZone]);

    React.useEffect(() => {
        const match = /^#calendar\/(event|promotion)\/(\d+)$/.exec(window.location.hash);
        if (!match) return;
        const type = match[1];
        const recordId = Number(match[2]);
        let current = true;
        const request = type === 'event'
            ? api.get<{ event: { starts_at: string; ends_at: string; promotion_id: number | null } }>(`/api/events/${recordId}`).then(({ data }) => ({
                starts_at: data.event.starts_at,
                focus_id: data.event.promotion_id ? `promotion-${data.event.promotion_id}` : `event-${recordId}`,
            }))
            : api.get<{ promotion: { starts_at: string } }>(`/api/calendar/promotions/${recordId}`).then(({ data }) => ({
                starts_at: data.promotion.starts_at,
                focus_id: `promotion-${recordId}`,
            }));
        request.then((data) => {
            if (!current) return;
            const start = new Date(data.starts_at);
            const nextMonth = startOfMonth(start);
            setMonth(nextMonth);
            setDateFrom(dateOnly(nextMonth));
            setDateTo(dateOnly(new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0)));
            setCategory('');
            setStatus('');
            setSearch('');
            setAudience('');
            setCreatorId('');
            setPage(1);
            setFocusEntryId(data.focus_id);
        }).catch((requestError: any) => {
            if (current) {
                const message = requestError.userMessage ?? requestError.response?.data?.message ?? 'This event or promotion is unavailable or you do not have permission to view it.';
                setError(message);
                onError(message);
            }
        });
        return () => { current = false; };
    }, [onError, role]);

    React.useEffect(() => {
        if (!focusEntryId || !entries.some((entry) => entry.id === focusEntryId)) return;
        const entry = entries.find((item) => item.id === focusEntryId);
        if (entry) setSelectedEntry(entry);
        document.getElementById(`calendar-entry-${focusEntryId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, [entries, focusEntryId]);

    React.useEffect(() => {
        const closeOnHashChange = () => {
            if (!/^#calendar\/(event|promotion)\/\d+$/.test(window.location.hash)) {
                setSelectedEntry(null);
            }
        };
        window.addEventListener('hashchange', closeOnHashChange);
        return () => window.removeEventListener('hashchange', closeOnHashChange);
    }, []);

    React.useEffect(() => {
        if (!formOpen) return undefined;
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') resetForm();
        };
        window.addEventListener('keydown', closeOnEscape);
        return () => window.removeEventListener('keydown', closeOnEscape);
    }, [formOpen]);

    function moveMonth(amount: number) {
        setMonth((current) => {
            const next = new Date(current.getFullYear(), current.getMonth() + amount, 1);
            setDateFrom(dateOnly(next));
            setDateTo(dateOnly(new Date(next.getFullYear(), next.getMonth() + 1, 0)));
            return next;
        });
        setPage(1);
    }

    function resetForm() {
        setForm(initialFields(role));
        setEditing(null);
        setImage(null);
        setFormOpen(false);
    }

    function beginEdit(entry: CalendarEntry) {
        setEditing(entry);
        setForm({
            title: entry.title,
            description: entry.description,
            category: entry.calendar_event_id ? 'PROMOTION_CAMPAIGN' : entry.category,
            starts_at: localDateTimeInTimezone(new Date(entry.starts_at), entry.timezone),
            ends_at: localDateTimeInTimezone(new Date(entry.ends_at), entry.timezone),
            timezone: entry.timezone,
            location: entry.location ?? '',
            online_url: entry.online_url ?? '',
            audience: entry.audience,
            promotion_id: entry.promotion_id ? String(entry.promotion_id) : '',
        });
        setImage(null);
        setFormOpen(true);
    }

    async function saveEvent(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (saving) return;
        setSaving(true);
        setError('');
        const body = new FormData();
        Object.entries(form).forEach(([key, value]) => {
            if (key === 'starts_at' || key === 'ends_at') {
                body.append(key, zonedDateTimeToIso(value, form.timezone));
            } else {
                body.append(key, value);
            }
        });
        if (image) body.append('image', image);
        if (editing) body.append('_method', 'PUT');
        try {
            await initializeCsrf();
            if (editing) await api.post(`/api/events/${editing.record_id}`, body);
            else await api.post('/api/events', body);
            resetForm();
            setRevision((value) => value + 1);
        } catch (requestError: any) {
            const message = requestError.userMessage ?? requestError.response?.data?.message ?? 'The event could not be saved.';
            setError(message);
            onError(message);
        } finally {
            setSaving(false);
        }
    }

    async function cancelEvent(entry: CalendarEntry) {
        if (!await confirmAction({ title: 'Cancel this event?', text: 'It will remain in the history and be marked as cancelled.', confirmText: 'Cancel event' })) return;
        try {
            await initializeCsrf();
            await api.post(`/api/events/${entry.record_id}/cancel`);
            setRevision((value) => value + 1);
        } catch (requestError: any) {
            const message = requestError.userMessage ?? requestError.response?.data?.message ?? 'The event could not be cancelled.';
            setError(message);
            onError(message);
        }
    }

    async function toggleHistory(entry: CalendarEntry) {
        if (expandedHistory === entry.record_id) {
            setExpandedHistory(null);
            return;
        }
        setExpandedHistory(entry.record_id);
        setHistoryLoading(true);
        try {
            const response = await api.get<{ history: EventHistory[] }>(`/api/events/${entry.record_id}/history`);
            setHistory(response.data.history);
        } catch (requestError: any) {
            const message = requestError.userMessage ?? requestError.response?.data?.message ?? 'Event history is unavailable.';
            setError(message);
            onError(message);
            setExpandedHistory(null);
        } finally {
            setHistoryLoading(false);
        }
    }

    const gridStart = new Date(month.getFullYear(), month.getMonth(), 1);
    gridStart.setDate(gridStart.getDate() - ((gridStart.getDay() + 6) % 7));
    const days = Array.from({ length: 42 }, (_, index) => {
        const date = new Date(gridStart);
        date.setDate(gridStart.getDate() + index);
        return date;
    });
    const weeks = Array.from({ length: 6 }, (_, index) => days.slice(index * 7, index * 7 + 7));

    function openEntry(entry: CalendarEntry) {
        if (entry.source_type === 'DELIVERY') {
            onOpenDelivery?.(entry.record_id, entry.order_reference);
            return;
        }
        setSelectedEntry(entry);
        const type = entry.source_type === 'PROMOTION' ? 'promotion' : 'event';
        const id = type === 'promotion' ? entry.promotion_id ?? entry.record_id : entry.record_id;
        window.history.pushState({}, '', `#calendar/${type}/${id}`);
    }

    function closeEntry() {
        setSelectedEntry(null);
        window.history.pushState({}, '', '#calendar');
    }

    function segmentsForWeek(week: Date[]) {
        const firstKey = dateOnly(week[0]);
        const lastKey = dateOnly(week[6]);
        const lanes: number[] = [];
        return entries.flatMap((entry) => {
            const startKey = dateKeyInTimezone(new Date(entry.starts_at), entry.timezone);
            const endKey = dateKeyInTimezone(new Date(entry.ends_at), entry.timezone);
            if (startKey > lastKey || endKey < firstKey) return [];
            const startColumn = Math.max(0, week.findIndex((day) => dateOnly(day) >= startKey));
            const endColumn = week.findIndex((day) => dateOnly(day) > endKey) - 1;
            const lastColumn = endColumn < 0 ? 6 : Math.min(6, endColumn);
            const lane = lanes.findIndex((lastUsedColumn) => lastUsedColumn < startColumn);
            const row = lane === -1 ? lanes.length : lane;
            lanes[row] = lastColumn;
            return [{
                entry,
                startColumn,
                span: lastColumn - startColumn + 1,
                row: row + 1,
                continuesBefore: startKey < firstKey,
                continuesAfter: endKey > lastKey,
            }];
        });
    }

    return <section className="seller-work-section system-calendar" aria-labelledby="system-calendar-title">
        <div className="seller-work-heading">
            <div><p className="eyebrow">{role === 'RIDER' ? 'Your work schedule' : 'Farmgate schedule'}</p><h2 id="system-calendar-title">{role === 'SELLER' || role === 'BUYER' ? 'Events' : 'Calendar'}</h2><p>Browse approved events, promotion periods{role === 'RIDER' ? ', and your assigned deliveries.' : '.'}</p></div>
            <div className="calendar-view-switch" role="group" aria-label="Calendar display">
                <button type="button" aria-pressed={view === 'month'} onClick={() => setView('month')}>Month</button>
                <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>List</button>
                {role === 'SELLER' && <button type="button" className="calendar-submit-event" onClick={() => { resetForm(); setFormOpen(true); }}>Submit an event</button>}
                {role === 'ADMIN' && <button type="button" className="calendar-submit-event" onClick={() => { resetForm(); setFormOpen(true); }}>Create event</button>}
            </div>
        </div>

        <div className="calendar-toolbar">
            <div className="calendar-month-control">
                <button type="button" aria-label="Previous month" onClick={() => moveMonth(-1)}>‹</button>
                <h3>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone })}</h3>
                <button type="button" aria-label="Next month" onClick={() => moveMonth(1)}>›</button>
                <button type="button" onClick={() => { const today = startOfMonth(new Date()); setMonth(today); setDateFrom(dateOnly(today)); setDateTo(dateOnly(new Date(today.getFullYear(), today.getMonth() + 1, 0))); setPage(1); }}>Today</button>
            </div>
            <div className="calendar-filters">
                <label>Search<input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search events" /></label>
                <label>Category<select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}>
                    <option value="">All categories</option>
                    <option value="FARMGATE_EVENT">Farmgate events</option>
                    <option value="PROMOTION_CAMPAIGN">Promotion campaigns</option>
                    <option value="SELLER_EVENT">Seller events</option>
                    <option value="ADMIN_ACTIVITY">Other activities</option>
                    {role === 'SELLER' && <option value="SELLER_PROMOTION">My promotions</option>}
                    {role === 'RIDER' && <option value="RIDER_DELIVERY">My deliveries</option>}
                </select></label>
                <label>Status<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
                    <option value="">All statuses</option>
                    {['UPCOMING', 'ACTIVE', 'ENDED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'PAUSED', 'DRAFT', 'SCHEDULED'].map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
                </select></label>
                <label>From date<input type="date" required value={dateFrom} max={dateTo || undefined} onChange={(event) => { setDateFrom(event.target.value); if (event.target.value) setMonth(startOfMonth(new Date(`${event.target.value}T12:00:00`))); setPage(1); }} /></label>
                <label>To date<input type="date" required value={dateTo} min={dateFrom || undefined} onChange={(event) => { setDateTo(event.target.value); if (event.target.value) setMonth(startOfMonth(new Date(`${event.target.value}T12:00:00`))); setPage(1); }} /></label>
                {role === 'ADMIN' && <>
                    <label>Audience<select value={audience} onChange={(event) => { setAudience(event.target.value); setPage(1); }}><option value="">All audiences</option>{['PUBLIC', 'BUYERS', 'SELLERS', 'RIDERS', 'ADMINS'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                    <label>Creator ID<input type="number" min="1" value={creatorId} onChange={(event) => { setCreatorId(event.target.value); setPage(1); }} /></label>
                </>}
            </div>
        </div>

        {error && <p className="calendar-error" role="alert">{error}</p>}
        {loading ? <LoadingSkeleton variant="list" count={4} label="Loading calendar entries" /> : total === 0 ? <p className="calendar-empty">No scheduled events or activities match these filters.</p> : <>
            <p className="calendar-results" aria-live="polite">{total} {total === 1 ? 'entry' : 'entries'} between {dateFrom} and {dateTo}</p>
            {view === 'month' ? <div className="calendar-grid-wrap">
                <div className="calendar-grid" role="grid" aria-label={`${month.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone })} calendar`}>
                    <div className="calendar-weekday-row" role="row">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <div className="calendar-weekday" role="columnheader" key={day}>{day}</div>)}</div>
                    {weeks.map((week) => {
                        const segments = segmentsForWeek(week);
                        return <div className="calendar-week" role="row" key={dateOnly(week[0])}>
                            <div className="calendar-week-days">{week.map((day) => <div className={`calendar-day${day.getMonth() === month.getMonth() ? '' : ' outside-month'}`} role="gridcell" key={dateOnly(day)}><span className="calendar-day-number">{day.getDate()}</span></div>)}</div>
                            <div className="calendar-week-bars" style={{ gridTemplateRows: `repeat(${Math.max(1, ...segments.map((segment) => segment.row))}, minmax(24px, auto))` }}>
                                {segments.map(({ entry, startColumn, span, row, continuesBefore, continuesAfter }) => <button
                                    type="button"
                                    key={entry.id}
                                    className={`calendar-entry calendar-entry-${entry.status.toLowerCase()}${continuesBefore ? ' continues-before' : ''}${continuesAfter ? ' continues-after' : ''}`}
                                    style={{ gridColumn: `${startColumn + 1} / span ${span}`, gridRow: row }}
                                    aria-label={`${entry.title}, ${displayDate(entry.starts_at, entry.timezone)} ${entry.timezone} to ${displayDate(entry.ends_at, entry.timezone)} ${entry.timezone}${continuesBefore ? ', continues from previous week' : ''}${continuesAfter ? ', continues next week' : ''}`}
                                    onClick={() => openEntry(entry)}
                                ><span>{continuesBefore ? '← ' : ''}{entry.title}{continuesAfter ? ' →' : ''}</span><small>{displayDate(entry.starts_at, entry.timezone)} {entry.timezone}</small></button>)}
                            </div>
                        </div>;
                    })}
                </div>
            </div> : null}
            <div className="calendar-entry-list">
                {entries.map((entry) => {
                    const canManage = entry.can_manage && (entry.source_type === 'EVENT' || entry.calendar_event_id !== null && entry.calendar_event_id !== undefined);
                    const canEdit = canManage && ['SUBMITTED', 'APPROVED'].includes(entry.workflow_status ?? entry.status);
                    return <article className="calendar-event-card" key={entry.id} id={`calendar-entry-${entry.id}`}>
                        {entry.image_url && <img className="calendar-event-image" src={entry.image_url} alt="" loading="lazy" />}
                        <div className="calendar-event-body">
                            <div className="calendar-event-heading"><span className="calendar-category">{(entry.category === 'SELLER_PROMOTION' ? 'Seller promotion' : entry.category === 'RIDER_DELIVERY' ? 'Assigned delivery' : entry.category.replaceAll('_', ' ').toLowerCase())}</span><span className={`status-pill status-${entry.status.toLowerCase()}`}>{entry.status.replaceAll('_', ' ')}</span></div>
                            {entry.source_type === 'EVENT' && entry.workflow_status === 'APPROVED' && <span className="calendar-visibility-label">Approved public event</span>}
                            {entry.source_type === 'EVENT' && entry.workflow_status === 'SUBMITTED' && <span className="calendar-visibility-label calendar-private-label">Private · pending review</span>}
                            {entry.source_type === 'EVENT' && entry.workflow_status === 'REJECTED' && <span className="calendar-visibility-label calendar-private-label">Private · not approved</span>}
                            <h3><button className="calendar-event-open" type="button" onClick={() => openEntry(entry)}>{entry.title}</button></h3>
                            {entry.description && <p>{entry.description}</p>}
                            <p><strong>When:</strong> {displayDate(entry.starts_at, entry.timezone)} – {displayDate(entry.ends_at, entry.timezone)} ({entry.timezone})</p>
                            {entry.source_type === 'PROMOTION' && entry.discount_type && entry.discount_value && <p><strong>Offer:</strong> {entry.discount_type === 'PERCENTAGE' ? `${Number(entry.discount_value)}% off` : `${new Intl.NumberFormat(undefined, { style: 'currency', currency: 'PHP' }).format(Number(entry.discount_value))} off`}</p>}
                            {entry.location && <p><strong>Where:</strong> {entry.location}</p>}
                            {entry.online_url && <p><a href={entry.online_url} target="_blank" rel="noreferrer">Open online event</a></p>}
                            {entry.source_type === 'DELIVERY' && entry.order_reference && <p><strong>Order:</strong> {entry.order_reference}</p>}
                            {entry.source_type === 'DELIVERY' && onOpenDelivery && <button className="calendar-related-link" type="button" onClick={() => onOpenDelivery(entry.record_id, entry.order_reference)}>Open assigned delivery</button>}
                            {entry.creator && <p><strong>Organizer:</strong> {entry.creator}</p>}
                            <ViewDetailsAction className="calendar-related-link" contextLabel={`${entry.source_type.toLowerCase()} ${entry.title}`} onClick={() => openEntry(entry)} />
                            {canManage && <div className="calendar-actions">
                                {canEdit && <button type="button" onClick={() => beginEdit(entry)}>Edit</button>}
                                {canEdit && <button type="button" onClick={() => void cancelEvent(entry)}>Cancel event</button>}
                                <button type="button" onClick={() => void toggleHistory(entry)}>{expandedHistory === entry.record_id ? 'Hide history' : 'History'}</button>
                            </div>}
                            {expandedHistory === entry.record_id && <div className="calendar-history" aria-live="polite">{historyLoading ? 'Loading history...' : history.length ? history.map((item) => <p key={item.id}><strong>{item.action.replaceAll('_', ' ')}</strong> · {item.actor?.name ?? 'System'} · {displayDate(item.created_at)}{item.reason ? ` — ${item.reason}` : ''}</p>) : <p>No history recorded.</p>}</div>}
                        </div>
                    </article>;
                })}
            </div>
            <Pagination page={page} lastPage={lastPage} onChange={setPage} />
        </>}

        {formOpen && role !== 'BUYER' && role !== 'RIDER' && <div className="calendar-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) resetForm(); }}>
            <form id="calendar-event-form" className="calendar-event-form calendar-event-form-modal" role="dialog" aria-modal="true" aria-labelledby="calendar-event-form-title" onSubmit={(event) => void saveEvent(event)}>
            <div className="calendar-modal-heading"><h3 id="calendar-event-form-title">{editing ? 'Edit event' : role === 'ADMIN' ? 'Create event' : 'Submit an event'}</h3><button autoFocus type="button" aria-label="Close event form" onClick={resetForm}>×</button></div>
            {role === 'SELLER' && <p>Your event will be reviewed before it is shown publicly.</p>}
            {error && <p className="calendar-error" role="alert">{error}</p>}
            <div className="calendar-form-grid">
                <label>Title<input required maxLength={160} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
                <label>Category<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>{categories.filter(([value]) => role === 'ADMIN' || value === 'SELLER_EVENT').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label>Starts<input type="datetime-local" required value={form.starts_at} onChange={(event) => setForm({ ...form, starts_at: event.target.value })} /></label>
                <label>Ends<input type="datetime-local" required value={form.ends_at} onChange={(event) => setForm({ ...form, ends_at: event.target.value })} /></label>
                <label>Timezone<input required list="farmgate-timezones" value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} /><datalist id="farmgate-timezones"><option value="Asia/Manila" /><option value="UTC" /></datalist></label>
                <label>Audience<select value={form.audience} onChange={(event) => setForm({ ...form, audience: event.target.value })}>{['PUBLIC', ...(role === 'ADMIN' ? ['BUYERS', 'SELLERS', 'RIDERS', 'ADMINS'] : [])].map((value) => <option key={value} value={value}>{value.toLowerCase()}</option>)}</select></label>
                <label>Location<input maxLength={255} value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value, online_url: '' })} placeholder="Venue or meeting place" /></label>
                <label>Online link<input type="url" maxLength={2048} value={form.online_url} onChange={(event) => setForm({ ...form, online_url: event.target.value, location: '' })} placeholder="https://" /></label>
                {role === 'ADMIN' && form.category === 'PROMOTION_CAMPAIGN' && <label>Existing promotion ID<input type="number" min="1" value={form.promotion_id} onChange={(event) => setForm({ ...form, promotion_id: event.target.value })} /></label>}
                <label>Event image<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setImage(event.target.files?.[0] ?? null)} /></label>
            </div>
            <label className="calendar-description-field">Description<textarea required maxLength={5000} rows={4} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
            <div className="calendar-form-actions"><button type="submit" disabled={saving}>{saving ? 'Saving...' : editing ? 'Save changes' : role === 'ADMIN' ? 'Create event' : 'Submit for review'}</button>{editing && <button type="button" onClick={resetForm}>Stop editing</button>}</div>
            </form>
        </div>}

        {selectedEntry && <FarmgateDetailDialog
            eyebrow={selectedEntry.category.replaceAll('_', ' ').toLowerCase()}
            title={selectedEntry.title}
            description={selectedEntry.description || undefined}
            onClose={closeEntry}
            className="calendar-detail-modal"
            contentClassName="calendar-detail-content"
        >
                {selectedEntry.image_url && <img className="calendar-detail-image" src={selectedEntry.image_url} alt="" />}
                <span className={`status-pill status-${selectedEntry.status.toLowerCase()}`}>{selectedEntry.status.replaceAll('_', ' ')}{selectedEntry.workflow_status === 'APPROVED' ? ' · approved public event' : ''}</span>
                {selectedEntry.workflow_status && selectedEntry.workflow_status !== selectedEntry.status && selectedEntry.source_type === 'EVENT' && <span className="calendar-workflow-status">Submission: {selectedEntry.workflow_status.toLowerCase()}</span>}
                {selectedEntry.source_type === 'PROMOTION' && selectedEntry.discount_type && selectedEntry.discount_value && <p className="calendar-detail-offer"><strong>Offer:</strong> {selectedEntry.discount_type === 'PERCENTAGE' ? `${Number(selectedEntry.discount_value)}% off` : `${new Intl.NumberFormat(undefined, { style: 'currency', currency: 'PHP' }).format(Number(selectedEntry.discount_value))} off`}</p>}
                <dl><div><dt>Starts</dt><dd>{displayDate(selectedEntry.starts_at, selectedEntry.timezone)} ({selectedEntry.timezone})</dd></div><div><dt>Ends</dt><dd>{displayDate(selectedEntry.ends_at, selectedEntry.timezone)} ({selectedEntry.timezone})</dd></div><div><dt>Timezone</dt><dd>{selectedEntry.timezone}</dd></div>{selectedEntry.location && <div><dt>Location</dt><dd>{selectedEntry.location}</dd></div>}{selectedEntry.creator && <div><dt>Organizer</dt><dd>{selectedEntry.creator}</dd></div>}</dl>
                {selectedEntry.online_url && <a href={selectedEntry.online_url} target="_blank" rel="noreferrer">Open online event</a>}
                {selectedEntry.source_type === 'DELIVERY' && onOpenDelivery && <button type="button" onClick={() => onOpenDelivery(selectedEntry.record_id, selectedEntry.order_reference)}>Open assigned delivery</button>}
                {selectedEntry.source_type === 'PROMOTION' && <a href="#promotions">Browse promotion products</a>}
                {selectedEntry.source_type === 'EVENT' && selectedEntry.status === 'SUBMITTED' && <p className="calendar-private-note">This submission is private while it is under review.</p>}
                {selectedEntry.status === 'REJECTED' && <p className="calendar-private-note">This event was not approved and is visible only to its organizer and authorized admins.</p>}
        </FarmgateDetailDialog>}
    </section>;
}
