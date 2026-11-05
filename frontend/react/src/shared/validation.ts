export function required(value: string, label: string): string | null {
    return value.trim() ? null : `${label} is required.`;
}

export function email(value: string): string | null {
    if (!value.trim()) return 'Email is required.';
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : 'Enter a valid email address.';
}

export function password(value: string): string | null {
    if (!value) return 'Password is required.';
    return value.length >= 8 ? null : 'Use at least 8 characters.';
}

export function positiveNumber(value: string, label: string): string | null {
    if (!value) return `${label} is required.`;
    return Number(value) > 0 ? null : `${label} must be greater than zero.`;
}
