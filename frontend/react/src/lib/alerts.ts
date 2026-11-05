import 'sweetalert2/dist/sweetalert2.min.css';

type ConfirmOptions = {
    title: string;
    text?: string;
    confirmText?: string;
    danger?: boolean;
};

export async function confirmAction({ title, text, confirmText = 'Continue', danger = false }: ConfirmOptions): Promise<boolean> {
    const { default: Swal } = await import('sweetalert2');
    const result = await Swal.fire({
        title,
        text,
        icon: danger ? 'warning' : 'question',
        showCancelButton: true,
        confirmButtonText: confirmText,
        cancelButtonText: 'Cancel',
        reverseButtons: true,
        focusCancel: true,
        buttonsStyling: false,
        customClass: {
            popup: 'farmgate-swal-popup',
            title: 'farmgate-swal-title',
            htmlContainer: 'farmgate-swal-text',
            actions: 'farmgate-swal-actions',
            confirmButton: danger ? 'farmgate-swal-confirm danger' : 'farmgate-swal-confirm',
            cancelButton: 'farmgate-swal-cancel',
        },
    });

    return result.isConfirmed;
}

export function showSuccess(message: string): void {
    void import('sweetalert2').then(({ default: Swal }) => Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: message,
        showConfirmButton: false,
        timer: 2800,
        timerProgressBar: true,
        buttonsStyling: false,
        customClass: { popup: 'farmgate-swal-toast' },
    }));
}

export function showError(message: string): void {
    void import('sweetalert2').then(({ default: Swal }) => Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'error',
        title: message,
        showConfirmButton: false,
        timer: 4200,
        timerProgressBar: true,
        buttonsStyling: false,
        customClass: { popup: 'farmgate-swal-toast' },
    }));
}

export function showInfo(message: string): void {
    void import('sweetalert2').then(({ default: Swal }) => Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'info',
        title: message,
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true,
        buttonsStyling: false,
        customClass: { popup: 'farmgate-swal-toast' },
    }));
}
