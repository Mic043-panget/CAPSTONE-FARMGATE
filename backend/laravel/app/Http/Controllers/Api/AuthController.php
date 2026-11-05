<?php

namespace App\Http\Controllers\Api;

use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\LoginHistory;
use App\Models\User;
use App\Services\PhoneVerificationException;
use App\Services\SellerRegistrationPhoneVerificationService;
use App\Services\SystemSettingsService;
use App\Support\PhilippinePhoneNumber;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Laravel\Socialite\Facades\Socialite;
use Symfony\Component\HttpFoundation\RedirectResponse;

class AuthController extends Controller
{
    public function register(Request $request, SystemSettingsService $settings, SellerRegistrationPhoneVerificationService $phoneVerification): JsonResponse
    {
        abort_unless($settings->getBoolean('account_registration_enabled'), 403, 'Account registration is currently disabled.');
        $requestedRole = $request->input('role', Role::BUYER->value);
        abort_unless($requestedRole === Role::BUYER->value ? $settings->getBoolean('buyer_registration_enabled') : $settings->getBoolean('seller_registration_enabled'), 403, 'This account type is currently unavailable.');
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'email' => ['required', 'string', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'string', 'min:'.$settings->getInt('minimum_password_length'), 'confirmed'],
            'phone_number' => ['required', 'string', 'max:30'],
            'role' => ['sometimes', Rule::in([Role::BUYER->value, Role::SELLER->value])],
            'phone_verification_token' => ['required_if:role,'.Role::SELLER->value, 'nullable', 'string', 'size:64'],
        ]);
        $phoneNumber = PhilippinePhoneNumber::normalize($validated['phone_number']);
        if (! $phoneNumber) {
            throw ValidationException::withMessages([
                'phone_number' => 'Enter a valid Philippine mobile number (09XXXXXXXXX or +639XXXXXXXXX).',
            ]);
        }
        $validated['phone_number'] = $phoneNumber;

        try {
            $user = DB::transaction(function () use ($validated, $phoneVerification): User {
                $role = Role::tryFrom($validated['role'] ?? Role::BUYER->value) ?? Role::BUYER;
                $phoneVerifiedAt = null;
                if ($role === Role::SELLER) {
                    $phoneVerifiedAt = $phoneVerification->consumeVerifiedRegistration(
                        $validated['phone_number'],
                        $validated['phone_verification_token'],
                    );
                }

                $user = User::create([
                    'name' => $validated['name'],
                    'email' => $validated['email'],
                    'password' => $validated['password'],
                    'phone_number' => $validated['phone_number'],
                    'role' => $role,
                ]);

                if ($role === Role::SELLER) {
                    $user->forceFill(['phone_verified_at' => $phoneVerifiedAt])->save();
                    $user->sellerProfile()->create([
                        'latitude' => 12.7321,
                        'longitude' => 121.3654,
                    ]);
                }

                return $user;
            });
        } catch (PhoneVerificationException $exception) {
            return response()->json([
                'message' => $exception->getMessage(),
                'errors' => ['phone_verification_token' => [$exception->getMessage()]],
            ], $exception->httpStatus);
        }

        Auth::login($user);
        $request->session()->regenerate();
        $user->sendEmailVerificationNotification();

        return response()->json(['user' => $this->userPayload($user)], 201);
    }

    public function login(Request $request, SystemSettingsService $settings): JsonResponse
    {
        $credentials = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
            'remember' => ['sometimes', 'boolean'],
        ]);

        $user = User::query()->where('email', $credentials['email'])->first();
        $maxAttempts = max(1, $settings->getInt('maximum_login_attempts'));
        $lockoutMinutes = max(1, $settings->getInt('account_lockout_minutes'));

        if ($user) {
            $recentFailures = $user->loginHistory()
                ->where('was_successful', false)
                ->where('created_at', '>=', now()->subMinutes($lockoutMinutes))
                ->count();

            if ($recentFailures >= $maxAttempts) {
                abort(429, 'This account is temporarily locked due to repeated failed login attempts.');
            }
        }

        if (! Auth::attempt([
            'email' => $credentials['email'],
            'password' => $credentials['password'],
        ], $credentials['remember'] ?? false)) {
            $this->recordLogin($user, $credentials['email'], $request, false);

            return response()->json(['message' => 'The provided credentials are incorrect.'], 422);
        }

        $this->recordLogin($request->user(), $credentials['email'], $request, true);
        $request->session()->regenerate();

        return response()->json(['user' => $this->userPayload($request->user())]);
    }

    public function redirectToGoogle(): RedirectResponse
    {
        if (! $this->googleIsConfigured()) {
            return $this->frontendOAuthRedirect('unconfigured');
        }

        return Socialite::driver('google')->redirect();
    }

    public function handleGoogleCallback(Request $request): RedirectResponse
    {
        if (! $this->googleIsConfigured()) {
            return $this->frontendOAuthRedirect('unconfigured');
        }

        try {
            $googleUser = Socialite::driver('google')->user();
        } catch (\Throwable $exception) {
            report($exception);

            return $this->frontendOAuthRedirect('failed');
        }

        $googleId = $googleUser->getId();
        $email = strtolower(trim((string) $googleUser->getEmail()));
        $emailVerified = ($googleUser->user['email_verified'] ?? $googleUser->user['verified_email'] ?? false) === true;
        if (! $googleId || ! filter_var($email, FILTER_VALIDATE_EMAIL) || ! $emailVerified) {
            return $this->frontendOAuthRedirect('unverified');
        }

        $user = DB::transaction(function () use ($googleId, $email, $googleUser): ?User {
            $linkedUser = User::withTrashed()->where('google_id', $googleId)->first();
            $emailUser = User::withTrashed()->where('email', $email)->first();

            if ($linkedUser?->trashed() || $emailUser?->trashed()) {
                return null;
            }

            if ($linkedUser && $emailUser && $linkedUser->id !== $emailUser->id) {
                return null;
            }

            $user = $linkedUser ?? $emailUser;
            if ($user) {
                if ($user->google_id && $user->google_id !== $googleId) {
                    return null;
                }

                $user->forceFill([
                    'google_id' => $googleId,
                    'email_verified_at' => $user->email_verified_at ?? now(),
                ])->save();

                return $user;
            }

            $baseUsername = Str::of(Str::before($email, '@'))
                ->lower()
                ->replaceMatches('/[^a-z0-9_-]+/', '')
                ->substr(0, 24)
                ->value() ?: 'buyer';
            $username = $baseUsername;
            $suffix = 1;
            while (User::query()->where('username', $username)->exists()) {
                $username = substr($baseUsername, 0, 27).'-'.$suffix++;
            }

            $user = User::create([
                'name' => $googleUser->getName() ?: $baseUsername,
                'username' => $username,
                'email' => $email,
                'password' => Str::random(64),
                'role' => Role::BUYER,
                'google_id' => $googleId,
            ]);
            $user->forceFill(['email_verified_at' => now()])->save();

            return $user;
        });

        if (! $user) {
            return $this->frontendOAuthRedirect('account-conflict');
        }

        Auth::login($user);
        $request->session()->regenerate();

        return $this->frontendOAuthRedirect('success');
    }

    public function logout(Request $request): JsonResponse
    {
        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->json(['message' => 'Logged out successfully.']);
    }

    public function user(Request $request): JsonResponse
    {
        return response()->json(['user' => $this->userPayload($request->user())]);
    }

    public function updateProfile(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless(in_array($user?->role, [Role::BUYER, Role::SELLER, Role::RIDER], true), 403);

        $rules = [
            'name' => ['required', 'string', 'max:120'],
            'username' => ['required', 'string', 'alpha_dash', 'min:3', 'max:32', Rule::unique('users', 'username')->ignore($user->id)],
        ];
        if (in_array($user->role, [Role::SELLER, Role::RIDER], true)) {
            $rules += [
                'email' => ['sometimes', 'required', 'string', 'email', 'max:255', Rule::unique('users', 'email')->ignore($user->id)],
                'business_name' => ['sometimes', 'nullable', 'string', 'max:255'],
                'business_phone' => ['sometimes', 'nullable', 'string', 'max:30'],
                'business_address' => ['sometimes', 'nullable', 'string', 'max:2000'],
            ];
        }
        $data = $request->validate($rules);
        if (array_key_exists('email', $data)) {
            $data['email'] = strtolower(trim($data['email']));
        }

        $emailChanged = isset($data['email']) && $data['email'] !== $user->email;
        DB::transaction(function () use ($user, $data, $emailChanged): void {
            $userData = array_intersect_key($data, array_flip(['name', 'username', 'email']));
            if ($emailChanged) {
                $user->forceFill(['email_verified_at' => null]);
            }
            $user->fill($userData)->save();

            if ($user->role === Role::SELLER) {
                $sellerProfileData = [];
                foreach ([
                    'business_name' => 'business_name',
                    'business_phone' => 'phone',
                    'business_address' => 'address',
                ] as $input => $column) {
                    if (array_key_exists($input, $data)) {
                        $sellerProfileData[$column] = $data[$input];
                    }
                }
                if ($sellerProfileData !== []) {
                    $user->sellerProfile()->firstOrCreate([])->fill($sellerProfileData)->save();
                }
            }
        });

        if ($emailChanged) {
            $user->sendEmailVerificationNotification();
        }

        return response()->json([
            'user' => $this->userPayload($user->refresh()),
            'email_verification_required' => $emailChanged,
        ]);
    }

    public function updatePassword(Request $request, SystemSettingsService $settings): JsonResponse
    {
        abort_unless(in_array($request->user()?->role, [Role::BUYER, Role::SELLER, Role::RIDER], true), 403);
        $data = $request->validate([
            'current_password' => ['required', 'current_password:web'],
            'password' => ['required', 'string', 'min:'.$settings->getInt('minimum_password_length'), 'confirmed'],
        ]);

        $request->user()->forceFill(['password' => $data['password']])->save();

        return response()->json(['message' => 'Password updated.']);
    }

    public function updatePhoto(Request $request): JsonResponse
    {
        abort_unless(in_array($request->user()?->role, [Role::BUYER, Role::RIDER], true), 403);
        $data = $request->validate(['photo' => ['required', 'image', 'mimes:jpg,jpeg,png', 'max:1024']]);
        $user = $request->user();

        $previousPhoto = $user->profile_photo_path;
        $newPhoto = $data['photo']->storePublicly('profile-photos', 'public');
        $user->forceFill(['profile_photo_path' => $newPhoto])->save();
        if ($previousPhoto) {
            Storage::disk('public')->delete($previousPhoto);
        }

        return response()->json(['user' => $this->userPayload($user->refresh())]);
    }

    public function deletePhoto(Request $request): JsonResponse
    {
        abort_unless(in_array($request->user()?->role, [Role::BUYER, Role::RIDER], true), 403);
        $user = $request->user();
        if ($user->profile_photo_path) {
            Storage::disk('public')->delete($user->profile_photo_path);
            $user->forceFill(['profile_photo_path' => null])->save();
        }

        return response()->json(['user' => $this->userPayload($user->refresh())]);
    }

    public function sendResetLink(Request $request): JsonResponse
    {
        $validated = $request->validate(['email' => ['required', 'email']]);
        Password::sendResetLink(['email' => $validated['email']]);

        return response()->json(['message' => 'If the account exists, reset instructions have been sent.']);
    }

    public function resetPassword(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'token' => ['required', 'string'],
            'email' => ['required', 'email'],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
        ]);

        $status = Password::reset($validated, function (User $user, string $password): void {
            $user->forceFill(['password' => $password])->save();
            $user->tokens()->delete();
        });

        if ($status !== Password::PASSWORD_RESET) {
            return response()->json(['message' => __($status)], 422);
        }

        return response()->json(['message' => 'Password reset successfully.']);
    }

    public function userPayload(User $user): array
    {
        $user->loadMissing(['sellerProfile', 'riderProfile']);
        $profilePhotoUrl = null;
        if ($user->profile_photo_path) {
            /** @var FilesystemAdapter $publicDisk */
            $publicDisk = Storage::disk('public');
            $profilePhotoUrl = $publicDisk->url($user->profile_photo_path);
        }

        return [
            'id' => $user->id,
            'name' => $user->name,
            'username' => $user->username ?: explode('@', $user->email)[0],
            'email' => $user->email,
            'phone_number' => $user->phone_number,
            'phone_verified_at' => $user->phone_verified_at,
            'email_verified_at' => $user->email_verified_at,
            'created_at' => $user->created_at,
            'profile_photo_url' => $profilePhotoUrl,
            'role' => $user->role->value,
            'seller_profile' => $user->sellerProfile,
            'rider_profile' => $user->riderProfile,
        ];
    }

    private function googleIsConfigured(): bool
    {
        return filled(config('services.google.client_id'))
            && filled(config('services.google.client_secret'))
            && filled(config('services.google.redirect'));
    }

    private function frontendOAuthRedirect(string $result): RedirectResponse
    {
        $frontendUrl = rtrim((string) config('services.frontend_url'), '/');

        return redirect()->away($frontendUrl.'/?oauth='.rawurlencode($result).'#marketplace');
    }

    private function recordLogin(?User $user, string $identifier, Request $request, bool $successful): void
    {
        $data = [
            'attempted_identifier' => $identifier,
            'was_successful' => $successful,
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
        ];

        if ($user) {
            $user->loginHistory()->create($data);

            return;
        }

        LoginHistory::create($data);
    }
}
