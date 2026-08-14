const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content', 'posts');
const OUTPUT_DIR = path.join(ROOT, 'posts');
const TEMPLATE_PATH = path.join(ROOT, 'templates', 'post.html');
const INDEX_TEMPLATE_PATH = path.join(ROOT, 'templates', 'index.html');
const INDEX_OUTPUT_PATH = path.join(ROOT, 'index.html');

let katex;
try {
  katex = require('katex');
} catch {
  katex = null;
}

const REQUIRED_FIELDS = [
  'slug',
  'title',
  'description',
  'date',
  'category',
  'categoryLabel',
  'cover',
  'readTime',
  'author',
  'published'
];

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

function parseScalar(rawValue) {
  const value = rawValue.trim();

  if (value.startsWith('"') && value.endsWith('"')) {
    return JSON.parse(value);
  }

  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'");
  }

  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);

  return value;
}

function parseFrontmatter(source, fileName) {
  const lines = source.replaceAll('\r\n', '\n').split('\n');

  if (lines[0] !== '---') {
    throw new Error(`${fileName}: missing frontmatter opening marker`);
  }

  const endIndex = lines.indexOf('---', 1);
  if (endIndex === -1) {
    throw new Error(`${fileName}: missing frontmatter closing marker`);
  }

  const metadata = {};
  for (const line of lines.slice(1, endIndex)) {
    if (!line.trim()) continue;

    const separator = line.indexOf(':');
    if (separator === -1) {
      throw new Error(`${fileName}: invalid frontmatter line: ${line}`);
    }

    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1);
    metadata[key] = parseScalar(rawValue);
  }

  for (const field of REQUIRED_FIELDS) {
    if (!(field in metadata) || metadata[field] === '') {
      throw new Error(`${fileName}: missing required frontmatter field: ${field}`);
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(metadata.date))) {
    throw new Error(`${fileName}: date must use YYYY-MM-DD`);
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(metadata.slug))) {
    throw new Error(`${fileName}: slug must be lowercase kebab-case`);
  }

  if (typeof metadata.published !== 'boolean') {
    throw new Error(`${fileName}: published must be true or false`);
  }

  if (metadata.fontSize !== undefined && !['small', 'medium', 'large'].includes(metadata.fontSize)) {
    throw new Error(`${fileName}: fontSize must be small, medium or large`);
  }

  return {
    metadata,
    body: lines.slice(endIndex + 1).join('\n').trim()
  };
}

function escapeCode(value) {
  return escapeHtml(value);
}

function renderMath(latex, displayMode) {
  const source = String(latex).trim();
  if (katex) {
    return katex.renderToString(source, {
      displayMode,
      throwOnError: false,
      strict: 'ignore'
    });
  }

  const className = displayMode ? 'math-block' : 'math-inline';
  return `<span class="${className}" data-latex="${escapeAttribute(source)}">${escapeHtml(source)}</span>`;
}

function renderInline(source) {
  const placeholders = [];
  const placeholder = (html) => {
    const token = `\u0000${placeholders.length}\u0000`;
    placeholders.push(html);
    return token;
  };

  const inlineHtml = String(source).replace(/<(u|mark|s)>([\s\S]*?)<\/\1>/gi, (_, tag, content) => {
    const normalizedTag = tag.toLowerCase();
    return placeholder(`<${normalizedTag}>${renderInline(content)}</${normalizedTag}>`);
  });
  let text = escapeHtml(inlineHtml);

  text = text.replace(/\$([^$\n]+)\$/g, (_, latex) => placeholder(renderMath(latex, false)));

  text = text.replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+["']([^"']*)["'])?\)/g, (_, alt, url, title) => {
    const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : '';
    return placeholder(`<img src="${escapeAttribute(url)}" alt="${escapeAttribute(alt)}"${titleAttribute}>`);
  });

  text = text.replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+["']([^"']*)["'])?\)/g, (_, label, url, title) => {
    const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : '';
    return placeholder(`<a href="${escapeAttribute(url)}"${titleAttribute}>${label}</a>`);
  });

  text = text.replace(/`([^`]+)`/g, (_, code) => placeholder(`<code>${escapeCode(code)}</code>`));
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  text = text.replace(/_([^_]+)_/g, '<em>$1</em>');

  return text.replace(/\u0000(\d+)\u0000/g, (_, index) => placeholders[Number(index)]);
}

function isRawHtmlBlock(line) {
  const trimmed = line.trim();
  return /^<(?:div|p|figure|img|table|details|aside|section|hr)\b/i.test(trimmed);
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

function renderMarkdown(markdown) {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
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

    if (trimmed === '$$') {
      const mathLines = [];
      index += 1;
      while (index < lines.length && lines[index].trim() !== '$$') {
        mathLines.push(lines[index]);
        index += 1;
      }
      if (index >= lines.length) {
        throw new Error('Unclosed math block');
      }
      index += 1;
      blocks.push(`<div class="math-block" data-latex="${escapeAttribute(mathLines.join('\n'))}">${renderMath(mathLines.join('\n'), true)}</div>`);
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
      if (index >= lines.length) {
        throw new Error('Unclosed fenced code block');
      }
      index += 1;
      const classAttribute = language ? ` class="language-${escapeAttribute(language)}"` : '';
      blocks.push(`<pre><code${classAttribute}>${escapeCode(codeLines.join('\n'))}</code></pre>`);
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
      const level = headingMatch[1].length;
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
        items.push(`<li data-type="taskItem" data-checked="${checked}"><input type="checkbox"${checked ? ' checked' : ''}>${renderInline(match[2])}</li>`);
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
      if (/^(#{1,6})\s+/.test(nextLine) || /^>\s?/.test(nextLine) || /^```/.test(nextLine) || /^\d+[.)]\s+/.test(nextLine) || /^[-*+]\s+/.test(nextLine) || isTableStart(lines, index) || isRawHtmlBlock(nextLine)) {
        break;
      }
      paragraphLines.push(nextLine);
      index += 1;
    }
    blocks.push(`<p>${paragraphLines.map(renderInline).join('<br>')}</p>`);
  }

  return blocks.join('\n\n');
}

function loadPosts() {
  const files = fs.readdirSync(CONTENT_DIR).filter((file) => file.endsWith('.md')).sort();
  if (files.length === 0) {
    throw new Error(`No Markdown posts found in ${path.relative(ROOT, CONTENT_DIR)}`);
  }

  const posts = files.map((file) => {
    const source = fs.readFileSync(path.join(CONTENT_DIR, file), 'utf8');
    const parsed = parseFrontmatter(source, file);
    if (path.basename(file, '.md') !== parsed.metadata.slug) {
      throw new Error(`${file}: filename must match slug`);
    }
    return parsed;
  });

  const slugs = new Set();
  for (const post of posts) {
    if (slugs.has(post.metadata.slug)) {
      throw new Error(`Duplicate slug: ${post.metadata.slug}`);
    }
    slugs.add(post.metadata.slug);
  }
  return posts;
}

function renderPost(template, post) {
  const metadata = post.metadata;
  const title = escapeHtml(metadata.title);
  const titleHtml = title.replaceAll('\n', '<br>');
  const coverPath = `../${String(metadata.cover).replace(/^\/+/, '')}`;
  const coverLoading = metadata.coverLoading ? ` loading="${escapeAttribute(metadata.coverLoading)}"` : '';
  const previousLink = metadata.previousUrl && metadata.previousLabel
    ? `<a href="${escapeAttribute(metadata.previousUrl)}">${escapeHtml(metadata.previousLabel)}</a>`
    : '';
  const nextLink = metadata.nextUrl && metadata.nextLabel
    ? `<a href="${escapeAttribute(metadata.nextUrl)}">${escapeHtml(metadata.nextLabel)}</a>`
    : '';

  const replacements = {
    '{{title}}': title.replaceAll('\n', ' '),
    '{{titleHtml}}': titleHtml,
    '{{description}}': escapeAttribute(metadata.description),
    '{{kicker}}': escapeHtml(metadata.kicker || metadata.categoryLabel),
    '{{deck}}': escapeHtml(metadata.deck || metadata.description),
    '{{date}}': escapeHtml(metadata.date),
    '{{readTime}}': escapeHtml(metadata.readTime),
    '{{author}}': escapeHtml(metadata.author),
    '{{coverPath}}': escapeAttribute(coverPath),
    '{{coverAlt}}': escapeAttribute(metadata.coverAlt || metadata.title),
    '{{coverLoading}}': coverLoading,
    '{{coverCaption}}': escapeHtml(metadata.coverCaption || ''),
    '{{fontClass}}': metadata.fontSize && metadata.fontSize !== 'medium' ? ` post-font-${metadata.fontSize}` : '',
    '{{content}}': renderMarkdown(post.body),
    '{{previousLink}}': previousLink,
    '{{nextLink}}': nextLink
  };

  return Object.entries(replacements).reduce((output, [token, value]) => output.replaceAll(token, value), template);
}

function renderBlogCard(post) {
  const metadata = post.metadata;
  const coverPath = String(metadata.cover).replace(/^\/+/, '');
  return `                <article class="blog-card" data-category="${escapeAttribute(metadata.category)}">
                    <div class="blog-image"><img class="blog-cover" src="${escapeAttribute(coverPath)}" alt="${escapeAttribute(metadata.coverAlt || metadata.title)}" loading="lazy"></div>
                    <div class="blog-content">
                        <div class="blog-meta"><span class="blog-category" data-category="${escapeAttribute(metadata.category)}">${escapeHtml(metadata.categoryLabel)}</span><span class="blog-date">${escapeHtml(metadata.date)}</span></div>
                        <h3 class="blog-title">${escapeHtml(metadata.title).replaceAll('\n', ' ')}</h3>
                        <p class="blog-excerpt">${escapeHtml(metadata.cardExcerpt || metadata.description)}</p>
                        <div class="blog-footer"><span class="read-time">${escapeHtml(metadata.readTime)} 分钟阅读</span><a href="posts/${escapeAttribute(metadata.slug)}.html" class="read-more">阅读全文 <span aria-hidden="true">→</span></a></div>
                    </div>
                </article>`;
}

function renderIndex(template, posts) {
  const publicPosts = posts
    .filter((post) => post.metadata.published)
    .sort((left, right) => String(right.metadata.date).localeCompare(String(left.metadata.date)));
  const cards = publicPosts.map(renderBlogCard).join('\n\n');
  const marker = /<!-- BLOG_POSTS_START -->[\s\S]*?<!-- BLOG_POSTS_END -->/;

  if (!marker.test(template)) {
    throw new Error('templates/index.html: missing BLOG_POSTS_START/BLOG_POSTS_END markers');
  }

  return template.replace(marker, `<!-- BLOG_POSTS_START -->\n${cards}\n                <!-- BLOG_POSTS_END -->`);
}

function main() {
  fs.mkdirSync(CONTENT_DIR, { recursive: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const indexTemplate = fs.readFileSync(INDEX_TEMPLATE_PATH, 'utf8');
  const posts = loadPosts();

  for (const file of fs.readdirSync(OUTPUT_DIR)) {
    if (file.endsWith('.html')) {
      fs.unlinkSync(path.join(OUTPUT_DIR, file));
    }
  }

  for (const post of posts.filter((item) => item.metadata.published)) {
    const outputPath = path.join(OUTPUT_DIR, `${post.metadata.slug}.html`);
    fs.writeFileSync(outputPath, renderPost(template, post));
  }

  fs.writeFileSync(INDEX_OUTPUT_PATH, renderIndex(indexTemplate, posts));

  const publicPostCount = posts.filter((post) => post.metadata.published).length;
  console.log(`Built ${posts.length} post(s) and ${publicPostCount} homepage card(s) from ${path.relative(ROOT, CONTENT_DIR)}/`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Build failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  REQUIRED_FIELDS,
  escapeHtml,
  loadPosts,
  parseFrontmatter,
  renderMarkdown
};
