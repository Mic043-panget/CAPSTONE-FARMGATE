import React from 'react';

type WorkspaceRole = 'admin' | 'seller' | 'rider';

type WorkspaceMobileHeaderProps = {
    role: WorkspaceRole;
    menuOpen: boolean;
    controlsId: string;
    onToggle: () => void;
};

export function WorkspaceMobileHeader({ role, menuOpen, controlsId, onToggle }: WorkspaceMobileHeaderProps) {
    return <header className="role-mobile-header">
        <a className="role-mobile-brand" href="/" aria-label="FARMGATE home">FARM<span>GATE</span></a>
        <span className="role-mobile-context">{role.toUpperCase()}</span>
        <button className="role-mobile-menu-toggle" type="button" aria-label={`${menuOpen ? 'Close' : 'Open'} ${role} menu`} aria-expanded={menuOpen} aria-controls={controlsId} onClick={onToggle}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
        </button>
    </header>;
}
