/**
 * EllipsisText — simple text truncation component.
 * Replaces the `react-ellipsis-text` dependency.
 */

interface EllipsisTextProps {
    text: string;
    length: number;
    tail?: string;
    className?: string;
}

export default function EllipsisText({ text, length, tail = "…", className }: EllipsisTextProps) {
    const truncated = text.length > length ? text.slice(0, length - tail.length) + tail : text;
    return <span className={className} title={text.length > length ? text : undefined}>{truncated}</span>;
}
