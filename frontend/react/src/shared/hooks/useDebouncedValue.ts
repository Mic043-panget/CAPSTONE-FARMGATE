import React from 'react';

export function useDebouncedValue<T>(value: T, delay = 200): T {
    const [debouncedValue, setDebouncedValue] = React.useState(value);

    React.useEffect(() => {
        const timeout = window.setTimeout(() => setDebouncedValue(value), delay);
        return () => window.clearTimeout(timeout);
    }, [value, delay]);

    return debouncedValue;
}
