<?php

use App\Models\User;
use Illuminate\Auth\Events\Verified;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/login', function () {
    return redirect('/');
})->name('login');

Route::get('/email/verify/{id}/{hash}', function (Request $request, int $id, string $hash) {
    $user = User::query()->findOrFail($id);
    abort_unless(hash_equals(sha1($user->getEmailForVerification()), $hash), 403);

    if ($user->markEmailAsVerified()) {
        event(new Verified($user));
    }

    return redirect()->away(rtrim((string) config('services.frontend_url'), '/').'/?email_verification=success#profile');
})->middleware(['signed', 'throttle:6,1'])->name('verification.verify');

Route::get('/', function () {
    return response()->json([
        'application' => config('app.name'),
        'frontend' => 'Run the React app from frontend/react.',
    ]);
});
