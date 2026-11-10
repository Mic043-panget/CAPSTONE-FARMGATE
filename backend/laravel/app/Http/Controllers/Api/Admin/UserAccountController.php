<?php

namespace App\Http\Controllers\Api\Admin;

use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\User;
use App\Services\SystemSettingsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class UserAccountController extends Controller
{
    public function violations(Request $request, int $userId): JsonResponse
    {
        $this->admin($request);
        $user = User::withTrashed()->findOrFail($userId);
        $this->ensureManageableAccount($request, $user);

        $violations = $user->moderationViolations()
            ->with('actor:id,name,email')
            ->latest()
            ->get(['id', 'user_id', 'action', 'created_at', 'description', 'reason', 'entity_type', 'entity_id']);

        return response()->json(['violations' => $violations]);
    }

    public function recordViolation(Request $request, int $userId): JsonResponse
    {
        $admin = $this->admin($request);
        $user = User::withTrashed()->findOrFail($userId);
        $this->ensureManageableAccount($request, $user);
        $data = $request->validate(['reason' => ['required', 'string', 'min:5', 'max:255']]);

        $violation = DB::transaction(function () use ($admin, $request, $user, $data): AuditLog {
            return AuditLog::create([
                'user_id' => $admin->id,
                'action' => 'admin.user.violation_recorded',
                'method' => 'POST',
                'route' => $request->path(),
                'status_code' => 201,
                'database_action' => 'INSERT',
                'entity_type' => User::class,
                'entity_id' => (string) $user->id,
                'description' => 'Administrator recorded an account violation report. This does not deactivate the account.',
                'reason' => $data['reason'],
                'ip_address' => $request->ip(),
                'user_agent' => $request->userAgent(),
                'metadata' => ['account_role' => $user->role->value],
                'before_values' => ['account_status' => $user->trashed() ? 'INACTIVE' : 'ACTIVE'],
                'after_values' => ['account_status' => $user->trashed() ? 'INACTIVE' : 'ACTIVE', 'violation_recorded' => true],
                'changed_fields' => ['violation_recorded'],
            ]);
        });

        return response()->json(['message' => 'Violation record added to the account audit history.', 'violation' => $violation], 201);
    }

    public function deactivate(Request $request, int $userId, SystemSettingsService $settings): JsonResponse
    {
        $admin = $this->admin($request);
        $user = User::withTrashed()->findOrFail($userId);
        $this->ensureManageableAccount($request, $user);
        abort_if($user->trashed(), 409, 'This account is already inactive.');
        abort_unless($settings->getBoolean('allow_account_deactivation'), 409, 'Account deactivation is disabled in system settings.');
        $data = $request->validate(['reason' => ['required', 'string', 'min:5', 'max:255']]);

        DB::transaction(function () use ($admin, $request, $user, $data): void {
            $user->delete();
            $user->tokens()->delete();

            AuditLog::create([
                'user_id' => $admin->id,
                'action' => 'admin.user.account_deactivated',
                'method' => 'POST',
                'route' => $request->path(),
                'status_code' => 200,
                'database_action' => 'UPDATE',
                'entity_type' => User::class,
                'entity_id' => (string) $user->id,
                'description' => 'Administrator deactivated the account. Existing API tokens were revoked.',
                'reason' => $data['reason'],
                'ip_address' => $request->ip(),
                'user_agent' => $request->userAgent(),
                'before_values' => ['account_status' => 'ACTIVE'],
                'after_values' => ['account_status' => 'INACTIVE', 'deleted_at' => $user->deleted_at?->toISOString()],
                'changed_fields' => ['deleted_at'],
            ]);
        });

        return response()->json(['message' => 'Account deactivated. The user must sign in again after reactivation.']);
    }

    public function reactivate(Request $request, int $userId, SystemSettingsService $settings): JsonResponse
    {
        $admin = $this->admin($request);
        $user = User::withTrashed()->findOrFail($userId);
        $this->ensureManageableAccount($request, $user);
        abort_unless($user->trashed(), 409, 'This account is already active.');
        abort_unless($settings->getBoolean('allow_account_reactivation'), 409, 'Account reactivation is disabled in system settings.');
        $data = $request->validate(['reason' => ['required', 'string', 'min:5', 'max:255']]);

        DB::transaction(function () use ($admin, $request, $user, $data): void {
            $user->restore();

            AuditLog::create([
                'user_id' => $admin->id,
                'action' => 'admin.user.account_reactivated',
                'method' => 'POST',
                'route' => $request->path(),
                'status_code' => 200,
                'database_action' => 'UPDATE',
                'entity_type' => User::class,
                'entity_id' => (string) $user->id,
                'description' => 'Administrator reactivated the account. The user must sign in again.',
                'reason' => $data['reason'],
                'ip_address' => $request->ip(),
                'user_agent' => $request->userAgent(),
                'before_values' => ['account_status' => 'INACTIVE'],
                'after_values' => ['account_status' => 'ACTIVE'],
                'changed_fields' => ['deleted_at'],
            ]);
        });

        return response()->json(['message' => 'Account reactivated. The user can sign in again.']);
    }

    private function admin(Request $request): User
    {
        $user = $request->user();
        abort_unless($user instanceof User && $user->role === Role::ADMIN, 403);

        return $user;
    }

    private function ensureManageableAccount(Request $request, User $target): void
    {
        abort_if($target->role === Role::ADMIN, 403, 'Administrator accounts cannot be changed through user account controls.');
        abort_if($request->user()?->is($target), 403, 'You cannot change your own account through user account controls.');
    }
}
