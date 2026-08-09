import katex from 'katex';

const PLACEHOLDER = '\u0000MATH_';

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function escapeAttribute(value) {
    return escapeHtml(value).replaceAll('`', '&#96;');
}

function renderMath(latex, displayMode) {
    return katex.renderToString(String(latex).trim(), {
        displayMode,
        throwOnError: false,
        strict: 'ignore'
    });
}

function renderInline(source) {
    const placeholders = [];
    const placeholder = (html) => {
        const token = `${PLACEHOLDER}${placeholders.length}\u0000`;
        placeholders.push(html);
        return token;
    };

    const inlineHtml = String(source).replace(/<(u|mark|s)>([\s\S]*?)<\/\1>/gi, (_, tag, content) => {
        const normalizedTag = tag.toLowerCase();
        return placeholder(`<${normalizedTag}>${renderInline(content)}</${normalizedTag}>`);
    });
    let text = escapeHtml(inlineHtml);
    text = text.replace(/\$([^$\n]+)\$/g, (_, latex) => placeholder(
        `<span data-math-inline data-latex="${escapeAttribute(latex)}"></span>`
    ));
    text = text.replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+["']([^"']*)["'])?\)/g, (_, alt, url, title) => {
        const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : '';
        return placeholder(`<img src="${escapeAttribute(url)}" alt="${escapeAttribute(alt)}"${titleAttribute}>`);
    });
    text = text.replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+["']([^"']*)["'])?\)/g, (_, label, url, title) => {
        const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : '';
        return placeholder(`<a href="${escapeAttribute(url)}"${titleAttribute}>${label}</a>`);
    });
    text = text.replace(/`([^`]+)`/g, (_, code) => placeholder(`<code>${escapeHtml(code)}</code>`));
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    text = text.replace(/_([^_]+)_/g, '<em>$1</em>');

    return text.replace(/\u0000MATH_(\d+)\u0000/g, (_, index) => placeholders[Number(index)]);
}

function isRawHtmlBlock(line) {
    return /^\s*<(?:div|p|figure|img|table|details|aside|section|hr)\b/i.test(line);
}

function splitTableCells(line) {
    const source = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    return source.split('|').map((cell) => cell.trim().replaceAll('\\|', '|'));
}

function isTableStart(lines, index) {
    if (index + 1 >= lines.length || !lines[index].includes('|')) return false;
    const header = splitTableCells(lines[index]);
    const divider = splitTableCells(lines[index + 1]);
    return header.length > 1 && divider.length === header.length && divider.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function renderTableRow(cells, tag) {
    return `<tr>${cells.map((cell) => `<${tag}>${renderInline(cell)}</${tag}>`).join('')}</tr>`;
}

export function markdownToHtml(markdown) {
    const lines = String(markdown || '').replaceAll('\r\n', '\n').split('\n');
    const blocks = [];
    let index = 0;

    while (index < lines.length) {
        const line = lines[index];
        const trimmed = line.trim();
        if (!trimmed) {
            index += 1;
            continue;
        }

        if (isRawHtmlBlock(line)) {
            const rawLines = [line];
            index += 1;
            while (index < lines.length && lines[index].trim()) {
                rawLines.push(lines[index]);
                index += 1;
            }
            blocks.push(rawLines.join('\n'));
            continue;
        }

        const singleMath = trimmed.match(/^\$\$(.+)\$\$$/);
        if (trimmed === '$$' || singleMath) {
            let latex;
            if (singleMath) {
                latex = singleMath[1];
                index += 1;
            } else {
                const mathLines = [];
                index += 1;
                while (index < lines.length && lines[index].trim() !== '$$') {
                    mathLines.push(lines[index]);
                    index += 1;
                }
                latex = mathLines.join('\n');
                if (index < lines.length) index += 1;
            }
            blocks.push(`<div data-math-block data-latex="${escapeAttribute(latex)}"></div>`);
            continue;
        }

        const fenceMatch = trimmed.match(/^```([\w-]*)$/);
        if (fenceMatch) {
            const language = fenceMatch[1];
            const codeLines = [];
            index += 1;
            while (index < lines.length && lines[index].trim() !== '```') {
                codeLines.push(lines[index]);
                index += 1;
            }
            if (index < lines.length) index += 1;
            const classAttribute = language ? ` class="language-${escapeAttribute(language)}"` : '';
            blocks.push(`<pre><code${classAttribute}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
            continue;
        }

        if (isTableStart(lines, index)) {
            const headers = splitTableCells(lines[index]);
            index += 2;
            const rows = [];
            while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
                const cells = splitTableCells(lines[index]);
                if (cells.length !== headers.length) break;
                rows.push(renderTableRow(cells, 'td'));
                index += 1;
            }
            blocks.push(`<table><tbody>${renderTableRow(headers, 'th')}${rows.join('')}</tbody></table>`);
            continue;
        }

        const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            const level = Math.min(3, headingMatch[1].length);
            blocks.push(`<h${level}>${renderInline(headingMatch[2])}</h${level}>`);
            index += 1;
            continue;
        }

        if (/^>\s?/.test(trimmed)) {
            const quoteLines = [];
            while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
                quoteLines.push(lines[index].trim().replace(/^>\s?/, ''));
                index += 1;
            }
            blocks.push(`<blockquote>${quoteLines.map(renderInline).join('<br>')}</blockquote>`);
            continue;
        }

        const taskMatch = trimmed.match(/^[-*+]\s+\[([ xX])\]\s*(.*)$/);
        if (taskMatch) {
            const items = [];
            while (index < lines.length) {
                const match = lines[index].trim().match(/^[-*+]\s+\[([ xX])\]\s*(.*)$/);
                if (!match) break;
                const checked = match[1].toLowerCase() === 'x';
                items.push(`<li data-type="taskItem" data-checked="${checked}"><p>${renderInline(match[2])}</p></li>`);
                index += 1;
            }
            blocks.push(`<ul data-type="taskList">${items.join('')}</ul>`);
            continue;
        }

        const orderedMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);
        const unorderedMatch = trimmed.match(/^[-*+]\s+(.+)$/);
        if (orderedMatch || unorderedMatch) {
            const ordered = Boolean(orderedMatch);
            const items = [];
            const itemPattern = ordered ? /^\d+[.)]\s+(.+)$/ : /^[-*+]\s+(.+)$/;
            while (index < lines.length) {
                const match = lines[index].trim().match(itemPattern);
                if (!match) break;
                items.push(`<li>${renderInline(match[1])}</li>`);
                index += 1;
            }
            const tag = ordered ? 'ol' : 'ul';
            blocks.push(`<${tag}>${items.join('')}</${tag}>`);
            continue;
        }

        const paragraphLines = [trimmed];
        index += 1;
        while (index < lines.length && lines[index].trim()) {
            const nextLine = lines[index].trim();
            if (/^(#{1,6})\s+/.test(nextLine) || /^>\s?/.test(nextLine) || /^```/.test(nextLine) || /^\$\$/.test(nextLine) || /^\d+[.)]\s+/.test(nextLine) || /^[-*+]\s+/.test(nextLine) || isTableStart(lines, index) || isRawHtmlBlock(nextLine)) {
                break;
            }
            paragraphLines.push(nextLine);
            index += 1;
        }
        blocks.push(`<p>${paragraphLines.map(renderInline).join('<br>')}</p>`);
    }

    return blocks.join('\n\n');
}

function inlineToMarkdown(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    if (node.matches('[data-math-inline]')) return `$${node.dataset.latex || ''}$`;
    if (node.tagName === 'BR') return '\n';
    if (node.tagName === 'CODE') return `\`${node.textContent || ''}\``;
    if (node.tagName === 'STRONG' || node.tagName === 'B') return `**${childrenToMarkdown(node)}**`;
    if (node.tagName === 'EM' || node.tagName === 'I') return `*${childrenToMarkdown(node)}*`;
    if (node.tagName === 'U') return `<u>${childrenToMarkdown(node)}</u>`;
    if (node.tagName === 'MARK') return `<mark>${childrenToMarkdown(node)}</mark>`;
    if (node.tagName === 'S' || node.tagName === 'DEL') return `<s>${childrenToMarkdown(node)}</s>`;
    if (node.tagName === 'A') return `[${childrenToMarkdown(node)}](${node.getAttribute('href') || ''})`;
    if (node.tagName === 'IMG') return `![${node.getAttribute('alt') || ''}](${node.getAttribute('src') || ''})`;
    return childrenToMarkdown(node);
}

function childrenToMarkdown(node) {
    return [...node.childNodes].map(inlineToMarkdown).join('');
}

function blockToMarkdown(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue.trim();
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    if (node.matches('[data-math-block]')) return `$$\n${node.dataset.latex || ''}\n$$`;

    const tag = node.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag.slice(1)))} ${childrenToMarkdown(node)}`;
    if (tag === 'p') return childrenToMarkdown(node).trim();
    if (tag === 'blockquote') return childrenToMarkdown(node).split('\n').map((line) => `> ${line}`).join('\n');
    if (tag === 'pre') return `\`\`\`\n${node.textContent || ''}\n\`\`\``;
    if (tag === 'ul' || tag === 'ol') {
        if (node.dataset.type === 'taskList') {
            return [...node.children].map((item) => {
                const checked = item.getAttribute('data-checked') === 'true' || item.querySelector('input[type="checkbox"]')?.checked;
                const content = item.querySelector(':scope > div') || item;
                return `- [${checked ? 'x' : ' '}] ${childrenToMarkdown(content).trim()}`;
            }).join('\n');
        }
        return [...node.children].map((item, itemIndex) => {
            const marker = tag === 'ol' ? `${itemIndex + 1}.` : '-';
            return `${marker} ${childrenToMarkdown(item).trim()}`;
        }).join('\n');
    }
    if (tag === 'table') {
        const rows = [...node.querySelectorAll(':scope > tbody > tr, :scope > tr')];
        if (!rows.length) return '';
        const getCells = (row) => [...row.children].map((cell) => childrenToMarkdown(cell).trim().replaceAll('|', '\\|'));
        const headerCells = getCells(rows[0]);
        const bodyRows = rows.slice(1).map(getCells);
        return [
            `| ${headerCells.join(' | ')} |`,
            `| ${headerCells.map(() => '---').join(' | ')} |`,
            ...bodyRows.map((cells) => `| ${cells.join(' | ')} |`)
        ].join('\n');
    }
    if (tag === 'details' || node.dataset.type === 'details') return node.outerHTML;
    if (tag === 'hr') return '---';
    if (tag === 'div' && node.dataset.htmlBlock) return node.dataset.htmlBlock;
    if (tag === 'div' || tag === 'section' || tag === 'aside' || tag === 'figure') return node.outerHTML;
    return childrenToMarkdown(node).trim();
}

export function htmlToMarkdown(html) {
    const container = document.createElement('div');
    container.innerHTML = html || '';
    return [...container.childNodes]
        .map(blockToMarkdown)
        .map((value) => value.trim())
        .filter(Boolean)
        .join('\n\n');
}

export function renderMathInElement(container) {
    container.querySelectorAll('[data-math-inline], [data-math-block]').forEach((element) => {
        const displayMode = element.hasAttribute('data-math-block');
        const latex = element.dataset.latex || '';
        try {
            element.innerHTML = renderMath(latex, displayMode);
            element.classList.add(displayMode ? 'math-block' : 'math-inline');
        } catch (error) {
            element.textContent = latex;
            element.classList.add('math-error');
        }
    });
}

export { escapeHtml, renderMath };
