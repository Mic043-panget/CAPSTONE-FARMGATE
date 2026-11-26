import React from 'react';
import api, { initializeCsrf } from '../../lib/api';
import { email as validateEmail } from '../validation';

type ForgotPasswordFormProps = {
    initialEmail: string;
    onBack: () => void;
};

export function ForgotPasswordForm({ initialEmail, onBack }: ForgotPasswordFormProps) {
    const [email, setEmail] = React.useState(initialEmail);
    const [busy, setBusy] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const [error, setError] = React.useState('');

    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const validationError = validateEmail(email);
        if (validationError) {
            setError(validationError);
            setMessage('');
            return;
        }

        setBusy(true);
        setError('');
        setMessage('');
        try {
            await initializeCsrf();
            const response = await api.post<{ message: string }>('/api/auth/forgot-password', { email });
            setMessage(response.data.message);
        } catch (requestError: any) {
            setError(requestError.response?.status === 429
                ? 'Too many requests. Please wait a moment before trying again.'
                : 'We could not send reset instructions right now. Please try again.');
        } finally {
            setBusy(false);
        }
    }

    return <div className="password-reset-form">
        <p>Enter your email and we’ll send a password-reset link if an account matches it.</p>
        <form noValidate onSubmit={(event) => void submit(event)}>
            <label>Email address<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} required /></label>
            {error && <p className="error" role="alert">{error}</p>}
            {message && <p className="password-reset-success" role="status">{message}</p>}
            <button type="submit" disabled={busy}>{busy ? 'Sending...' : 'Send reset link'}</button>
        </form>
        <button className="password-reset-back" type="button" onClick={onBack}>Back to log in</button>
    </div>;
}

type PasswordResetPageProps = {
    hash: string;
};

function resetCredentialsFromHash(hash: string): { email: string; token: string } {
    const prefix = '#reset-password?';
    if (!hash.startsWith(prefix)) return { email: '', token: '' };
    const query = new URLSearchParams(hash.slice(prefix.length));

    return { email: query.get('email') ?? '', token: query.get('token') ?? '' };
}

export function PasswordResetPage({ hash }: PasswordResetPageProps) {
    const credentials = React.useMemo(() => resetCredentialsFromHash(hash), [hash]);
    const [password, setPassword] = React.useState('');
    const [confirmation, setConfirmation] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const [error, setError] = React.useState('');
    const [completed, setCompleted] = React.useState(false);
    const hasCredentials = Boolean(credentials.email && credentials.token);

    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError('');
        setMessage('');
        if (password.length < 8) {
            setError('Use a password with at least 8 characters.');
            return;
        }
        if (password !== confirmation) {
            setError('Passwords do not match.');
            return;
        }

        setBusy(true);
        try {
            await initializeCsrf();
            const response = await api.post<{ message: string }>('/api/auth/reset-password', {
                ...credentials,
                password,
                password_confirmation: confirmation,
            });
            setMessage(response.data.message);
            setPassword('');
            setConfirmation('');
            setCompleted(true);
            window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}#marketplace`);
        } catch (requestError: any) {
            const status = requestError.response?.status;
            const passwordError = requestError.response?.data?.errors?.password?.[0]
                ?? requestError.response?.data?.errors?.password_confirmation?.[0];
            if (passwordError) {
                setError(passwordError);
            } else if (status === 422) {
                setError('This reset link is invalid or has expired. Request a new link to continue.');
            } else if (status === 429) {
                setError('Too many attempts. Please wait a moment and try again.');
            } else {
                setError('We could not reset your password right now. Please try again.');
            }
        } finally {
            setBusy(false);
        }
    }

    return <main className="password-reset-page">
        <section className="password-reset-card" aria-labelledby="password-reset-title">
            <p className="eyebrow">FARMGATE account security</p>
            <h1 id="password-reset-title">Reset your password</h1>
            {!hasCredentials
                ? <p className="error" role="alert">This reset link is invalid or incomplete.</p>
                : completed
                    ? <p className="password-reset-success" role="status">{message}</p>
                    : <form noValidate onSubmit={(event) => void submit(event)}>
                        <p>Choose a new password for {credentials.email}.</p>
                        <label>New password<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.currentTarget.value)} minLength={8} required /></label>
                        <label>Confirm new password<input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.currentTarget.value)} minLength={8} required /></label>
                        {error && <p className="error" role="alert">{error}</p>}
                        <button type="submit" disabled={busy}>{busy ? 'Updating...' : 'Reset password'}</button>
                    </form>}
            {!hasCredentials || (error && !completed)
                ? <button className="password-reset-back" type="button" onClick={() => { window.location.hash = '#forgot-password'; }}>Request a new reset link</button>
                : completed && <a className="password-reset-back" href="/#marketplace">Return to log in</a>}
        </section>
    </main>;
}
