function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeUrl(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  if (text.startsWith("/")) {
    return text;
  }
  try {
    const url = new URL(text, "http://localhost");
    if (["http:", "https:"].includes(url.protocol)) {
      return url.href;
    }
  } catch {
    return "";
  }
  return "";
}

function stashHtml(html, placeholders) {
  const token = `%%MD_PLACEHOLDER_${placeholders.length}%%`;
  placeholders.push(html);
  return token;
}

function restoreHtmlPlaceholders(text, placeholders) {
  return placeholders.reduce(
    (result, html, index) => result.replaceAll(`%%MD_PLACEHOLDER_${index}%%`, html),
    text,
  );
}

function renderInlineMarkdown(text) {
  const placeholders = [];
  let output = String(text || "");

  output = output.replace(/`([^`]+)`/g, (_match, code) => stashHtml(`<code>${escapeHtml(code)}</code>`, placeholders));
  output = escapeHtml(output);
  output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, url) => {
    const safeUrl = sanitizeUrl(String(url || "").replaceAll("&amp;", "&"));
    if (!safeUrl) {
      return label;
    }
    return stashHtml(
      `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noreferrer">${label}</a>`,
      placeholders,
    );
  });
  output = output.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  output = output.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  output = output.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  output = output.replace(
    /(^|[\s(])(https?:\/\/[^\s<]+)/g,
    (_match, prefix, url) =>
      `${prefix}${stashHtml(
        `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a>`,
        placeholders,
      )}`,
  );
  return restoreHtmlPlaceholders(output, placeholders);
}

function splitTableRow(line) {
  const input = String(line || "").trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let current = "";
  let escaped = false;

  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  if (escaped) {
    current += "\\";
  }
  cells.push(current.trim());
  return cells;
}

function alignmentForCell(cell) {
  const token = String(cell || "").trim();
  if (!/^:?-{3,}:?$/.test(token)) {
    return null;
  }
  if (token.startsWith(":") && token.endsWith(":")) {
    return "center";
  }
  if (token.endsWith(":")) {
    return "right";
  }
  return "left";
}

function tableSeparatorAlignments(line) {
  const cells = splitTableRow(line);
  if (cells.length < 2) {
    return null;
  }
  const alignments = cells.map(alignmentForCell);
  if (alignments.some((value) => !value)) {
    return null;
  }
  return alignments;
}

function hasTableCells(line) {
  return splitTableRow(line).length >= 2;
}

function renderTable(headerCells, bodyRows, alignments) {
  const columnCount = Math.max(
    headerCells.length,
    ...bodyRows.map((row) => row.length),
  );
  const normalizedHeader = Array.from({ length: columnCount }, (_value, index) => headerCells[index] || "");
  const normalizedBody = bodyRows.map((row) =>
    Array.from({ length: columnCount }, (_value, index) => row[index] || ""),
  );

  return `
    <div class="message-table-wrap">
      <table class="message-table">
        <thead>
          <tr>
            ${normalizedHeader
              .map((cell, index) => `<th${alignments[index] ? ` style="text-align:${alignments[index]}"` : ""}>${renderInlineMarkdown(cell)}</th>`)
              .join("")}
          </tr>
        </thead>
        <tbody>
          ${normalizedBody
            .map(
              (row) => `
                <tr>
                  ${row
                    .map((cell, index) => `<td${alignments[index] ? ` style="text-align:${alignments[index]}"` : ""}>${renderInlineMarkdown(cell)}</td>`)
                    .join("")}
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

export function renderMarkdown(text) {
  const source = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!source) {
    return "";
  }

  const placeholders = [];
  const prepared = source.replace(/```([a-z0-9_-]+)?\n?([\s\S]*?)```/gi, (_match, language, code) =>
    stashHtml(
      `<pre><code${language ? ` class="language-${escapeHtml(language)}"` : ""}>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`,
      placeholders,
    ),
  );
  const blocks = [];
  const lines = prepared.split("\n");
  let paragraph = [];
  let list = null;
  let quote = [];

  function flushParagraph() {
    if (!paragraph.length) {
      return;
    }
    blocks.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  }

  function flushList() {
    if (!list?.items?.length) {
      list = null;
      return;
    }
    const tag = list.type === "ordered" ? "ol" : "ul";
    blocks.push(
      `<${tag}>${list.items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</${tag}>`,
    );
    list = null;
  }

  function flushQuote() {
    if (!quote.length) {
      return;
    }
    blocks.push(
      `<blockquote>${quote.map((line) => `<p>${renderInlineMarkdown(line)}</p>`).join("")}</blockquote>`,
    );
    quote = [];
  }

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      flushQuote();
      continue;
    }

    if (/^%%MD_PLACEHOLDER_\d+%%$/.test(trimmed)) {
      flushParagraph();
      flushList();
      flushQuote();
      blocks.push(trimmed);
      continue;
    }

    const nextLine = lines[index + 1] || "";
    const alignments = tableSeparatorAlignments(nextLine);
    if (alignments && hasTableCells(trimmed)) {
      flushParagraph();
      flushList();
      flushQuote();

      const headerCells = splitTableRow(trimmed);
      const bodyRows = [];
      index += 2;
      while (index < lines.length) {
        const candidate = String(lines[index] || "").trim();
        if (!candidate || /^%%MD_PLACEHOLDER_\d+%%$/.test(candidate) || !hasTableCells(candidate)) {
          index -= 1;
          break;
        }
        bodyRows.push(splitTableRow(candidate));
        index += 1;
      }
      blocks.push(renderTable(headerCells, bodyRows, alignments));
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      flushQuote();
      const level = headingMatch[1].length;
      blocks.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    const quoteMatch = trimmed.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      quote.push(quoteMatch[1]);
      continue;
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+(.*)$/);
    if (orderedMatch) {
      flushParagraph();
      flushQuote();
      if (!list || list.type !== "ordered") {
        flushList();
        list = { type: "ordered", items: [] };
      }
      list.items.push(orderedMatch[1]);
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*+]\s+(.*)$/);
    if (bulletMatch) {
      flushParagraph();
      flushQuote();
      if (!list || list.type !== "unordered") {
        flushList();
        list = { type: "unordered", items: [] };
      }
      list.items.push(bulletMatch[1]);
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  flushQuote();

  return restoreHtmlPlaceholders(blocks.join(""), placeholders);
}
