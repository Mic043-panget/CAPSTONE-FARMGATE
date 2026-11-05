import React from 'react';

export type TabOption = { value: string; label: string };

type TabNavProps = {
    label: string;
    options: TabOption[];
    value: string;
    onChange: (value: string) => void;
    className?: string;
};

export function TabNav({ label, options, value, onChange, className }: TabNavProps) {
    return <nav className={`tab-nav${className ? ` ${className}` : ''}`} aria-label={label}>
        {options.map((option) => <button className={option.value === value ? 'active' : ''} type="button" key={option.value} aria-current={option.value === value ? 'page' : undefined} onClick={() => onChange(option.value)}>{option.label}</button>)}
    </nav>;
}