type NavigationBadgeProps = {
    count: number;
};

export function NavigationBadge({ count }: NavigationBadgeProps) {
    if (!Number.isFinite(count) || count < 1) return null;

    return <span className="navigation-badge" aria-hidden="true">
        {count > 99 ? '99+' : Math.floor(count)}
    </span>;
}

export function navigationBadgeLabel(count: number, singular: string, plural: string): string {
    const displayedCount = count > 99 ? '99+' : String(Math.floor(count));
    return `${displayedCount} ${count === 1 ? singular : plural}`;
}
