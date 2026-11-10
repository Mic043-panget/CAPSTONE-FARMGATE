<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AccountSettingsController extends Controller
{
    private const DEFAULT_PREFERENCES = [
        'order_notifications' => true,
        'chat_notifications' => true,
        'event_notifications' => true,
        'allow_direct_messages' => true,
    ];

    public function show(Request $request): JsonResponse
    {
        return response()->json($this->settingsPayload($request));
    }

    public function update(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'order_notifications' => ['sometimes', 'boolean'],
            'chat_notifications' => ['sometimes', 'boolean'],
            'event_notifications' => ['sometimes', 'boolean'],
            'allow_direct_messages' => ['sometimes', 'boolean'],
        ]);
        abort_if($validated === [], 422, 'Choose at least one setting to update.');

        $user = $request->user();
        $preferences = array_merge(
            self::DEFAULT_PREFERENCES,
            $user->account_preferences ?? [],
            $validated,
        );
        $user->forceFill(['account_preferences' => $preferences])->save();

        return response()->json($this->settingsPayload($request));
    }

    public function resendVerification(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_if($user->hasVerifiedEmail(), 409, 'This email address is already verified.');

        $user->sendEmailVerificationNotification();

        return response()->json(['message' => 'A verification link has been sent to your email address.']);
    }

    private function settingsPayload(Request $request): array
    {
        $user = $request->user();

        return [
            'email' => $user->email,
            'email_verified_at' => $user->email_verified_at?->toISOString(),
            'preferences' => array_merge(
                self::DEFAULT_PREFERENCES,
                $user->account_preferences ?? [],
            ),
        ];
    }
}
