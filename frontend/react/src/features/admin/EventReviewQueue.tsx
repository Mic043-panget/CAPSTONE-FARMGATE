import React from 'react';
import api, { initializeCsrf } from '../../lib/api';
import { confirmAction, showSuccess } from '../../lib/alerts';
import { Pagination } from '../../shared/components/Pagination';
import { FarmgateDetailDialog } from '../shared/FarmgateDetailDialog';

type EventStatus = 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
type FarmgateEvent = {
    id: number;
    title: string;
    description: string;
    location: string;
    starts_at: string;
    ends_at: string;
    created_at: string;
    status: EventStatus;
    review_reason: string | null;
    organizer: { name: string };
    category?: string;
    timezone?: string;
    audience?: string;
    online_url?: string | null;
    image_url?: string | null;
    history?: { id: number; action: string; reason: string | null; created_at: string; actor?: { name: string } | null }[];
};
type SortOption = 'submitted_desc' | 'submitted_asc' | 'title_asc' | 'title_desc' | 'organizer_asc' | 'event_date_asc' | 'event_date_desc' | 'status_asc';

function formatDate(value: string, timezone?: string): string {
    return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone });
}

export function EventReviewQueue({ onError, onCountChange }: { onError: (message: string) => void; onCountChange?: (count: number) => void }) {
    const [events, setEvents] = React.useState<FarmgateEvent[]>([]);
    const [status, setStatus] = React.useState('SUBMITTED');
    const [search, setSearch] = React.useState('');
    const [sort, setSort] = React.useState<SortOption>('submitted_desc');
    const [reason, setReason] = React.useState('');
    const [page, setPage] = React.useState(1);
    const [lastPage, setLastPage] = React.useState(1);
    const [total, setTotal] = React.useState(0);
    const [loading, setLoading] = React.useState(true);
    const [loadError, setLoadError] = React.useState('');
    const [workingId, setWorkingId] = React.useState<number | null>(null);
    const [selectedEvent, setSelectedEvent] = React.useState<FarmgateEvent | null>(null);
    const [detailsLoading, setDetailsLoading] = React.useState(false);

    const reload = React.useCallback(async () => {
        setLoading(true);
        setLoadError('');
        try {
            const response = await api.get<{
                events: { data: FarmgateEvent[]; last_page: number; total: number };
                submitted_count: number;
            }>('/api/admin/events', { params: { status: status || undefined, search: search.trim() || undefined, sort, page } });
            setEvents(response.data.events.data);
            setLastPage(response.data.events.last_page);
            setTotal(response.data.events.total);
            onCountChange?.(response.data.submitted_count);
        } catch (requestError: any) {
            setLoadError(requestError.userMessage ?? requestError.response?.data?.message ?? 'Event submissions could not be loaded.');
        } finally {
            setLoading(false);
        }
    }, [onCountChange, onError, page, search, sort, status]);

    React.useEffect(() => { void reload(); }, [reload]);

    React.useEffect(() => {
        if (!selectedEvent) return undefined;
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && workingId === null) setSelectedEvent(null);
        };
        window.addEventListener('keydown', closeOnEscape);
        return () => window.removeEventListener('keydown', closeOnEscape);
    }, [selectedEvent, workingId]);

    async function decide(event: FarmgateEvent, nextStatus: 'APPROVED' | 'REJECTED') {
        const decisionReason = reason.trim();
        if (nextStatus === 'REJECTED' && !decisionReason) {
            onError('Add a reason before rejecting this event.');
            return;
        }
        const confirmed = await confirmAction({
            title: `${nextStatus === 'APPROVED' ? 'Approve' : 'Reject'} this event?`,
            text: nextStatus === 'APPROVED' ? 'The event will be visible in the public Promotions area.' : 'The submitter will see the rejection reason.',
            confirmText: nextStatus === 'APPROVED' ? 'Approve event' : 'Reject event',
        });
        if (!confirmed) return;
        setWorkingId(event.id);
        try {
            await initializeCsrf();
            await api.patch(`/api/admin/events/${event.id}`, { status: nextStatus, reason: decisionReason || null });
            showSuccess(nextStatus === 'APPROVED' ? 'Event approved and published.' : 'Event rejected.');
            setSelectedEvent(null);
            setReason('');
            await reload();
        } catch (requestError: any) {
            const errors = requestError.response?.data?.errors;
            onError(errors ? Object.values(errors).flat().join(' ') : requestError.userMessage ?? requestError.response?.data?.message ?? 'The event decision could not be saved.');
        } finally {
            setWorkingId(null);
        }
    }

    async function openReview(event: FarmgateEvent) {
        setSelectedEvent(event);
        setReason('');
        setDetailsLoading(true);
        try {
            const response = await api.get<{ event: FarmgateEvent }>(`/api/admin/events/${event.id}`);
            setSelectedEvent(response.data.event);
        } catch (requestError: any) {
            onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'Event details and review history could not be loaded.');
            setSelectedEvent(null);
        } finally {
            setDetailsLoading(false);
        }
    }

    return <section className="admin-event-queue" aria-labelledby="admin-event-queue-title">
        <div className="admin-event-heading">
            <div><h2 id="admin-event-queue-title">Event Review</h2><p>Search and review submitted events before they appear publicly.</p></div>
            <label>Status
                <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
                    <option value="">All statuses</option>
                    <option value="SUBMITTED">Submitted</option>
                    <option value="APPROVED">Approved</option>
                    <option value="REJECTED">Rejected</option>
                    <option value="CANCELLED">Cancelled</option>
                </select>
            </label>
        </div>
        <div className="admin-event-controls">
            <label>Search events<input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Title, organizer, or category" /></label>
            <label>Sort by<select value={sort} onChange={(event) => { setSort(event.target.value as SortOption); setPage(1); }}>
                <option value="submitted_desc">Newest submitted</option>
                <option value="submitted_asc">Oldest submitted</option>
                <option value="title_asc">Title (A–Z)</option>
                <option value="title_desc">Title (Z–A)</option>
                <option value="organizer_asc">Organizer (A–Z)</option>
                <option value="event_date_asc">Event date (earliest)</option>
                <option value="event_date_desc">Event date (latest)</option>
                <option value="status_asc">Status</option>
            </select></label>
        </div>
        {!loading && <p className="admin-event-count" aria-live="polite">{total} {total === 1 ? 'event' : 'events'}</p>}
        {loadError && <div className="admin-event-load-error" role="alert"><p>{loadError}</p><button type="button" onClick={() => void reload()}>Try again</button></div>}
        {loading ? <p role="status">Loading event submissions...</p> : events.length ? <>
            <div className="data-table-wrap admin-event-table-wrap"><table className="data-table admin-event-table">
                <thead><tr><th>Event title</th><th>Organizer</th><th>Category</th><th>Submitted</th><th>Event date</th><th>Status</th><th>Action</th></tr></thead>
                <tbody>{events.map((event) => <tr key={event.id}>
                    <td data-label="Event title"><strong>{event.title}</strong></td>
                    <td data-label="Organizer">{event.organizer.name}</td>
                    <td data-label="Category">{event.category?.replaceAll('_', ' ') ?? 'Seller event'}</td>
                    <td data-label="Submitted">{formatDate(event.created_at)}</td>
                    <td data-label="Event date">{formatDate(event.starts_at, event.timezone)}</td>
                    <td data-label="Status"><span className={`status-pill status-${event.status.toLowerCase()}`}>{event.status.replaceAll('_', ' ')}</span></td>
                    <td data-label="Action"><button type="button" className="admin-event-details-toggle" onClick={() => void openReview(event)}>Review</button></td>
                </tr>)}</tbody>
            </table></div>
            <Pagination page={page} lastPage={lastPage} onChange={setPage} />
        </> : !loadError && <div className="admin-empty-state"><h3>No matching event submissions</h3><p>Try changing the search or status filter.</p></div>}

        {selectedEvent && <FarmgateDetailDialog
            eyebrow="Event review"
            title={selectedEvent.title}
            description={`${selectedEvent.organizer.name} · ${formatDate(selectedEvent.created_at)}`}
            onClose={() => setSelectedEvent(null)}
            closeDisabled={workingId !== null}
            className="admin-event-review-modal"
            contentClassName="admin-event-review-content"
        >
                {detailsLoading ? <p role="status">Loading full event details...</p> : <>
                    {selectedEvent.image_url && <a href={selectedEvent.image_url} target="_blank" rel="noreferrer"><img className="admin-event-review-image" src={selectedEvent.image_url} alt={`Submitted media for ${selectedEvent.title}`} /></a>}
                    <dl className="admin-event-review-facts">
                        <div><dt>Organizer</dt><dd>{selectedEvent.organizer.name}</dd></div>
                        <div><dt>Category</dt><dd>{selectedEvent.category?.replaceAll('_', ' ') ?? 'Seller event'}</dd></div>
                        <div><dt>Submitted</dt><dd>{formatDate(selectedEvent.created_at)}</dd></div>
                        <div><dt>Event schedule</dt><dd>{formatDate(selectedEvent.starts_at, selectedEvent.timezone)} – {formatDate(selectedEvent.ends_at, selectedEvent.timezone)} ({selectedEvent.timezone ?? 'Asia/Manila'})</dd></div>
                        <div><dt>Location</dt><dd>{selectedEvent.location || 'Not specified'}</dd></div>
                        <div><dt>Audience</dt><dd>{selectedEvent.audience ?? 'PUBLIC'}</dd></div>
                    </dl>
                    <p className="admin-event-review-description">{selectedEvent.description}</p>
                    {selectedEvent.online_url && <p><a href={selectedEvent.online_url} target="_blank" rel="noreferrer">Open event link</a></p>}
                    {selectedEvent.review_reason && <p><strong>Decision reason:</strong> {selectedEvent.review_reason}</p>}
                    {selectedEvent.history?.length ? <div className="admin-event-history"><h4>Decision and change history</h4>{selectedEvent.history.map((item) => <p key={item.id}><strong>{item.action.replaceAll('_', ' ')}</strong> · {item.actor?.name ?? 'System'} · {formatDate(item.created_at)}{item.reason ? ` — ${item.reason}` : ''}</p>)}</div> : <p>No review history recorded.</p>}
                    {selectedEvent.status === 'SUBMITTED' && <div className="admin-event-actions">
                        <label>Rejection reason <span>(required to reject)</span><textarea maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} aria-required="true" /></label>
                        <button type="button" disabled={workingId === selectedEvent.id} onClick={() => void decide(selectedEvent, 'APPROVED')}>{workingId === selectedEvent.id ? 'Saving...' : 'Approve event'}</button>
                        <button className="admin-event-reject" type="button" disabled={workingId === selectedEvent.id || !reason.trim()} onClick={() => void decide(selectedEvent, 'REJECTED')}>{workingId === selectedEvent.id ? 'Saving...' : 'Reject event'}</button>
                    </div>}
                </>}
        </FarmgateDetailDialog>}
    </section>;
}
