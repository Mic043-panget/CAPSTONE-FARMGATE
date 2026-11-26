import React from 'react';

export type AccountSetupStatus = 'Not started' | 'In progress' | 'Waiting for review' | 'Complete';

export type AccountSetupStep = {
    id: string;
    title: string;
    description: string;
    status: AccountSetupStatus;
    actionLabel: string;
    onAction: () => void;
    secondaryActionLabel?: string;
    onSecondaryAction?: () => void;
    secondaryActionBusy?: boolean;
};

export type AccountSetupGroup = {
    title: string;
    steps: AccountSetupStep[];
};

export function AccountSetupProgress({ id, hidden = false, onClose, title, groups, loading, error, onRetry, onReviewTutorial }: {
    id?: string;
    hidden?: boolean;
    onClose?: () => void;
    title: string;
    groups: AccountSetupGroup[];
    loading: boolean;
    error: string;
    onRetry: () => void;
    onReviewTutorial: () => void;
}) {
    const [expanded, setExpanded] = React.useState(false);
    const closeButton = onClose && <button type="button" className="account-setup-progress-close" aria-label="Close setup progress" title="Close setup progress" onClick={onClose}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
    </button>;
    if (loading) return <aside id={id} hidden={hidden} className="account-setup-progress account-setup-progress--status" role="status">
        <div className="account-setup-progress-status-heading"><span>Loading {title.toLowerCase()} progress…</span>{closeButton}</div>
    </aside>;
    if (error) return <aside id={id} hidden={hidden} className="account-setup-progress account-setup-progress--status" role="alert">
        <div className="account-setup-progress-status-heading"><strong>Couldn’t load {title.toLowerCase()} progress.</strong>{closeButton}</div>
        <span>{error}</span>
        <button type="button" className="seller-text-action" onClick={onRetry}>Retry</button>
    </aside>;

    const steps = groups.flatMap((group) => group.steps);
    const completed = steps.filter((step) => step.status === 'Complete').length;
    const nextStep = steps.find((step) => step.status === 'In progress')
        ?? steps.find((step) => step.status === 'Not started')
        ?? steps.find((step) => step.status === 'Waiting for review');

    return <aside id={id} hidden={hidden} className={`account-setup-progress${expanded ? ' is-expanded' : ''}`} aria-label={`${title} progress`}>
        <div className="account-setup-progress-heading">
            <div><span>Setup progress</span><strong>{completed} of {steps.length} complete</strong></div>
            <div className="account-setup-progress-controls">
                <button type="button" className="account-setup-progress-toggle" aria-expanded={expanded} aria-controls="account-setup-progress-details" onClick={() => setExpanded((value) => !value)}>
                    {expanded ? 'Hide details' : 'Details'}
                </button>
                {closeButton}
            </div>
        </div>
        <progress value={completed} max={Math.max(steps.length, 1)} aria-label={`${completed} of ${steps.length} setup steps complete`} />
        <div className="account-setup-progress-actions">
            {nextStep && <button type="button" className="seller-inline-action" onClick={nextStep.onAction}>Continue: {nextStep.title}</button>}
            <button type="button" className="seller-text-action" aria-haspopup="dialog" onClick={onReviewTutorial}>Take a guided tour</button>
        </div>
        <div id="account-setup-progress-details" className="account-setup-progress-details" hidden={!expanded}>
            {groups.map((group) => {
                const groupComplete = group.steps.filter((step) => step.status === 'Complete').length;
                return <section className="account-setup-group" key={group.title} aria-label={group.title}>
                    <div className="account-setup-group-heading"><h4>{group.title}</h4><span>{groupComplete} of {group.steps.length}</span></div>
                    <progress value={groupComplete} max={Math.max(group.steps.length, 1)} aria-label={`${group.title}: ${groupComplete} of ${group.steps.length} complete`} />
                    <ol className="account-setup-steps">
                        {group.steps.map((step) => <li className="account-setup-step" key={step.id}>
                            <span className="account-setup-step-title">{step.title}</span>
                            <span className={`account-setup-status account-setup-status--${step.status.toLowerCase().replaceAll(' ', '-')}`} role="status">{step.status}</span>
                            <p className="account-setup-step-description">{step.description}</p>
                            <div className="account-setup-step-actions">
                                <button type="button" className="seller-text-action" onClick={step.onAction}>{step.actionLabel}</button>
                                {step.secondaryActionLabel && step.onSecondaryAction && <button
                                    type="button"
                                    className="seller-text-action"
                                    disabled={step.secondaryActionBusy}
                                    onClick={step.onSecondaryAction}
                                >{step.secondaryActionBusy ? 'Saving…' : step.secondaryActionLabel}</button>}
                            </div>
                        </li>)}
                    </ol>
                </section>;
            })}
        </div>
    </aside>;
}
