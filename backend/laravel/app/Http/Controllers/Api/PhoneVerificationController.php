<?php

namespace App\Http\Controllers\Api;

use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\RiderProfile;
use App\Services\PhoneVerificationException;
use App\Services\PhoneVerificationService;
use App\Support\PhilippinePhoneNumber;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class PhoneVerificationController extends Controller
{
    public function send(Request $request, PhoneVerificationService $verification): JsonResponse
    {
        $data = $request->validate([
            'phone_number' => ['required', 'string', 'max:30'],
        ]);
        $phoneNumber = PhilippinePhoneNumber::normalize($data['phone_number']);
        if (! $phoneNumber) {
            throw ValidationException::withMessages([
                'phone_number' => 'Enter a valid Philippine mobile number (09XXXXXXXXX or +639XXXXXXXXX).',
            ]);
        }

        try {
            $sent = $verification->send($request->user(), $phoneNumber);
        } catch (PhoneVerificationException $exception) {
            return response()->json(['message' => $exception->getMessage()], $exception->httpStatus);
        }

        $user = $request->user()->refresh();
        if ($user->role === Role::RIDER) {
            RiderProfile::query()->updateOrCreate(
                ['user_id' => $user->id],
                ['phone' => $user->phone_number],
            );
        }

        return response()->json([
            'message' => $sent
                ? 'If this number can receive a verification code, a code has been sent.'
                : 'This phone number is already verified.',
            'user' => app(AuthController::class)->userPayload($user),
        ]);
    }

    public function verify(Request $request, PhoneVerificationService $verification): JsonResponse
    {
        $data = $request->validate([
            'code' => ['required', 'string', 'regex:/^\d{6}$/'],
        ]);

        try {
            $verification->verify($request->user(), $data['code']);
        } catch (PhoneVerificationException $exception) {
            return response()->json(['message' => $exception->getMessage()], $exception->httpStatus);
        }

        $user = $request->user()->refresh();
        if ($user->role === Role::RIDER) {
            RiderProfile::query()->updateOrCreate(
                ['user_id' => $user->id],
                ['phone' => $user->phone_number],
            );
        }

        return response()->json([
            'message' => 'Phone number verified.',
            'user' => app(AuthController::class)->userPayload($user),
        ]);
    }
}
