import axios from 'axios';

const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || undefined,
    headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
    },
    withCredentials: true,
});

// Preserve the full CSRF token value instead of splitting on the first equals sign.
// Some Laravel/XSRF cookies include encoded characters and padding that would be truncated otherwise.
api.interceptors.request.use((config) => {
    const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    const rawToken = match?.[1];

    if (rawToken) {
        config.headers['X-XSRF-TOKEN'] = decodeURIComponent(rawToken);
    }

    return config;
});

api.interceptors.response.use(undefined, (error) => {
    const status = error.response?.status;
    const url = error.config?.url || '';

    // Only invalidate the client session on the real auth check, not on every protected admin request.
    // This avoids a transient admin 401 clearing a valid session while multiple requests are in flight.
    if (status === 401) {
        const isSilentSessionCheck = error.config?.headers?.['X-Auth-Check'] === 'silent';

        if (url.includes('/auth/user') && !isSilentSessionCheck) {
            window.dispatchEvent(new CustomEvent('farmgate:unauthenticated'));
        } else if (!url.includes('/auth/logout')) {
            error.userMessage = error.response?.data?.message || 'Your session may have expired. Please sign in again.';
        }
    }

    if (status === 419) {
        window.dispatchEvent(new CustomEvent('farmgate:session-expired'));
    }

    if (status === 429) {
        error.userMessage = 'Too many requests. Please try again shortly.';
    }

    if (status === 422 && error.response?.data?.errors) {
        error.userMessage = Object.values(error.response.data.errors).flat().join(' ');
    }

    return Promise.reject(error);
});

export async function initializeCsrf(): Promise<void> {
    await api.get('/sanctum/csrf-cookie');
}

export default api;