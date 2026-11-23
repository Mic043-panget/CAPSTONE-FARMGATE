import React from 'react';

export function SettingsCategoryIcon({ name }: { name: string }) {
    return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {name === 'account' ? <><circle cx="12" cy="8" r="3.5" /><path d="M5 21c.7-4.1 3-6 7-6s6.3 1.9 7 6" /></>
            : name === 'security' ? <><path d="M12 3 19 6v5c0 4.7-2.9 8-7 10-4.1-2-7-5.3-7-10V6l7-3Z" /><path d="m9 12 2 2 4-4" /></>
                : name === 'seller' ? <><path d="M4 10v11h16V10M3 9l2-5h14l2 5" /><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" /></>
                    : name === 'rider' ? <><circle cx="6" cy="17" r="3" /><circle cx="18" cy="17" r="3" /><path d="m6 17 4-8h4l4 8M9 13h7M12 9l-2-3H7" /></>
                        : name === 'orders' ? <><path d="m4 7 8-4 8 4v10l-8 4-8-4V7Z" /><path d="m4 7 8 4 8-4M12 11v10" /></>
                            : name === 'charges' ? <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" /></>
                                : name === 'finance' ? <><ellipse cx="8" cy="7" rx="5" ry="2.5" /><path d="M3 7v4c0 1.4 2.2 2.5 5 2.5M13 7v4c0 1.4-2.2 2.5-5 2.5M8 11v3c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4" /><ellipse cx="13" cy="10" rx="5" ry="2.5" /><path d="M8 16v2c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-2" /></>
                                    : name === 'delivery' ? <><path d="M3 6h11v11H3zM14 10h4l3 3v4h-7z" /><circle cx="7.5" cy="18.5" r="1.5" /><circle cx="18" cy="18.5" r="1.5" /></>
                                        : name === 'distance' ? <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>
                                            : name === 'listings' ? <><path d="M20 13 11 22 2 13l9-9h7l2 2v7Z" /><circle cx="15" cy="9" r="1" /></>
                                                : name === 'notifications' ? <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>
                                                    : name === 'seller-verification' ? <><path d="M12 3 19 6v5c0 4.7-2.9 8-7 10-4.1-2-7-5.3-7-10V6l7-3Z" /><path d="m9 12 2 2 4-4" /></>
                                                        : <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="8" cy="6" r="2" fill="currentColor" /><circle cx="15" cy="12" r="2" fill="currentColor" /><circle cx="10" cy="18" r="2" fill="currentColor" /></>}
    </svg>;
}
