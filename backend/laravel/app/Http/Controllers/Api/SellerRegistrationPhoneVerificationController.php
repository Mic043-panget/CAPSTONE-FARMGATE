<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\PhoneVerificationException;
use App\Services\SellerRegistrationPhoneVerificationService;
use App\Services\SystemSettingsService;
use App\Support\PhilippinePhoneNumber;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class SellerRegistrationPhoneVerificationController extends Controller
{
    public function send(Request $request, SellerRegistrationPhoneVerificationService $verification, SystemSettingsService $settings): JsonResponse
    {
        $this->ensureRegistrationEnabled($settings);
        $data = $request->validate([
            'phone_number' => ['required', 'string', 'max:30'],
        ]);
        if (! PhilippinePhoneNumber::normalize($data['phone_number'])) {
            throw ValidationException::withMessages([
                'phone_number' => 'Enter a valid Philippine mobile number (09XXXXXXXXX or +639XXXXXXXXX).',
            ]);
        }

        try {
            $verification->send($data['phone_number']);
        } catch (PhoneVerificationException $exception) {
            return response()->json(['message' => $exception->getMessage()], $exception->httpStatus);
        }

        return response()->json([
            'message' => 'A verification code has been sent to your phone. It expires in 10 minutes.',
        ]);
    }

    public function verify(Request $request, SellerRegistrationPhoneVerificationService $verification, SystemSettingsService $settings): JsonResponse
    {
        $this->ensureRegistrationEnabled($settings);
        $data = $request->validate([
            'phone_number' => ['required', 'string', 'max:30'],
            'code' => ['required', 'string', 'regex:/^\d{6}$/'],
        ]);
        if (! PhilippinePhoneNumber::normalize($data['phone_number'])) {
            throw ValidationException::withMessages([
                'phone_number' => 'Enter a valid Philippine mobile number (09XXXXXXXXX or +639XXXXXXXXX).',
            ]);
        }

        try {
            $token = $verification->verify($data['phone_number'], $data['code']);
        } catch (PhoneVerificationException $exception) {
            return response()->json(['message' => $exception->getMessage()], $exception->httpStatus);
        }

        return response()->json([
            'message' => 'Phone number verified. Complete seller registration within 15 minutes.',
            'phone_verification_token' => $token,
        ]);
    }

    private function ensureRegistrationEnabled(SystemSettingsService $settings): void
    {
        abort_unless($settings->getBoolean('account_registration_enabled'), 403, 'Account registration is currently disabled.');
        abort_unless($settings->getBoolean('seller_registration_enabled'), 403, 'Seller registration is currently disabled.');
    }
}
