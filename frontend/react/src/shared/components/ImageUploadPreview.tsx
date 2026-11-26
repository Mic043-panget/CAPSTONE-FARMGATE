import * as React from 'react';

export const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const IMAGE_UPLOAD_HINT = 'JPEG, PNG, or WebP; up to 10 MB per image, optimized to 2 MB or smaller after upload.';

export function imageUploadError(file: File, maxBytes = MAX_IMAGE_UPLOAD_BYTES): string | null {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
        return 'Choose a JPEG, PNG, or WebP image. SVG and video files are not accepted here.';
    }

    const maxMegabytes = maxBytes / (1024 * 1024);
    return file.size > maxBytes
        ? `Each image must be ${maxMegabytes} MB or smaller. Choose a smaller image and try again.`
        : null;
}

export function ImageUploadPreview({ file, alt = '' }: { file: File | null; alt?: string }) {
    const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (!file || !ACCEPTED_IMAGE_TYPES.includes(file.type)) {
            setPreviewUrl(null);
            return;
        }

        const url = URL.createObjectURL(file);
        setPreviewUrl(url);

        return () => URL.revokeObjectURL(url);
    }, [file]);

    return previewUrl ? <img className="image-upload-preview" src={previewUrl} alt={alt} /> : null;
}
