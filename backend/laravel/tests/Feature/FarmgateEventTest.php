<?php

namespace Tests\Feature;

use App\Enums\ListingStatus;
use App\Enums\PricingType;
use App\Enums\Role;
use App\Models\Category;
use App\Models\FarmgateEvent;
use App\Models\LivestockListing;
use App\Models\SellerPromotion;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class FarmgateEventTest extends TestCase
{
    use RefreshDatabase;

    public function test_event_image_urls_are_returned_for_public_calendar_and_admin_details(): void
    {
        Storage::fake('public');
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $imagePath = 'calendar-events/event-image.jpg';
        Storage::disk('public')->put($imagePath, 'image');
        $event = FarmgateEvent::create([
            'organizer_id' => $admin->id,
            'category' => 'FARMGATE_EVENT',
            'title' => 'Farmgate market day',
            'description' => 'A public event.',
            'location' => 'Bongabong',
            'image_path' => $imagePath,
            'starts_at' => now()->addDay(),
            'ends_at' => now()->addDay()->addHour(),
            'timezone' => 'Asia/Manila',
            'audience' => 'PUBLIC',
            'status' => 'APPROVED',
        ]);
        $expectedUrl = Storage::disk('public')->url($imagePath);

        $this->getJson('/api/events')
            ->assertOk()
            ->assertJsonPath('events.data.0.image_url', $expectedUrl);
        $this->actingAs($admin)->getJson('/api/admin/events/'.$event->id)
            ->assertOk()
            ->assertJsonPath('event.image_url', $expectedUrl);
        $this->actingAs($admin)->getJson('/api/calendar?from='.now()->toDateString().'&to='.now()->addDays(2)->toDateString())
            ->assertOk()
            ->assertJsonPath('data.0.image_url', $expectedUrl);
    }

    public function test_seller_events_remain_private_until_admin_approval(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);

        $eventId = $this->actingAs($seller)->postJson('/api/seller/events', [
            'title' => 'Bongabong Livestock Market Day',
            'description' => 'A local livestock market event.',
            'location' => 'Bongabong, Oriental Mindoro',
            'starts_at' => now()->addDays(3)->toISOString(),
            'ends_at' => now()->addDays(3)->addHours(4)->toISOString(),
        ])->assertCreated()
            ->assertJsonPath('event.status', 'SUBMITTED')
            ->json('event.id');

        $this->getJson('/api/events')->assertOk()->assertJsonCount(0, 'events.data');
        $this->actingAs($buyer)->getJson('/api/seller/events')->assertForbidden();
        $this->actingAs($admin)->getJson('/api/admin/events?status=SUBMITTED&search=Bongabong&sort=title_asc')
            ->assertOk()
            ->assertJsonPath('submitted_count', 1)
            ->assertJsonPath('events.data.0.id', $eventId);
        $this->actingAs($admin)->getJson('/api/admin/events?status=SUBMITTED')->assertOk()
            ->assertJsonPath('events.data.0.id', $eventId);

        $this->actingAs($admin)->patchJson("/api/admin/events/{$eventId}", ['status' => 'APPROVED'])
            ->assertOk()
            ->assertJsonPath('event.status', 'APPROVED')
            ->assertJsonPath('event.reviewer.id', $admin->id);
        $this->getJson('/api/events')->assertOk()
            ->assertJsonCount(1, 'events.data')
            ->assertJsonPath('events.data.0.title', 'Bongabong Livestock Market Day');
        $this->actingAs($admin)->getJson("/api/admin/events/{$eventId}")
            ->assertOk()->assertJsonCount(2, 'event.history');

        $this->assertDatabaseHas('audit_logs', [
            'user_id' => $admin->id,
            'action' => 'admin.event.approved',
            'entity_id' => (string) $eventId,
        ]);
    }

    public function test_event_rejection_requires_a_reason_and_is_not_public(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $eventId = $this->actingAs($seller)->postJson('/api/seller/events', [
            'title' => 'Community Livestock Workshop',
            'description' => 'A workshop about livestock care.',
            'location' => 'Bongabong, Oriental Mindoro',
            'starts_at' => now()->addDays(3)->toISOString(),
            'ends_at' => now()->addDays(3)->addHours(2)->toISOString(),
        ])->assertCreated()->json('event.id');

        $this->actingAs($admin)->patchJson("/api/admin/events/{$eventId}", ['status' => 'REJECTED'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('reason');
        $this->actingAs($admin)->patchJson("/api/admin/events/{$eventId}", [
            'status' => 'REJECTED',
            'reason' => 'Please provide a venue contact.',
        ])->assertOk()->assertJsonPath('event.review_reason', 'Please provide a venue contact.');
        $this->getJson('/api/events')->assertOk()->assertJsonCount(0, 'events.data');
    }

    public function test_calendar_limits_private_events_to_their_audience(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $rider = User::factory()->create(['role' => Role::RIDER]);
        $startsAt = now()->addDays(2);
        $eventIds = [];
        foreach ([
            ['title' => 'Rider safety training', 'audience' => 'RIDERS', 'offset' => 0],
            ['title' => 'Buyer orientation', 'audience' => 'BUYERS', 'offset' => 2],
        ] as $event) {
            $eventIds[$event['audience']] = $this->actingAs($admin)->postJson('/api/events', [
                'title' => $event['title'],
                'audience' => $event['audience'],
                'description' => 'Operational training for Farmgate users.',
                'category' => 'ADMIN_ACTIVITY',
                'starts_at' => $startsAt->copy()->addHours($event['offset'])->toISOString(),
                'ends_at' => $startsAt->copy()->addHours($event['offset'] + 1)->toISOString(),
                'timezone' => 'Asia/Manila',
                'location' => 'Farmgate hub',
            ])->assertCreated()->json('event.id');
        }

        $range = ['from' => now()->toDateString(), 'to' => now()->addDays(7)->toDateString(), 'timezone' => 'Asia/Manila'];
        $this->actingAs($buyer)->getJson('/api/calendar?'.http_build_query($range))
            ->assertOk()->assertJsonCount(0, 'data');
        $this->actingAs($rider)->getJson('/api/calendar?'.http_build_query($range))
            ->assertOk()->assertJsonPath('data.0.title', 'Rider safety training')
            ->assertJsonCount(1, 'data')
            ->assertJsonMissingPath('data.0.buyer_address');
        $this->actingAs($buyer)->getJson("/api/events/{$eventIds['BUYERS']}")->assertNotFound();
    }

    public function test_calendar_shows_sellers_only_their_own_promotion_schedule(): void
    {
        $seller = User::factory()->create(['role' => Role::SELLER]);
        $otherSeller = User::factory()->create(['role' => Role::SELLER]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $category = Category::create(['name' => 'Calendar livestock', 'slug' => 'calendar-livestock']);
        $eligibleListing = LivestockListing::create([
            'seller_id' => $otherSeller->id,
            'category_id' => $category->id,
            'name' => 'Calendar promotion animal',
            'quantity' => 3,
            'pricing_type' => PricingType::PER_HEAD,
            'price_per_head' => 100,
            'status' => ListingStatus::ACTIVE,
        ]);
        $startsAt = now()->addDays(2);
        $promotionAttributes = [
            'name' => 'Upcoming livestock offer',
            'description' => 'A scheduled discount.',
            'discount_type' => 'PERCENTAGE',
            'discount_value' => 10,
            'applies_to_all' => true,
            'starts_at' => $startsAt,
            'ends_at' => $startsAt->copy()->addDays(3),
        ];
        $ownDraft = SellerPromotion::create([...$promotionAttributes, 'seller_id' => $seller->id, 'status' => 'DRAFT']);
        $publicPromotion = SellerPromotion::create([...$promotionAttributes, 'name' => 'Another seller offer', 'seller_id' => $otherSeller->id, 'status' => 'ACTIVE']);
        $publicPromotion->listings()->attach($eligibleListing->id);

        $range = ['from' => now()->toDateString(), 'to' => now()->addDays(7)->toDateString(), 'timezone' => 'Asia/Manila', 'category' => 'SELLER_PROMOTION'];
        $this->actingAs($seller)->getJson('/api/calendar?'.http_build_query($range))
            ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.record_id', $ownDraft->id);
        $this->actingAs($buyer)->getJson('/api/calendar?'.http_build_query($range))
            ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.title', 'Another seller offer');
        $this->getJson("/api/calendar/promotions/{$publicPromotion->id}")
            ->assertOk()->assertJsonPath('promotion.id', $publicPromotion->id);
    }

    public function test_upcoming_event_reminders_are_idempotent(): void
    {
        $admin = User::factory()->create(['role' => Role::ADMIN]);
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $startsAt = now()->addHours(3);
        FarmgateEvent::create([
            'organizer_id' => $admin->id,
            'category' => 'FARMGATE_EVENT',
            'title' => 'Farmgate community event',
            'description' => 'An approved public event.',
            'location' => 'Bongabong',
            'starts_at' => $startsAt,
            'ends_at' => $startsAt->copy()->addHour(),
            'timezone' => 'Asia/Manila',
            'audience' => 'PUBLIC',
            'status' => 'APPROVED',
        ]);

        $this->artisan('calendar:send-reminders')->assertSuccessful();
        $this->artisan('calendar:send-reminders')->assertSuccessful();

        $this->assertSame(1, $buyer->notifications()->where('data->type', 'calendar_event')->count());
    }
}
