import React from 'react';

const iconPaths: Record<string, React.ReactNode> = {
    dashboard: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 20c.5-3.7 2.5-5.5 6-5.5s5.5 1.8 6 5.5M16 5.5a3 3 0 0 1 0 5.8M18 14.8c1.8.8 2.8 2.5 3 5.2" /></>,
    listings: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 12h6M9 16h6" /></>,
    orders: <><path d="m4 7 8-4 8 4v10l-8 4-8-4V7Z" /><path d="m4 7 8 4 8-4M12 11v10" /></>,
    transactions: <><path d="M4 8h15m0 0-4-4m4 4-4 4M20 16H5m0 0 4-4m-4 4 4 4" /></>,
    payments: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18m-12 5h4" /></>,
    earnings: <><circle cx="12" cy="12" r="9" /><path d="M15 8.5c-.7-.7-1.6-1-2.8-1-1.5 0-2.5.8-2.5 1.9 0 3 5.6 1.2 5.6 4.4 0 1.2-1.1 2.1-2.8 2.1-1.2 0-2.3-.4-3.1-1.2M12 5.5v13" /></>,
    deliveries: <><path d="M3 6h11v12H3zM14 10h4l3 3v5h-7" /><circle cx="7.5" cy="18" r="2" /><circle cx="17.5" cy="18" r="2" /></>,
    categories: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
    complaints: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6m0 4h.01" /></>,
    reviews: <><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" /></>,
    rider: <><circle cx="6" cy="17" r="3" /><circle cx="18" cy="17" r="3" /><path d="m6 17 4-8h4l4 8M9 13h7M12 9l-2-3H7" /></>,
    promotions: <><path d="M20 13 11 22 2 13l9-9h7l2 2v7Z" /><circle cx="15" cy="9" r="1" /><path d="m10 15 4-4m-3 0h.01M13 15h.01" /></>,
    notifications: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    reports: <><path d="M4 20V11m5 9V5m5 15v-7m5 7V8" /></>,
    chats: <><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H7l-4 2v-5.2A7.5 7.5 0 1 1 20 11.5Z" /><path d="M8 11h.01M12 11h.01M16 11h.01" /></>,
    security: <><path d="M12 3 19 6v5c0 4.7-2.9 8-7 10-4.1-2-7-5.3-7-10V6l7-3Z" /><path d="m9 12 2 2 4-4" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2M12 19.2v2M4.7 4.7l1.4 1.4m11.8 11.8 1.4 1.4M2.8 12h2m14.4 0h2M4.7 19.3l1.4-1.4M17.9 6.1l1.4-1.4" /></>,
    events: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 10h18M8 14h2m4 0h2m-8 3h2" /></>,
};

export function WorkspaceSidebarIcon({ name }: { name: string }) {
    const iconName = name === 'account' ? 'settings' : name;
    return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {iconPaths[iconName] ?? iconPaths.dashboard}
    </svg>;
}
