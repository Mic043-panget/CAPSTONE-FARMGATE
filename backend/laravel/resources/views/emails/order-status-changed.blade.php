<!DOCTYPE html>
<html lang="en">
<body>
    <p>Hello {{ $recipientName }},</p>
    <p>Order <strong>{{ $orderReference }}</strong> was {{ $status }}.</p>
    <p>Open Farmgate to review the update and any next steps.</p>
    <p><a href="{{ $orderUrl }}">{{ $actionLabel }}</a></p>
    <p>Farmgate</p>
</body>
</html>
