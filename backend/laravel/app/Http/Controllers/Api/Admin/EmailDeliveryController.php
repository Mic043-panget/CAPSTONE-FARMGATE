<?php

namespace App\Http\Controllers\Api\Admin;

use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Jobs\SendAdminMailConfigurationTest;
use App\Models\MailTestDelivery;
use App\Models\User;
use App\Services\EmailDeliveryConfiguration;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Throwable;

class EmailDeliveryController extends Controller
{
    public function status(Request $request, EmailDeliveryConfiguration $configuration): JsonResponse
    {
        $user = $this->admin($request);
        $latestTest = MailTestDelivery::query()
            ->where('user_id', $user->id)
            ->latest('id')
            ->first(['id', 'status', 'attempts', 'last_error', 'sent_at', 'created_at']);
        $configured = $configuration->isConfigured();

        return response()->json([
            'email' => $configuration->status(),
            'can_test' => $configured && $user->email_verified_at !== null && filter_var($user->email, FILTER_VALIDATE_EMAIL) !== false,
            'verified_address' => $user->email_verified_at !== null,
            'latest_test' => $latestTest,
        ]);
    }

    public function sendTest(Request $request, EmailDeliveryConfiguration $configuration): JsonResponse
    {
        $user = $this->admin($request);

        if (! $configuration->isConfigured()) {
            return response()->json([
                'code' => 'SMTP_SETUP_REQUIRED',
                'message' => 'Configure the SMTP environment before requesting a test email.',
            ], 422);
        }

        if (! $user->email_verified_at || ! filter_var($user->email, FILTER_VALIDATE_EMAIL)) {
            return response()->json([
                'code' => 'VERIFIED_EMAIL_REQUIRED',
                'message' => 'Verify your account email before requesting a test message.',
            ], 422);
        }

        $delivery = MailTestDelivery::query()->create([
            'user_id' => $user->id,
            'status' => 'queued',
        ]);
        $connection = (string) config('queue.default', 'database');
        if ($connection === 'sync') {
            $connection = 'database';
        }

        try {
            SendAdminMailConfigurationTest::dispatch($delivery->id)
                ->onConnection($connection)
                ->onQueue('notifications');
        } catch (Throwable $exception) {
            $delivery->forceFill([
                'status' => 'failed',
                'last_error' => $exception::class,
            ])->save();
            Log::warning('A FARMGATE email configuration test could not be queued.', [
                'delivery_id' => $delivery->id,
                'exception' => $exception::class,
            ]);

            return response()->json([
                'code' => 'EMAIL_TEST_QUEUE_FAILED',
                'message' => 'The email test could not be queued. Check the background queue worker.',
            ], 503);
        }

        return response()->json([
            'message' => 'Email test queued for your verified account address.',
            'test' => $delivery->only(['id', 'status', 'attempts', 'created_at']),
        ], 202);
    }

    private function admin(Request $request): User
    {
        $user = $request->user();
        abort_unless($user instanceof User && $user->role === Role::ADMIN, 403);

        return $user;
    }
}
