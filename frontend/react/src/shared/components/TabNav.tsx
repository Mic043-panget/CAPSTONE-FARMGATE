import React from 'react';
import { Button } from './Button';

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
        {options.map((option) => <Button variant={option.value === value ? 'primary' : 'secondary'} size="sm" className={option.value === value ? 'active' : ''} key={option.value} aria-current={option.value === value ? 'page' : undefined} onClick={() => onChange(option.value)}>{option.label}</Button>)}
    </nav>;
}