import React from 'react';
import { getApps, initializeApp } from 'firebase/app';
import { deleteToken, getMessaging, getToken, isSupported } from 'firebase/messaging';
import api from '../../lib/api';

type FirebaseWebConfig = {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket?: string;
    messagingSenderId: string;
    appId: string;
};

type PushConfig = { enabled: boolean; firebase: FirebaseWebConfig | null; vapid_key: string | null };

function firebaseMessaging(config: FirebaseWebConfig) {
    const app = getApps().find((candidate) => candidate.name === '[DEFAULT]')
        ?? initializeApp(config);

    return getMessaging(app);
}

type DeviceNotificationSettingsState = {
    browserPermission: NotificationPermission | 'unsupported';
    browserPermissionMessage: string;
    pushConfig: PushConfig | null;
    pushSubscribed: boolean;
    pushBusy: boolean;
    pushMessage: string;
    enableBrowserNotifications: () => Promise<void>;
    disableDeviceNotifications: () => Promise<void>;
};

export function useDeviceNotificationSettings(): DeviceNotificationSettingsState {
    const [browserPermission, setBrowserPermission] = React.useState<NotificationPermission | 'unsupported'>(() => (
        typeof window !== 'undefined' && 'Notification' in window ? window.Notification.permission : 'unsupported'
    ));
    const [browserPermissionMessage, setBrowserPermissionMessage] = React.useState('');
    const [pushConfig, setPushConfig] = React.useState<PushConfig | null>(null);
    const [pushSubscribed, setPushSubscribed] = React.useState(false);
    const [pushToken, setPushToken] = React.useState<string | null>(null);
    const [pushBusy, setPushBusy] = React.useState(false);
    const [pushMessage, setPushMessage] = React.useState('');

    React.useEffect(() => {
        let active = true;
        api.get<PushConfig>('/api/notifications/push-config')
            .then(async ({ data }) => {
                if (!active) return;
                setPushConfig(data);
                if (!data.enabled || !data.firebase || !data.vapid_key
                    || browserPermission !== 'granted'
                    || !('serviceWorker' in navigator)
                    || !('PushManager' in window)) return;
                if (!await isSupported()) return;

                const registration = await navigator.serviceWorker.register('/service-worker.js');
                const token = await getToken(firebaseMessaging(data.firebase), {
                    vapidKey: data.vapid_key,
                    serviceWorkerRegistration: registration,
                });
                if (!token) return;
                await api.post('/api/notifications/push-subscriptions', { provider: 'fcm', token });
                if (active) {
                    setPushToken(token);
                    setPushSubscribed(true);
                }
            })
            .catch((requestError: { userMessage?: string }) => {
                if (active) setPushMessage(requestError.userMessage ?? 'Device notification settings could not be loaded.');
            });

        return () => { active = false; };
    }, [browserPermission]);

    async function enableBrowserNotifications(): Promise<void> {
        if (browserPermission === 'unsupported' || !('serviceWorker' in navigator) || !('PushManager' in window) || !window.isSecureContext || !await isSupported()) {
            setBrowserPermissionMessage('Background device notifications are not supported here. In-app notifications and email remain available.');
            return;
        }
        if (!pushConfig?.enabled || !pushConfig.firebase || !pushConfig.vapid_key) {
            setBrowserPermissionMessage('Device notifications are not configured on this Farmgate server. In-app notifications and email remain available.');
            return;
        }
        setPushBusy(true);
        try {
            const permission = await window.Notification.requestPermission();
            setBrowserPermission(permission);
            if (permission !== 'granted') {
                setBrowserPermissionMessage('Device permission was not granted. Farmgate will keep in-app notifications and email available.');
                return;
            }

            const registration = await navigator.serviceWorker.register('/service-worker.js');
            const token = await getToken(firebaseMessaging(pushConfig.firebase), {
                vapidKey: pushConfig.vapid_key,
                serviceWorkerRegistration: registration,
            });
            if (!token) throw new Error('Firebase did not return a device registration token.');
            await api.post('/api/notifications/push-subscriptions', { provider: 'fcm', token });
            setPushToken(token);
            setPushSubscribed(true);
            setBrowserPermissionMessage('Device notifications are enabled. Important updates can appear even when Farmgate is closed.');
        } catch (requestError) {
            setBrowserPermissionMessage(requestError instanceof Error
                ? `Device notifications could not be enabled: ${requestError.message}`
                : 'Device notifications could not be enabled. In-app notifications and email remain available.');
        } finally {
            setPushBusy(false);
        }
    }

    async function disableDeviceNotifications(): Promise<void> {
        setPushBusy(true);
        try {
            if (pushToken && pushConfig?.firebase) {
                await api.delete('/api/notifications/push-subscriptions', {
                    data: { provider: 'fcm', token: pushToken },
                });
                if (await isSupported()) {
                    await deleteToken(firebaseMessaging(pushConfig.firebase));
                }
            }
            setPushToken(null);
            setPushSubscribed(false);
            setBrowserPermissionMessage('Device notifications are disabled for this browser. In-app notifications and email remain available.');
        } catch (requestError) {
            setBrowserPermissionMessage(requestError instanceof Error
                ? `Device notifications could not be disabled: ${requestError.message}`
                : 'Device notification settings could not be updated.');
        } finally {
            setPushBusy(false);
        }
    }

    return {
        browserPermission,
        browserPermissionMessage,
        pushConfig,
        pushSubscribed,
        pushBusy,
        pushMessage,
        enableBrowserNotifications,
        disableDeviceNotifications,
    };
}

export function NotificationDeviceSettingsControls({
    browserPermission,
    browserPermissionMessage,
    pushConfig,
    pushSubscribed,
    pushBusy,
    pushMessage,
    enableBrowserNotifications,
    disableDeviceNotifications,
}: DeviceNotificationSettingsState) {
    const message = browserPermissionMessage || pushMessage || (browserPermission === 'unsupported' || !('serviceWorker' in navigator) || !('PushManager' in window)
        ? 'Device notifications are unavailable on this browser or device. In-app notifications and email remain available.'
        : browserPermission === 'denied'
            ? 'Device notification permission is blocked in browser settings. In-app notifications and email remain available.'
            : pushConfig?.enabled === false || !pushConfig?.firebase || !pushConfig?.vapid_key
                ? 'Device notifications are not configured on this Farmgate server. In-app notifications and email remain available.'
                : 'Allow browser permission to receive important updates on this device, even when Farmgate is closed.');

    return <div className="farmgate-notification-device">
        <span className="farmgate-notification-device-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
        </span>
        <strong>{pushSubscribed ? 'Device notifications enabled' : 'Enable device notifications'}</strong>
        <p aria-live="polite">{message}</p>
        <div className="farmgate-notification-device-actions">
            {!pushSubscribed && <button type="button" onClick={() => void enableBrowserNotifications()} disabled={pushBusy || !pushConfig || browserPermission === 'unsupported' || pushConfig?.enabled === false}>
                {pushBusy ? 'Updating...' : 'Enable'}
            </button>}
            {pushSubscribed && <button type="button" onClick={() => void disableDeviceNotifications()} disabled={pushBusy}>{pushBusy ? 'Updating...' : 'Disable on this device'}</button>}
        </div>
    </div>;
}

export function NotificationDeviceSettings() {
    return <NotificationDeviceSettingsControls {...useDeviceNotificationSettings()} />;
}
