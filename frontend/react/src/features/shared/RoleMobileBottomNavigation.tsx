import React from 'react';

type MobileNavigationIcon = 'home' | 'chat' | 'document' | 'settings' | 'delivery';
type MobileNavigationItem<T extends string> = { id: T; label: string; icon: MobileNavigationIcon };

export function useMobileBottomNavigationVisibility(
    navigationRef: React.RefObject<HTMLElement | null>,
    enabled = true,
) {
    const [hidden, setHidden] = React.useState(false);

    React.useEffect(() => {
        if (!enabled) {
            setHidden(false);
            return;
        }

        const revealThreshold = 12;
        let lastScrollY = window.scrollY;
        let accumulatedMovement = 0;
        let routeFrame = 0;
        let focusReleaseTimer = 0;

        function isMobile() {
            return window.matchMedia('(max-width: 760px)').matches;
        }

        function isEditable(element: Element | null): boolean {
            if (!(element instanceof HTMLElement)) return false;
            if (element.isContentEditable || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
                return true;
            }
            if (!(element instanceof HTMLInputElement)) return false;
            return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'reset', 'submit'].includes(element.type);
        }

        function resetScrollBaseline() {
            lastScrollY = window.scrollY;
            accumulatedMovement = 0;
        }

        function handleScroll() {
            const scrollY = window.scrollY;
            const delta = scrollY - lastScrollY;
            lastScrollY = scrollY;

            if (!isMobile()) {
                setHidden(false);
                return;
            }
            if (isEditable(document.activeElement)) {
                accumulatedMovement = 0;
                setHidden(true);
                return;
            }
            if (navigationRef.current?.contains(document.activeElement)) {
                accumulatedMovement = 0;
                setHidden(false);
                return;
            }
            if (scrollY <= revealThreshold) {
                accumulatedMovement = 0;
                setHidden(false);
                return;
            }
            if (delta === 0) return;

            if (accumulatedMovement !== 0 && Math.sign(delta) !== Math.sign(accumulatedMovement)) {
                accumulatedMovement = delta;
            } else {
                accumulatedMovement += delta;
            }

            if (accumulatedMovement >= revealThreshold) {
                accumulatedMovement = 0;
                setHidden(true);
            } else if (accumulatedMovement <= -revealThreshold) {
                accumulatedMovement = 0;
                setHidden(false);
            }
        }

        function handleResize() {
            resetScrollBaseline();
            if (isEditable(document.activeElement)) {
                setHidden(true);
            } else if (window.scrollY <= revealThreshold) {
                setHidden(false);
            }
        }

        function handleRouteChange() {
            window.cancelAnimationFrame(routeFrame);
            routeFrame = window.requestAnimationFrame(() => {
                routeFrame = window.requestAnimationFrame(() => {
                    resetScrollBaseline();
                    if (window.scrollY <= revealThreshold && !isEditable(document.activeElement)) {
                        setHidden(false);
                    }
                });
            });
        }

        function handleFocusIn(event: FocusEvent) {
            if (!isMobile()) return;
            window.clearTimeout(focusReleaseTimer);
            if (isEditable(event.target instanceof Element ? event.target : null)) {
                accumulatedMovement = 0;
                setHidden(true);
            } else if (event.target instanceof Node && navigationRef.current?.contains(event.target)) {
                accumulatedMovement = 0;
                setHidden(false);
            }
        }

        function handleFocusOut(event: FocusEvent) {
            if (!isMobile() || !isEditable(event.target instanceof Element ? event.target : null)) return;
            window.clearTimeout(focusReleaseTimer);
            focusReleaseTimer = window.setTimeout(() => {
                if (isEditable(document.activeElement)) return;
                resetScrollBaseline();
                setHidden(false);
            }, 250);
        }

        window.addEventListener('scroll', handleScroll, { passive: true });
        window.addEventListener('resize', handleResize, { passive: true });
        window.addEventListener('hashchange', handleRouteChange);
        window.addEventListener('popstate', handleRouteChange);
        window.addEventListener('pageshow', handleRouteChange);
        document.addEventListener('focusin', handleFocusIn);
        document.addEventListener('focusout', handleFocusOut);
        return () => {
            window.removeEventListener('scroll', handleScroll);
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('hashchange', handleRouteChange);
            window.removeEventListener('popstate', handleRouteChange);
            window.removeEventListener('pageshow', handleRouteChange);
            document.removeEventListener('focusin', handleFocusIn);
            document.removeEventListener('focusout', handleFocusOut);
            window.cancelAnimationFrame(routeFrame);
            window.clearTimeout(focusReleaseTimer);
        };
    }, [enabled, navigationRef]);

    return hidden;
}

export function MobileBottomNavigation({
    children,
    className,
    navigationLabel,
    enabled = true,
}: {
    children: React.ReactNode;
    className: string;
    navigationLabel: string;
    enabled?: boolean;
}) {
    const navigationRef = React.useRef<HTMLElement>(null);
    const hidden = useMobileBottomNavigationVisibility(navigationRef, enabled);

    return <nav
        ref={navigationRef}
        className={`${className}${hidden ? ' is-hidden' : ''}`}
        aria-label={navigationLabel}
        aria-hidden={hidden}
        inert={hidden}
        onClick={(event) => {
            if (event.detail === 0 || !(event.target instanceof Element)) return;
            const button = event.target.closest('button');
            if (button && navigationRef.current?.contains(button)) button.blur();
        }}
    >
        {children}
    </nav>;
}

export function RoleMobileBottomNavigation<T extends string>({
    items,
    activeId,
    navigationLabel,
    onNavigate,
}: {
    items: readonly MobileNavigationItem<T>[];
    activeId: string;
    navigationLabel: string;
    onNavigate: (destination: T) => void;
}) {
    return <MobileBottomNavigation className="role-mobile-bottom-nav" navigationLabel={navigationLabel}>
        {items.map((item) => {
            const active = activeId === item.id;
            return <button type="button" key={item.id} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={() => onNavigate(item.id)}>
                <span className="role-mobile-bottom-nav-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        {item.icon === 'home' ? <><path d="m3 10 9-7 9 7" /><path d="M5 9v12h14V9M9 21v-7h6v7" /></>
                            : item.icon === 'chat' ? <><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H7l-4 2v-5.2A7.5 7.5 0 1 1 20 11.5Z" /><path d="M8 11h.01M12 11h.01M16 11h.01" /><path d="M16.5 4.5a7.5 7.5 0 0 1 4.4 8.6" /></>
                                : item.icon === 'document' ? <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 12h6M9 16h6" /></>
                                    : item.icon === 'delivery' ? <><path d="M3 6h11v12H3zM14 10h4l3 3v5h-7" /><circle cx="7.5" cy="18" r="2" /><circle cx="17.5" cy="18" r="2" /></>
                                        : <><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2M12 19.2v2M4.7 4.7l1.4 1.4m11.8 11.8 1.4 1.4M2.8 12h2m14.4 0h2M4.7 19.3l1.4-1.4M17.9 6.1l1.4-1.4" /></>}
                    </svg>
                </span>
                <span className="role-mobile-bottom-nav-label">{item.label}</span>
            </button>;
        })}
    </MobileBottomNavigation>;
}
