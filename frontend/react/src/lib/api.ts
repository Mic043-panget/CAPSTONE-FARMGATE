import axios, { type AxiosError } from 'axios';
import { beginRequest, endRequest } from './requestProgress';

type ApiErrorPayload = {
    message?: unknown;
    errors?: unknown;
    reference_id?: unknown;
    [key: string]: unknown;
};

type FarmgateAxiosError = AxiosError<ApiErrorPayload> & {
    userMessage?: string;
};

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
    beginRequest();
    const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    const rawToken = match?.[1];

    if (rawToken) {
        config.headers['X-XSRF-TOKEN'] = decodeURIComponent(rawToken);
    }

    return config;
}, (error) => {
    endRequest();
    return Promise.reject(error);
});

const technicalMessagePattern = /SQLSTATE|PDOException|Illuminate\\|Symfony\\|stack trace|vendor\/|\/var\/www\/|\.php(?::\d+)?|call to undefined|syntax error|uncaught exception/i;

function isSafeUserMessage(value: unknown): value is string {
    return typeof value === 'string'
        && value.trim().length > 0
        && value.trim().length <= 500
        && !technicalMessagePattern.test(value)
        && !/<[^>]*>/.test(value);
}

function getPayload(error: FarmgateAxiosError): ApiErrorPayload | undefined {
    const data: unknown = error.response?.data;

    return typeof data === 'object' && data !== null && !Array.isArray(data)
        ? data as ApiErrorPayload
        : undefined;
}

function sanitizeValidationErrors(errors: unknown): Record<string, string[]> {
    if (typeof errors !== 'object' || errors === null || Array.isArray(errors)) {
        return {};
    }

    const safeErrors: Record<string, string[]> = {};
    for (const [field, value] of Object.entries(errors as Record<string, unknown>)) {
        if (field.trim().length === 0 || field.trim().length > 100 || /<[^>]*>/.test(field)) {
            continue;
        }

        const messages = (Array.isArray(value) ? value : [value])
            .filter(isSafeUserMessage)
            .map((message) => message.trim())
            .slice(0, 3);

        if (messages.length > 0) {
            safeErrors[field] = messages;
        }
    }

    return safeErrors;
}

function getValidationMessages(errors: Record<string, string[]>): string[] {
    return Object.values(errors).flat().slice(0, 3);
}

function getStatusMessage(status: number | undefined, responseMessage?: string): string {
    switch (status) {
        case 401:
            return 'Your session may have expired. Please sign in again.';
        case 403:
            return responseMessage ?? 'You do not have permission to do that.';
        case 404:
            return 'The requested information could not be found or is no longer available.';
        case 408:
        case 504:
            return 'The request took too long. Check your connection and try again.';
        case 413:
            return 'The submitted data is too large. Reduce the file size or number of images and try again.';
        case 419:
            return 'Your session has expired. Refresh the page and sign in again.';
        case 429:
            return responseMessage ?? 'You are making requests too quickly. Please wait a moment and try again.';
        case 422:
            return responseMessage && responseMessage !== 'The given data was invalid.'
                ? responseMessage
                : 'Please review the highlighted information and try again.';
        default:
            if (status !== undefined && status >= 500) {
                return responseMessage ?? 'Farmgate could not complete the request. Please try again later.';
            }

            return responseMessage ?? 'The request could not be completed. Please try again.';
    }
}

api.interceptors.response.use((response) => {
    endRequest();
    return response;
}, (error: unknown) => {
    endRequest();

    if (!axios.isAxiosError<ApiErrorPayload>(error) || axios.isCancel(error)) {
        return Promise.reject(error);
    }

    const requestError = error as FarmgateAxiosError;
    const status = requestError.response?.status;
    const url = requestError.config?.url || '';

    // Only invalidate the client session on the real auth check, not on every protected admin request.
    // This avoids a transient admin 401 clearing a valid session while multiple requests are in flight.
    if (status === 401) {
        const isSilentSessionCheck = requestError.config?.headers?.['X-Auth-Check'] === 'silent';

        if (url.includes('/auth/user') && !isSilentSessionCheck) {
            window.dispatchEvent(new CustomEvent('farmgate:unauthenticated'));
        } else if (!url.includes('/auth/logout')) {
            requestError.userMessage = 'Your session may have expired. Please sign in again.';
        }
    }

    if (status === 419) {
        window.dispatchEvent(new CustomEvent('farmgate:session-expired'));
    }

    if (!requestError.response) {
        const message = requestError.code === 'ECONNABORTED' || requestError.code === 'ETIMEDOUT'
            ? 'The request took too long. Check your connection and try again.'
            : 'We could not reach Farmgate. Check your connection and try again.';
        requestError.userMessage = message;
        requestError.message = message;
        return Promise.reject(requestError);
    }

    const payload = getPayload(requestError);
    const responseMessage = isSafeUserMessage(payload?.message) ? payload.message.trim() : undefined;
    const message = getStatusMessage(status, responseMessage);
    const validationErrors = status === 422 ? sanitizeValidationErrors(payload?.errors) : undefined;
    const validationMessages = validationErrors ? getValidationMessages(validationErrors) : [];
    const userMessage = validationMessages.length > 0 ? validationMessages.join(' ') : message;

    requestError.userMessage = userMessage;
    requestError.message = userMessage;

    if (status !== undefined && status >= 500) {
        const referenceId = typeof payload?.reference_id === 'string' && /^[\w-]{8,80}$/.test(payload.reference_id)
            ? payload.reference_id
            : undefined;
        const safePayload: ApiErrorPayload = { message };

        if (referenceId) {
            safePayload.reference_id = referenceId;
        }

        requestError.response.data = safePayload;
    } else {
        const safePayload: ApiErrorPayload = payload ?? {};
        safePayload.message = message;
        if (validationErrors) {
            safePayload.errors = validationErrors;
        }
        requestError.response.data = safePayload;
    }

    return Promise.reject(requestError);
});

export async function initializeCsrf(): Promise<void> {
    await api.get('/sanctum/csrf-cookie');
}

export default api;