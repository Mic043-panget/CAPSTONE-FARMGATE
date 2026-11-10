let activeRequests = 0;
const listeners = new Set<() => void>();

function publish(): void {
    listeners.forEach((listener) => listener());
}

export function beginRequest(): void {
    activeRequests += 1;
    publish();
}

export function endRequest(): void {
    activeRequests = Math.max(0, activeRequests - 1);
    publish();
}

export function subscribeToRequests(listener: () => void): () => void {
    listeners.add(listener);

    return () => listeners.delete(listener);
}

export function hasActiveRequests(): boolean {
    return activeRequests > 0;
}
