const { errorJson, readJson, requireAuth, sendJson } = require('./_shared');

function localSelectionReplacement(selectedText) {
    return selectedText;
}

function localDocumentOperations(instruction, document) {
    const blocks = Array.isArray(document?.blocks) ? document.blocks : [];
    const headings = blocks
        .map((block, index) => ({ ...block, index }))
        .filter((block) => block.type === 'heading');
    const hasAttentionPair = headings.some((heading) => /Attention/.test(heading.text))
        && headings.some((heading) => /Multi-Head/.test(heading.text));
    if ((/过渡|衔接/.test(instruction) || (/Attention/.test(instruction) && /Multi-Head/.test(instruction))) && hasAttentionPair && headings.length >= 2) {
        const first = headings.find((heading) => /Attention/.test(heading.text));
        const second = headings.find((heading) => /Multi-Head/.test(heading.text));
        if (first && second && first.index < second.index) {
            const target = blocks[second.index - 1] || first;
            return [{
                type: 'insert_after',
                blockId: target.id,
                content: 'Attention 先建立了对输入关系的整体理解，而 Multi-Head Attention 则把这种关系拆成多个互补的表示空间。下面从多个头如何协同工作继续展开。'
            }];
        }
    }
    if (/公式|数学/.test(instruction)) {
        return blocks.filter((block) => block.type === 'paragraph').slice(0, 2).map((block) => ({
            type: 'insert_math',
            blockId: block.id,
            latex: 'E = mc^2'
        }));
    }
    return [];
}

function parseJsonResponse(text) {
    const cleaned = String(text || '').trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    return JSON.parse(cleaned);
}

const CHAT_SYSTEM_PROMPT = `你是 SelfWeb 的中文写作助手，嵌在作者的文章编辑器里。你可以和用户正常对话：回答写作问题、讨论文章思路、评价草稿。当用户要求修改文章时，你必须用结构化操作修改 document，而不是只给建议。

规则：
- 只返回 JSON：{"reply":"...","operations":[...]}。
- reply 是给用户看的自然语言回复；修改完成后在 reply 里简要说明你改了什么。
- 不需要改动文章时，operations 返回空数组。
- operation 类型：replace_block（替换整个块）、insert_after、insert_before（在指定块后/前插入新块）、insert_math（插入公式，使用 latex 字段）。
- blockId 必须来自用户消息里的 document.blocks；content 是 Markdown 纯文本，不能是 HTML。
- 最多 10 个写操作，不要重写无关内容。
- references 是用户用 @ 引用的其他文章全文，只读参考，不要修改它们。`;

function normalizeChatMessages(messages) {
    if (!Array.isArray(messages)) return [];
    return messages
        .filter((message) => ['user', 'assistant'].includes(message?.role))
        .map((message) => ({ role: message.role, content: String(message.content || '').slice(0, 4000) }))
        .filter((message) => message.content.trim())
        .slice(-20);
}

function normalizeReferences(references) {
    if (!Array.isArray(references)) return [];
    return references.slice(0, 3).map((reference) => ({
        slug: String(reference?.slug || ''),
        title: String(reference?.title || ''),
        text: String(reference?.text || '').slice(0, 6000)
    })).filter((reference) => reference.slug && reference.text);
}

function localChatReply(operations) {
    const prefix = '（未配置模型 API key，使用本地简易逻辑）';
    return operations.length
        ? `${prefix}已执行 ${operations.length} 个局部修改。配置 DEEPSEEK_API_KEY 或 OPENAI_API_KEY 后即可正常对话。`
        : `${prefix}没有找到可执行的修改。配置 DEEPSEEK_API_KEY 或 OPENAI_API_KEY 后即可正常对话。`;
}

function modelConfig() {
    if (process.env.DEEPSEEK_API_KEY) {
        const baseUrl = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
        return {
            apiKey: process.env.DEEPSEEK_API_KEY,
            endpoint: `${baseUrl}/chat/completions`,
            model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
            provider: 'deepseek'
        };
    }
    if (process.env.OPENAI_API_KEY) {
        return {
            apiKey: process.env.OPENAI_API_KEY,
            endpoint: 'https://api.openai.com/v1/chat/completions',
            model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
            provider: 'openai'
        };
    }
    return null;
}

async function askModel(mode, payload) {
    const config = modelConfig();
    if (!config) return null;
    let messages;
    if (mode === 'chat') {
        messages = [
            { role: 'system', content: CHAT_SYSTEM_PROMPT },
            ...payload.messages,
            {
                role: 'user',
                content: JSON.stringify({
                    instruction: payload.instruction,
                    document: payload.document,
                    references: payload.references
                })
            }
        ];
    } else {
        const system = mode === 'selection'
            ? '你是中文写作编辑。只修改 selectedText，保留原意与篇幅约束。只返回 JSON：{"replacement":"..."}。replacement 不能是 HTML。'
            : '你是 Writing Agent。先阅读 document，再用最少的局部工具操作完成 instruction。只返回 JSON：{"operations":[{"type":"replace_block|insert_after|insert_before|insert_math","blockId":"...","content":"...","latex":"..."}]}。最多 10 个写操作，不能返回 HTML，不能重写无关内容。';
        const user = mode === 'selection'
            ? JSON.stringify({ selectedText: payload.selectedText, instruction: payload.instruction, beforeContext: payload.beforeContext, afterContext: payload.afterContext })
            : JSON.stringify({ instruction: payload.instruction, document: payload.document });
        messages = [
            { role: 'system', content: system },
            { role: 'user', content: user }
        ];
    }
    const body = {
        model: config.model,
        temperature: 0.3,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
        messages
    };
    if (config.provider === 'deepseek') {
        body.thinking = {
            type: process.env.DEEPSEEK_THINKING === 'enabled' ? 'enabled' : 'disabled'
        };
    }
    const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error?.message || `AI 服务返回 ${response.status}`);
    return parseJsonResponse(result.choices?.[0]?.message?.content || '{}');
}

module.exports = async function agentHandler(req, res) {
    if (req.method !== 'POST') {
        errorJson(res, 405, '只支持 POST');
        return;
    }
    if (!requireAuth(req, res)) return;
    try {
        const payload = await readJson(req);
        const mode = ['document', 'chat'].includes(payload.mode) ? payload.mode : 'selection';
        if (mode === 'chat') {
            const history = normalizeChatMessages(payload.messages);
            const last = history.at(-1);
            if (!last || last.role !== 'user') {
                errorJson(res, 400, 'messages 不能为空，且最后一条必须是用户消息');
                return;
            }
            const references = normalizeReferences(payload.references);
            const generated = await askModel(mode, {
                messages: history.slice(0, -1),
                instruction: last.content,
                document: payload.document,
                references
            });
            if (generated) {
                const operations = Array.isArray(generated.operations) ? generated.operations.slice(0, 10) : [];
                sendJson(res, 200, { reply: String(generated.reply || '完成。'), operations });
                return;
            }
            const operations = localDocumentOperations(last.content, payload.document);
            sendJson(res, 200, { reply: localChatReply(operations), operations });
            return;
        }
        if (mode === 'selection') {
            if (!String(payload.selectedText || '').trim() || !String(payload.instruction || '').trim()) {
                errorJson(res, 400, 'selectedText 与 instruction 不能为空');
                return;
            }
            const generated = await askModel(mode, payload);
            const replacement = String(generated?.replacement ?? localSelectionReplacement(payload.selectedText));
            sendJson(res, 200, { replacement });
            return;
        }
        const generated = await askModel(mode, payload);
        const operations = Array.isArray(generated?.operations)
            ? generated.operations.slice(0, 10)
            : localDocumentOperations(payload.instruction, payload.document);
        sendJson(res, 200, { operations });
    } catch (error) {
        console.error('Agent 请求失败', error);
        errorJson(res, 500, `AI 请求失败：${error.message}`);
    }
};
