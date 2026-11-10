import React from 'react';
import { EventReviewQueue } from './EventReviewQueue';
import { SystemCalendar } from '../shared/SystemCalendar';

export function AdminPromotionsPage({ onError }: { onError: (message: string) => void }) {
    const [activeTab, setActiveTab] = React.useState<'calendar' | 'review'>('calendar');
    const [submittedCount, setSubmittedCount] = React.useState<number | null>(null);

    return <section className="admin-promotions-page" aria-labelledby="admin-promotions-title">
        <h2 id="admin-promotions-title" className="sr-only">Promotions</h2>
        <div className="admin-promotions-tabs" role="tablist" aria-label="Promotions tools">
            <button type="button" role="tab" id="admin-promotions-calendar-tab" aria-controls="admin-promotions-calendar-panel" aria-selected={activeTab === 'calendar'} className={activeTab === 'calendar' ? 'active' : ''} onClick={() => setActiveTab('calendar')}>Calendar</button>
            <button type="button" role="tab" id="admin-promotions-review-tab" aria-controls="admin-promotions-review-panel" aria-selected={activeTab === 'review'} className={activeTab === 'review' ? 'active' : ''} onClick={() => setActiveTab('review')}>Event Review{submittedCount !== null ? ` (${submittedCount})` : ''}</button>
        </div>
        <div role="tabpanel" id="admin-promotions-calendar-panel" aria-labelledby="admin-promotions-calendar-tab" hidden={activeTab !== 'calendar'}>
            <SystemCalendar role="ADMIN" onError={onError} />
        </div>
        <div role="tabpanel" id="admin-promotions-review-panel" aria-labelledby="admin-promotions-review-tab" hidden={activeTab !== 'review'}>
            <EventReviewQueue onError={onError} onCountChange={setSubmittedCount} />
        </div>
    </section>;
}
