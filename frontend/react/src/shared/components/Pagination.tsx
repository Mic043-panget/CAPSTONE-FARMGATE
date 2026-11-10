import React from 'react';
import { Button } from './Button';

type PaginationProps = {
    page: number;
    lastPage: number;
    onChange: (page: number) => void;
    label?: string;
};

export function Pagination({ page, lastPage, onChange, label = 'Page navigation' }: PaginationProps) {
    const totalPages = Math.max(1, lastPage);

    const pages = Array.from({ length: totalPages }, (_, index) => index + 1).filter((item) =>
        item === 1 || item === totalPages || Math.abs(item - page) <= 1,
    );

    return <nav aria-label={label}>
        <ul className="pagination">
            <li className={`page-item${page === 1 ? ' disabled' : ''}`}><Button className="page-link" size="sm" disabled={page === 1} onClick={() => onChange(page - 1)}>Previous</Button></li>
            {pages.map((item, index) => <React.Fragment key={item}>
                {index > 0 && pages[index - 1] !== item - 1 && <li className="page-item disabled"><span className="page-link" aria-hidden="true">...</span></li>}
                <li className={`page-item${item === page ? ' active' : ''}`}><Button className="page-link" size="sm" aria-current={item === page ? 'page' : undefined} onClick={() => onChange(item)}>{item}</Button></li>
            </React.Fragment>)}
            <li className={`page-item${page === totalPages ? ' disabled' : ''}`}><Button className="page-link" size="sm" disabled={page === totalPages} onClick={() => onChange(page + 1)}>Next</Button></li>
        </ul>
    </nav>;
}