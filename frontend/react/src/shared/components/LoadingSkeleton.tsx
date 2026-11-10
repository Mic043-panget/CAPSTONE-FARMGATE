import React from 'react';

type LoadingSkeletonProps = {
    variant?: 'table' | 'cards' | 'list' | 'detail';
    count?: number;
    columns?: number;
    label?: string;
};

export function LoadingSkeleton({ variant = 'list', count = 3, columns = 4, label = 'Loading content' }: LoadingSkeletonProps) {
    if (variant === 'table') {
        return <div className="farmgate-skeleton farmgate-skeleton-table" role="status" aria-label={label} aria-busy="true">
            {Array.from({ length: count }, (_, row) => <div className="farmgate-skeleton-row" key={row} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
                {Array.from({ length: columns }, (_, column) => <span key={column} />)}
            </div>)}
        </div>;
    }

    return <div className={`farmgate-skeleton farmgate-skeleton-${variant}`} role="status" aria-label={label} aria-busy="true">
        {Array.from({ length: count }, (_, index) => <div className="farmgate-skeleton-card" key={index}>
            <span />
            <span />
            {variant !== 'list' && <span />}
        </div>)}
    </div>;
}
