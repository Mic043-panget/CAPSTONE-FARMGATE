import React from 'react';
import { AnalyticsDashboard } from '../shared/AnalyticsDashboard';

type AdminDashboardProps = { onError: (message: string) => void; onOpenOrder?: (orderId: number) => void; userName: string };

export function AdminDashboard({ userName, onOpenOrder }: AdminDashboardProps) {
    return <AnalyticsDashboard role="ADMIN" preparedBy={userName} onOpenOrder={onOpenOrder} />;
}
