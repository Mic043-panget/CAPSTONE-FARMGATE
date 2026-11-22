import React from 'react';
import { GuidedWalkthrough, type GuidedWalkthroughStep } from '../../shared/components/GuidedWalkthrough';

const deliveryTabs = ['nearby', 'assigned', 'scanner', 'history'] as const;
const deliverySteps: GuidedWalkthroughStep[] = [
    {
        title: 'Nearby Orders',
        description: 'Review available requests and pickup/drop-off areas. Choose Accept delivery to request an assignment; after Farmgate confirms, it appears in My Deliveries as Rider Accepted.',
        targetSelectors: ['#rider-nearby-workspace', '#rider-delivery-tab-nearby'],
    },
    {
        title: 'My Deliveries',
        description: 'Open an assigned delivery to review its instructions and current status. For an active delivery, capture the required photo, enter the recipient name, confirm receipt, and save proof here before delivery verification.',
        targetSelectors: ['#rider-assigned-deliveries', '#rider-delivery-tab-assigned'],
    },
    {
        title: 'QR Scanner',
        description: 'Choose an assigned delivery, then scan at the seller with Verify pickup or at the buyer with Verify delivery. A successful pickup scan records Picked Up. Delivery verification records Delivered only after the server confirms the scan and required proof is saved. Location checks and status updates do not happen automatically.',
        targetSelectors: ['#rider-qr-scanner', '#rider-delivery-tab-scanner'],
    },
    {
        title: 'Delivery History',
        description: 'Review past delivery records here. If you have a problem you cannot resolve in the app, contact Farmgate using the official support contact in the published rider privacy notice.',
        targetSelectors: ['#rider-delivery-history', '#rider-delivery-tab-history'],
    },
];

export function RiderDeliveryTutorial({ open, onToggle, onDismiss, onDeliveryTabChange }: {
    open: boolean;
    onToggle: () => void;
    onDismiss: () => void;
    onDeliveryTabChange: (tab: typeof deliveryTabs[number]) => void;
}) {
    return <>
        <div className="rider-delivery-tutorial-launch">
            <button type="button" className="seller-inline-action" aria-expanded={open} aria-controls={open ? 'guided-walkthrough-title' : undefined} aria-haspopup="dialog" onClick={onToggle}>
                {open ? 'Close delivery tour' : 'How deliveries work'}
            </button>
        </div>
        <GuidedWalkthrough
            open={open}
            steps={deliverySteps}
            onStepChange={(index) => onDeliveryTabChange(deliveryTabs[index])}
            onClose={onDismiss}
        />
    </>;
}
