import React from 'react';
import { createPortal } from 'react-dom';

export type GuidedWalkthroughStep = {
    title: string;
    description: string;
    targetSelectors: string[];
};

type GuidedWalkthroughProps = {
    open: boolean;
    steps: GuidedWalkthroughStep[];
    onStepChange?: (index: number) => void;
    onClose: () => void;
};

type TourPosition = {
    top: number;
    left: number;
};

export function GuidedWalkthrough({ open, steps, onStepChange, onClose }: GuidedWalkthroughProps) {
    const [stepIndex, setStepIndex] = React.useState(0);
    const [position, setPosition] = React.useState<TourPosition | null>(null);
    const dialogRef = React.useRef<HTMLDivElement>(null);
    const previousFocusRef = React.useRef<HTMLElement | null>(null);
    const highlightedElementsRef = React.useRef<HTMLElement[]>([]);
    const onStepChangeRef = React.useRef(onStepChange);
    const onCloseRef = React.useRef(onClose);
    const stepsRef = React.useRef(steps);

    onStepChangeRef.current = onStepChange;
    onCloseRef.current = onClose;
    stepsRef.current = steps;

    const closeTour = React.useCallback(() => {
        setStepIndex(0);
        onCloseRef.current();
    }, []);

    React.useEffect(() => {
        if (open) {
            previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            return;
        }

        highlightedElementsRef.current.forEach((element) => element.classList.remove('guided-walkthrough-spotlight'));
        highlightedElementsRef.current = [];
        setPosition(null);
        previousFocusRef.current?.focus();
    }, [open]);

    React.useEffect(() => {
        if (!open || stepsRef.current.length === 0) return undefined;

        const step = stepsRef.current[Math.min(stepIndex, stepsRef.current.length - 1)];
        onStepChangeRef.current?.(Math.min(stepIndex, stepsRef.current.length - 1));
        highlightedElementsRef.current.forEach((element) => element.classList.remove('guided-walkthrough-spotlight'));
        highlightedElementsRef.current = [];
        setPosition(null);

        let measureTimer = 0;
        let targetFrame = 0;
        const frame = window.requestAnimationFrame(() => {
            targetFrame = window.requestAnimationFrame(() => {
                const targets = step.targetSelectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)))
                    .filter((element): element is HTMLElement => element instanceof HTMLElement
                        && element.getClientRects().length > 0
                        && !element.closest('[hidden]'));
                if (targets.length === 0) return;

                targets.forEach((element) => element.classList.add('guided-walkthrough-spotlight'));
                highlightedElementsRef.current = targets;
                targets[0].scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

                const measure = () => {
                    const anchor = targets[0].getBoundingClientRect();
                    const cardWidth = Math.min(380, window.innerWidth - 32);
                    const left = Math.min(
                        Math.max(16, anchor.left + anchor.width / 2 - cardWidth / 2),
                        Math.max(16, window.innerWidth - cardWidth - 16),
                    );
                    const estimatedCardHeight = Math.min(360, window.innerHeight * 0.65);
                    const below = anchor.bottom + 16;
                    const top = below + estimatedCardHeight <= window.innerHeight - 16
                        ? below
                        : Math.max(16, anchor.top - estimatedCardHeight - 16);
                    setPosition({ top, left });
                };

                measureTimer = window.setTimeout(measure, 350);
            });
        });

        function onViewportChange() {
            const anchor = highlightedElementsRef.current[0]?.getBoundingClientRect();
            if (!anchor) return;
            const cardWidth = Math.min(380, window.innerWidth - 32);
            const left = Math.min(
                Math.max(16, anchor.left + anchor.width / 2 - cardWidth / 2),
                Math.max(16, window.innerWidth - cardWidth - 16),
            );
            const estimatedCardHeight = Math.min(360, window.innerHeight * 0.65);
            const below = anchor.bottom + 16;
            const top = below + estimatedCardHeight <= window.innerHeight - 16
                ? below
                : Math.max(16, anchor.top - estimatedCardHeight - 16);
            setPosition({ top, left });
        }

        window.addEventListener('resize', onViewportChange);
        window.addEventListener('scroll', onViewportChange, true);

        return () => {
            window.cancelAnimationFrame(frame);
            window.cancelAnimationFrame(targetFrame);
            window.clearTimeout(measureTimer);
            window.removeEventListener('resize', onViewportChange);
            window.removeEventListener('scroll', onViewportChange, true);
            highlightedElementsRef.current.forEach((element) => element.classList.remove('guided-walkthrough-spotlight'));
            highlightedElementsRef.current = [];
        };
    }, [open, stepIndex]);

    React.useEffect(() => {
        if (!open) return undefined;

        dialogRef.current?.focus();
        function onKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape') {
                closeTour();
                return;
            }
            if (event.key !== 'Tab' || !dialogRef.current) return;

            const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
                'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ));
            if (focusable.length === 0) {
                event.preventDefault();
                return;
            }

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
            if (activeIndex === -1) {
                event.preventDefault();
                (event.shiftKey ? last : first).focus();
            } else if (event.shiftKey && activeIndex === 0) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && activeIndex === focusable.length - 1) {
                event.preventDefault();
                first.focus();
            }
        }

        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [closeTour, open]);

    if (!open || steps.length === 0) return null;

    const activeStep = steps[Math.min(stepIndex, steps.length - 1)];
    const stepNumber = Math.min(stepIndex, steps.length - 1);

    return createPortal(<>
        <div className="guided-walkthrough-backdrop" aria-hidden="true" />
        <div
            ref={dialogRef}
            className={`guided-walkthrough-card${position ? ' is-positioned' : ''}`}
            style={position ? { top: position.top, left: position.left } : undefined}
            role="dialog"
            aria-modal="true"
            aria-labelledby="guided-walkthrough-title"
            aria-describedby="guided-walkthrough-description"
            tabIndex={-1}
        >
            <div className="guided-walkthrough-card-heading">
                <span>Step {stepNumber + 1} of {steps.length}</span>
                <button type="button" className="guided-walkthrough-close" onClick={closeTour} aria-label="Close walkthrough">×</button>
            </div>
            <h2 id="guided-walkthrough-title" aria-live="polite">{activeStep.title}</h2>
            <p id="guided-walkthrough-description">{activeStep.description}</p>
            <div className="guided-walkthrough-actions">
                <button type="button" className="guided-walkthrough-skip" onClick={closeTour}>Skip tour</button>
                <div>
                    <button type="button" onClick={() => setStepIndex((current) => Math.max(0, current - 1))} disabled={stepNumber === 0}>Back</button>
                    <button
                        type="button"
                        className="seller-inline-action"
                        onClick={() => stepNumber === steps.length - 1 ? closeTour() : setStepIndex((current) => current + 1)}
                    >{stepNumber === steps.length - 1 ? 'Finish' : 'Next'}</button>
                </div>
            </div>
        </div>
    </>, document.body);
}
