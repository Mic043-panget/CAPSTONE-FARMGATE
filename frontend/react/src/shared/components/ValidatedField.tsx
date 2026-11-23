import React from 'react';

type ValidatedFieldProps = {
    label: string;
    value: string;
    onChange: (value: string) => void;
    validate?: (value: string) => string | null;
    type?: string;
    placeholder?: string;
    required?: boolean;
    minLength?: number;
    maxLength?: number;
    validationTrigger?: number;
    children?: React.ReactNode;
    as?: 'input' | 'textarea' | 'select';
};

export function ValidatedField({ label, value, onChange, validate, type = 'text', placeholder, required, minLength, maxLength, validationTrigger = 0, children, as = 'input' }: ValidatedFieldProps) {
    const [touched, setTouched] = React.useState(false);
    const [passwordVisible, setPasswordVisible] = React.useState(false);
    const error = validate?.(value) ?? null;
    const describedBy = error ? `${label.toLowerCase().replaceAll(' ', '-')}-error` : undefined;
    const controlProps = {
        id: label.toLowerCase().replaceAll(' ', '-'),
        value,
        onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => onChange(event.target.value),
        onBlur: () => setTouched(true),
        'aria-invalid': Boolean(touched && error),
        'aria-describedby': describedBy,
        placeholder,
        required,
        minLength,
        maxLength,
    };

    if (as === 'input' && type === 'password') {
        return <div className="validated-password-field">
            <label htmlFor={controlProps.id}>{label}</label>
            <div className="validated-password-control">
                <input {...controlProps} type={passwordVisible ? 'text' : 'password'} />
                <button
                    className="validated-password-toggle"
                    type="button"
                    aria-label={passwordVisible ? 'Hide password' : 'Show password'}
                    aria-controls={controlProps.id}
                    aria-pressed={passwordVisible}
                    onClick={() => setPasswordVisible((visible) => !visible)}
                >
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        {passwordVisible
                            ? <><path d="M3 3l18 18" /><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 5.2A10.7 10.7 0 0 1 12 5c5.5 0 9 7 9 7a15.7 15.7 0 0 1-3.1 3.8M6.2 6.2C3.9 7.7 3 12 3 12s3.5 7 9 7a10.5 10.5 0 0 0 4-.8" /></>
                            : <><path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" /><circle cx="12" cy="12" r="3" /></>}
                    </svg>
                </button>
            </div>
            {(touched || validationTrigger > 0) && error && <span className="field-error" id={describedBy} role="alert">{error}</span>}
        </div>;
    }

    return <label>{label}{as === 'textarea' ? <textarea {...controlProps} /> : as === 'select' ? <select {...controlProps}>{children}</select> : <input {...controlProps} type={type} />} {(touched || validationTrigger > 0) && error && <span className="field-error" id={describedBy} role="alert">{error}</span>}</label>;
}
