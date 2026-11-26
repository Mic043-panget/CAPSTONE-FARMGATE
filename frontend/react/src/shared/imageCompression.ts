type CompressionOptions = {
    maxBytes: number;
    maxDimension: number;
    minDimension: number;
    qualities: number[];
    purpose: string;
};

async function compressImage(file: File, options: CompressionOptions): Promise<File> {
    let bitmap: ImageBitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        throw new Error(`This ${options.purpose} photo could not be opened. Choose a valid JPEG, PNG, or WebP image and try again.`);
    }
    try {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) {
            throw new Error(`Your browser could not prepare the ${options.purpose} photo. Please try another browser.`);
        }

        const initialScale = Math.min(1, options.maxDimension / Math.max(bitmap.width, bitmap.height));
        let width = Math.max(1, Math.round(bitmap.width * initialScale));
        let height = Math.max(1, Math.round(bitmap.height * initialScale));

        while (true) {
            canvas.width = width;
            canvas.height = height;
            context.drawImage(bitmap, 0, 0, width, height);

            for (const quality of options.qualities) {
                const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
                if (!blob || blob.type !== 'image/webp') {
                    throw new Error(`Your browser could not compress the ${options.purpose} photo. Please try another browser.`);
                }

                if (blob.size <= options.maxBytes) {
                    const baseName = file.name.replace(/\.[^.]+$/, '') || `${options.purpose}-photo`;
                    return new File([blob], `${baseName}.webp`, {
                        type: 'image/webp',
                        lastModified: file.lastModified,
                    });
                }
            }

            const longestSide = Math.max(width, height);
            if (longestSide <= options.minDimension) {
                throw new Error(`The ${options.purpose} photo could not be compressed enough to upload. Choose a smaller image and try again.`);
            }

            const scale = Math.max(options.minDimension / longestSide, 0.8);
            width = Math.max(1, Math.round(width * scale));
            height = Math.max(1, Math.round(height * scale));
        }
    } finally {
        bitmap.close();
    }
}

export function compressListingImage(file: File): Promise<File> {
    return compressImage(file, {
        maxBytes: 384 * 1024,
        maxDimension: 1600,
        minDimension: 640,
        qualities: [0.82, 0.72, 0.62, 0.52, 0.42],
        purpose: 'listing',
    });
}

export function compressDeliveryProofImage(file: File): Promise<File> {
    return compressImage(file, {
        maxBytes: 2 * 1024 * 1024,
        maxDimension: 1920,
        minDimension: 800,
        qualities: [0.9, 0.84, 0.78, 0.7, 0.62],
        purpose: 'delivery proof',
    });
}
