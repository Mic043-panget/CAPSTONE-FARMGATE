<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use App\Contracts\FarmgateNotification;
use App\Enums\Role;
use App\Services\NotificationDispatchService;
use Database\Factories\UserFactory;
use Illuminate\Auth\Passwords\CanResetPassword as CanResetPasswordTrait;
use Illuminate\Contracts\Auth\CanResetPassword;
use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

#[Fillable(['name', 'email', 'password', 'role', 'username', 'phone_number', 'profile_photo_path', 'google_id'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable implements CanResetPassword, MustVerifyEmail
{
    /** @use HasFactory<UserFactory> */
    use CanResetPasswordTrait, HasApiTokens, HasFactory, Notifiable, SoftDeletes {
        notify as protected notifyUsingLaravelChannels;
    }

    public function notify($instance)
    {
        if ($instance instanceof FarmgateNotification) {
            app(NotificationDispatchService::class)->send($this, $instance);

            return;
        }

        $this->notifyUsingLaravelChannels($instance);
    }

    public function sellerProfile(): HasOne
    {
        return $this->hasOne(SellerProfile::class);
    }

    public function riderProfile(): HasOne
    {
        return $this->hasOne(RiderProfile::class);
    }

    public function riderApplication(): HasOne
    {
        return $this->hasOne(RiderApplication::class);
    }

    public function loginHistory(): HasMany
    {
        return $this->hasMany(LoginHistory::class);
    }

    public function pushSubscriptions(): HasMany
    {
        return $this->hasMany(PushSubscription::class);
    }

    public function auditLogs(): HasMany
    {
        return $this->hasMany(AuditLog::class);
    }

    public function moderationViolations(): HasMany
    {
        return $this->hasMany(AuditLog::class, 'entity_id')
            ->where('entity_type', self::class)
            ->where('action', 'admin.user.violation_recorded');
    }

    public function livestockListings(): HasMany
    {
        return $this->hasMany(LivestockListing::class, 'seller_id');
    }

    public function interests(): HasMany
    {
        return $this->hasMany(Interest::class, 'buyer_id');
    }

    public function cart(): HasOne
    {
        return $this->hasOne(Cart::class, 'user_id');
    }

    public function orders(): HasMany
    {
        return $this->hasMany(Order::class, 'buyer_id');
    }

    public function buyerAddresses(): HasMany
    {
        return $this->hasMany(BuyerAddress::class)->orderByDesc('is_default')->orderByDesc('created_at');
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'phone_verified_at' => 'datetime',
            'account_preferences' => 'array',
            'password' => 'hashed',
            'role' => Role::class,
        ];
    }

    public function accountPreferenceEnabled(string $preference): bool
    {
        $preferences = $this->account_preferences ?? [];

        return (bool) ($preferences[$preference] ?? true);
    }
}
