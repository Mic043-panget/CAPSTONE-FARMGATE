<?php

namespace App\Providers;

use App\Services\AuditContext;
use App\Services\Chat\ChatProvider;
use App\Services\Chat\GeminiChatProvider;
use App\Services\GeminiListingModerationProvider;
use App\Services\ListingModerationProvider;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->scoped(AuditContext::class, fn () => new AuditContext);
        $this->app->singleton(ChatProvider::class, GeminiChatProvider::class);
        $this->app->singleton(ListingModerationProvider::class, GeminiListingModerationProvider::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        Event::listen('eloquent.created: *', function (string $event, array $payload): void {
            $model = $payload[0] ?? null;
            if ($model instanceof Model) {
                app(AuditContext::class)->record('INSERT', $model, [], $model->getAttributes());
            }
        });
        Event::listen('eloquent.updated: *', function (string $event, array $payload): void {
            $model = $payload[0] ?? null;
            if ($model instanceof Model) {
                app(AuditContext::class)->record('UPDATE', $model, $model->getRawOriginal(), $model->getAttributes());
            }
        });
        Event::listen('eloquent.deleted: *', function (string $event, array $payload): void {
            $model = $payload[0] ?? null;
            if ($model instanceof Model) {
                app(AuditContext::class)->record('DELETE', $model, $model->getRawOriginal(), []);
            }
        });

        RateLimiter::for('auth', function (Request $request): Limit {
            return Limit::perMinute(10)->by(strtolower((string) $request->input('email')).'|'.$request->ip());
        });

        RateLimiter::for('interests', function (Request $request): Limit {
            return Limit::perMinute(30)->by($request->user()?->id ?: $request->ip());
        });

        RateLimiter::for('chat', function (Request $request): array {
            $userId = $request->user()?->id;

            return [
                Limit::perMinute(8)->by('chat-user:'.($userId ?: $request->ip())),
                Limit::perMinute(16)->by('chat-ip:'.$request->ip()),
            ];
        });

        RateLimiter::for('chat-search', function (Request $request): array {
            $userId = $request->user()?->id;

            return [
                Limit::perMinute(30)->by('chat-search-user:'.($userId ?: $request->ip())),
                Limit::perMinute(60)->by('chat-search-ip:'.$request->ip()),
            ];
        });
    }
}
