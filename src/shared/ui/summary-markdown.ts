/**
 * The small Markdown subset a briefing summary uses: `## headings`, `- bullets`, paragraphs and
 * `**bold**`. Anything else is plain text, so a model that ignores the format still reads fine.
 * Parsed into data, never into HTML, so nothing a model writes can inject markup.
 */
export type SummaryInline = { text: string; bold: boolean };

export type SummaryBlock =
  | { type: "heading"; inline: SummaryInline[] }
  | { type: "paragraph"; inline: SummaryInline[] }
  | { type: "list"; items: SummaryInline[][] };

export function parseInline(text: string): SummaryInline[] {
  const out: SummaryInline[] = [];
  for (const [i, part] of text.split(/\*\*(.+?)\*\*/gs).entries()) {
    if (part) out.push({ text: part, bold: i % 2 === 1 });
  }
  return out;
}

export function parseSummary(markdown: string): SummaryBlock[] {
  const blocks: SummaryBlock[] = [];
  let paragraph: string[] = [];
  let list: SummaryInline[][] | undefined;

  const flushParagraph = () => {
    if (paragraph.length)
      blocks.push({ type: "paragraph", inline: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };
  const flushList = () => {
    if (list?.length) blocks.push({ type: "list", items: list });
    list = undefined;
  };

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = line.match(/^#{1,4}\s+(.+?)\s*#*$/);
    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (!line) {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", inline: parseInline(heading[1]!) });
    } else if (bullet) {
      flushParagraph();
      (list ??= []).push(parseInline(bullet[1]!));
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}
