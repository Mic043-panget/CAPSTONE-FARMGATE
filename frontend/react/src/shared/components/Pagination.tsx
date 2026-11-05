import React from 'react';

type PaginationProps = {
    page: number;
    lastPage: number;
    onChange: (page: number) => void;
};

export function Pagination({ page, lastPage, onChange }: PaginationProps) {
    const totalPages = Math.max(1, lastPage);

    const pages = Array.from({ length: totalPages }, (_, index) => index + 1).filter((item) =>
        item === 1 || item === totalPages || Math.abs(item - page) <= 1,
    );

    return <nav aria-label="Page navigation">
        <ul className="pagination">
            <li className={`page-item${page === 1 ? ' disabled' : ''}`}><button className="page-link" type="button" disabled={page === 1} onClick={() => onChange(page - 1)}>Previous</button></li>
            {pages.map((item, index) => <React.Fragment key={item}>
                {index > 0 && pages[index - 1] !== item - 1 && <li className="page-item disabled"><span className="page-link" aria-hidden="true">...</span></li>}
                <li className={`page-item${item === page ? ' active' : ''}`}><button className="page-link" type="button" aria-current={item === page ? 'page' : undefined} onClick={() => onChange(item)}>{item}</button></li>
            </React.Fragment>)}
            <li className={`page-item${page === totalPages ? ' disabled' : ''}`}><button className="page-link" type="button" disabled={page === totalPages} onClick={() => onChange(page + 1)}>Next</button></li>
        </ul>
    </nav>;
}