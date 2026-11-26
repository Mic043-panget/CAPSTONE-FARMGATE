import React from 'react';

const DISMISSED_AT_KEY = 'farmgate-install-prompt-dismissed-at';
const INSTALLED_KEY = 'farmgate-install-confirmed';
const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

type InstallPromptChoice = {
    outcome: 'accepted' | 'dismissed';
    platform: string;
};

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<InstallPromptChoice>;
}

function readPreference(key: string): string | null {
    try {
        return window.localStorage.getItem(key);
    } catch {
        console.warn('Farmgate install prompt preference could not be read.');
        return null;
    }
}

function writePreference(key: string, value: string): void {
    try {
        window.localStorage.setItem(key, value);
    } catch {
        console.warn('Farmgate install prompt preference could not be saved.');
    }
}

function isStandalone(): boolean {
    const displayModeStandalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
    const iosStandalone = 'standalone' in navigator
        && Boolean((navigator as Navigator & { standalone?: boolean }).standalone);

    return displayModeStandalone || iosStandalone;
}

function isAlreadyInstalled(): boolean {
    return isStandalone() || readPreference(INSTALLED_KEY) === 'true';
}

function isDismissalCoolingDown(): boolean {
    const dismissedAt = Number(readPreference(DISMISSED_AT_KEY));

    return Number.isFinite(dismissedAt)
        && dismissedAt > 0
        && Date.now() - dismissedAt < DISMISS_COOLDOWN_MS;
}

export function useInstallFarmgatePrompt(enabled: boolean) {
    const [installEvent, setInstallEvent] = React.useState<BeforeInstallPromptEvent | null>(null);
    const [open, setOpen] = React.useState(false);
    const [installed, setInstalled] = React.useState(isAlreadyInstalled);
    const [installing, setInstalling] = React.useState(false);
    const [installError, setInstallError] = React.useState('');
    const enabledRef = React.useRef(enabled);
    enabledRef.current = enabled;

    React.useEffect(() => {
        function handleBeforeInstallPrompt(event: Event) {
            const promptEvent = event as BeforeInstallPromptEvent;
            if (typeof promptEvent.prompt !== 'function' || !promptEvent.userChoice) return;

            event.preventDefault();

            if (isAlreadyInstalled()) {
                setInstalled(true);
                return;
            }
            if (!enabledRef.current || isDismissalCoolingDown()) return;

            setInstallError('');
            setInstallEvent(promptEvent);
            setOpen(true);
        }

        function handleAppInstalled() {
            writePreference(INSTALLED_KEY, 'true');
            setInstalled(true);
            setInstallEvent(null);
            setOpen(false);
        }

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        window.addEventListener('appinstalled', handleAppInstalled);

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            window.removeEventListener('appinstalled', handleAppInstalled);
        };
    }, []);

    React.useEffect(() => {
        if (enabled) return;

        setInstallEvent(null);
        setOpen(false);
        setInstallError('');
        setInstalling(false);
    }, [enabled]);

    const dismiss = React.useCallback(() => {
        writePreference(DISMISSED_AT_KEY, String(Date.now()));
        setInstallEvent(null);
        setOpen(false);
        setInstallError('');
        setInstalling(false);
    }, []);

    const install = React.useCallback(async () => {
        if (!installEvent) return;

        setInstalling(true);
        setInstallError('');

        try {
            await installEvent.prompt();
            const choice = await installEvent.userChoice;
            setInstallEvent(null);
            setInstalling(false);

            if (choice.outcome === 'accepted') {
                setOpen(false);
                return;
            }

            dismiss();
        } catch {
            console.error('Chrome could not complete the Farmgate install prompt.');
            setInstallEvent(null);
            setInstalling(false);
            setInstallError('Chrome could not open the install prompt. Please try again later.');
        }
    }, [dismiss, installEvent]);

    return {
        show: enabled && open && !installed,
        canInstall: installEvent !== null,
        installing,
        installError,
        install,
        dismiss,
    };
}

export function InstallFarmgatePrompt({
    canInstall,
    installing,
    error,
    onInstall,
    onDismiss,
}: {
    canInstall: boolean;
    installing: boolean;
    error: string;
    onInstall: () => void;
    onDismiss: () => void;
}) {
    const titleId = React.useId();
    const descriptionId = React.useId();
    const closeButtonRef = React.useRef<HTMLButtonElement>(null);

    React.useEffect(() => {
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        closeButtonRef.current?.focus({ preventScroll: true });

        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape') {
                event.preventDefault();
                onDismiss();
            }
        }

        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            if (previousFocus?.isConnected) previousFocus.focus();
        };
    }, [onDismiss]);

    return (
        <div className="farmgate-install-prompt-positioner">
            <section
                className="farmgate-install-prompt"
                role="dialog"
                aria-labelledby={titleId}
                aria-describedby={descriptionId}
            >
                <header className="farmgate-install-prompt-header">
                    <img src="/icons/icon-192.png" alt="" />
                    <div>
                        <p className="eyebrow">Farmgate app</p>
                        <h2 id={titleId}>Install Farmgate</h2>
                    </div>
                    <button
                        ref={closeButtonRef}
                        className="farmgate-install-prompt-close"
                        type="button"
                        aria-label="Close install prompt"
                        onClick={onDismiss}
                    >
                        <span aria-hidden="true">×</span>
                    </button>
                </header>
                <p id={descriptionId} className="farmgate-install-prompt-copy">
                    Install Farmgate for quick access to your local livestock marketplace.
                </p>
                {error && <p className="farmgate-install-prompt-error" role="alert">{error}</p>}
                <div className="farmgate-install-prompt-actions">
                    {canInstall && <button type="button" className="farmgate-install-primary" onClick={onInstall} disabled={installing}>
                        {installing ? 'Opening install prompt…' : 'Install'}
                    </button>}
                    <button type="button" className="farmgate-install-secondary" onClick={onDismiss}>Not now</button>
                </div>
            </section>
        </div>
    );
}
