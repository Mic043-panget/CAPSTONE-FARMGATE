import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'subtle' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

type ButtonBaseProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'aria-label'> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    loading?: boolean;
    leadingIcon?: React.ReactNode;
    trailingIcon?: React.ReactNode;
    className?: string;
};

type ButtonProps = ButtonBaseProps & (
    | { iconOnly: true; 'aria-label': string; children?: never }
    | { iconOnly?: false; 'aria-label'?: string; children: React.ReactNode }
);

export function Button({
    variant = 'secondary',
    size = 'md',
    loading = false,
    leadingIcon,
    trailingIcon,
    iconOnly = false,
    className,
    type = 'button',
    disabled,
    children,
    ...props
}: ButtonProps) {
    const classes = [
        'fg-button',
        `fg-button--${variant}`,
        `fg-button--${size}`,
        iconOnly ? 'fg-button--icon-only' : '',
        loading ? 'is-loading' : '',
        className ?? '',
    ].filter(Boolean).join(' ');

    return <button
        {...props}
        type={type}
        className={classes}
        disabled={disabled || loading}
        aria-busy={loading || props['aria-busy'] || undefined}
    >
        {loading && <span className="fg-button__spinner" aria-hidden="true" />}
        {loading && <span className="sr-only" role="status">Loading</span>}
        {!iconOnly && leadingIcon && <span className="fg-button__icon" aria-hidden="true">{leadingIcon}</span>}
        {!iconOnly && children}
        {!iconOnly && trailingIcon && <span className="fg-button__icon" aria-hidden="true">{trailingIcon}</span>}
        {iconOnly && leadingIcon}
    </button>;
}

type ViewDetailsActionProps = {
    onClick: React.MouseEventHandler<HTMLButtonElement>;
    contextLabel: string;
    expanded?: boolean;
    controls?: string;
    disabled?: boolean;
    loading?: boolean;
    className?: string;
};

export function ViewDetailsAction({
    onClick,
    contextLabel,
    expanded,
    controls,
    disabled,
    loading,
    className,
}: ViewDetailsActionProps) {
    const label = expanded ? 'Hide details' : 'View details';

    return <Button
        variant="subtle"
        size="sm"
        className={className}
        onClick={onClick}
        disabled={disabled}
        loading={loading}
        aria-label={`${label} for ${contextLabel}`}
        aria-expanded={expanded}
        aria-controls={controls}
    >{label}</Button>;
}
