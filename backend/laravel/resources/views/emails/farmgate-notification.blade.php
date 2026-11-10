<!DOCTYPE html>
<html lang="en">
<body style="margin:0;background:#f4f7f1;color:#203128;font-family:Arial,sans-serif">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 12px">
        <tr><td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border-radius:12px;padding:28px">
                <tr><td>
                    <p style="margin:0 0 20px;color:#245b3a;font-size:13px;font-weight:bold;letter-spacing:2px">FARMGATE</p>
                    <h1 style="font-size:21px;line-height:1.35;margin:0 0 16px">{{ $title }}</h1>
                    <p>Hello {{ $recipientName }},</p>
                    <p style="line-height:1.6">{{ $notificationMessage }}</p>
                    @if ($notificationTimestamp)
                        <p style="color:#68756c;font-size:12px">Updated {{ \Illuminate\Support\Carbon::parse($notificationTimestamp)->timezone(config('app.timezone'))->format('M j, Y g:i A T') }}</p>
                    @endif
                    <p style="margin:28px 0">
                        <a href="{{ $notificationUrl }}" style="background:#245b3a;border-radius:7px;color:#fff;display:inline-block;padding:12px 18px;text-decoration:none">{{ $actionLabel }}</a>
                    </p>
                    <p style="color:#68756c;font-size:12px">Sign in to Farmgate to view the related item. If it is no longer available to your account, the page will explain why.</p>
                    <p style="color:#68756c;font-size:12px">FARMGATE · Bongabong, Oriental Mindoro</p>
                </td></tr>
            </table>
        </td></tr>
    </table>
</body>
</html>
