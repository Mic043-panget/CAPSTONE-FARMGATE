import React from 'react';
import { RiderApplicationQueue } from './RiderApplicationQueue';
import { RiderPolicyPublication } from './RiderPolicyPublication';

type RiderTab = 'applications' | 'policies';

type AdminRiderPageProps = {
    onError: (message: string) => void;
    initialApplicationId?: number;
    onInitialApplicationHandled?: () => void;
    initialVehicleChangeId?: number;
    onInitialVehicleChangeHandled?: () => void;
};

export function AdminRiderPage({
    onError,
    initialApplicationId,
    onInitialApplicationHandled,
    initialVehicleChangeId,
    onInitialVehicleChangeHandled,
}: AdminRiderPageProps) {
    const [activeTab, setActiveTab] = React.useState<RiderTab>('applications');
    const tabRefs = React.useRef<Record<RiderTab, HTMLButtonElement | null>>({
        applications: null,
        policies: null,
    });

    function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, currentTab: RiderTab) {
        const tabs: RiderTab[] = ['applications', 'policies'];
        const currentIndex = tabs.indexOf(currentTab);
        let nextTab: RiderTab | null = null;

        if (event.key === 'ArrowRight') nextTab = tabs[(currentIndex + 1) % tabs.length];
        if (event.key === 'ArrowLeft') nextTab = tabs[(currentIndex - 1 + tabs.length) % tabs.length];
        if (event.key === 'Home') nextTab = tabs[0];
        if (event.key === 'End') nextTab = tabs[tabs.length - 1];

        if (nextTab) {
            event.preventDefault();
            setActiveTab(nextTab);
            tabRefs.current[nextTab]?.focus();
        }
    }

    return <section className="admin-promotions-page" aria-labelledby="admin-rider-title">
        <h2 id="admin-rider-title" className="sr-only">Rider</h2>
        <div className="admin-promotions-tabs" role="tablist" aria-label="Rider administration" aria-orientation="horizontal">
            <button ref={(element) => { tabRefs.current.applications = element; }} type="button" role="tab" id="admin-rider-applications-tab" aria-controls="admin-rider-applications-panel" aria-selected={activeTab === 'applications'} tabIndex={activeTab === 'applications' ? 0 : -1} className={activeTab === 'applications' ? 'active' : ''} onKeyDown={(event) => handleTabKeyDown(event, 'applications')} onClick={() => setActiveTab('applications')}>Rider applications &amp; vehicles</button>
            <button ref={(element) => { tabRefs.current.policies = element; }} type="button" role="tab" id="admin-rider-policies-tab" aria-controls="admin-rider-policies-panel" aria-selected={activeTab === 'policies'} tabIndex={activeTab === 'policies' ? 0 : -1} className={activeTab === 'policies' ? 'active' : ''} onKeyDown={(event) => handleTabKeyDown(event, 'policies')} onClick={() => setActiveTab('policies')}>Rider policies</button>
        </div>
        <div role="tabpanel" id="admin-rider-applications-panel" aria-labelledby="admin-rider-applications-tab" tabIndex={0} hidden={activeTab !== 'applications'}>
            {activeTab === 'applications' && <RiderApplicationQueue
                onError={onError}
                initialApplicationId={initialApplicationId}
                onInitialApplicationHandled={onInitialApplicationHandled}
                initialVehicleChangeId={initialVehicleChangeId}
                onInitialVehicleChangeHandled={onInitialVehicleChangeHandled}
            />}
        </div>
        <div role="tabpanel" id="admin-rider-policies-panel" aria-labelledby="admin-rider-policies-tab" tabIndex={0} hidden={activeTab !== 'policies'}>
            {activeTab === 'policies' && <RiderPolicyPublication onError={onError} />}
        </div>
    </section>;
}
