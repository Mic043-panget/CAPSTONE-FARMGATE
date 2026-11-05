<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class NotificationController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $notifications = $request->user()
            ->notifications()
            ->latest()
            ->limit(100)
            ->get(['id', 'type', 'data', 'read_at', 'created_at']);
        $unreadNotifications = $user->unreadNotifications();

        return response()->json([
            'notifications' => $notifications,
            'unread_count' => (clone $unreadNotifications)
                ->where(fn ($query) => $query->whereNull('data->type')->orWhere('data->type', '!=', 'chat_message'))
                ->count(),
            'unread_chat_count' => (clone $unreadNotifications)->where('data->type', 'chat_message')->count(),
        ]);
    }

    public function markAllAsRead(Request $request): JsonResponse
    {
        $request->user()->unreadNotifications()
            ->where(fn ($query) => $query->whereNull('data->type')->orWhere('data->type', '!=', 'chat_message'))
            ->update(['read_at' => now()]);

        return response()->json([
            'message' => 'Notifications marked as read.',
            'unread_count' => $request->user()->unreadNotifications()
                ->where(fn ($query) => $query->whereNull('data->type')->orWhere('data->type', '!=', 'chat_message'))
                ->count(),
            'unread_chat_count' => $request->user()->unreadNotifications()->where('data->type', 'chat_message')->count(),
        ]);
    }
}
