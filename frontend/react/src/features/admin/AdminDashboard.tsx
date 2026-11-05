import React from 'react';
import { AnalyticsDashboard } from '../shared/AnalyticsDashboard';

type AdminDashboardProps = { onError: (message: string) => void };

export function AdminDashboard(_props: AdminDashboardProps) {
    return <AnalyticsDashboard role="ADMIN" />;
}
