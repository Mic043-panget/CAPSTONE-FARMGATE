import * as React from 'react';

type FileDropzoneProps = {
    label: string;
    accept: string;
    onFiles: (files: File[]) => void;
    multiple?: boolean;
    required?: boolean;
    disabled?: boolean;
    buttonLabel?: string;
    helperText?: React.ReactNode;
    className?: string;
    invalid?: boolean;
    describedBy?: string;
    onBlur?: () => void;
};

export function FileDropzone({
    label,
    accept,
    onFiles,
    multiple = false,
    required = false,
    disabled = false,
    buttonLabel,
    helperText,
    className = '',
    invalid,
    describedBy,
    onBlur,
}: FileDropzoneProps) {
    const inputRef = React.useRef<HTMLInputElement>(null);
    const [dragging, setDragging] = React.useState(false);

    function receiveFiles(files: FileList | File[], fromPicker = false) {
        const selected = Array.from(files);
        if (disabled || !selected.length) return;
        if (required && !fromPicker && inputRef.current) {
            const transfer = new DataTransfer();
            selected.forEach((file) => transfer.items.add(file));
            inputRef.current.files = transfer.files;
        }
        onFiles(selected);
        if (!required && inputRef.current) inputRef.current.value = '';
    }

    return <div
        className={`file-dropzone${dragging ? ' is-dragging' : ''}${className ? ` ${className}` : ''}`}
        onBlur={onBlur}
        onDragEnter={(event) => {
            if (disabled || !event.dataTransfer.types.includes('Files')) return;
            event.preventDefault();
            setDragging(true);
        }}
        onDragOver={(event) => {
            if (disabled || !event.dataTransfer.types.includes('Files')) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={(event) => {
            const nextTarget = event.relatedTarget;
            if (event.currentTarget === event.target || !(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
                setDragging(false);
            }
        }}
        onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (!disabled) receiveFiles(event.dataTransfer.files);
        }}
    >
        <span className="file-dropzone-label">{label}</span>
        <div className="file-dropzone-actions">
            <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()}>
                {buttonLabel ?? (multiple ? 'Choose files' : 'Choose file')}
            </button>
            <span>{dragging ? 'Drop files to add them' : `or drag and drop ${multiple ? 'files' : 'a file'} here`}</span>
        </div>
        {helperText && <small className="file-dropzone-help">{helperText}</small>}
        <input
            ref={inputRef}
            className="file-dropzone-input sr-only"
            type="file"
            accept={accept}
            multiple={multiple}
            required={required}
            disabled={disabled}
            aria-label={label}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            onChange={(event) => receiveFiles(event.currentTarget.files ?? [], true)}
        />
    </div>;
}
