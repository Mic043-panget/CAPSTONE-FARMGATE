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

    return <label>{label}{as === 'textarea' ? <textarea {...controlProps} /> : as === 'select' ? <select {...controlProps}>{children}</select> : <input {...controlProps} type={type} />} {(touched || validationTrigger > 0) && error && <span className="field-error" id={describedBy} role="alert">{error}</span>}</label>;
}
