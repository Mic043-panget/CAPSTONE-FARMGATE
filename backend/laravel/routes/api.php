<?php

use App\Http\Controllers\Api\AccountSettingsController;
use App\Http\Controllers\Api\Admin\ComplaintController as AdminComplaintController;
use App\Http\Controllers\Api\Admin\DashboardController as AdminDashboardController;
use App\Http\Controllers\Api\Admin\ListingController as AdminListingController;
use App\Http\Controllers\Api\Admin\OverviewController as AdminOverviewController;
use App\Http\Controllers\Api\Admin\ReviewModerationController;
use App\Http\Controllers\Api\Admin\SettingsController as AdminSettingsController;
use App\Http\Controllers\Api\AnalyticsController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\Buyer\AddressController as BuyerAddressController;
use App\Http\Controllers\Api\Buyer\ComplaintController as BuyerComplaintController;
use App\Http\Controllers\Api\Buyer\DashboardController as BuyerDashboardController;
use App\Http\Controllers\Api\Buyer\ReviewController as BuyerReviewController;
use App\Http\Controllers\Api\CartController;
use App\Http\Controllers\Api\CategoryController;
use App\Http\Controllers\Api\ChatController;
use App\Http\Controllers\Api\CheckoutController;
use App\Http\Controllers\Api\DeliveryController;
use App\Http\Controllers\Api\DeliveryTrackingController;
use App\Http\Controllers\Api\InterestController;
use App\Http\Controllers\Api\ListingController;
use App\Http\Controllers\Api\NotificationController;
use App\Http\Controllers\Api\OrderController;
use App\Http\Controllers\Api\PayMongoWebhookController;
use App\Http\Controllers\Api\PhoneVerificationController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\Rider\DashboardController as RiderDashboardController;
use App\Http\Controllers\Api\RiderApplicationController;
use App\Http\Controllers\Api\RiderController;
use App\Http\Controllers\Api\Seller\ComplaintController as SellerComplaintController;
use App\Http\Controllers\Api\Seller\DashboardController as SellerDashboardController;
use App\Http\Controllers\Api\Seller\ProfileController as SellerProfileController;
use App\Http\Controllers\Api\Seller\PromotionController as SellerPromotionController;
use App\Http\Controllers\Api\Seller\ReviewController as SellerReviewController;
use App\Http\Controllers\Api\SellerRegistrationPhoneVerificationController;
use App\Http\Middleware\EnsureApprovedRider;
use App\Http\Middleware\MaintenanceMode;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::post('/payments/paymongo/webhook', [PayMongoWebhookController::class, 'handle']);

Route::middleware(MaintenanceMode::class)->group(function (): void {
    Route::get('/health', function () {
        return response()->json([
            'status' => 'ok',
            'application' => config('app.name'),
        ]);
    });

    Route::get('/categories', [CategoryController::class, 'index']);
    Route::get('/listings', [ListingController::class, 'index']);
    Route::get('/listings/{listing}', [ListingController::class, 'show']);
    Route::get('/review-media/{media}', [BuyerReviewController::class, 'publicMedia'])->name('review-media.public');
    Route::get('/orders/verify/{reference}', [OrderController::class, 'verify'])
        ->where('reference', 'FG-(?:[A-Z]{2}-S[0-9]{5,}-P[0-9]{5,}-[23456789A-HJ-NP-Z]{16}|[A-F0-9]{32})')
        ->middleware('throttle:30,1');

    Route::middleware('web')->group(function (): void {
        Route::get('/rider-registration/policy', [RiderApplicationController::class, 'policy']);
        Route::get('/rider-registration/policy-document', [RiderApplicationController::class, 'policyDocument'])->name('rider-registration.policy-document');
        Route::get('/auth/google/redirect', [AuthController::class, 'redirectToGoogle'])->middleware('throttle:auth');
        Route::get('/auth/google/callback', [AuthController::class, 'handleGoogleCallback'])->middleware('throttle:auth');

        Route::middleware('throttle:auth')->group(function (): void {
            Route::post('/auth/register', [AuthController::class, 'register']);
            Route::post('/rider-registration', [RiderApplicationController::class, 'register'])->middleware('throttle:auth');
            Route::post('/auth/seller-registration/phone/send', [SellerRegistrationPhoneVerificationController::class, 'send'])->middleware('throttle:5,1');
            Route::post('/auth/seller-registration/phone/verify', [SellerRegistrationPhoneVerificationController::class, 'verify'])->middleware('throttle:10,1');
            Route::post('/auth/login', [AuthController::class, 'login']);
            Route::post('/auth/forgot-password', [AuthController::class, 'sendResetLink']);
            Route::post('/auth/reset-password', [AuthController::class, 'resetPassword']);
        });

        Route::middleware('auth:sanctum')->group(function (): void {
            Route::get('/auth/user', [AuthController::class, 'user']);
            Route::get('/rider/application', [RiderApplicationController::class, 'show']);
            Route::post('/rider/application/submit', [RiderApplicationController::class, 'submit'])->middleware('throttle:10,1');
            Route::post('/rider/vehicle-change', [RiderApplicationController::class, 'vehicleChange'])->middleware('throttle:10,1');
            Route::get('/rider-documents/{document}', [RiderApplicationController::class, 'document'])->middleware('signed')->name('rider-documents.show');
            Route::post('/profile/phone/send', [PhoneVerificationController::class, 'send'])->middleware('throttle:5,1');
            Route::post('/profile/phone/verify', [PhoneVerificationController::class, 'verify'])->middleware('throttle:10,1');
            Route::put('/profile', [AuthController::class, 'updateProfile'])->middleware('throttle:6,1');
            Route::put('/profile/password', [AuthController::class, 'updatePassword'])->middleware('throttle:10,1');
            Route::post('/profile/photo', [AuthController::class, 'updatePhoto']);
            Route::delete('/profile/photo', [AuthController::class, 'deletePhoto']);
            Route::get('/profile/settings', [AccountSettingsController::class, 'show']);
            Route::put('/profile/settings', [AccountSettingsController::class, 'update']);
            Route::post('/profile/email/verification-notification', [AccountSettingsController::class, 'resendVerification'])->middleware('throttle:6,1');
            Route::post('/auth/logout', [AuthController::class, 'logout']);
            Route::post('/categories', [CategoryController::class, 'store']);
            Route::get('/seller/listings', [ListingController::class, 'mine']);
            Route::get('/seller/profile', [SellerProfileController::class, 'show']);
            Route::put('/seller/profile/location', [SellerProfileController::class, 'update']);
            Route::get('/seller/promotions', [SellerPromotionController::class, 'index']);
            Route::get('/seller/promotions/eligible-listings', [SellerPromotionController::class, 'eligibleListings']);
            Route::post('/seller/promotions', [SellerPromotionController::class, 'store'])->middleware('throttle:30,1');
            Route::put('/seller/promotions/{promotion}', [SellerPromotionController::class, 'update'])->middleware('throttle:30,1');
            Route::delete('/seller/promotions/{promotion}', [SellerPromotionController::class, 'destroy'])->middleware('throttle:30,1');
            Route::post('/seller/promotions/{promotion}/activate', [SellerPromotionController::class, 'activate'])->middleware('throttle:30,1');
            Route::post('/seller/promotions/{promotion}/pause', [SellerPromotionController::class, 'pause'])->middleware('throttle:30,1');
            Route::post('/seller/promotions/{promotion}/end', [SellerPromotionController::class, 'end'])->middleware('throttle:30,1');
            Route::post('/seller/listings', [ListingController::class, 'store']);
            Route::put('/seller/listings/{listing}', [ListingController::class, 'update']);
            Route::delete('/seller/listings/{listing}', [ListingController::class, 'destroy']);
            Route::post('/seller/listings/{listing}/cancel', [ListingController::class, 'cancel']);
            Route::post('/seller/listings/{listing}/submit', [ListingController::class, 'submit']);
            Route::get('/admin/listings', [AdminListingController::class, 'index']);
            Route::post('/admin/listings/{listing}/moderation-retry', [AdminListingController::class, 'retryModeration']);
            Route::post('/admin/listings/{listing}/review', [AdminListingController::class, 'review']);
            Route::get('/admin/rider-applications', [RiderApplicationController::class, 'adminIndex']);
            Route::patch('/admin/rider-applications/{application}', [RiderApplicationController::class, 'adminDecision']);
            Route::delete('/admin/rider-documents/{document}', [RiderApplicationController::class, 'deleteDocument']);
            Route::get('/admin/rider-vehicle-changes', [RiderApplicationController::class, 'adminVehicleChanges']);
            Route::patch('/admin/rider-vehicle-changes/{change}', [RiderApplicationController::class, 'adminVehicleDecision']);
            Route::get('/admin/users', [AdminOverviewController::class, 'users']);
            Route::get('/admin/orders', [AdminOverviewController::class, 'orders']);
            Route::get('/admin/orders/{order}', [AdminOverviewController::class, 'orderDetails']);
            Route::get('/admin/deliveries', [AdminOverviewController::class, 'deliveries']);
            Route::get('/admin/categories', [AdminOverviewController::class, 'categories']);
            Route::get('/admin/security/login-history', [AdminOverviewController::class, 'loginHistory']);
            Route::get('/admin/audit-logs', [AdminOverviewController::class, 'auditLogs']);
            Route::get('/admin/audit-logs/{auditLog}', [AdminOverviewController::class, 'auditLog']);
            Route::get('/admin/settings', [AdminSettingsController::class, 'show']);
            Route::get('/admin/settings/categories', [AdminSettingsController::class, 'categories']);
            Route::get('/admin/settings/history', [AdminSettingsController::class, 'history']);
            Route::get('/admin/settings/tiers', [AdminSettingsController::class, 'tiers']);
            Route::post('/admin/settings/tiers', [AdminSettingsController::class, 'storeTier']);
            Route::put('/admin/settings/tiers/{tier}', [AdminSettingsController::class, 'updateTier']);
            Route::delete('/admin/settings/tiers/{tier}', [AdminSettingsController::class, 'destroyTier']);
            Route::get('/admin/settings/{key}', [AdminSettingsController::class, 'key']);
            Route::put('/admin/settings/{key}', [AdminSettingsController::class, 'updateKey']);
            Route::put('/admin/settings', [AdminSettingsController::class, 'update']);
            Route::get('/admin/settings', [AdminSettingsController::class, 'show']);
            Route::put('/admin/settings', [AdminSettingsController::class, 'update']);
            Route::middleware('throttle:interests')->group(function (): void {
                Route::post('/listings/{listing}/interest', [InterestController::class, 'toggle']);
            });
            Route::get('/buyer/interests', [InterestController::class, 'mine']);
            Route::get('/seller/interests', [InterestController::class, 'sellerAnalytics']);
            Route::patch('/seller/interests/{interest}', [InterestController::class, 'updateStatus']);

            Route::get('/cart', [CartController::class, 'index']);
            Route::post('/cart/items', [CartController::class, 'addItem']);
            Route::patch('/cart/items/{cartItem}', [CartController::class, 'updateItem']);
            Route::delete('/cart/items/{cartItem}', [CartController::class, 'removeItem']);
            Route::post('/checkout', [CheckoutController::class, 'store']);
            Route::post('/checkout/quote', [CheckoutController::class, 'quote']);
            Route::get('/orders', [OrderController::class, 'index']);
            Route::get('/orders/{order}', [OrderController::class, 'show']);
            Route::post('/orders/{order}/request-update', [OrderController::class, 'requestUpdate'])->middleware('throttle:3,1');
            Route::post('/orders/{order}/delivery-code', [DeliveryTrackingController::class, 'issueCode'])->middleware('throttle:10,1');
            Route::patch('/orders/{order}/status', [OrderController::class, 'updateStatus']);
            Route::get('/notifications', [NotificationController::class, 'index']);
            Route::post('/notifications/read', [NotificationController::class, 'markAllAsRead']);

            Route::post('/deliveries/assign', [DeliveryController::class, 'assign']);
            Route::post('/deliveries/{delivery}/location', [DeliveryTrackingController::class, 'updateLocation'])->middleware(EnsureApprovedRider::class);
            Route::get('/deliveries/{delivery}/tracking', [DeliveryTrackingController::class, 'tracking']);
            Route::get('/deliveries/{delivery}/proof', [DeliveryTrackingController::class, 'proof'])->middleware('throttle:30,1')->name('deliveries.proof');
            Route::post('/deliveries/{delivery}/pickup-verify', [DeliveryTrackingController::class, 'verifyPickup'])->middleware(EnsureApprovedRider::class);
            Route::post('/deliveries/{delivery}/delivery-verify', [DeliveryTrackingController::class, 'verifyDropoff'])->middleware(['throttle:10,1', EnsureApprovedRider::class]);
            Route::post('/deliveries/{delivery}/proof', [DeliveryTrackingController::class, 'recordProof'])->middleware(['throttle:10,1', EnsureApprovedRider::class]);
            Route::post('/admin/deliveries/{delivery}/proof-correction', [DeliveryTrackingController::class, 'correctProof'])->middleware('throttle:5,1');
            Route::post('/riders/location', [RiderController::class, 'updateLocation'])->middleware(EnsureApprovedRider::class);
            Route::get('/riders/settings', [RiderController::class, 'preferences'])->middleware(EnsureApprovedRider::class);
            Route::put('/riders/settings', [RiderController::class, 'updatePreferences'])->middleware(EnsureApprovedRider::class);
            Route::get('/riders/deliveries', [RiderController::class, 'deliveries'])->middleware(EnsureApprovedRider::class);
            Route::get('/riders/offers', [RiderController::class, 'offers'])->middleware(EnsureApprovedRider::class);
            Route::post('/riders/offers/{offer}/accept', [RiderController::class, 'acceptOffer'])->middleware(['throttle:10,1', EnsureApprovedRider::class]);
            Route::post('/riders/offers/{offer}/decline', [RiderController::class, 'declineOffer'])->middleware(['throttle:10,1', EnsureApprovedRider::class]);

            Route::get('/dashboard/seller', SellerDashboardController::class);
            Route::get('/dashboard/buyer', BuyerDashboardController::class);
            Route::get('/dashboard/rider', RiderDashboardController::class)->middleware(EnsureApprovedRider::class);
            Route::get('/dashboard/admin', AdminDashboardController::class);
            Route::get('/analytics', [AnalyticsController::class, 'index']);
            Route::get('/buyer/reviews', [BuyerReviewController::class, 'index']);
            Route::post('/buyer/reviews/{review}/reports', [BuyerReviewController::class, 'report'])->middleware('throttle:10,1');
            Route::get('/buyer/reviews/{review}/media/{media}', [BuyerReviewController::class, 'privateMedia'])->name('buyer.review-media');
            Route::get('/buyer/addresses', [BuyerAddressController::class, 'index']);
            Route::post('/buyer/addresses', [BuyerAddressController::class, 'store']);
            Route::put('/buyer/addresses/{address}', [BuyerAddressController::class, 'update']);
            Route::delete('/buyer/addresses/{address}', [BuyerAddressController::class, 'destroy']);
            Route::post('/orders/{order}/review', [BuyerReviewController::class, 'store']);
            Route::get('/buyer/complaints', [BuyerComplaintController::class, 'index']);
            Route::post('/orders/{order}/complaint', [BuyerComplaintController::class, 'store']);
            Route::post('/orders/{order}/return-refund', [BuyerComplaintController::class, 'storeReturnRequest']);
            Route::post('/cases/{complaint}/messages', [BuyerComplaintController::class, 'sendMessage']);
            Route::get('/cases/media/{media}', [BuyerComplaintController::class, 'media'])->name('case-media.show');
            Route::get('/seller/reviews', [SellerReviewController::class, 'index']);
            Route::get('/seller/complaints', [SellerComplaintController::class, 'index']);
            Route::get('/admin/reviews/reports', [ReviewModerationController::class, 'index']);
            Route::patch('/admin/reviews/{review}/moderation', [ReviewModerationController::class, 'moderate']);
            Route::get('/admin/complaints', [AdminComplaintController::class, 'index']);
            Route::patch('/admin/complaints/{complaint}', [AdminComplaintController::class, 'update']);
            Route::post('/admin/complaints/{complaint}/refund-approval', [AdminComplaintController::class, 'approveRefund']);
            Route::post('/admin/complaints/{complaint}/return-received', [AdminComplaintController::class, 'markReturnReceived']);
            Route::post('/admin/complaints/{complaint}/manual-payout', [AdminComplaintController::class, 'recordManualPayout']);
            Route::post('/admin/complaints/{complaint}/refund-sync', [AdminComplaintController::class, 'syncRefund']);
            Route::get('/cases/{complaint}/payout-evidence', [AdminComplaintController::class, 'payoutEvidence'])->name('case-payout-evidence.show');
            Route::get('/reports/{type}', [ReportController::class, 'index'])
                ->whereIn('type', ['sales', 'transactions', 'listings', 'users', 'sellers', 'buyers', 'riders', 'categories', 'deliveries', 'complaints']);
            Route::get('/chat/recipients', [ChatController::class, 'recipients'])->middleware('throttle:chat-search');
            Route::post('/chat/direct-conversations', [ChatController::class, 'startDirect'])->middleware('throttle:chat');
            Route::get('/chat/conversations', [ChatController::class, 'index']);
            Route::post('/chat/conversations/{conversation}/messages', [ChatController::class, 'sendDirect'])
                ->whereNumber('conversation')
                ->middleware('throttle:chat');
            Route::get('/chat/conversations/{conversation}', [ChatController::class, 'show'])->whereNumber('conversation');
            Route::delete('/chat/conversations/{conversation}', [ChatController::class, 'destroy'])->whereNumber('conversation');
            Route::patch('/chat/conversations/{conversation}/report-context', [ChatController::class, 'clearReportContext'])->whereNumber('conversation');
            Route::post('/chat/messages', [ChatController::class, 'send'])->middleware('throttle:chat');
        });
    });
});

Route::middleware(MaintenanceMode::class)->get('/user', function (Request $request) {
    return $request->user();
})->middleware('auth:sanctum');
