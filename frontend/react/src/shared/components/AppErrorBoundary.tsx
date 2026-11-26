import React, { Component, type ReactNode } from 'react';

type AppErrorBoundaryProps = {
    children: ReactNode;
};

type AppErrorBoundaryState = {
    hasError: boolean;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
    state: AppErrorBoundaryState = { hasError: false };

    static getDerivedStateFromError(): AppErrorBoundaryState {
        return { hasError: true };
    }

    componentDidCatch(): void {
        console.error('Farmgate UI render failed.');
    }

    render() {
        if (this.state.hasError) {
            return (
                <main className="app-error-boundary" role="alert" aria-live="assertive">
                    <h1>We could not load this page</h1>
                    <p>Refresh the page and try again. If the problem continues, please try again later.</p>
                    <button type="button" onClick={() => window.location.reload()}>
                        Refresh page
                    </button>
                </main>
            );
        }

        return this.props.children;
    }
}
