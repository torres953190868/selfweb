import { Editor, Mark as TiptapMark, Node as TiptapNode, mergeAttributes } from '@tiptap/core';
import { Details } from '@tiptap/extension-details';
import { Table } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableRow } from '@tiptap/extension-table-row';
import { TaskItem } from '@tiptap/extension-task-item';
import { TaskList } from '@tiptap/extension-task-list';
import StarterKit from '@tiptap/starter-kit';
import {
    escapeHtml,
    htmlToMarkdown,
    markdownToHtml,
    renderMath,
    renderMathInElement
} from './markdown.js';

const DEFAULT_COVER = '/assets/blog/ai-understanding-cover.png';
const CATEGORY_LABELS = {
    building: '构建',
    thinking: '思考',
    practice: '实践',
    essay: '随笔'
};
const BLOCK_TYPES = new Set([
    'paragraph',
    'heading',
    'blockquote',
    'bulletList',
    'orderedList',
    'taskList',
    'codeBlock',
    'mathBlock',
    'details',
    'table',
    'horizontalRule',
    'highlightBlock'
]);

const titleInput = document.getElementById('editor-title');
const descriptionInput = document.getElementById('editor-description');
const slugInput = document.getElementById('editor-slug');
const dateInput = document.getElementById('editor-date');
const categoryInput = document.getElementById('editor-category');
const editorCanvas = document.getElementById('editor-canvas');
const statusElement = document.getElementById('editor-status');
const blockFormat = document.getElementById('block-format');
const saveButton = document.getElementById('save-button');
const previewButton = document.getElementById('preview-button');
const publishButton = document.getElementById('publish-button');
const insertMathButton = document.getElementById('insert-math-button');
const previewPanel = document.getElementById('preview-panel');
const closePreviewButton = document.getElementById('close-preview-button');
const previewContent = document.getElementById('preview-content');
const selectionMenu = document.getElementById('selection-menu');
const selectionMenuCard = selectionMenu?.querySelector('.selection-menu-card');
const selectionConvertMenu = document.getElementById('selection-convert-menu');
const selectionBlockTrigger = document.getElementById('selection-block-trigger');
const selectionBlockLabel = document.getElementById('selection-block-label');
const selectionAiForm = document.getElementById('selection-ai-form');
const selectionAiInput = document.getElementById('selection-ai-input');
const slashMenu = document.getElementById('slash-menu');
const slashMenuList = document.getElementById('slash-menu-list');
const slashMenuEmpty = document.getElementById('slash-menu-empty');
const slashMenuHint = document.getElementById('slash-menu-hint');
const diffPanel = document.getElementById('diff-panel');
const diffOriginal = document.getElementById('diff-original');
const diffReplacement = document.getElementById('diff-replacement');
const acceptAiButton = document.getElementById('accept-ai-button');
const rejectAiButton = document.getElementById('reject-ai-button');
const agentInstruction = document.getElementById('agent-instruction');
const agentRunButton = document.getElementById('agent-run-button');
const agentResult = document.getElementById('agent-result');
const editorLayout = document.querySelector('.editor-layout');
const agentRail = document.querySelector('.editor-agent-rail');
const agentPanel = document.getElementById('agent-panel');
const agentToggleButton = document.getElementById('agent-toggle-button');
const agentToggleLabel = agentToggleButton?.querySelector('.agent-panel-toggle-label');
const agentReopenButton = document.getElementById('agent-reopen-button');
const agentReopenRow = document.getElementById('agent-reopen-row');
const postList = document.getElementById('post-list');
const newPostButton = document.getElementById('new-post-button');
const loginButton = document.getElementById('login-button');
const loginDialog = document.getElementById('login-dialog');
const loginForm = document.getElementById('login-form');
const loginPassword = document.getElementById('login-password');
const loginError = document.getElementById('login-error');
const closeLoginButton = document.getElementById('close-login-button');

let editor;
let currentPost = null;
let posts = [];
let isDirty = false;
let isHydrating = false;
let isEnsuringBlockIds = false;
let autoSaveTimer = null;
let selectionSnapshot = null;
let slashMenuState = null;

const AGENT_PANEL_STORAGE_KEY = 'selfweb.editor.agent.collapsed';

function setAgentPanelCollapsed(collapsed, persist = true) {
    if (!agentPanel || !agentToggleButton) return;
    agentPanel.classList.toggle('is-collapsed', collapsed);
    editorLayout?.classList.toggle('agent-collapsed', collapsed);
    if (agentRail) agentRail.hidden = collapsed;
    agentPanel.hidden = collapsed;
    if (agentReopenRow) agentReopenRow.hidden = !collapsed;
    if (agentReopenButton) {
        agentReopenButton.hidden = !collapsed;
        agentReopenButton.setAttribute('aria-expanded', String(collapsed));
    }
    agentToggleButton.setAttribute('aria-expanded', String(!collapsed));
    agentToggleButton.setAttribute('aria-label', collapsed ? '展开 Writing Agent' : '折叠 Writing Agent');
    if (agentToggleLabel) agentToggleLabel.textContent = collapsed ? '展开' : '收起';
    if (!persist) return;
    try {
        window.localStorage.setItem(AGENT_PANEL_STORAGE_KEY, String(collapsed));
    } catch {
        // localStorage may be unavailable in private or restricted browsing contexts.
    }
}

function restoreAgentPanelState() {
    let collapsed = false;
    try {
        collapsed = window.localStorage.getItem(AGENT_PANEL_STORAGE_KEY) === 'true';
    } catch {
        // Keep the panel expanded when localStorage is unavailable.
    }
    setAgentPanelCollapsed(collapsed, false);
}

function createBlockId() {
    const suffix = window.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 8)
        || Math.random().toString(36).slice(2, 10);
    return `block_${suffix}`;
}

const BlockIds = TiptapNode.create({
    name: 'blockIds',
    addGlobalAttributes() {
        return [{
            types: [...BLOCK_TYPES],
            attributes: {
                blockId: {
                    default: null,
                    parseHTML: (element) => element.getAttribute('data-block-id'),
                    renderHTML: (attributes) => attributes.blockId
                        ? { 'data-block-id': attributes.blockId }
                        : {}
                }
            }
        }];
    }
});

function createMathExtension(name, tag, displayMode) {
    return TiptapNode.create({
        name,
        group: displayMode ? 'block' : 'inline',
        inline: !displayMode,
        atom: true,
        selectable: true,
        isolating: displayMode,
        addAttributes() {
            return { latex: { default: '' } };
        },
        parseHTML() {
            return [{ tag }];
        },
        renderHTML({ HTMLAttributes }) {
            const attributeName = displayMode ? 'data-math-block' : 'data-math-inline';
            return [displayMode ? 'div' : 'span', mergeAttributes(HTMLAttributes, {
                [attributeName]: '',
                'data-latex': HTMLAttributes.latex || ''
            })];
        },
        addNodeView() {
            return ({ node, getPos, editor: nodeEditor }) => {
                const dom = document.createElement(displayMode ? 'div' : 'span');
                dom.className = displayMode ? 'math-node math-block' : 'math-node math-inline';
                if (displayMode) dom.dataset.mathBlock = '';
                else dom.dataset.mathInline = '';
                dom.dataset.latex = node.attrs.latex || '';
                dom.contentEditable = 'false';

                const render = (latex) => {
                    dom.dataset.latex = latex;
                    try {
                        dom.innerHTML = renderMath(latex, displayMode);
                    } catch {
                        dom.textContent = latex;
                        dom.classList.add('math-error');
                    }
                };

                render(node.attrs.latex || '');
                dom.addEventListener('dblclick', () => {
                    const nextLatex = window.prompt('编辑 LaTeX 公式', node.attrs.latex || '');
                    if (nextLatex === null || !nextLatex.trim() || typeof getPos !== 'function') return;
                    nodeEditor.commands.command(({ tr }) => {
                        tr.setNodeMarkup(getPos(), undefined, { latex: nextLatex.trim() });
                        return true;
                    });
                });

                return {
                    dom,
                    update(updatedNode) {
                        if (updatedNode.type.name !== name) return false;
                        render(updatedNode.attrs.latex || '');
                        return true;
                    }
                };
            };
        }
    });
}

const MathInline = createMathExtension('mathInline', 'span[data-math-inline]', false);
const MathBlock = createMathExtension('mathBlock', 'div[data-math-block]', true);

const Underline = TiptapMark.create({
    name: 'underline',
    parseHTML() {
        return [{ tag: 'u' }];
    },
    renderHTML({ HTMLAttributes }) {
        return ['u', mergeAttributes(HTMLAttributes), 0];
    },
    addCommands() {
        return {
            toggleUnderline: () => ({ commands }) => commands.toggleMark(this.name)
        };
    }
});

const Highlight = TiptapMark.create({
    name: 'highlight',
    parseHTML() {
        return [{ tag: 'mark' }];
    },
    renderHTML({ HTMLAttributes }) {
        return ['mark', mergeAttributes(HTMLAttributes), 0];
    },
    addCommands() {
        return {
            toggleHighlight: () => ({ commands }) => commands.toggleMark(this.name)
        };
    }
});

const LinkMark = TiptapMark.create({
    name: 'link',
    inclusive: false,
    addAttributes() {
        return {
            href: { default: null },
            title: { default: null }
        };
    },
    parseHTML() {
        return [{ tag: 'a[href]' }];
    },
    renderHTML({ HTMLAttributes }) {
        return ['a', mergeAttributes(HTMLAttributes, {
            rel: 'noreferrer noopener',
            target: '_blank'
        }), 0];
    },
    addCommands() {
        return {
            setLink: (attributes) => ({ commands }) => commands.setMark(this.name, attributes),
            unsetLink: () => ({ commands }) => commands.unsetMark(this.name)
        };
    }
});

const HighlightBlock = TiptapNode.create({
    name: 'highlightBlock',
    group: 'block',
    content: 'inline*',
    defining: true,
    parseHTML() {
        return [{ tag: 'div[data-type="highlightBlock"]' }];
    },
    renderHTML({ HTMLAttributes }) {
        return ['div', mergeAttributes(HTMLAttributes, {
            'data-type': 'highlightBlock',
            class: 'editor-highlight-block'
        }), 0];
    }
});

// Tiptap 2's Details extension expects these two companion nodes. They are
// intentionally small so Toggle blocks remain regular, serializable document
// nodes instead of being managed by direct DOM mutations.
const DetailsSummary = TiptapNode.create({
    name: 'detailsSummary',
    group: 'block',
    content: 'inline*',
    defining: true,
    parseHTML() {
        return [
            { tag: 'summary' },
            { tag: 'div[data-type="detailsSummary"]' }
        ];
    },
    renderHTML({ HTMLAttributes }) {
        return ['summary', mergeAttributes(HTMLAttributes, { 'data-type': 'detailsSummary' }), 0];
    }
});

const DetailsContent = TiptapNode.create({
    name: 'detailsContent',
    group: 'block',
    content: 'block+',
    defining: true,
    parseHTML() {
        return [{ tag: 'div[data-type="detailsContent"]' }];
    },
    renderHTML({ HTMLAttributes }) {
        return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'detailsContent' }), 0];
    }
});

const SLASH_MENU_WIDTH = 348;
const SLASH_MENU_MARGIN = 12;

const SLASH_COMMANDS = [
    {
        id: 'paragraph',
        icon: '¶',
        label: '普通文本',
        hint: 'Plain paragraph',
        shortcut: 'text',
        aliases: ['text', 'paragraph', 'plain', 'body', '正文'],
        run: (currentEditor, range) => currentEditor.chain().focus().deleteRange(range).setParagraph().run()
    },
    {
        id: 'heading-1',
        icon: 'H1',
        label: '一级标题',
        hint: 'Large section title',
        shortcut: '#',
        aliases: ['heading', 'head', 'h1', 'title', 'header 1', '标题'],
        run: (currentEditor, range) => currentEditor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run()
    },
    {
        id: 'heading-2',
        icon: 'H2',
        label: '二级标题',
        hint: 'Medium section title',
        shortcut: '##',
        aliases: ['heading', 'head', 'h2', 'subtitle', 'header 2', '标题'],
        run: (currentEditor, range) => currentEditor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run()
    },
    {
        id: 'heading-3',
        icon: 'H3',
        label: '三级标题',
        hint: 'Small section title',
        shortcut: '###',
        aliases: ['heading', 'head', 'h3', 'subheading', 'header 3', '标题'],
        run: (currentEditor, range) => currentEditor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run()
    },
    {
        id: 'bullet-list',
        icon: '•',
        label: '无序列表',
        hint: 'Simple unordered list',
        shortcut: '-',
        aliases: ['bullet', 'bulleted', 'ul', 'unordered', 'list', '列表'],
        run: (currentEditor, range) => currentEditor.chain().focus().deleteRange(range).toggleBulletList().run()
    },
    {
        id: 'ordered-list',
        icon: '1.',
        label: '有序列表',
        hint: 'Numbered ordered list',
        shortcut: '1.',
        aliases: ['number', 'numbered', 'ordered', 'ol', 'list', '列表'],
        run: (currentEditor, range) => currentEditor.chain().focus().deleteRange(range).toggleOrderedList().run()
    },
    {
        id: 'task-list',
        icon: '☑',
        label: '待办清单',
        hint: 'Track tasks with checkboxes',
        shortcut: '[]',
        aliases: ['todo', 'to-do', 'task', 'tasks', 'checkbox', 'checklist', '待办', '清单'],
        run: (currentEditor, range) => currentEditor.chain().focus().deleteRange(range).toggleTaskList().run()
    },
    {
        id: 'toggle',
        icon: '▸',
        label: '可折叠 Toggle 区块',
        hint: 'Collapsible note section',
        shortcut: '>',
        aliases: ['toggle', 'fold', 'details', 'collapse', '折叠', '区块'],
        run: (currentEditor, range) => currentEditor.chain().focus().deleteRange(range).setDetails().run()
    },
    {
        id: 'blockquote',
        icon: '“',
        label: '引用',
        hint: 'Call out a note or citation',
        shortcut: '"',
        aliases: ['quote', 'blockquote', 'citation', '引用'],
        run: (currentEditor, range) => currentEditor.chain().focus().deleteRange(range).toggleBlockquote().run()
    },
    {
        id: 'code-block',
        icon: '</>',
        label: '代码块',
        hint: 'Preformatted code',
        shortcut: '```',
        aliases: ['code', 'pre', 'fenced', '代码'],
        run: (currentEditor, range) => currentEditor.chain().focus().deleteRange(range).toggleCodeBlock().run()
    },
    {
        id: 'math-block',
        icon: '∑',
        label: '数学公式（LaTeX）',
        hint: 'Display a LaTeX equation',
        shortcut: '$$',
        aliases: ['math', 'formula', 'equation', 'latex', '数学', '公式'],
        run: (currentEditor, range) => openMathPrompt(range)
    },
    {
        id: 'horizontal-rule',
        icon: '—',
        label: '分隔线',
        hint: 'Horizontal separator',
        shortcut: '---',
        aliases: ['divider', 'separator', 'hr', 'rule', '分隔'],
        run: (currentEditor, range) => currentEditor.chain().focus().deleteRange(range).setHorizontalRule().run()
    },
    {
        id: 'table',
        icon: '▦',
        label: '3×3 表格',
        hint: 'Insert a 3 × 3 table',
        shortcut: '3×3',
        aliases: ['table', 'grid', 'rows', 'columns', '表格'],
        run: (currentEditor, range) => currentEditor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
    }
];

function ensureBlockIds() {
    if (!editor || isEnsuringBlockIds) return;
    let transaction = editor.state.tr;
    let changed = false;
    editor.state.doc.descendants((node, position) => {
        if (!node.isBlock || !BLOCK_TYPES.has(node.type.name) || node.attrs.blockId) return;
        transaction = transaction.setNodeMarkup(position, undefined, {
            ...node.attrs,
            blockId: createBlockId()
        });
        changed = true;
    });
    if (!changed) return;
    isEnsuringBlockIds = true;
    transaction.setMeta('addToHistory', false);
    editor.view.dispatch(transaction);
    isEnsuringBlockIds = false;
}

function setStatus(message, kind = '') {
    statusElement.textContent = message;
    statusElement.classList.toggle('is-saved', kind === 'saved');
    statusElement.classList.toggle('is-error', kind === 'error');
}

function markDirty() {
    if (isHydrating) return;
    isDirty = true;
    setStatus('未保存');
    window.clearTimeout(autoSaveTimer);
    autoSaveTimer = window.setTimeout(() => saveDraft(true), 2000);
}

function today() {
    return new Date().toISOString().slice(0, 10);
}

function getMetadata() {
    return {
        slug: slugInput.value.trim(),
        title: titleInput.value,
        description: descriptionInput.value.trim(),
        date: dateInput.value || today(),
        category: categoryInput.value,
        categoryLabel: CATEGORY_LABELS[categoryInput.value] || '随笔',
        cover: currentPost?.cover || DEFAULT_COVER,
        coverAlt: currentPost?.coverAlt || titleInput.value.trim() || 'Hongyu 的文章封面',
        readTime: currentPost?.readTime || 5,
        author: currentPost?.author || 'Hongyu',
        published: true
    };
}

function draftStorageKey(slug = slugInput.value.trim() || 'new-post') {
    return `selfweb.editor.draft.${slug}`;
}

function getMarkdownBody() {
    return htmlToMarkdown(editor.getHTML()).trim();
}

function saveDraft(isAutoSave = false) {
    try {
        const metadata = getMetadata();
        localStorage.setItem(draftStorageKey(metadata.slug), JSON.stringify({
            metadata,
            body: getMarkdownBody(),
            updatedAt: new Date().toISOString()
        }));
        isDirty = false;
        setStatus(isAutoSave ? '已保存' : '已保存', 'saved');
        return true;
    } catch (error) {
        console.error('保存草稿失败', error);
        setStatus('保存失败：浏览器存储不可用', 'error');
        return false;
    }
}

function loadDraft(slug) {
    try {
        const raw = localStorage.getItem(draftStorageKey(slug));
        if (!raw) return null;
        const draft = JSON.parse(raw);
        if (!draft || !draft.metadata) return null;
        return draft;
    } catch (error) {
        console.error('读取草稿失败', error);
        setStatus('读取草稿失败', 'error');
        return null;
    }
}

function applyMetadata(metadata) {
    const source = metadata || {};
    slugInput.value = source.slug || '';
    titleInput.value = source.title || '';
    descriptionInput.value = source.description || '';
    dateInput.value = source.date || today();
    categoryInput.value = source.category || 'essay';
}

function hydratePost(post, source = 'server') {
    isHydrating = true;
    currentPost = { ...(post.metadata || post), body: post.body || '' };
    applyMetadata(currentPost);
    editor.commands.setContent(markdownToHtml(currentPost.body), false);
    ensureBlockIds();
    isHydrating = false;
    isDirty = false;
    diffPanel.hidden = true;
    setStatus(source === 'draft' ? '存在未发布的修改' : '已载入文章', source === 'draft' ? '' : 'saved');
    updateActivePostLink();
}

function createNewPost() {
    isHydrating = true;
    currentPost = {
        slug: '',
        title: '',
        description: '',
        date: today(),
        category: 'essay',
        categoryLabel: '随笔',
        cover: DEFAULT_COVER,
        coverAlt: 'Hongyu 的文章封面',
        readTime: 5,
        author: 'Hongyu',
        body: ''
    };
    applyMetadata(currentPost);
    editor.commands.setContent('<p></p>', false);
    ensureBlockIds();
    isHydrating = false;
    isDirty = false;
    window.history.replaceState({}, '', 'admin.html');
    selectionMenu.hidden = true;
    hideSlashMenu();
    diffPanel.hidden = true;
    setStatus('新文章');
    updateActivePostLink();
    titleInput.focus();
}

async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options
    });
    let payload = null;
    try { payload = await response.json(); } catch { /* non-JSON response */ }
    if (!response.ok) {
        const error = new Error(payload?.error || `请求失败（${response.status}）`);
        error.status = response.status;
        throw error;
    }
    return payload;
}

async function loadPostList() {
    try {
        const payload = await fetchJson('/api/posts');
        posts = payload.posts || [];
        postList.innerHTML = posts.length ? posts.map((post) => `
            <a class="editor-post-link" data-slug="${escapeHtml(post.slug)}" href="admin.html?slug=${encodeURIComponent(post.slug)}">
                ${escapeHtml(String(post.title).replaceAll('\n', ' '))}
                <small>${escapeHtml(post.date)} · ${escapeHtml(post.categoryLabel || post.category)}</small>
            </a>`).join('') : '<span class="editor-list-loading">还没有已发布文章</span>';
        postList.querySelectorAll('[data-slug]').forEach((link) => link.addEventListener('click', async (event) => {
            event.preventDefault();
            await loadPost(link.dataset.slug);
        }));
        updateActivePostLink();
    } catch (error) {
        console.error('读取文章列表失败', error);
        postList.innerHTML = '<span class="editor-list-loading">文章列表读取失败，可继续编辑本地草稿。</span>';
        setStatus('读取文章失败', 'error');
    }
}

async function loadPost(slug) {
    if (isDirty && !window.confirm('当前有未保存的修改，确定切换文章吗？')) return;
    try {
        const payload = await fetchJson(`/api/posts/${encodeURIComponent(slug)}`);
        const draft = loadDraft(slug);
        hydratePost(draft ? { metadata: draft.metadata, body: draft.body } : payload.post, draft ? 'draft' : 'server');
        window.history.pushState({}, '', `admin.html?slug=${encodeURIComponent(slug)}`);
    } catch (error) {
        console.error('读取文章失败', error);
        setStatus(`读取文章失败：${error.message}`, 'error');
    }
}

function updateActivePostLink() {
    const slug = slugInput.value.trim();
    postList.querySelectorAll('[data-slug]').forEach((link) => link.classList.toggle('is-active', link.dataset.slug === slug));
}

function filterSlashCommands(query) {
    const terms = String(query || '')
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
    if (terms.length === 0) return SLASH_COMMANDS;

    return SLASH_COMMANDS.filter((command) => {
        const searchText = [command.label, command.hint, command.shortcut, ...command.aliases]
            .join(' ')
            .toLowerCase();
        return terms.every((term) => searchText.includes(term));
    });
}

function getSlashMenuState(previousState = slashMenuState) {
    if (!editor || !editor.isFocused) return null;
    const { selection } = editor.state;
    const { $from, empty, from } = selection;
    if (!empty || !$from.parent.isTextblock || $from.parent.type.name !== 'paragraph') return null;

    const textBeforeCursor = $from.parent.textBetween(0, $from.parentOffset, '\n', '\0');
    const currentLine = textBeforeCursor.slice(textBeforeCursor.lastIndexOf('\n') + 1);
    const match = currentLine.match(/^\/([^\/]*)$/);
    if (!match) return null;

    const query = match[1].trim().toLowerCase();
    const range = { from: from - currentLine.length, to: from };
    const commandCount = filterSlashCommands(query).length;
    const activeIndex = previousState?.range.from === range.from && previousState.query === query
        ? Math.min(previousState.activeIndex, Math.max(commandCount - 1, 0))
        : 0;
    return { activeIndex, query, range };
}

function setSlashMenuActiveIndex(index) {
    if (!slashMenuState) return;
    const items = filterSlashCommands(slashMenuState.query);
    if (!items.length) return;
    slashMenuState = { ...slashMenuState, activeIndex: (index + items.length) % items.length };
    slashMenuList?.querySelectorAll('[data-slash-command]').forEach((button, buttonIndex) => {
        const active = buttonIndex === slashMenuState.activeIndex;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-selected', String(active));
    });
    const activeButton = slashMenuList?.querySelector('[data-slash-command].is-active');
    if (activeButton) activeButton.scrollIntoView({ block: 'nearest' });
    slashMenu?.setAttribute('aria-activedescendant', activeButton?.id || '');
}

function positionSlashMenu() {
    if (!slashMenu || !slashMenuState || !editor) return;
    try {
        const coords = editor.view.coordsAtPos(slashMenuState.range.to);
        const menuWidth = slashMenu.offsetWidth || SLASH_MENU_WIDTH;
        const menuHeight = Math.min(slashMenu.offsetHeight || 430, window.innerHeight - SLASH_MENU_MARGIN * 2);
        const left = Math.min(
            Math.max(coords.left, SLASH_MENU_MARGIN),
            Math.max(SLASH_MENU_MARGIN, window.innerWidth - menuWidth - SLASH_MENU_MARGIN)
        );
        const top = coords.bottom + menuHeight + SLASH_MENU_MARGIN > window.innerHeight && coords.top > menuHeight
            ? Math.max(SLASH_MENU_MARGIN, coords.top - menuHeight - 8)
            : Math.min(coords.bottom + 8, Math.max(SLASH_MENU_MARGIN, window.innerHeight - menuHeight - SLASH_MENU_MARGIN));
        slashMenu.style.left = `${left}px`;
        slashMenu.style.top = `${top}px`;
    } catch {
        hideSlashMenu();
    }
}

function renderSlashMenu(state) {
    if (!slashMenu || !slashMenuList || !slashMenuEmpty) return;
    if (!state) {
        slashMenu.hidden = true;
        slashMenu.removeAttribute('aria-activedescendant');
        return;
    }

    const items = filterSlashCommands(state.query);
    slashMenu.hidden = false;
    slashMenuHint.textContent = state.query ? `/${state.query}` : '输入命令筛选';
    slashMenuList.innerHTML = items.map((command, index) => `
        <button id="slash-menu-item-${command.id}" class="slash-menu-item${index === state.activeIndex ? ' is-active' : ''}" type="button" role="option" aria-selected="${index === state.activeIndex}" data-slash-command="${command.id}">
            <span class="slash-menu-icon" aria-hidden="true">${escapeHtml(command.icon)}</span>
            <span class="slash-menu-copy"><span class="slash-menu-label">${escapeHtml(command.label)}</span><span class="slash-menu-description">${escapeHtml(command.hint)}</span></span>
            <kbd>${escapeHtml(command.shortcut)}</kbd>
        </button>`).join('');
    slashMenuEmpty.hidden = items.length !== 0;
    slashMenu.setAttribute('aria-activedescendant', items[state.activeIndex]?.id ? `slash-menu-item-${items[state.activeIndex].id}` : '');
    positionSlashMenu();
}

function updateSlashMenu() {
    const nextState = getSlashMenuState();
    slashMenuState = nextState;
    renderSlashMenu(nextState);
}

function hideSlashMenu() {
    slashMenuState = null;
    if (!slashMenu) return;
    slashMenu.hidden = true;
    slashMenu.removeAttribute('aria-activedescendant');
}

function runSlashCommand(command) {
    if (!editor || !slashMenuState) return false;
    const currentCommand = typeof command === 'string'
        ? SLASH_COMMANDS.find((item) => item.id === command)
        : command;
    if (!currentCommand) return false;
    const didRun = currentCommand.run(editor, slashMenuState.range);
    hideSlashMenu();
    return didRun;
}

function executeCommand(command, attributes) {
    if (!editor) return;
    const chain = editor.chain().focus();
    if (command === 'undo' || command === 'redo') chain[command]().run();
    else chain[command](attributes).run();
}

function setBlockFormat(value) {
    if (!editor) return;
    const chain = editor.chain().focus();
    if (value === 'paragraph') chain.setParagraph().run();
    if (value === 'heading1') chain.toggleHeading({ level: 1 }).run();
    if (value === 'heading2') chain.toggleHeading({ level: 2 }).run();
    if (value === 'heading3') chain.toggleHeading({ level: 3 }).run();
    if (value === 'blockquote') chain.toggleBlockquote().run();
    if (value === 'codeBlock') chain.toggleCodeBlock().run();
}

function openMathPrompt(range = null) {
    if (!editor) return;
    const latex = window.prompt('输入 LaTeX 公式（将插入为块级公式）', 'E = mc^2');
    if (!latex || !latex.trim()) return;
    const content = { type: 'mathBlock', attrs: { latex: latex.trim() } };
    if (range) return editor.chain().focus().insertContentAt(range, content).run();
    return editor.chain().focus().insertContent(content).run();
}

const SELECTION_BLOCK_LABELS = {
    paragraph: '段落',
    heading1: '标题',
    heading2: '副标题',
    heading3: '三级标题',
    taskList: '任务列表',
    orderedList: '有序列表',
    bulletList: '无序列表',
    blockquote: '引用',
    highlightBlock: '高亮块',
    codeBlock: '代码块'
};

function getSelectionBlockLabel() {
    if (!editor) return SELECTION_BLOCK_LABELS.paragraph;
    if (editor.isActive('heading', { level: 1 })) return SELECTION_BLOCK_LABELS.heading1;
    if (editor.isActive('heading', { level: 2 })) return SELECTION_BLOCK_LABELS.heading2;
    if (editor.isActive('heading', { level: 3 })) return SELECTION_BLOCK_LABELS.heading3;
    if (editor.isActive('taskList')) return SELECTION_BLOCK_LABELS.taskList;
    if (editor.isActive('orderedList')) return SELECTION_BLOCK_LABELS.orderedList;
    if (editor.isActive('bulletList')) return SELECTION_BLOCK_LABELS.bulletList;
    if (editor.isActive('blockquote')) return SELECTION_BLOCK_LABELS.blockquote;
    if (editor.isActive('highlightBlock')) return SELECTION_BLOCK_LABELS.highlightBlock;
    if (editor.isActive('codeBlock')) return SELECTION_BLOCK_LABELS.codeBlock;
    return SELECTION_BLOCK_LABELS.paragraph;
}

function updateSelectionToolbar() {
    if (!editor || !selectionMenu) return;
    if (selectionBlockLabel) selectionBlockLabel.textContent = getSelectionBlockLabel();
    selectionMenu.querySelectorAll('[data-selection-command]').forEach((button) => {
        const command = button.dataset.selectionCommand;
        const markName = command === 'clearMarks' ? null : command === 'setLink' ? 'link' :
            command === 'toggleUnderline' ? 'underline' : command === 'toggleHighlight' ? 'highlight' :
                command.replace(/^toggle/, '').replace(/^./, (character) => character.toLowerCase());
        const active = Boolean(markName && editor.isActive(markName));
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
    });
}

function closeSelectionSubmenus() {
    if (selectionConvertMenu) selectionConvertMenu.hidden = true;
    if (selectionBlockTrigger) selectionBlockTrigger.setAttribute('aria-expanded', 'false');
}

function positionSelectionMenu() {
    if (!editor || !selectionMenu || selectionMenu.hidden) return;
    try {
        const { from, to } = editor.state.selection;
        if (from === to) return;
        const start = editor.view.coordsAtPos(from);
        const end = editor.view.coordsAtPos(to);
        const menuWidth = selectionMenuCard?.offsetWidth || selectionMenu.offsetWidth;
        const cardHeight = selectionMenuCard?.offsetHeight || selectionMenu.offsetHeight;
        const convertIsFixed = selectionConvertMenu && window.getComputedStyle(selectionConvertMenu).position === 'fixed';
        const convertWidth = selectionConvertMenu && !selectionConvertMenu.hidden && !convertIsFixed ? selectionConvertMenu.offsetWidth + 7 : 0;
        const convertHeight = selectionConvertMenu && !selectionConvertMenu.hidden && !convertIsFixed ? selectionConvertMenu.offsetHeight : 0;
        const menuHeight = Math.max(cardHeight, convertHeight);
        const left = Math.max(12 + convertWidth, Math.min(window.innerWidth - menuWidth - 12, (start.left + end.right) / 2 - menuWidth / 2));
        const top = Math.max(12, start.top - menuHeight - 10);
        selectionMenu.style.left = `${left}px`;
        selectionMenu.style.top = `${top}px`;
    } catch {
        selectionMenu.hidden = true;
    }
}

function showSelectionMenu() {
    if (!editor || !selectionMenu) return;
    const { from, to } = editor.state.selection;
    if (from === to) {
        selectionMenu.hidden = true;
        closeSelectionSubmenus();
        return;
    }
    updateSelectionToolbar();
    selectionMenu.hidden = false;
    positionSelectionMenu();
}

function applySelectionBlockCommand(command) {
    if (!editor) return;
    const chain = editor.chain().focus();
    if (command === 'heading1') chain.setHeading({ level: 1 }).run();
    if (command === 'heading2') chain.setHeading({ level: 2 }).run();
    if (command === 'heading3') chain.setHeading({ level: 3 }).run();
    if (command === 'taskList') chain.toggleTaskList().run();
    if (command === 'orderedList') chain.toggleOrderedList().run();
    if (command === 'bulletList') chain.toggleBulletList().run();
    if (command === 'blockquote') chain.toggleBlockquote().run();
    if (command === 'highlightBlock') chain.setNode('highlightBlock').run();
    if (command === 'codeBlock') chain.toggleCodeBlock().run();
    closeSelectionSubmenus();
    updateSelectionToolbar();
    window.requestAnimationFrame(positionSelectionMenu);
}

function normalizeLink(value) {
    const source = String(value || '').trim();
    if (!source || /^javascript:/i.test(source)) return null;
    if (/^(?:https?:|mailto:|tel:|\/|#)/i.test(source)) return source;
    return `https://${source}`;
}

function openLinkPrompt() {
    if (!editor) return;
    const current = editor.getAttributes('link').href || '';
    const value = window.prompt('输入链接地址', current);
    if (value === null) return;
    if (!value.trim()) {
        editor.chain().focus().unsetLink().run();
        return;
    }
    const href = normalizeLink(value);
    if (!href) {
        setStatus('链接地址不安全', 'error');
        return;
    }
    editor.chain().focus().setLink({ href }).run();
    updateSelectionToolbar();
}

function contextForSelection(from, to) {
    const before = editor.state.doc.textBetween(0, from, '\n').split('\n').filter(Boolean);
    const after = editor.state.doc.textBetween(to, editor.state.doc.content.size, '\n').split('\n').filter(Boolean);
    return {
        beforeContext: before.at(-1) || '',
        afterContext: after[0] || ''
    };
}

async function requestSelectionAi(instruction) {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const selectedText = editor.state.doc.textBetween(from, to, '\n');
    const normalizedInstruction = String(instruction || '').trim();
    if (!normalizedInstruction) return;
    selectionSnapshot = { from, to, original: selectedText };
    selectionMenu.hidden = true;
    setStatus('AI 正在处理……');
    try {
        const payload = await fetchJson('/api/agent', {
            method: 'POST',
            body: JSON.stringify({
                mode: 'selection',
                selectedText,
                instruction: normalizedInstruction,
                ...contextForSelection(from, to)
            })
        });
        diffOriginal.textContent = selectedText;
        diffReplacement.textContent = payload.replacement || '';
        diffPanel.hidden = false;
        setStatus('等待确认 AI 修改');
        diffPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) {
        console.error('Selection AI 请求失败', error);
        if (error.status === 401 || error.status === 403) openLogin();
        setStatus(`AI 请求失败：${error.message}`, 'error');
    }
}

function acceptSelectionAi() {
    if (!selectionSnapshot) return;
    const replacement = diffReplacement.textContent || '';
    editor.chain().focus().insertContentAt({ from: selectionSnapshot.from, to: selectionSnapshot.to }, replacement).run();
    diffPanel.hidden = true;
    selectionSnapshot = null;
    setStatus('已接受 AI 修改');
}

function rejectSelectionAi() {
    diffPanel.hidden = true;
    selectionSnapshot = null;
    setStatus('已拒绝 AI 修改');
}

function getDocument() {
    const blocks = [];
    let position = 0;
    editor.state.doc.forEach((node) => {
        if (BLOCK_TYPES.has(node.type.name)) {
            blocks.push({
                id: node.attrs.blockId,
                type: node.type.name === 'heading' ? 'heading' : node.type.name,
                ...(node.type.name === 'heading' ? { level: node.attrs.level } : {}),
                text: node.textContent
            });
        }
        position += node.nodeSize;
    });
    return { title: titleInput.value, blocks };
}

function findBlock(blockId) {
    let result = null;
    editor.state.doc.descendants((node, position) => {
        if (!result && node.attrs.blockId === blockId) result = { node, position };
    });
    return result;
}

function insertMathAt(position, latex) {
    const mathNode = editor.schema.nodes.mathBlock?.create({ latex });
    if (!mathNode) return false;
    editor.view.dispatch(editor.state.tr.insert(position, mathNode));
    return true;
}

function applyAgentOperation(operation) {
    const type = operation.type || operation.tool;
    if (type === 'replace_selection') {
        const { from, to } = editor.state.selection;
        return editor.commands.insertContentAt({ from, to }, String(operation.content || ''));
    }
    if (type === 'find_text') return true;
    const target = findBlock(operation.blockId);
    if (!target) return false;
    if (type === 'replace_block') {
        return editor.commands.insertContentAt({ from: target.position, to: target.position + target.node.nodeSize }, markdownToHtml(operation.content || ''));
    }
    if (type === 'insert_after' || type === 'insert_before') {
        const position = type === 'insert_after' ? target.position + target.node.nodeSize : target.position;
        return editor.commands.insertContentAt(position, markdownToHtml(operation.content || ''));
    }
    if (type === 'insert_math') return insertMathAt(target.position + target.node.nodeSize, String(operation.latex || ''));
    return false;
}

async function runFullAgent() {
    const instruction = agentInstruction.value.trim();
    if (!instruction) {
        agentResult.textContent = '请先输入修改要求。';
        return;
    }
    agentRunButton.disabled = true;
    agentResult.classList.remove('is-error');
    agentResult.textContent = 'Agent 正在读取文档并规划局部修改……';
    try {
        const payload = await fetchJson('/api/agent', {
            method: 'POST',
            body: JSON.stringify({ mode: 'document', instruction, document: getDocument() })
        });
        const operations = Array.isArray(payload.operations) ? payload.operations : [];
        if (operations.length > 10) throw new Error('本次修改范围较大，建议分步骤处理。');
        let applied = 0;
        for (const operation of operations) {
            if (applyAgentOperation(operation)) applied += 1;
            ensureBlockIds();
        }
        agentResult.textContent = applied ? `Agent 已完成 ${applied} 个局部修改。` : 'Agent 没有找到需要修改的位置。';
        setStatus(applied ? 'Agent 修改已写入，可继续 undo' : 'Agent 未修改文章', applied ? '' : 'saved');
    } catch (error) {
        console.error('全文 Agent 请求失败', error);
        agentResult.classList.add('is-error');
        agentResult.textContent = `Agent 失败：${error.message}`;
        if (error.status === 401 || error.status === 403) openLogin();
        setStatus(`Agent 请求失败：${error.message}`, 'error');
    } finally {
        agentRunButton.disabled = false;
    }
}

function sanitizePreviewHtml(source) {
    const allowedTags = new Set(['P', 'H1', 'H2', 'H3', 'STRONG', 'B', 'EM', 'I', 'U', 'MARK', 'S', 'DEL', 'BLOCKQUOTE', 'OL', 'UL', 'LI', 'CODE', 'PRE', 'BR', 'SPAN', 'DIV', 'A', 'IMG', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'DETAILS', 'SUMMARY', 'INPUT', 'LABEL']);
    const container = document.createElement('div');
    container.innerHTML = source;
    const clean = (node) => {
        [...node.childNodes].forEach((child) => {
            if (child.nodeType !== window.Node.ELEMENT_NODE) return;
            if (!allowedTags.has(child.tagName)) {
                const fragment = document.createDocumentFragment();
                while (child.firstChild) fragment.appendChild(child.firstChild);
                child.replaceWith(fragment);
                return;
            }
            [...child.attributes].forEach((attribute) => {
                const name = attribute.name.toLowerCase();
                if (name.startsWith('on')) child.removeAttribute(attribute.name);
                if (!['class', 'href', 'src', 'alt', 'title', 'type', 'checked', 'open', 'colspan', 'rowspan', 'data-type', 'data-checked', 'data-math-inline', 'data-math-block', 'data-latex'].includes(name) && !name.startsWith('data-block')) child.removeAttribute(attribute.name);
            });
            if (['A', 'IMG'].includes(child.tagName)) {
                const url = child.getAttribute(child.tagName === 'A' ? 'href' : 'src') || '';
                if (/^javascript:/i.test(url)) child.removeAttribute(child.tagName === 'A' ? 'href' : 'src');
            }
            clean(child);
        });
    };
    clean(container);
    return container.innerHTML;
}

function togglePreview(forceOpen) {
    const open = typeof forceOpen === 'boolean' ? forceOpen : previewPanel.hidden;
    previewPanel.hidden = !open;
    previewButton.textContent = open ? '收起预览' : '预览';
    if (!open) return;
    const title = escapeHtml(titleInput.value.trim() || '未命名文章');
    previewContent.innerHTML = `<h1 class="editor-preview-title">${title}</h1>${sanitizePreviewHtml(editor.getHTML())}`;
    renderMathInElement(previewContent);
    previewPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function syncDetailsToggleLabels() {
    editorCanvas.querySelectorAll('[data-type="details"] > button').forEach((button) => {
        const summary = button.parentElement?.querySelector('[data-type="detailsSummary"]');
        const label = summary?.textContent?.trim() || 'Toggle 区块';
        button.setAttribute('aria-label', button.parentElement?.classList.contains('is-open') ? `收起 ${label}` : `展开 ${label}`);
        button.setAttribute('title', button.getAttribute('aria-label'));
    });
}

function validatePublish() {
    const metadata = getMetadata();
    const body = getMarkdownBody();
    if (!metadata.title.trim()) return '标题不能为空';
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.slug)) return 'Slug 必须是小写 kebab-case';
    if (['admin', 'api', 'assets', 'css', 'js', 'content', 'templates', 'posts'].includes(metadata.slug)) return 'Slug 与保留路径冲突';
    if (!metadata.description) return '摘要不能为空';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(metadata.date)) return '日期格式不正确';
    if (!body) return '正文不能为空';
    return null;
}

async function publishPost() {
    const validationError = validatePublish();
    if (validationError) {
        setStatus(`发布校验失败：${validationError}`, 'error');
        return;
    }
    publishButton.disabled = true;
    setStatus('正在发布……');
    try {
        const metadata = getMetadata();
        const payload = await fetchJson('/api/publish', {
            method: 'POST',
            body: JSON.stringify({
                metadata,
                body: getMarkdownBody(),
                allowUpdate: Boolean(currentPost?.slug && currentPost.slug === metadata.slug)
            })
        });
        currentPost = { ...metadata, body: getMarkdownBody() };
        setStatus(payload.message || '已提交发布', 'saved');
        await loadPostList();
    } catch (error) {
        console.error('发布失败', error);
        if (error.status === 401 || error.status === 403) openLogin();
        setStatus(`发布失败：${error.message}`, 'error');
    } finally {
        publishButton.disabled = false;
    }
}

function openLogin() {
    loginError.textContent = '';
    loginPassword.value = '';
    if (typeof loginDialog.showModal === 'function') loginDialog.showModal();
    else loginDialog.setAttribute('open', '');
    loginPassword.focus();
}

async function submitLogin(event) {
    event.preventDefault();
    loginError.textContent = '';
    try {
        await fetchJson('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ password: loginPassword.value })
        });
        if (typeof loginDialog.close === 'function') loginDialog.close();
        loginButton.textContent = '已登录';
        setStatus('已登录后台', 'saved');
    } catch (error) {
        loginError.textContent = error.message;
    }
}

function setupEditor() {
    editor = new Editor({
        element: editorCanvas,
        extensions: [
            StarterKit.configure({
                heading: { levels: [1, 2, 3] },
                history: { depth: 100 }
            }),
            TaskList.configure({
                HTMLAttributes: { class: 'editor-task-list' }
            }),
            TaskItem.configure({
                nested: true,
                HTMLAttributes: { class: 'editor-task-item' }
            }),
            Details.configure({
                persist: true,
                HTMLAttributes: { class: 'editor-details' }
            }),
            DetailsSummary.configure({
                HTMLAttributes: { class: 'editor-details-summary' }
            }),
            DetailsContent.configure({
                HTMLAttributes: { class: 'editor-details-content' }
            }),
            Table.configure({
                resizable: false,
                HTMLAttributes: { class: 'editor-table' }
            }),
            TableRow,
            TableHeader,
            TableCell,
            BlockIds,
            Underline,
            Highlight,
            LinkMark,
            HighlightBlock,
            MathInline,
            MathBlock
        ],
        content: '<p></p>',
        editorProps: {
            attributes: {
                class: 'ProseMirror',
                spellcheck: 'true',
                'data-placeholder': '从这里开始写作……'
            }
        },
        editorProps: {
            handleKeyDown: (_view, event) => {
                if (!slashMenuState) return false;
                const items = filterSlashCommands(slashMenuState.query);
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    event.stopPropagation();
                    if (items.length) {
                        const direction = event.key === 'ArrowDown' ? 1 : -1;
                        setSlashMenuActiveIndex(slashMenuState.activeIndex + direction);
                    }
                    return true;
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                    if (!items.length) return false;
                    event.preventDefault();
                    event.stopPropagation();
                    return runSlashCommand(items[Math.min(slashMenuState.activeIndex, items.length - 1)]);
                }
                if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    hideSlashMenu();
                    return true;
                }
                return false;
            }
        },
        onCreate: () => {
            ensureBlockIds();
            syncDetailsToggleLabels();
        },
        onUpdate: () => {
            ensureBlockIds();
            syncDetailsToggleLabels();
            markDirty();
            updateSlashMenu();
        },
        onSelectionUpdate: () => {
            updateSlashMenu();
            window.requestAnimationFrame(showSelectionMenu);
        }
    });
}

function bindEvents() {
    document.querySelectorAll('[data-command]').forEach((button) => {
        button.addEventListener('mousedown', (event) => event.preventDefault());
        button.addEventListener('click', () => executeCommand(button.dataset.command));
    });
    blockFormat.addEventListener('change', () => setBlockFormat(blockFormat.value));
    insertMathButton.addEventListener('mousedown', (event) => event.preventDefault());
    insertMathButton.addEventListener('click', openMathPrompt);
    selectionBlockTrigger?.addEventListener('mousedown', (event) => event.preventDefault());
    selectionBlockTrigger?.addEventListener('click', () => {
        if (!selectionConvertMenu) return;
        const nextOpen = selectionConvertMenu.hidden;
        selectionConvertMenu.hidden = !nextOpen;
        selectionBlockTrigger.setAttribute('aria-expanded', String(nextOpen));
        if (nextOpen) positionSelectionMenu();
    });
    selectionConvertMenu?.addEventListener('mousedown', (event) => {
        if (event.target.closest('[data-selection-block]')) event.preventDefault();
    });
    selectionConvertMenu?.addEventListener('click', (event) => {
        const button = event.target instanceof Element ? event.target.closest('[data-selection-block]') : null;
        if (button) applySelectionBlockCommand(button.dataset.selectionBlock);
    });
    selectionMenu?.querySelectorAll('[data-selection-command]').forEach((button) => {
        button.addEventListener('mousedown', (event) => event.preventDefault());
        button.addEventListener('click', () => {
            const command = button.dataset.selectionCommand;
            if (command === 'setLink') return openLinkPrompt();
            if (command === 'clearMarks') editor.chain().focus().unsetAllMarks().run();
            else executeCommand(command);
            updateSelectionToolbar();
            window.requestAnimationFrame(positionSelectionMenu);
        });
    });
    selectionAiForm?.addEventListener('submit', (event) => {
        event.preventDefault();
        const instruction = selectionAiInput?.value.trim() || '';
        if (!instruction) {
            selectionAiInput?.focus();
            return;
        }
        requestSelectionAi(instruction);
        if (selectionAiInput) selectionAiInput.value = '';
    });
    slashMenuList?.addEventListener('mousedown', (event) => {
        if (event.target.closest('[data-slash-command]')) event.preventDefault();
    });
    slashMenuList?.addEventListener('mouseover', (event) => {
        const button = event.target instanceof Element ? event.target.closest('[data-slash-command]') : null;
        if (!button || !slashMenuState) return;
        const items = filterSlashCommands(slashMenuState.query);
        const index = items.findIndex((item) => item.id === button.dataset.slashCommand);
        if (index >= 0 && index !== slashMenuState.activeIndex) setSlashMenuActiveIndex(index);
    });
    slashMenuList?.addEventListener('click', (event) => {
        const button = event.target instanceof Element ? event.target.closest('[data-slash-command]') : null;
        if (button) runSlashCommand(button.dataset.slashCommand);
    });
    editorCanvas.addEventListener('blur', () => window.setTimeout(() => {
        if (!selectionMenu.matches(':hover') && !selectionMenu.contains(document.activeElement)) selectionMenu.hidden = true;
        if (!slashMenu?.matches(':hover')) hideSlashMenu();
    }, 120));
    [titleInput, descriptionInput, slugInput, dateInput, categoryInput].forEach((field) => field.addEventListener('input', () => {
        if (field === slugInput) updateActivePostLink();
        markDirty();
    }));
    saveButton.addEventListener('click', () => saveDraft(false));
    previewButton.addEventListener('click', () => togglePreview());
    closePreviewButton.addEventListener('click', () => togglePreview(false));
    acceptAiButton.addEventListener('click', acceptSelectionAi);
    rejectAiButton.addEventListener('click', rejectSelectionAi);
    agentRunButton.addEventListener('click', runFullAgent);
    agentToggleButton?.addEventListener('click', () => {
        setAgentPanelCollapsed(!agentPanel.classList.contains('is-collapsed'));
    });
    agentReopenButton?.addEventListener('click', () => setAgentPanelCollapsed(false));
    restoreAgentPanelState();
    newPostButton.addEventListener('click', createNewPost);
    publishButton.addEventListener('click', publishPost);
    loginButton.addEventListener('click', openLogin);
    closeLoginButton.addEventListener('click', () => loginDialog.close());
    loginForm.addEventListener('submit', submitLogin);
    window.addEventListener('resize', () => {
        if (!selectionMenu.hidden) positionSelectionMenu();
        positionSlashMenu();
    });
    window.addEventListener('scroll', () => {
        positionSelectionMenu();
        positionSlashMenu();
    }, true);
    window.addEventListener('beforeunload', (event) => {
        if (!isDirty) return;
        event.preventDefault();
        event.returnValue = '';
    });
}

async function boot() {
    setupEditor();
    bindEvents();
    await loadPostList();
    const slug = new URLSearchParams(window.location.search).get('slug');
    if (slug) await loadPost(slug);
    else createNewPost();
}

window.selfWebWritingTools = {
    get_document: getDocument,
    get_selection: () => editor ? {
        from: editor.state.selection.from,
        to: editor.state.selection.to,
        text: editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, '\n')
    } : null,
    find_text: (text) => editor ? editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n').includes(text) : false,
    replace_selection: (content) => applyAgentOperation({ type: 'replace_selection', content }),
    replace_block: (blockId, content) => applyAgentOperation({ type: 'replace_block', blockId, content }),
    insert_after: (blockId, content) => applyAgentOperation({ type: 'insert_after', blockId, content }),
    insert_before: (blockId, content) => applyAgentOperation({ type: 'insert_before', blockId, content }),
    insert_math: (blockId, latex) => applyAgentOperation({ type: 'insert_math', blockId, latex })
};

boot().catch((error) => {
    console.error('编辑器启动失败', error);
    setStatus(`编辑器启动失败：${error.message}`, 'error');
});
