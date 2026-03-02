import React from "react";

/**
 * Renders markdown-like text as React elements with Tailwind classes.
 * Handles: **bold**, *italic*, `inline code`, ```code blocks```,
 * - lists, > blockquotes, [links](url), ### headers.
 *
 * No external deps — pure regex parsing.
 */
export function Markdown({ content }: { content: string }) {
    if (!content) return null;

    const elements: React.ReactNode[] = [];
    const lines = content.split("\n");
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        // Code block
        if (line.trimStart().startsWith("```")) {
            const lang = line.trim().slice(3).trim();
            const codeLines: string[] = [];
            i++;
            while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
                codeLines.push(lines[i]);
                i++;
            }
            i++; // Skip closing ```
            elements.push(
                <div key={elements.length} className="my-2 rounded-md border border-border-subtle bg-black/30 overflow-hidden">
                    {lang && <div className="text-[9px] font-semibold uppercase tracking-widest text-text-muted px-2.5 py-1 border-b border-white/[0.04] bg-white/[0.02]">{lang}</div>}
                    <pre className="m-0 p-2.5 overflow-x-auto"><code className="font-mono text-[11px] leading-relaxed text-text-secondary">{codeLines.join("\n")}</code></pre>
                </div>
            );
            continue;
        }

        // Header
        if (line.startsWith("### ")) {
            elements.push(<h4 key={elements.length} className="mt-2.5 mb-1 font-semibold text-text-primary text-[13px] leading-tight">{renderInline(line.slice(4))}</h4>);
            i++; continue;
        }
        if (line.startsWith("## ")) {
            elements.push(<h3 key={elements.length} className="mt-2.5 mb-1 font-semibold text-text-primary text-[14px] leading-tight">{renderInline(line.slice(3))}</h3>);
            i++; continue;
        }
        if (line.startsWith("# ")) {
            elements.push(<h2 key={elements.length} className="mt-2.5 mb-1 font-semibold text-text-primary text-[15px] leading-tight">{renderInline(line.slice(2))}</h2>);
            i++; continue;
        }

        // Blockquote
        if (line.startsWith("> ")) {
            const quoteLines: string[] = [];
            while (i < lines.length && lines[i].startsWith("> ")) {
                quoteLines.push(lines[i].slice(2));
                i++;
            }
            elements.push(
                <blockquote key={elements.length} className="my-1.5 py-1.5 px-3 border-l-3 border-white/20 text-text-secondary italic text-xs">
                    {renderInline(quoteLines.join(" "))}
                </blockquote>
            );
            continue;
        }

        // Unordered list
        if (/^[-*] /.test(line.trimStart())) {
            const listItems: string[] = [];
            while (i < lines.length && /^[-*] /.test(lines[i].trimStart())) {
                listItems.push(lines[i].trimStart().slice(2));
                i++;
            }
            elements.push(
                <ul key={elements.length} className="my-1 pl-4.5 list-disc">
                    {listItems.map((item, j) => (
                        <li key={j} className="my-0.5 leading-normal text-[12.5px]">{renderInline(item)}</li>
                    ))}
                </ul>
            );
            continue;
        }

        // Ordered list
        if (/^\d+\. /.test(line.trimStart())) {
            const listItems: string[] = [];
            while (i < lines.length && /^\d+\. /.test(lines[i].trimStart())) {
                listItems.push(lines[i].trimStart().replace(/^\d+\. /, ""));
                i++;
            }
            elements.push(
                <ol key={elements.length} className="my-1 pl-4.5 list-decimal">
                    {listItems.map((item, j) => (
                        <li key={j} className="my-0.5 leading-normal text-[12.5px]">{renderInline(item)}</li>
                    ))}
                </ol>
            );
            continue;
        }

        // Empty line
        if (!line.trim()) {
            i++;
            continue;
        }

        // Paragraph
        elements.push(<p key={elements.length} className="mb-1.5 last:mb-0 leading-relaxed">{renderInline(line)}</p>);
        i++;
    }

    return <>{elements}</>;
}

/**
 * Render inline markdown: **bold**, *italic*, `code`, [link](url)
 */
function renderInline(text: string): React.ReactNode {
    if (!text) return null;

    const parts: React.ReactNode[] = [];
    let remaining = text;
    let key = 0;

    while (remaining.length > 0) {
        // Bold: **text**
        let match = remaining.match(/^(.*?)\*\*(.+?)\*\*(.*)/s);
        if (match) {
            if (match[1]) parts.push(match[1]);
            parts.push(<strong key={key++}>{match[2]}</strong>);
            remaining = match[3];
            continue;
        }

        // Italic: *text*
        match = remaining.match(/^(.*?)\*(.+?)\*(.*)/s);
        if (match) {
            if (match[1]) parts.push(match[1]);
            parts.push(<em key={key++}>{match[2]}</em>);
            remaining = match[3];
            continue;
        }

        // Inline code: `code`
        match = remaining.match(/^(.*?)`(.+?)`(.*)/s);
        if (match) {
            if (match[1]) parts.push(match[1]);
            parts.push(
                <code key={key++} className="font-mono text-[11px] bg-white/[0.06] border border-white/[0.08] rounded-sm px-1.5 py-px text-accent-light">
                    {match[2]}
                </code>
            );
            remaining = match[3];
            continue;
        }

        // Link: [text](url)
        match = remaining.match(/^(.*?)\[(.+?)\]\((.+?)\)(.*)/s);
        if (match) {
            if (match[1]) parts.push(match[1]);
            parts.push(
                <a key={key++} href={match[3]} className="text-accent no-underline border-b border-transparent hover:border-accent transition-colors" target="_blank" rel="noopener">
                    {match[2]}
                </a>
            );
            remaining = match[4];
            continue;
        }

        // No more patterns
        parts.push(remaining);
        break;
    }

    return parts.length === 1 ? parts[0] : <>{parts}</>;
}
