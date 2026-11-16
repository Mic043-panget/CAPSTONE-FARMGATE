import React from 'react';

export function RiderDeliveryTutorial({ open, onToggle, onDismiss }: {
    open: boolean;
    onToggle: () => void;
    onDismiss: () => void;
}) {
    return <section className="rider-delivery-tutorial" aria-labelledby="rider-delivery-tutorial-title">
        <div className="rider-delivery-tutorial-heading">
            <div>
                <p className="eyebrow">Quick guide</p>
                <h3 id="rider-delivery-tutorial-title">How deliveries work</h3>
            </div>
            <button type="button" className="seller-inline-action" aria-expanded={open} aria-controls="rider-delivery-tutorial-content" onClick={onToggle}>
                {open ? 'Hide tutorial' : 'Review tutorial'}
            </button>
        </div>
        {open && <div id="rider-delivery-tutorial-content" className="rider-delivery-tutorial-content" role="region" aria-labelledby="rider-delivery-tutorial-title">
            <ol>
                <li><strong>Accept an available order.</strong> Review requests in <b>Nearby Orders</b> and choose <b>Accept delivery</b>. After Farmgate confirms, the assignment appears in <b>My Deliveries</b> with status <b>Rider Accepted</b>.</li>
                <li><strong>Review the assignment.</strong> Open <b>My Deliveries</b> and check the pickup and drop-off details and any instructions shown before you travel.</li>
                <li><strong>Verify pickup at the seller.</strong> At the seller’s pickup location, use <b>QR Scanner</b> and choose <b>Verify pickup</b> to scan the pickup QR (the order QR is also accepted). Allow location access; Farmgate checks the submitted location against the saved pickup point. A successful verification records status <b>Picked Up</b>.</li>
                <li><strong>Save delivery proof before drop-off verification.</strong> In <b>My Deliveries</b>, take or choose a photo, enter the recipient’s name, confirm receipt, and select <b>Save proof</b>. The proof is saved only after the request succeeds.</li>
                <li><strong>Verify delivery at the buyer.</strong> At the buyer’s location, use <b>QR Scanner</b> and choose <b>Verify delivery</b> to scan the delivery QR (the same order QR is also accepted). Allow location access for the server-side location check. Farmgate marks the delivery <b>Delivered</b> only after verification succeeds and the required proof is saved.</li>
                <li><strong>Check the result or get help.</strong> Review the current status in <b>My Deliveries</b> and past records in <b>Delivery History</b>. For a problem you cannot resolve in the app, contact Farmgate using the official support contact in the published rider privacy notice.</li>
            </ol>
            <p>Scanning, location verification, proof saving, and status changes require the corresponding app action and a successful server response; they do not happen automatically.</p>
            <button type="button" className="seller-text-action" onClick={onDismiss}>Dismiss tutorial</button>
        </div>}
    </section>;
}
