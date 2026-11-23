import React from 'react';

export function FarmgateBrand({ label = 'Farmgate home' }: { label?: string }) {
    return <a className="brand" href="/" aria-label={label}>
        <svg aria-hidden="true" viewBox="0 0 32 32" fill="none">
            <path d="M25.8 4.7C14 4.8 6.4 9.2 5.1 17.1c-.8 4.6 2 8.6 6.4 9.1C21 27.3 27.8 17.7 25.8 4.7Z" fill="currentColor" />
            <path d="M8 24c4.2-5.3 8.8-9.2 14.2-12.1" stroke="#f5f3ec" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="brand-wordmark">FARM<span>GATE</span></span>
    </a>;
}
