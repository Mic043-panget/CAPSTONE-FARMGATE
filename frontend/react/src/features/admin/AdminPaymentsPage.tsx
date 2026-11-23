import React from 'react';
import { CodMoneyOperations } from './CodMoneyOperations';
import { CodReceivingSettings } from './CodReceivingSettings';
import { RiderPayouts } from './RiderPayouts';

type PaymentsTab = 'reconciliation' | 'rider-payouts' | 'settings';

function PaymentsTabIcon({ name }: { name: 'rider' | 'cod' | 'settings' }) {
    return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {name === 'rider' ? <><circle cx="6" cy="17" r="3" /><circle cx="18" cy="17" r="3" /><path d="M9 17h4l3-7h-5l-2 4H5M12 6h3l2 4M10 6H8" /></>
            : name === 'cod' ? <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>
                : <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.2 1-1.6 2.8-1.5-.6a8 8 0 0 1-1.5.9l-.2 1.6h-3.2l-.2-1.6a8 8 0 0 1-1.5-.9l-1.5.6-1.6-2.8 1.2-1a8 8 0 0 1 0-1.8l-1.2-1L9 9.4l1.5.6a8 8 0 0 1 1.5-.9l.2-1.6h3.2l.2 1.6a8 8 0 0 1 1.5.9l1.5-.6 1.6 2.8-1.2 1a8 8 0 0 1 .4 1.8Z" /></>}
    </svg>;
}

export function AdminPaymentsPage({ onError, onOpenSystemSettings }: { onError: (message: string) => void; onOpenSystemSettings: () => void }) {
    const [activeTab, setActiveTab] = React.useState<PaymentsTab>('reconciliation');

    return <section className="admin-payments-page" aria-labelledby="admin-payments-title">
        <div className="payments-page-title"><p className="eyebrow">Admin operations</p><h2 id="admin-payments-title">Payments</h2></div>
        <div className="admin-payments-tabs" role="tablist" aria-label="Payment tools">
            <button
                type="button"
                role="tab"
                id="admin-payments-rider-payouts-tab"
                aria-controls="admin-payments-rider-payouts-panel"
                aria-selected={activeTab === 'rider-payouts'}
                className={activeTab === 'rider-payouts' ? 'active' : ''}
                onClick={() => setActiveTab('rider-payouts')}
            >
                <PaymentsTabIcon name="rider" />Rider Payouts
            </button>
            <button
                type="button"
                role="tab"
                id="admin-payments-reconciliation-tab"
                aria-controls="admin-payments-reconciliation-panel"
                aria-selected={activeTab === 'reconciliation'}
                className={activeTab === 'reconciliation' ? 'active' : ''}
                onClick={() => setActiveTab('reconciliation')}
            >
                <PaymentsTabIcon name="cod" />COD Reconciliation
            </button>
            <button
                type="button"
                role="tab"
                id="admin-payments-settings-tab"
                aria-controls="admin-payments-settings-panel"
                aria-selected={activeTab === 'settings'}
                className={activeTab === 'settings' ? 'active' : ''}
                onClick={() => setActiveTab('settings')}
            >
                <PaymentsTabIcon name="settings" />Payment and COD Settings
            </button>
        </div>
        <div
            role="tabpanel"
            id="admin-payments-rider-payouts-panel"
            aria-labelledby="admin-payments-rider-payouts-tab"
            className="admin-payments-panel"
            hidden={activeTab !== 'rider-payouts'}
        >
            <RiderPayouts onError={onError} />
        </div>
        <div
            role="tabpanel"
            id="admin-payments-reconciliation-panel"
            aria-labelledby="admin-payments-reconciliation-tab"
            className="admin-payments-panel"
            hidden={activeTab !== 'reconciliation'}
        >
            <CodMoneyOperations onError={onError} onOpenSettings={() => setActiveTab('settings')} />
        </div>
        <div
            role="tabpanel"
            id="admin-payments-settings-panel"
            aria-labelledby="admin-payments-settings-tab"
            className="admin-payments-panel"
            hidden={activeTab !== 'settings'}
        >
            <CodReceivingSettings onError={onError} onOpenSystemSettings={onOpenSystemSettings} />
        </div>
    </section>;
}
