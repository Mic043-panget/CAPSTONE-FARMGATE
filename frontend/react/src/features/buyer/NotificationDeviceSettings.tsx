import React from 'react';
import api from '../../lib/api';

type PushConfig = { enabled: boolean; public_key: string | null };

function decodePushKey(value: string): ArrayBuffer {
    const padded = value + '='.repeat((4 - value.length % 4) % 4);
    const binary = window.atob(padded.replaceAll('-', '+').replaceAll('_', '/'));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const buffer = new ArrayBuffer(bytes.length);
    new Uint8Array(buffer).set(bytes);

    return buffer;
}

function samePushKey(current: ArrayBuffer | null, expected: ArrayBuffer): boolean {
    if (!current) return false;
    const actual = new Uint8Array(current);
    const expectedBytes = new Uint8Array(expected);

    return actual.length === expectedBytes.length && actual.every((value, index) => value === expectedBytes[index]);
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
    const [pushBusy, setPushBusy] = React.useState(false);
    const [pushMessage, setPushMessage] = React.useState('');

    React.useEffect(() => {
        let active = true;
        api.get<PushConfig>('/api/notifications/push-config')
            .then(async ({ data }) => {
                if (!active) return;
                setPushConfig(data);
                if (!data.enabled || !data.public_key
                    || browserPermission !== 'granted'
                    || !('serviceWorker' in navigator)
                    || !('PushManager' in window)) return;

                const registration = await navigator.serviceWorker.register('/service-worker.js');
                let subscription = await registration.pushManager.getSubscription();
                const serverKey = decodePushKey(data.public_key);
                if (subscription && !samePushKey(subscription.options.applicationServerKey, serverKey)) {
                    await subscription.unsubscribe();
                    subscription = null;
                }
                if (!subscription) return;

                const serialized = subscription.toJSON();
                if (serialized.endpoint && serialized.keys?.p256dh && serialized.keys.auth) {
                    await api.post('/api/notifications/push-subscriptions', {
                        endpoint: serialized.endpoint,
                        expirationTime: serialized.expirationTime,
                        keys: serialized.keys,
                        contentEncoding: 'aes128gcm',
                    });
                    if (active) setPushSubscribed(true);
                }
            })
            .catch((requestError: { userMessage?: string }) => {
                if (active) setPushMessage(requestError.userMessage ?? 'Device notification settings could not be loaded.');
            });

        return () => { active = false; };
    }, [browserPermission]);

    async function enableBrowserNotifications(): Promise<void> {
        if (browserPermission === 'unsupported' || !('serviceWorker' in navigator) || !('PushManager' in window) || !window.isSecureContext) {
            setBrowserPermissionMessage('Background device notifications are not supported here. In-app notifications and email remain available.');
            return;
        }
        if (!pushConfig?.enabled || !pushConfig.public_key) {
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
            const serverKey = decodePushKey(pushConfig.public_key);
            let subscription = await registration.pushManager.getSubscription();
            if (subscription && !samePushKey(subscription.options.applicationServerKey, serverKey)) {
                await subscription.unsubscribe();
                subscription = null;
            }
            subscription ??= await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: serverKey,
            });
            const serialized = subscription.toJSON();
            if (!serialized.endpoint || !serialized.keys?.p256dh || !serialized.keys.auth) {
                throw new Error('The browser returned an incomplete device subscription.');
            }
            await api.post('/api/notifications/push-subscriptions', {
                endpoint: serialized.endpoint,
                expirationTime: serialized.expirationTime,
                keys: serialized.keys,
                contentEncoding: 'aes128gcm',
            });
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
            const registration = await navigator.serviceWorker.getRegistration('/service-worker.js');
            const subscription = await registration?.pushManager.getSubscription();
            if (subscription) {
                await api.delete('/api/notifications/push-subscriptions', { data: { endpoint: subscription.endpoint } });
                await subscription.unsubscribe();
            }
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
            : pushConfig?.enabled === false
                ? 'Device notifications are not configured on this Farmgate server. In-app notifications and email remain available.'
                : 'Allow browser permission to receive important updates on this device, even when Farmgate is closed.');

    return <div className="buyer-notification-device-alerts">
        <button type="button" onClick={() => void enableBrowserNotifications()} disabled={pushBusy || !pushConfig || pushSubscribed || browserPermission === 'unsupported' || pushConfig?.enabled === false}>
            {pushBusy ? 'Updating...' : pushSubscribed ? 'Device notifications enabled' : 'Enable device notifications'}
        </button>
        {pushSubscribed && <button type="button" onClick={() => void disableDeviceNotifications()} disabled={pushBusy}>Disable on this device</button>}
        <p aria-live="polite">{message}</p>
    </div>;
}

export function NotificationDeviceSettings() {
    return <NotificationDeviceSettingsControls {...useDeviceNotificationSettings()} />;
}
