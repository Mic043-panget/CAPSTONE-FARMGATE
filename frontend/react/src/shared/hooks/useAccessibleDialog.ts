import React from 'react';

export function useAccessibleDialog<T extends HTMLElement>(open: boolean, onClose: () => void) {
    const dialogRef = React.useRef<T>(null);
    const onCloseRef = React.useRef(onClose);
    onCloseRef.current = onClose;

    React.useEffect(() => {
        const dialog = dialogRef.current;
        if (!open || !dialog) return undefined;
        const activeDialog = dialog;
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const focusable = () => [...activeDialog.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )].filter((element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true');
        focusable()[0]?.focus();

        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape') {
                event.preventDefault();
                onCloseRef.current();
                return;
            }
            if (event.key !== 'Tab') return;
            const elements = focusable();
            if (!elements.length) {
                event.preventDefault();
                activeDialog.focus();
                return;
            }
            const first = elements[0];
            const last = elements[elements.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            if (previousFocus?.isConnected) previousFocus.focus();
        };
    }, [open]);

    return dialogRef;
}
