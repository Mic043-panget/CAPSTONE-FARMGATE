<?php

namespace App\Exceptions;

use RuntimeException;
use Throwable;

class MailDeliveryException extends RuntimeException
{
    public function __construct(public readonly string $providerExceptionClass)
    {
        parent::__construct('SMTP mail delivery failed.');
    }

    public static function from(Throwable $exception): self
    {
        return new self($exception::class);
    }
}
