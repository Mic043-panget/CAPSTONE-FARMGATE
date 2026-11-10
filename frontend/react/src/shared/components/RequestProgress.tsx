import React from 'react';
import { createPortal } from 'react-dom';
import { hasActiveRequests, subscribeToRequests } from '../../lib/requestProgress';

export function RequestProgress() {
    const loading = React.useSyncExternalStore(subscribeToRequests, hasActiveRequests, () => false);
    const [visible, setVisible] = React.useState(false);

    React.useEffect(() => {
        if (!loading) {
            setVisible(false);
            return undefined;
        }

        const timer = window.setTimeout(() => setVisible(true), 180);

        return () => window.clearTimeout(timer);
    }, [loading]);

    if (!visible) return null;

    return createPortal(
        <div className="farmgate-request-progress" role="progressbar" aria-label="Loading Farmgate content" aria-valuetext="Loading">
            <span />
        </div>,
        document.body,
    );
}
