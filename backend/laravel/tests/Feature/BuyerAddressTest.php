<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class BuyerAddressTest extends TestCase
{
    use RefreshDatabase;

    public function test_buyer_can_save_list_and_set_a_default_delivery_address(): void
    {
        $buyer = User::factory()->create(['role' => Role::BUYER]);
        $payload = [
            'label' => 'Home',
            'recipient_name' => 'Maria Santos',
            'phone_number' => '+639171234567',
            'province' => 'Oriental Mindoro',
            'city_municipality' => 'Bongabong',
            'postal_code' => '5211',
            'street_address' => '123 Rizal Street',
            'address_line2' => 'Barangay Hulo',
            'delivery_notes' => 'Call before arrival.',
            'latitude' => 12.7321,
            'longitude' => 121.3654,
            'is_default' => true,
        ];

        $first = $this->actingAs($buyer)->postJson('/api/buyer/addresses', $payload)
            ->assertCreated()
            ->assertJsonPath('address.label', 'Home')
            ->assertJsonPath('address.is_default', true);

        $second = $this->actingAs($buyer)->postJson('/api/buyer/addresses', array_replace($payload, ['label' => 'Work', 'is_default' => false]))
            ->assertCreated()
            ->assertJsonPath('address.is_default', false);

        $this->actingAs($buyer)->putJson('/api/buyer/addresses/'.$second->json('address.id'), [
            ...$payload,
            'label' => 'Work',
            'is_default' => true,
        ])->assertOk()->assertJsonPath('address.is_default', true);

        $this->actingAs($buyer)->getJson('/api/buyer/addresses')
            ->assertOk()
            ->assertJsonCount(2, 'addresses')
            ->assertJsonPath('addresses.0.label', 'Work')
            ->assertJsonPath('addresses.0.is_default', true)
            ->assertJsonPath('addresses.1.label', 'Home')
            ->assertJsonPath('addresses.1.is_default', false);

        $this->assertDatabaseHas('buyer_addresses', [
            'id' => $first->json('address.id'),
            'user_id' => $buyer->id,
            'is_default' => false,
        ]);
    }

    public function test_buyer_cannot_read_or_modify_another_buyers_address(): void
    {
        $owner = User::factory()->create(['role' => Role::BUYER]);
        $otherBuyer = User::factory()->create(['role' => Role::BUYER]);
        $address = $this->actingAs($owner)->postJson('/api/buyer/addresses', [
            'label' => 'Home',
            'recipient_name' => 'Maria Santos',
            'phone_number' => '+639171234567',
            'province' => 'Oriental Mindoro',
            'city_municipality' => 'Bongabong',
            'postal_code' => '5211',
            'street_address' => '123 Rizal Street',
            'latitude' => 12.7321,
            'longitude' => 121.3654,
            'is_default' => true,
        ])->assertCreated()->json('address.id');

        $this->actingAs($otherBuyer)->putJson('/api/buyer/addresses/'.$address, ['label' => 'Stolen'])
            ->assertNotFound();
        $this->actingAs($otherBuyer)->deleteJson('/api/buyer/addresses/'.$address)->assertNotFound();
    }
}
