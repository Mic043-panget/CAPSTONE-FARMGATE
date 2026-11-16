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

export function AccountSetupChecklist({ title, description, groups }: {
    title: string;
    description: string;
    groups: AccountSetupGroup[];
}) {
    const steps = groups.flatMap((group) => group.steps);
    const completed = steps.filter((step) => step.status === 'Complete').length;
    const nextStep = steps.find((step) => step.status === 'In progress')
        ?? steps.find((step) => step.status === 'Not started')
        ?? steps.find((step) => step.status === 'Waiting for review')
        ?? steps[0];

    return <section className="account-setup-checklist" aria-labelledby="account-setup-checklist-title">
        <div className="account-setup-heading">
            <div>
                <p className="eyebrow">Setup guide</p>
                <h3 id="account-setup-checklist-title">{title}</h3>
                <p>{description}</p>
            </div>
            <button type="button" className="seller-inline-action" onClick={nextStep.onAction}>
                {completed === steps.length ? 'Review setup' : 'Continue setup'}
            </button>
        </div>
        <div className="account-setup-overall-progress">
            <progress value={completed} max={steps.length} aria-label={`${completed} of ${steps.length} setup steps complete`} />
            <strong>{completed} of {steps.length} steps complete</strong>
        </div>
        {groups.map((group) => {
            const groupComplete = group.steps.filter((step) => step.status === 'Complete').length;

            return <section className="account-setup-group" key={group.title} aria-label={group.title}>
                <div className="account-setup-group-heading">
                    <h4>{group.title}</h4>
                    <span>{groupComplete} of {group.steps.length} complete</span>
                </div>
                <progress value={groupComplete} max={group.steps.length} aria-label={`${group.title}: ${groupComplete} of ${group.steps.length} complete`} />
                <ol className="account-setup-steps">
                    {group.steps.map((step) => <li className="account-setup-step" key={step.id}>
                        <div className="account-setup-step-copy">
                            <strong>{step.title}</strong>
                            <p>{step.description}</p>
                        </div>
                        <span className={`account-setup-status account-setup-status--${step.status.toLowerCase().replaceAll(' ', '-')}`} role="status">{step.status}</span>
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
    </section>;
}
