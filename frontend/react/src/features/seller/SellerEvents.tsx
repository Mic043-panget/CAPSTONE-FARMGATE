import React from 'react';
import { LoadingSkeleton } from '../../shared/components/LoadingSkeleton';
import api, { initializeCsrf } from '../../lib/api';
import { Pagination } from '../../shared/components/Pagination';
import { showSuccess } from '../../lib/alerts';

type SellerEvent = {
    id: number;
    title: string;
    description: string;
    location: string;
    starts_at: string;
    ends_at: string;
    status: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
    review_reason: string | null;
};
type EventForm = { title: string; description: string; location: string; starts_at: string; ends_at: string };
const emptyForm = (): EventForm => ({ title: '', description: '', location: '', starts_at: '', ends_at: '' });

function toLocalDateTime(value: string): string {
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function SellerEvents({ onError }: { onError: (message: string) => void }) {
    const [events, setEvents] = React.useState<SellerEvent[]>([]);
    const [form, setForm] = React.useState<EventForm | null>(null);
    const [page, setPage] = React.useState(1);
    const [lastPage, setLastPage] = React.useState(1);
    const [loading, setLoading] = React.useState(true);
    const [saving, setSaving] = React.useState(false);

    const reload = React.useCallback(async () => {
        setLoading(true);
        try {
            const response = await api.get<{ events: { data: SellerEvent[]; last_page: number } }>('/api/seller/events', { params: { page } });
            setEvents(response.data.events.data);
            setLastPage(response.data.events.last_page);
        } catch (requestError: any) {
            onError(requestError.userMessage ?? requestError.response?.data?.message ?? 'Your submitted events could not be loaded.');
        } finally {
            setLoading(false);
        }
    }, [onError, page]);

    React.useEffect(() => { void reload(); }, [reload]);

    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!form) return;
        setSaving(true);
        try {
            await initializeCsrf();
            await api.post('/api/seller/events', {
                ...form,
                starts_at: new Date(form.starts_at).toISOString(),
                ends_at: new Date(form.ends_at).toISOString(),
            });
            setForm(null);
            setPage(1);
            showSuccess('Event submitted for Farmgate review.');
            if (page === 1) await reload();
        } catch (requestError: any) {
            const errors = requestError.response?.data?.errors;
            onError(errors ? Object.values(errors).flat().join(' ') : requestError.userMessage ?? requestError.response?.data?.message ?? 'The event could not be submitted.');
        } finally {
            setSaving(false);
        }
    }

    return <section className="seller-work-section" aria-labelledby="seller-events-title">
        <div className="seller-work-heading"><div><p className="eyebrow">Community calendar</p><h2 id="seller-events-title">Events</h2></div><button className="seller-inline-action" type="button" onClick={() => setForm((current) => current ? null : emptyForm())}>{form ? 'Cancel' : 'Submit an event +'}</button></div>
        <p>Submit livestock and community events for Farmgate review. Events appear publicly only after approval.</p>
        {form && <form className="seller-event-form" onSubmit={(event) => void submit(event)}>
            <label>Event title<input required maxLength={160} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
            <label>Description<textarea required maxLength={5000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
            <label>Location<input required maxLength={255} value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></label>
            <label>Starts at<input type="datetime-local" required min={toLocalDateTime(new Date().toISOString())} value={form.starts_at} onChange={(event) => setForm({ ...form, starts_at: event.target.value })} /></label>
            <label>Ends at<input type="datetime-local" required min={form.starts_at || undefined} value={form.ends_at} onChange={(event) => setForm({ ...form, ends_at: event.target.value })} /></label>
            <div className="seller-event-form-actions"><button className="seller-inline-action" type="submit" disabled={saving}>{saving ? 'Submitting...' : 'Submit for review'}</button><button className="seller-table-action" type="button" onClick={() => setForm(null)}>Cancel</button></div>
        </form>}
        {loading ? <LoadingSkeleton variant="list" count={3} label="Loading submitted events" /> : events.length ? <div className="seller-event-list">{events.map((event) => <article className="seller-event-card" key={event.id}>
            <div><h3>{event.title}</h3><span className={`status-pill status-${event.status.toLowerCase()}`}>{event.status.replaceAll('_', ' ')}</span></div>
            <p>{event.description}</p><p><strong>Location:</strong> {event.location}</p>
            <p>{new Date(event.starts_at).toLocaleString()} – {new Date(event.ends_at).toLocaleString()}</p>
            {event.review_reason && <p className="seller-event-review-reason"><strong>Admin feedback:</strong> {event.review_reason}</p>}
        </article>)}</div> : <p className="seller-empty">You have not submitted any events yet.</p>}
        <Pagination page={page} lastPage={lastPage} onChange={setPage} />
    </section>;
}
