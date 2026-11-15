import React from 'react';
import { CodMoneyOperations } from './CodMoneyOperations';
import { CodReceivingSettings } from './CodReceivingSettings';
import { RiderPayouts } from './RiderPayouts';

type PaymentsTab = 'reconciliation' | 'rider-payouts' | 'settings';

export function AdminPaymentsPage({ onError, onOpenSystemSettings }: { onError: (message: string) => void; onOpenSystemSettings: () => void }) {
    const [activeTab, setActiveTab] = React.useState<PaymentsTab>('reconciliation');

    return <section className="admin-promotions-page" aria-labelledby="admin-payments-title">
        <div className="payments-page-title"><p className="eyebrow">Admin operations</p><h2 id="admin-payments-title">Payments</h2></div>
        <div className="admin-promotions-tabs" role="tablist" aria-label="Payment tools">
            <button
                type="button"
                role="tab"
                id="admin-payments-rider-payouts-tab"
                aria-controls="admin-payments-rider-payouts-panel"
                aria-selected={activeTab === 'rider-payouts'}
                className={activeTab === 'rider-payouts' ? 'active' : ''}
                onClick={() => setActiveTab('rider-payouts')}
            >
                Rider Payouts
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
                COD Reconciliation
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
                Payment and COD Settings
            </button>
        </div>
        <div
            role="tabpanel"
            id="admin-payments-rider-payouts-panel"
            aria-labelledby="admin-payments-rider-payouts-tab"
            hidden={activeTab !== 'rider-payouts'}
        >
            <RiderPayouts onError={onError} />
        </div>
        <div
            role="tabpanel"
            id="admin-payments-reconciliation-panel"
            aria-labelledby="admin-payments-reconciliation-tab"
            hidden={activeTab !== 'reconciliation'}
        >
            <CodMoneyOperations onError={onError} onOpenSettings={() => setActiveTab('settings')} />
        </div>
        <div
            role="tabpanel"
            id="admin-payments-settings-panel"
            aria-labelledby="admin-payments-settings-tab"
            hidden={activeTab !== 'settings'}
        >
            <CodReceivingSettings onError={onError} onOpenSystemSettings={onOpenSystemSettings} />
        </div>
    </section>;
}
