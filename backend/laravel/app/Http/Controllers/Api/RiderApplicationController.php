<?php

namespace App\Http\Controllers\Api;

use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\RiderApplication;
use App\Models\RiderApplicationHistory;
use App\Models\RiderDocument;
use App\Models\RiderProfile;
use App\Models\RiderVehicleChange;
use App\Models\User;
use App\Notifications\RiderApplicationStatusNotification;
use App\Services\SystemSettingsService;
use App\Support\PhilippinePhoneNumber;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\Response;

class RiderApplicationController extends Controller
{
    private const DOCUMENT_TYPES = [
        'DRIVER_LICENSE',
        'VEHICLE_REGISTRATION',
        'SELFIE',
        'VEHICLE_PHOTO',
    ];

    public function policy(SystemSettingsService $settings): JsonResponse
    {
        $policy = config('rider-registration');

        return response()->json([
            'policy_version' => $policy['policy_version'],
            'effective_date' => $policy['effective_date'],
            'privacy_contact' => $policy['privacy_contact'],
            'documents' => [
                'privacy' => $policy['privacy_policy_url'],
                'terms' => $policy['terms_url'],
                'safety' => $policy['safety_policy_url'],
                'draft_package' => route('rider-registration.policy-document'),
            ],
            'selfie_collection_enabled' => $policy['selfie_collection_enabled'],
            'registration_open' => $this->registrationIsOpen($settings),
            'status_message' => $this->registrationIsOpen($settings)
                ? null
                : 'Rider registration is unavailable until Farmgate publishes and adopts the rider privacy, terms, safety, and retention documents.',
        ]);
    }

    public function policyDocument(): Response|BinaryFileResponse
    {
        $path = config('rider-registration.policy_package_path') ?: base_path('../../../PRIVACY_POLICY.md');
        abort_unless(is_file($path), 404, 'The rider policy package has not been published.');

        return response()->file($path, [
            'Content-Type' => 'text/markdown; charset=UTF-8',
            'Cache-Control' => 'public, max-age=300',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    public function register(Request $request, SystemSettingsService $settings): JsonResponse
    {
        abort_unless($request->user() === null, 403, 'Sign out before creating a rider account.');
        abort_unless($this->registrationIsOpen($settings), 403, 'Rider registration is unavailable until the rider policy package is adopted and published.');
        $data = $request->validate([
            'name' => ['required', 'string', 'min:2', 'max:120'],
            'date_of_birth' => ['required', 'date', 'before_or_equal:today'],
            'residential_address' => ['required', 'string', 'min:8', 'max:1000'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'phone_number' => ['required', 'string', 'max:30'],
            'password' => ['required', 'string', 'min:'.$settings->getInt('minimum_password_length'), 'confirmed'],
            'policy_version' => ['required', 'string', Rule::in([(string) config('rider-registration.policy_version')])],
            'privacy_consent' => ['required', 'accepted'],
            'terms_consent' => ['required', 'accepted'],
            'safety_consent' => ['required', 'accepted'],
        ]);
        $phone = PhilippinePhoneNumber::normalize($data['phone_number']);
        if (! $phone) {
            throw ValidationException::withMessages([
                'phone_number' => 'Enter a valid Philippine mobile number (09XXXXXXXXX or +639XXXXXXXXX).',
            ]);
        }
        Validator::make(['phone_number' => $phone], [
            'phone_number' => ['unique:users,phone_number'],
        ])->validate();

        $policyVersion = (string) config('rider-registration.policy_version');
        $user = DB::transaction(function () use ($data, $phone, $policyVersion): User {
            $user = User::create([
                'name' => trim($data['name']),
                'email' => strtolower(trim($data['email'])),
                'password' => $data['password'],
                'phone_number' => $phone,
                'role' => Role::RIDER,
            ]);
            RiderProfile::create(['user_id' => $user->id, 'phone' => $phone, 'availability' => 'OFFLINE']);
            $application = RiderApplication::create([
                'user_id' => $user->id,
                'date_of_birth' => $data['date_of_birth'],
                'residential_address' => trim($data['residential_address']),
                'status' => 'DRAFT',
                'privacy_policy_version' => $policyVersion,
                'privacy_accepted_at' => now(),
                'terms_version' => $policyVersion,
                'terms_accepted_at' => now(),
                'safety_policy_version' => $policyVersion,
                'safety_policy_accepted_at' => now(),
            ]);
            RiderApplicationHistory::create([
                'rider_application_id' => $application->id,
                'actor_id' => $user->id,
                'to_status' => 'DRAFT',
                'action' => 'APPLICATION_CREATED',
                'reason' => 'Applicant accepted the published rider policy package.',
            ]);

            return $user;
        });

        Auth::login($user);
        $request->session()->regenerate();
        $user->sendEmailVerificationNotification();

        return response()->json([
            'message' => 'Your rider application draft has been created. Add your vehicle details and required documents to submit it.',
            'application' => $this->applicantPayload($user->riderApplication()->with('documents')->firstOrFail()),
            'user' => app(AuthController::class)->userPayload($user),
        ], 201);
    }

    public function show(Request $request): JsonResponse
    {
        abort_unless($request->user()?->role === Role::RIDER, 403);
        $application = RiderApplication::query()
            ->where('user_id', $request->user()->id)
            ->with(['documents', 'history.actor:id,name', 'vehicleChanges.documents'])
            ->first();

        return response()->json(['application' => $application ? $this->applicantPayload($application) : null]);
    }

    public function submit(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless($user?->role === Role::RIDER, 403);
        abort_unless($this->riderPolicyIsAdopted(), 403, 'Rider document collection is unavailable until the rider policy package is adopted and published.');
        $application = RiderApplication::query()->where('user_id', $user->id)->firstOrFail();
        abort_unless(in_array($application->status, ['DRAFT', 'MORE_INFORMATION_REQUIRED'], true), 409, 'This application cannot be edited in its current status.');
        $existingDocumentTypes = $application->documents()->pluck('document_type')->all();

        $data = $request->validate([
            'name' => ['required', 'string', 'min:2', 'max:120'],
            'date_of_birth' => ['required', 'date', 'before_or_equal:today'],
            'residential_address' => ['required', 'string', 'min:8', 'max:1000'],
            'license_number' => ['required', 'string', 'min:4', 'max:80'],
            'plate_number' => ['required', 'string', 'min:2', 'max:16', 'regex:/^[A-Za-z0-9][A-Za-z0-9 -]{1,15}$/'],
            'vehicle_type' => ['required', 'string', 'max:80'],
            'vehicle_make_model' => ['required', 'string', 'max:120'],
            'vehicle_color' => ['required', 'string', 'max:60'],
            'license_expires_on' => ['required', 'date', 'after:today'],
            'vehicle_registration_expires_on' => ['required', 'date', 'after:today'],
            'driver_license' => [Rule::requiredIf(! in_array('DRIVER_LICENSE', $existingDocumentTypes, true)), 'file', 'mimes:jpg,jpeg,png,webp,pdf', 'max:10240'],
            'vehicle_registration' => [Rule::requiredIf(! in_array('VEHICLE_REGISTRATION', $existingDocumentTypes, true)), 'file', 'mimes:jpg,jpeg,png,webp,pdf', 'max:10240'],
            'selfie' => [Rule::requiredIf(! in_array('SELFIE', $existingDocumentTypes, true)), 'image', 'mimes:jpg,jpeg,png,webp', 'max:10240'],
            'vehicle_photos' => [Rule::requiredIf(! in_array('VEHICLE_PHOTO', $existingDocumentTypes, true)), 'array', 'min:1', 'max:5'],
            'vehicle_photos.*' => ['image', 'mimes:jpg,jpeg,png,webp', 'max:10240'],
        ]);
        $plate = mb_strtoupper(trim(preg_replace('/\s+/', ' ', $data['plate_number'])));
        Validator::make(['plate_number' => $plate], [
            'plate_number' => [Rule::unique('rider_profiles', 'plate_number')],
        ])->validate();
        $licenseNumber = mb_strtoupper(preg_replace('/\s+/', '', trim($data['license_number'])));
        $licenseHash = hash_hmac('sha256', $licenseNumber, (string) config('app.key'));
        Validator::make(['license_number_hash' => $licenseHash], [
            'license_number_hash' => [Rule::unique('rider_applications', 'license_number_hash')->ignore($application->id)],
        ])->validate();
        $this->assertNoPendingPlateCollision($plate, $user->id);
        $qualityGroups = [];
        foreach (['driver_license', 'vehicle_registration'] as $field) {
            $file = $request->file($field);
            if ($file && str_starts_with((string) $file->getMimeType(), 'image/')) {
                $qualityGroups[$field] = [$file];
            }
        }
        if ($request->hasFile('selfie')) {
            $qualityGroups['selfie'] = [$request->file('selfie')];
        }
        if ($request->hasFile('vehicle_photos')) {
            $qualityGroups['vehicle_photos'] = $request->file('vehicle_photos');
        }
        $this->assertImageQuality($qualityGroups);

        $requiredFiles = [
            'DRIVER_LICENSE' => $request->file('driver_license') ? [$request->file('driver_license')] : [],
            'VEHICLE_REGISTRATION' => $request->file('vehicle_registration') ? [$request->file('vehicle_registration')] : [],
            'SELFIE' => $request->file('selfie') ? [$request->file('selfie')] : [],
            'VEHICLE_PHOTO' => $request->file('vehicle_photos') ?? [],
        ];
        $paths = [];
        $pathsToRemove = [];
        try {
            DB::transaction(function () use ($application, $user, $data, $plate, $licenseNumber, $licenseHash, $requiredFiles, &$paths, &$pathsToRemove): void {
                foreach ($requiredFiles as $type => $files) {
                    if ($files === []) {
                        continue;
                    }
                    $oldDocuments = $application->documents()->where('document_type', $type)->get();
                    foreach ($oldDocuments as $oldDocument) {
                        $pathsToRemove[] = $oldDocument->path;
                        $oldDocument->forceFill(['deleted_at' => now(), 'deleted_by' => $user->id])->save();
                    }
                    foreach ($files as $file) {
                        $paths[] = $this->storeEncryptedDocument($application, null, $user->id, $type, $file);
                    }
                    RiderApplicationHistory::create([
                        'rider_application_id' => $application->id,
                        'actor_id' => $user->id,
                        'from_status' => $application->status,
                        'to_status' => $application->status,
                        'action' => $oldDocuments->isEmpty() ? 'DOCUMENT_ADDED' : 'DOCUMENT_REPLACED',
                        'reason' => 'Applicant '.($oldDocuments->isEmpty() ? 'added' : 'replaced').' '.$type.' document.',
                    ]);
                }
                $from = $application->status;
                $application->forceFill([
                    'date_of_birth' => $data['date_of_birth'],
                    'residential_address' => trim($data['residential_address']),
                    'license_number' => $licenseNumber,
                    'license_number_hash' => $licenseHash,
                    'plate_number' => $plate,
                    'vehicle_type' => trim($data['vehicle_type']),
                    'vehicle_make_model' => trim($data['vehicle_make_model']),
                    'vehicle_color' => trim($data['vehicle_color']),
                    'license_expires_on' => $data['license_expires_on'],
                    'vehicle_registration_expires_on' => $data['vehicle_registration_expires_on'],
                    'status' => 'SUBMITTED',
                    'submitted_at' => now(),
                    'decision_reason' => null,
                ])->save();
                $user->forceFill(['name' => trim($data['name'])])->save();
                RiderApplicationHistory::create([
                    'rider_application_id' => $application->id,
                    'actor_id' => $user->id,
                    'from_status' => $from,
                    'to_status' => 'SUBMITTED',
                    'action' => 'APPLICATION_SUBMITTED',
                    'reason' => 'Applicant submitted required vehicle details and documents.',
                ]);
            });
        } catch (\Throwable $exception) {
            $this->deleteStoredPaths($paths);
            throw $exception;
        }
        $this->deleteStoredPaths($pathsToRemove);

        $application->user->notify(new RiderApplicationStatusNotification($application->id, 'SUBMITTED', null));
        User::query()->where('role', Role::ADMIN)->each(
            fn (User $admin) => $admin->notify(new RiderApplicationStatusNotification($application->id, 'SUBMITTED', null)),
        );

        return response()->json(['application' => $this->applicantPayload($application->fresh(['documents', 'history.actor:id,name']))]);
    }

    public function vehicleChange(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless($user?->role === Role::RIDER && $user->riderProfile()->where('is_verified', true)->exists(), 403, 'An approved rider account is required to request vehicle changes.');
        abort_unless($this->riderPolicyIsAdopted(), 403, 'Rider document collection is unavailable until the rider policy package is adopted and published.');
        $data = $request->validate([
            'plate_number' => ['required', 'string', 'min:2', 'max:16', 'regex:/^[A-Za-z0-9][A-Za-z0-9 -]{1,15}$/'],
            'vehicle_type' => ['required', 'string', 'max:80'],
            'vehicle_make_model' => ['required', 'string', 'max:120'],
            'vehicle_color' => ['required', 'string', 'max:60'],
            'license_expires_on' => ['required', 'date', 'after:today'],
            'vehicle_registration_expires_on' => ['required', 'date', 'after:today'],
            'vehicle_registration' => ['required', 'file', 'mimes:jpg,jpeg,png,webp,pdf', 'max:10240'],
            'driver_license' => ['required', 'file', 'mimes:jpg,jpeg,png,webp,pdf', 'max:10240'],
            'vehicle_photos' => ['required', 'array', 'min:1', 'max:5'],
            'vehicle_photos.*' => ['image', 'mimes:jpg,jpeg,png,webp', 'max:10240'],
        ]);
        $plate = mb_strtoupper(trim(preg_replace('/\s+/', ' ', $data['plate_number'])));
        $this->assertNoPendingPlateCollision($plate, $user->id);
        Validator::make(['plate_number' => $plate], [
            'plate_number' => [Rule::unique('rider_profiles', 'plate_number')->ignore($user->riderProfile->id)],
        ])->validate();
        $qualityGroups = ['vehicle_photos' => $request->file('vehicle_photos')];
        if (str_starts_with((string) $request->file('driver_license')->getMimeType(), 'image/')) {
            $qualityGroups['driver_license'] = [$request->file('driver_license')];
        }
        if (str_starts_with((string) $request->file('vehicle_registration')->getMimeType(), 'image/')) {
            $qualityGroups['vehicle_registration'] = [$request->file('vehicle_registration')];
        }
        $this->assertImageQuality($qualityGroups);
        abort_if(RiderVehicleChange::query()->where('user_id', $user->id)->where('status', 'PENDING')->exists(), 409, 'A vehicle update is already pending admin review.');

        $paths = [];
        try {
            $change = DB::transaction(function () use ($request, $user, $data, $plate, &$paths): RiderVehicleChange {
                $change = RiderVehicleChange::create([
                    'user_id' => $user->id,
                    'plate_number' => $plate,
                    'vehicle_type' => trim($data['vehicle_type']),
                    'vehicle_make_model' => trim($data['vehicle_make_model']),
                    'vehicle_color' => trim($data['vehicle_color']),
                    'license_expires_on' => $data['license_expires_on'],
                    'vehicle_registration_expires_on' => $data['vehicle_registration_expires_on'],
                    'status' => 'PENDING',
                ]);
                $paths[] = $this->storeEncryptedDocument(null, $change, $user->id, 'VEHICLE_REGISTRATION', $request->file('vehicle_registration'));
                $paths[] = $this->storeEncryptedDocument(null, $change, $user->id, 'DRIVER_LICENSE', $request->file('driver_license'));
                foreach ($request->file('vehicle_photos') as $file) {
                    $paths[] = $this->storeEncryptedDocument(null, $change, $user->id, 'VEHICLE_PHOTO', $file);
                }

                return $change;
            });
        } catch (\Throwable $exception) {
            $this->deleteStoredPaths($paths);
            throw $exception;
        }
        $user->notify(new RiderApplicationStatusNotification($change->id, 'VEHICLE_SUBMITTED', null));
        User::query()->where('role', Role::ADMIN)->each(
            fn (User $admin) => $admin->notify(new RiderApplicationStatusNotification($change->id, 'VEHICLE_SUBMITTED', null)),
        );

        return response()->json(['vehicle_change' => $change->load('documents')], 201);
    }

    public function document(Request $request, RiderDocument $document): Response
    {
        $user = $request->user();
        abort_unless($user, 401);
        $applicationOwnerId = $document->application?->user_id ?? $document->vehicleChange?->user_id;
        abort_unless($user->role === Role::ADMIN || $applicationOwnerId === $user->id, 403);
        abort_unless($document->deleted_at === null, 404);
        $disk = Storage::disk('rider_private');
        abort_unless($disk->exists($document->path), 404, 'The requested rider document could not be found.');
        try {
            $contents = Crypt::decryptString($disk->get($document->path));
        } catch (\Throwable $exception) {
            report($exception);
            abort(500, 'The requested rider document could not be decrypted.');
        }

        return response($contents, 200, [
            'Content-Type' => $document->mime_type,
            'Content-Disposition' => 'inline; filename="'.str_replace(['"', "\r", "\n"], '', $document->original_name).'"',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    public function deleteDocument(Request $request, RiderDocument $document): JsonResponse
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
        abort_unless($document->deleted_at === null, 404);
        $application = $document->application;
        $vehicleChange = $document->vehicleChange;
        abort_unless($application || $vehicleChange, 422, 'The rider document is not attached to an application or vehicle update.');
        $disk = Storage::disk('rider_private');
        abort_unless(! $disk->exists($document->path) || $disk->delete($document->path), 500, 'The protected document could not be deleted. No deletion record was saved.');
        $document->forceFill(['deleted_at' => now(), 'deleted_by' => $request->user()->id])->save();
        if ($application) {
            RiderApplicationHistory::create([
                'rider_application_id' => $application->id,
                'actor_id' => $request->user()->id,
                'from_status' => $application->status,
                'to_status' => $application->status,
                'action' => 'DOCUMENT_DELETED',
                'reason' => 'Admin deleted rider document #'.$document->id.' ('.$document->document_type.').',
            ]);
        }
        AuditLog::create([
            'user_id' => $request->user()->id,
            'action' => 'rider.document.deleted',
            'method' => $request->method(),
            'route' => $request->path(),
            'status_code' => 200,
            'metadata' => ['application_id' => $application?->id, 'vehicle_change_id' => $vehicleChange?->id, 'document_id' => $document->id, 'document_type' => $document->document_type],
        ]);

        return response()->json(['message' => 'Rider document securely deleted.']);
    }

    public function adminIndex(Request $request): JsonResponse
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
        $filters = $request->validate([
            'status' => ['nullable', Rule::in(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'MORE_INFORMATION_REQUIRED', 'APPROVED', 'REJECTED'])],
            'search' => ['nullable', 'string', 'max:120'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);
        $query = RiderApplication::query()->with(['user:id,name,email,phone_number', 'documents', 'history.actor:id,name']);
        if (isset($filters['status'])) {
            $query->where('status', $filters['status']);
        }
        if (isset($filters['search'])) {
            $term = '%'.trim($filters['search']).'%';
            $query->whereHas('user', fn (Builder $users) => $users->where('name', 'like', $term)->orWhere('email', 'like', $term));
        }
        $applications = $query->latest()->paginate(15)->withQueryString();
        $applications->getCollection()->transform(fn (RiderApplication $application): array => $this->adminPayload($application));

        return response()->json(['applications' => $applications]);
    }

    public function adminDecision(Request $request, RiderApplication $application): JsonResponse
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
        $data = $request->validate([
            'status' => ['required', Rule::in(['UNDER_REVIEW', 'MORE_INFORMATION_REQUIRED', 'APPROVED', 'REJECTED'])],
            'reason' => ['nullable', 'string', 'max:2000', 'required_if:status,MORE_INFORMATION_REQUIRED,REJECTED'],
        ]);
        abort_if(in_array($application->status, ['APPROVED', 'REJECTED'], true), 409, 'This rider application has already been decided.');
        abort_if($data['status'] === 'APPROVED' && $application->status === 'DRAFT', 409, 'Submit the application before approval.');
        if ($data['status'] === 'APPROVED') {
            $this->assertCompleteApplication($application);
            $this->assertNoPendingPlateCollision($application->plate_number, $application->user_id);
        }
        $updated = DB::transaction(function () use ($request, $application, $data): RiderApplication {
            $locked = RiderApplication::query()->lockForUpdate()->findOrFail($application->id);
            abort_if(in_array($locked->status, ['APPROVED', 'REJECTED'], true), 409, 'This rider application has already been decided.');
            $from = $locked->status;
            $locked->forceFill([
                'status' => $data['status'],
                'reviewer_id' => $request->user()->id,
                'reviewed_at' => in_array($data['status'], ['APPROVED', 'REJECTED'], true) ? now() : $locked->reviewed_at,
                'decision_reason' => $data['reason'] ?? null,
            ])->save();
            if ($data['status'] === 'APPROVED') {
                RiderProfile::query()->where('user_id', $locked->user_id)->update([
                    'plate_number' => $locked->plate_number,
                    'vehicle_type' => $locked->vehicle_type,
                    'vehicle_make_model' => $locked->vehicle_make_model,
                    'vehicle_color' => $locked->vehicle_color,
                    'license_expires_on' => $locked->license_expires_on,
                    'vehicle_registration_expires_on' => $locked->vehicle_registration_expires_on,
                    'is_verified' => true,
                ]);
            } elseif ($data['status'] === 'REJECTED') {
                RiderProfile::query()->where('user_id', $locked->user_id)->update([
                    'is_verified' => false,
                    'availability' => 'OFFLINE',
                ]);
            }
            RiderApplicationHistory::create([
                'rider_application_id' => $locked->id,
                'actor_id' => $request->user()->id,
                'from_status' => $from,
                'to_status' => $data['status'],
                'action' => 'ADMIN_DECISION',
                'reason' => $data['reason'] ?? null,
            ]);

            return $locked->fresh(['user', 'documents', 'history.actor:id,name']);
        });
        $updated->user->notify(new RiderApplicationStatusNotification($updated->id, $updated->status, $updated->decision_reason));

        return response()->json(['application' => $this->adminPayload($updated)]);
    }

    public function adminVehicleChanges(Request $request): JsonResponse
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
        $changes = RiderVehicleChange::query()
            ->with(['user:id,name,email,phone_number', 'documents'])
            ->where('status', 'PENDING')
            ->latest()
            ->paginate(15);
        $changes->getCollection()->transform(fn (RiderVehicleChange $change): array => $this->vehicleChangePayload($change));

        return response()->json(['vehicle_changes' => $changes]);
    }

    public function adminVehicleDecision(Request $request, RiderVehicleChange $change): JsonResponse
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
        $data = $request->validate([
            'status' => ['required', Rule::in(['APPROVED', 'REJECTED', 'MORE_INFORMATION_REQUIRED'])],
            'reason' => ['nullable', 'string', 'max:2000', 'required_if:status,REJECTED,MORE_INFORMATION_REQUIRED'],
        ]);
        abort_unless($change->status === 'PENDING', 409, 'This vehicle change is no longer pending review.');
        if ($data['status'] === 'APPROVED') {
            $this->assertNoPendingPlateCollision($change->plate_number, $change->user_id);
            abort_unless($change->documents->contains('document_type', 'VEHICLE_REGISTRATION')
                && $change->documents->contains('document_type', 'DRIVER_LICENSE')
                && $change->documents->contains('document_type', 'VEHICLE_PHOTO'), 422, 'Current license, registration, and vehicle photos are required.');
        }

        DB::transaction(function () use ($request, $change, $data): void {
            $locked = RiderVehicleChange::query()->lockForUpdate()->findOrFail($change->id);
            abort_unless($locked->status === 'PENDING', 409, 'This vehicle change is no longer pending review.');
            $locked->forceFill([
                'status' => $data['status'],
                'reviewer_id' => $request->user()->id,
                'reviewed_at' => now(),
                'decision_reason' => $data['reason'] ?? null,
            ])->save();
            if ($data['status'] === 'APPROVED') {
                RiderProfile::query()->where('user_id', $locked->user_id)->update([
                    'plate_number' => $locked->plate_number,
                    'vehicle_type' => $locked->vehicle_type,
                    'vehicle_make_model' => $locked->vehicle_make_model,
                    'vehicle_color' => $locked->vehicle_color,
                    'license_expires_on' => $locked->license_expires_on,
                    'vehicle_registration_expires_on' => $locked->vehicle_registration_expires_on,
                ]);
            }
        });
        $change->user->notify(new RiderApplicationStatusNotification($change->id, 'VEHICLE_'.$data['status'], $data['reason'] ?? null));

        return response()->json(['vehicle_change' => $this->vehicleChangePayload($change->fresh(['user', 'documents']))]);
    }

    private function registrationIsOpen(SystemSettingsService $settings): bool
    {
        return $settings->getBoolean('account_registration_enabled')
            && $settings->getBoolean('rider_registration_enabled')
            && $this->riderPolicyIsAdopted();
    }

    private function riderPolicyIsAdopted(): bool
    {
        $policy = config('rider-registration');

        return filled($policy['policy_version'])
            && filled($policy['effective_date'])
            && filled($policy['privacy_contact'])
            && filled($policy['privacy_policy_url'])
            && filled($policy['terms_url'])
            && filled($policy['safety_policy_url'])
            && $policy['retention_policy_approved']
            && $policy['selfie_collection_enabled'];
    }

    private function applicantPayload(RiderApplication $application): array
    {
        return [
            'id' => $application->id,
            'status' => $application->status,
            'name' => $application->user->name,
            'email' => $application->user->email,
            'phone_number' => $application->user->phone_number,
            'date_of_birth' => $application->date_of_birth,
            'residential_address' => $application->residential_address,
            'license_number' => $application->license_number,
            'plate_number' => $application->plate_number,
            'vehicle_type' => $application->vehicle_type,
            'vehicle_make_model' => $application->vehicle_make_model,
            'vehicle_color' => $application->vehicle_color,
            'license_expires_on' => $application->license_expires_on?->toDateString(),
            'vehicle_registration_expires_on' => $application->vehicle_registration_expires_on?->toDateString(),
            'decision_reason' => $application->decision_reason,
            'submitted_at' => $application->submitted_at?->toISOString(),
            'privacy_policy_version' => $application->privacy_policy_version,
            'privacy_accepted_at' => $application->privacy_accepted_at?->toISOString(),
            'documents' => $application->documents->map(fn (RiderDocument $document): array => $this->documentPayload($document))->values(),
            'history' => $application->history->map(fn (RiderApplicationHistory $entry): array => [
                'id' => $entry->id,
                'from_status' => $entry->from_status,
                'to_status' => $entry->to_status,
                'action' => $entry->action,
                'reason' => $entry->reason,
                'actor' => $entry->actor?->name,
                'created_at' => $entry->created_at?->toISOString(),
            ])->values(),
            'vehicle_changes' => $application->vehicleChanges->map(fn (RiderVehicleChange $change): array => $this->vehicleChangePayload($change))->values(),
        ];
    }

    private function adminPayload(RiderApplication $application): array
    {
        $payload = $this->applicantPayload($application);
        $payload['user'] = [
            'id' => $application->user->id,
            'name' => $application->user->name,
            'email' => $application->user->email,
            'phone_number' => $application->user->phone_number,
        ];

        return $payload;
    }

    private function documentPayload(RiderDocument $document): array
    {
        return [
            'id' => $document->id,
            'document_type' => $document->document_type,
            'original_name' => $document->original_name,
            'mime_type' => $document->mime_type,
            'size' => $document->size,
            'view_url' => URL::temporarySignedRoute(
                'rider-documents.show',
                now()->addMinutes(5),
                ['document' => $document->id],
            ),
        ];
    }

    private function vehicleChangePayload(RiderVehicleChange $change): array
    {
        return [
            'id' => $change->id,
            'user' => $change->user ? [
                'id' => $change->user->id,
                'name' => $change->user->name,
                'email' => $change->user->email,
                'phone_number' => $change->user->phone_number,
            ] : null,
            'plate_number' => $change->plate_number,
            'vehicle_type' => $change->vehicle_type,
            'vehicle_make_model' => $change->vehicle_make_model,
            'vehicle_color' => $change->vehicle_color,
            'license_expires_on' => $change->license_expires_on?->toDateString(),
            'vehicle_registration_expires_on' => $change->vehicle_registration_expires_on?->toDateString(),
            'status' => $change->status,
            'decision_reason' => $change->decision_reason,
            'documents' => $change->documents->map(fn (RiderDocument $document): array => $this->documentPayload($document))->values(),
            'created_at' => $change->created_at?->toISOString(),
        ];
    }

    private function assertCompleteApplication(RiderApplication $application): void
    {
        abort_unless($application->status !== 'DRAFT', 409, 'Submit the application before approval.');
        abort_unless($application->license_expires_on?->isFuture()
            && $application->vehicle_registration_expires_on?->isFuture(), 422, 'A current driver license and vehicle registration are required for approval.');
        $types = $application->documents()->pluck('document_type');
        foreach (self::DOCUMENT_TYPES as $type) {
            abort_unless($types->contains($type), 422, 'The application is missing required document type: '.$type.'.');
        }
    }

    private function assertNoPendingPlateCollision(string $plate, int $userId): void
    {
        $profileCollision = RiderProfile::query()
            ->where('user_id', '!=', $userId)
            ->whereRaw('UPPER(plate_number) = ?', [$plate])
            ->exists();
        $pendingCollision = RiderVehicleChange::query()
            ->where('user_id', '!=', $userId)
            ->where('status', 'PENDING')
            ->whereRaw('UPPER(plate_number) = ?', [$plate])
            ->exists();
        $applicationCollision = RiderApplication::query()
            ->where('user_id', '!=', $userId)
            ->whereIn('status', ['SUBMITTED', 'UNDER_REVIEW', 'MORE_INFORMATION_REQUIRED'])
            ->whereRaw('UPPER(plate_number) = ?', [$plate])
            ->exists();
        abort_if($profileCollision || $pendingCollision || $applicationCollision, 422, 'This plate number is already registered to another rider or awaiting review.');
    }

    private function storeEncryptedDocument(
        ?RiderApplication $application,
        ?RiderVehicleChange $change,
        int $userId,
        string $type,
        UploadedFile $file,
    ): string {
        $contents = file_get_contents($file->getRealPath());
        if (! is_string($contents)) {
            throw new \RuntimeException('The uploaded rider document could not be read.');
        }
        $path = 'rider/'.Str::uuid().'.enc';
        if (! Storage::disk('rider_private')->put($path, Crypt::encryptString($contents))) {
            $disk = Storage::disk('rider_private');
            if ($disk->exists($path) && ! $disk->delete($path)) {
                report(new \RuntimeException('A partially written rider document remains in private storage.'));
            }
            throw new \RuntimeException('The encrypted rider document could not be stored.');
        }
        RiderDocument::create([
            'rider_application_id' => $application?->id,
            'rider_vehicle_change_id' => $change?->id,
            'uploaded_by' => $userId,
            'document_type' => $type,
            'path' => $path,
            'mime_type' => $file->getMimeType() ?: 'application/octet-stream',
            'original_name' => mb_substr($file->getClientOriginalName(), 0, 255),
            'size' => $file->getSize(),
        ]);

        return $path;
    }

    private function deleteStoredPaths(array $paths): void
    {
        foreach ($paths as $path) {
            $disk = Storage::disk('rider_private');
            if (! $disk->delete($path) && $disk->exists($path)) {
                report(new \RuntimeException('A replaced or failed rider document remains in private storage.'));
            }
        }
    }

    private function assertImageQuality(array $groups): void
    {
        foreach ($groups as $field => $files) {
            foreach ($files as $index => $file) {
                $dimensions = @getimagesize($file->getRealPath());
                if (! $dimensions || min($dimensions[0], $dimensions[1]) < 360) {
                    throw ValidationException::withMessages([
                        "{$field}.{$index}" => 'Use a clear image with at least 360 pixels on its shortest side.',
                    ]);
                }
            }
        }
    }
}
