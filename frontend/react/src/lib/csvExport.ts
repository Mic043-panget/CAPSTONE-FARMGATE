export type CsvColumn<Row> = {
    header: string;
    value: keyof Row | ((row: Row) => unknown);
    format?: 'number' | 'dateTime' | 'status' | 'boolean';
};

type CsvWritable = {
    write(chunk: string): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
};

type CsvFileHandle = {
    createWritable(): Promise<CsvWritable>;
};

type CsvPickerWindow = Window & {
    showSaveFilePicker?: (options: {
        suggestedName: string;
        types: { description: string; accept: Record<string, string[]> }[];
    }) => Promise<CsvFileHandle>;
};

export type CsvDownloadWriter = {
    write(chunk: string): Promise<void>;
    finish(): Promise<void>;
    cancel(): Promise<void>;
};

function toCellText(value: unknown, format?: CsvColumn<unknown>['format']): string {
    if (value === null || value === undefined) return '';
    if (format === 'status') {
        return formatCsvStatus(value);
    }
    if (format === 'boolean') {
        if (value === true || value === 1 || value === '1' || value === 'true') return 'Yes';
        if (value === false || value === 0 || value === '0' || value === 'false') return 'No';
        return '';
    }
    if (format === 'number') {
        const numericText = typeof value === 'string' ? value.trim() : String(value);
        return /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(numericText) ? numericText : '';
    }
    if (format === 'dateTime') {
        const date = value instanceof Date ? value : new Date(String(value));
        if (Number.isNaN(date.getTime())) return String(value);
        const pad = (part: number) => String(part).padStart(2, '0');
        return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
    }
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
    return JSON.stringify(value) ?? '';
}

export function formatCsvDateTime(value: Date | string): string {
    return toCellText(value, 'dateTime');
}

export function formatCsvStatus(value: unknown): string {
    if (value === null || value === undefined || value === '') return '';
    const status = typeof value === 'object' && value !== null && 'value' in value
        ? String(value.value)
        : String(value);
    return status.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function protectFormulaText(value: string): string {
    const isNumericValue = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value);
    const startsWithFormula = /^[\s\u0000-\u001f\u007f-\u009f\uFEFF]*[=+\-@]/.test(value);

    return startsWithFormula && !isNumericValue ? `'${value}` : value;
}

function escapeCsvCell(value: unknown, format?: CsvColumn<unknown>['format']): string {
    const safeText = protectFormulaText(toCellText(value, format));
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(safeText)) return safeText;
    if (!/[",\r\n]/.test(safeText) && safeText === safeText.trim()) return safeText;
    return `"${safeText.replaceAll('"', '""')}"`;
}

export function createCsvContent<Row>(
    rows: readonly Row[],
    columns: readonly CsvColumn<Row>[],
    metadata: readonly (readonly unknown[])[] = [],
): string {
    return `${createCsvPreamble(columns, metadata)}${createCsvRows(rows, columns)}`;
}

export function createCsvPreamble<Row>(
    columns: readonly CsvColumn<Row>[],
    metadata: readonly (readonly unknown[])[] = [],
): string {
    const metadataRows = metadata.map((row) => row.map((value) => escapeCsvCell(value)).join(','));
    const header = columns.map((column) => escapeCsvCell(column.header)).join(',');

    return `\uFEFF${[...metadataRows, header].join('\r\n')}\r\n`;
}

export function createCsvRows<Row>(rows: readonly Row[], columns: readonly CsvColumn<Row>[]): string {
    return rows.map((row) => columns.map((column) => {
        const value = typeof column.value === 'function' ? column.value(row) : row[column.value];
        return escapeCsvCell(value, column.format);
    }).join(',')).join('\r\n') + (rows.length ? '\r\n' : '');
}

export async function createCsvDownload(filename: string): Promise<CsvDownloadWriter> {
    const picker = (window as CsvPickerWindow).showSaveFilePicker;
    if (picker) {
        const handle = await picker.call(window, {
            suggestedName: filename,
            types: [{ description: 'CSV file', accept: { 'text/csv': ['.csv'] } }],
        });
        const writable = await handle.createWritable();

        return {
            write: (chunk) => writable.write(chunk),
            finish: () => writable.close(),
            cancel: () => writable.abort(),
        };
    }

    const chunks: BlobPart[] = [];

    return {
        write: async (chunk) => { chunks.push(chunk); },
        finish: async () => {
            const blob = new Blob(chunks, { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.append(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 0);
        },
        cancel: async () => { chunks.length = 0; },
    };
}

export function downloadCsv<Row>(
    filename: string,
    rows: readonly Row[],
    columns: readonly CsvColumn<Row>[],
    metadata: readonly (readonly unknown[])[] = [],
): void {
    const blob = new Blob([createCsvContent(rows, columns, metadata)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
