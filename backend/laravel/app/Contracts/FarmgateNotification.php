<?php

namespace App\Contracts;

interface FarmgateNotification
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(object $notifiable): array;
}
