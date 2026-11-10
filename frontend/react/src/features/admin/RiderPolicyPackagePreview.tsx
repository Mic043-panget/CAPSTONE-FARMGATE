import React from 'react';

const sourcePackage = `# Rider privacy, terms & safety documents

**Document set:** Rider-facing policy package
**Version:** 1.0
**Status:** Draft for organizational adoption — NOT YET EFFECTIVE
**Prepared:** 8 November 2026
**Effective date:** Not set. The organization must approve, complete the highlighted fields, and publish the package before collecting registration data or accepting riders.
**Policy owner:** [LEGAL ENTITY / PERSONAL INFORMATION CONTROLLER]
**Service:** [SERVICE / APP NAME]
**Jurisdiction assumed for this draft:** Philippines

This is a maintainable policy package, not legal advice or a representation that an unidentified operator is already compliant. The repository supplied no organization, service model, contact, vendor, security, or operational facts. Bracketed fields are required decisions, not facts. Obtain Philippine privacy and transport counsel review for the actual service before adopting. Never publish this package as effective while placeholders remain.

## Included documents

1. Rider Privacy Notice — full document missing
2. Rider Terms of Service — full document missing
3. Rider Safety Policy — full document missing
4. Retention and Secure Disposal Schedule — full document missing
5. Admin adoption, publication, and revision procedure

## Current release gate

**Registration must remain disabled.** This document set alone does not authorize collection. An authorized administrator must complete the adoption checklist, approve and publish all documents, configure the effective date and privacy contact, configure data systems and deletion jobs to match the retention schedule, and record approval. Until then, do not collect ID details, ID images, selfies, birthdates, or addresses through registration.

**ID verification for initial release:** manual review only. Do not enable OCR, face matching, biometric identification, or third-party ID processing until the organization completes a privacy impact assessment, approves a lawful basis and notice, reviews the vendor and data flows, contracts appropriate safeguards, and updates and republishes this versioned package. Selfie collection is disabled by default; turning it on requires separate documented necessity, safeguards, and legal review.

## Legal and guidance sources reviewed

Official Philippine sources consulted on 8 November 2026. This list is maintained as drafting provenance; administrators must re-check current issuances before adoption and each material update.

- [Republic Act No. 10173, Data Privacy Act of 2012 (National Privacy Commission)](https://privacy.gov.ph/data-privacy-act/)
- [Implementing Rules and Regulations of the Data Privacy Act (National Privacy Commission)](https://privacy.gov.ph/implementing-rules-regulations-data-privacy-act-2012/)
- [NPC Circular No. 2023-06, Security of Personal Data in the Government and the Private Sector](https://privacy.gov.ph/wp-content/uploads/2024/03/NPC-Circular-Repeal-16-01-Signed.pdf) — security, governance, access control, privacy impact assessment, retention/disposal considerations; effective 30 March 2024 according to NPC.
- [NPC Circular No. 2023-03, Guidelines on Identification Cards](https://privacy.gov.ph/wp-content/uploads/2023/11/Published-NPC-Circular-No.-2023-03_Guidelines-on-Identification-Cards_07Nov2023.pdf) — relevant where the service issues digital or physical IDs; also reinforces proportionality and purpose limitation.
- [NPC Circular No. 2023-04, Guidelines on Consent](https://privacy.gov.ph/wp-content/uploads/2023/11/NPC-Circular-No.-2023-04_Guidelines-on-Consent_07Nov2023.pdf) — consent must be freely given, specific, informed, and evidenced where consent is the lawful basis.
- [NPC guidance on data-subject rights](https://privacy.gov.ph/right-to-erasure-or-blocking/)
- [NPC breach reporting guidance](https://privacy.gov.ph/pips-and-pics/breach-reporting/) — confirm current reporting channels and deadlines in the incident response plan; mandatory notification may apply within 72 hours.
- [NPC guidance: Creating a Privacy Manual](https://privacy.gov.ph/creating-a-privacy-manual/)

The policy does not treat consent as the automatic lawful basis for every processing activity. The controller must identify and document an appropriate basis for each purpose, including any sensitive personal information.`;

function inlineMarkdown(text: string, keyPrefix: string): React.ReactNode[] {
    const token = /(\*\*[^*]+\*\*|\[[^\]]+\]\(https:\/\/[^)\s]+\))/g;
    const nodes: React.ReactNode[] = [];
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = token.exec(text)) !== null) {
        if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
        const value = match[0];
        if (value.startsWith('**')) {
            nodes.push(<strong key={`${keyPrefix}-${match.index}`}>{value.slice(2, -2)}</strong>);
        } else {
            const linkMatch = /^\[([^\]]+)\]\((https:\/\/[^)\s]+)\)$/.exec(value);
            if (linkMatch) {
                nodes.push(<a key={`${keyPrefix}-${match.index}`} href={linkMatch[2]} target="_blank" rel="noreferrer">{linkMatch[1]}</a>);
            }
        }
        cursor = match.index + value.length;
    }
    if (cursor < text.length) nodes.push(text.slice(cursor));
    return nodes;
}

export function renderPolicyMarkdown(markdown: string): React.ReactNode[] {
    const blocks: React.ReactNode[] = [];
    const lines = markdown.split('\n');
    let index = 0;
    while (index < lines.length) {
        const line = lines[index].trim();
        if (!line) {
            index += 1;
            continue;
        }
        const heading = /^(#{1,3})\s+(.+)$/.exec(line);
        if (heading) {
            const Heading = `h${Math.min(heading[1].length + 1, 4)}` as 'h2' | 'h3' | 'h4';
            blocks.push(<Heading key={`heading-${index}`}>{inlineMarkdown(heading[2], `heading-${index}`)}</Heading>);
            index += 1;
            continue;
        }
        if (/^\d+\.\s+/.test(line) || /^-\s+/.test(line)) {
            const ordered = /^\d+\.\s+/.test(line);
            const items: React.ReactNode[] = [];
            while (index < lines.length && (ordered ? /^\d+\.\s+/.test(lines[index].trim()) : /^-\s+/.test(lines[index].trim()))) {
                const item = lines[index].trim().replace(ordered ? /^\d+\.\s+/ : /^-\s+/, '');
                items.push(<li key={`list-${index}`}>{inlineMarkdown(item, `list-${index}`)}</li>);
                index += 1;
            }
            blocks.push(ordered ? <ol key={`ol-${index}`}>{items}</ol> : <ul key={`ul-${index}`}>{items}</ul>);
            continue;
        }
        const paragraphLines = [line];
        index += 1;
        while (index < lines.length && lines[index].trim() && !/^(#{1,3})\s+/.test(lines[index].trim()) && !/^(?:\d+\.|-)\s+/.test(lines[index].trim())) {
            paragraphLines.push(lines[index].trim());
            index += 1;
        }
        blocks.push(<p key={`paragraph-${index}`}>{inlineMarkdown(paragraphLines.join(' '), `paragraph-${index}`)}</p>);
    }
    return blocks;
}

export function RiderPolicyPackagePreview() {
    return <details className="rider-policy-source-preview">
        <summary>Source package preview · Version 1.0 · Draft, not effective</summary>
        <div className="rider-policy-source-content">{renderPolicyMarkdown(sourcePackage)}</div>
    </details>;
}
