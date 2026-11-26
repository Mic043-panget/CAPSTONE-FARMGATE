import React from 'react';
import { NavigationBadge, navigationBadgeLabel } from '../../shared/components/NavigationBadge';

type WorkspaceRole = 'admin' | 'seller' | 'rider';

type WorkspaceMobileHeaderProps = {
    role: WorkspaceRole;
    menuOpen: boolean;
    controlsId: string;
    onToggle: () => void;
    location?: string;
    notificationCount?: number;
    notificationsActive?: boolean;
    onOpenNotifications?: () => void;
};

export function useWorkspaceMobileMenu() {
    const [menuOpen, setMenuOpen] = React.useState(false);

    React.useEffect(() => {
        const desktopViewport = window.matchMedia('(min-width: 901px)');
        const closeOnDesktop = (event: MediaQueryListEvent) => {
            if (event.matches) setMenuOpen(false);
        };
        desktopViewport.addEventListener('change', closeOnDesktop);
        if (desktopViewport.matches) setMenuOpen(false);

        return () => desktopViewport.removeEventListener('change', closeOnDesktop);
    }, []);

    return [menuOpen, setMenuOpen] as const;
}

export function WorkspaceMobileHeader({
    role,
    menuOpen,
    controlsId,
    onToggle,
    location,
    notificationCount = 0,
    notificationsActive = false,
    onOpenNotifications,
}: WorkspaceMobileHeaderProps) {
    const menuButton = <button className="role-mobile-menu-toggle" type="button" aria-label={`${menuOpen ? 'Close' : 'Open'} ${role} menu`} aria-expanded={menuOpen} aria-controls={controlsId} onClick={onToggle}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
            <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
    </button>;
    const hasFarmgateHeader = !!onOpenNotifications;

    return <>
        <header className={`role-mobile-header${hasFarmgateHeader ? ' role-mobile-header-farmgate' : ''}`}>
            {hasFarmgateHeader ? <>
                {menuButton}
                <a className="role-mobile-brand role-mobile-brand-farmgate" href="/" aria-label="FARMGATE home">
                    <svg className="role-mobile-leaf" aria-hidden="true" viewBox="0 0 32 32" fill="none">
                        <path d="M25.8 4.7C14 4.8 6.4 9.2 5.1 17.1c-.8 4.6 2 8.6 6.4 9.1C21 27.3 27.8 17.7 25.8 4.7Z" fill="currentColor" />
                        <path d="M8 24c4.2-5.3 8.8-9.2 14.2-12.1" stroke="#f5f3ec" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    <span>FARM<span>GATE</span></span>
                </a>
                <span className="role-mobile-location" aria-label={`Current location: ${location ?? 'Bongabong, Oriental Mindoro'}`} title={location ?? 'Bongabong, Oriental Mindoro'}>
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg>
                    <span>{location ?? 'Bongabong, Oriental Mindoro'}</span>
                </span>
                <button className={`role-mobile-notifications${notificationsActive ? ' active' : ''}`} type="button" aria-label={notificationCount > 0 ? `Open notifications, ${navigationBadgeLabel(notificationCount, 'unread notification', 'unread notifications')}` : 'Open notifications'} aria-current={notificationsActive ? 'page' : undefined} onClick={onOpenNotifications}>
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    <NavigationBadge count={notificationCount} />
                </button>
            </> : <>
                <a className="role-mobile-brand" href="/" aria-label="FARMGATE home">FARM<span>GATE</span></a>
                <span className="role-mobile-context">{role.toUpperCase()}</span>
                {menuButton}
            </>}
        </header>
        {menuOpen && <button className="role-mobile-menu-backdrop" type="button" aria-label={`Close ${role} navigation`} onClick={onToggle} />}
    </>;
}

type WorkspaceNotificationsButtonProps = {
    count: number;
    active: boolean;
    onClick: () => void;
};

export function WorkspaceNotificationsButton({ count, active, onClick }: WorkspaceNotificationsButtonProps) {
    const label = count > 0
        ? `Notifications, ${navigationBadgeLabel(count, 'unread notification', 'unread notifications')}`
        : 'Notifications';

    return <button
        className={`workspace-notifications-header-link${active ? ' active' : ''}`}
        type="button"
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        title={label}
        onClick={onClick}
    >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <NavigationBadge count={count} />
    </button>;
}

type WorkspaceAccountControlProps = {
    role: WorkspaceRole;
    userName: string;
    profilePhotoUrl?: string | null;
    onOpenAccount: () => void;
};

export function WorkspaceAccountControl({ role, userName, profilePhotoUrl, onOpenAccount }: WorkspaceAccountControlProps) {
    const initials = userName.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase() || role.charAt(0).toUpperCase();

    return <button className="role-header-account" type="button" aria-label={`Open ${role} account settings`} title={`${userName} · account settings`} onClick={onOpenAccount}>
        {profilePhotoUrl
            ? <img className="role-header-avatar" src={profilePhotoUrl} alt="" />
            : <span className="role-header-avatar role-header-avatar-initials" aria-hidden="true">{initials}</span>}
        <span className="role-header-account-copy"><strong>{userName}</strong><small>Account settings</small></span>
        <svg className="role-header-account-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none">
            <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" stroke="currentColor" strokeWidth="1.7" />
            <path d="m19.4 15 .1.1a1.8 1.8 0 1 1-2.5 2.5l-.1-.1a1.8 1.8 0 0 0-3 .9v.2a1.8 1.8 0 1 1-3.6 0v-.2a1.8 1.8 0 0 0-3-.9l-.1.1a1.8 1.8 0 1 1-2.5-2.5l.1-.1a1.8 1.8 0 0 0-.9-3H3.7a1.8 1.8 0 1 1 0-3.6h.2a1.8 1.8 0 0 0 .9-3l-.1-.1a1.8 1.8 0 1 1 2.5-2.5l.1.1a1.8 1.8 0 0 0 3-.9v-.2a1.8 1.8 0 1 1 3.6 0v.2a1.8 1.8 0 0 0 3 .9l.1-.1a1.8 1.8 0 1 1 2.5 2.5l-.1.1a1.8 1.8 0 0 0 .9 3h.2a1.8 1.8 0 1 1 0 3.6h-.2a1.8 1.8 0 0 0-.9 3Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
    </button>;
}
