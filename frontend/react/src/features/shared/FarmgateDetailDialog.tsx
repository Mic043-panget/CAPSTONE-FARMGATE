import React from 'react';
import { useAccessibleDialog } from '../../shared/hooks/useAccessibleDialog';

type FarmgateDetailDialogProps = {
    eyebrow: string;
    title: React.ReactNode;
    description?: React.ReactNode;
    onClose: () => void;
    closeDisabled?: boolean;
    className?: string;
    contentClassName?: string;
    children: React.ReactNode;
};

export function FarmgateDetailDialog({
    eyebrow,
    title,
    description,
    onClose,
    closeDisabled = false,
    className = '',
    contentClassName = '',
    children,
}: FarmgateDetailDialogProps) {
    const titleId = React.useId();
    const descriptionId = React.useId();
    const dialogRef = useAccessibleDialog<HTMLElement>(true, () => {
        if (!closeDisabled) onClose();
    });

    React.useEffect(() => {
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, []);

    return <div
        className="farmgate-detail-backdrop"
        role="presentation"
        onMouseDown={(event) => {
            if (event.target === event.currentTarget && !closeDisabled) onClose();
        }}
    >
        <section
            ref={dialogRef}
            className={`farmgate-detail-dialog ${className}`.trim()}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
        >
            <header className="farmgate-detail-heading">
                <div>
                    <p className="eyebrow">{eyebrow}</p>
                    <h2 id={titleId}>{title}</h2>
                    {description && <p id={descriptionId} className="farmgate-detail-description">{description}</p>}
                </div>
                <button type="button" className="farmgate-detail-close" onClick={onClose} disabled={closeDisabled} aria-label="Close details">
                    Close
                </button>
            </header>
            <div className={`farmgate-detail-content ${contentClassName}`.trim()}>{children}</div>
        </section>
    </div>;
}
