import React from 'react';
import api from '../../lib/api';
import { confirmAction } from '../../lib/alerts';
import type { UserRole } from '../../shared/types';

export type ChatReportContext = {
    type: string;
    title: string;
    from?: string;
    to?: string;
    status?: string;
    search?: string;
    order_status?: string;
    payment_status?: string;
    payment_method?: string;
    role?: string;
    account_status?: string;
    complaint_type?: string;
    resolution_status?: string;
    amount_min?: string;
    amount_max?: string;
    category_id?: number;
    listing_id?: number;
    seller_id?: number;
    requestId?: number;
};

type ChatKind = 'ai' | 'direct';
type ChatPeer = { id: number; name: string; role: UserRole };
type ChatMessage = {
    id: number;
    role: 'user' | 'assistant' | 'participant';
    sender_id: number | null;
    is_mine: boolean;
    content: string;
    created_at: string;
};
type ChatConversation = {
    id: number;
    kind: ChatKind;
    title: string | null;
    report_context: Omit<ChatReportContext, 'title' | 'requestId'> | null;
    peer?: ChatPeer | null;
    updated_at: string;
};
type ChatResponse = {
    conversation: ChatConversation;
    user_message: ChatMessage;
    assistant_message: ChatMessage;
};

type ChatOrderContext = {
    id: number;
    order_reference: string;
    status: string;
    seller?: { name: string } | null;
    items: { quantity: number; listing?: { name: string } | null }[];
};

const roleCopy: Record<UserRole, { welcome: string; suggestions: string[] }> = {
    ADMIN: {
        welcome: 'Ask FARMGATE AI, or start a direct conversation with another account.',
        suggestions: ['Summarize marketplace performance.', 'Explain the selected report.', 'What should I review in platform operations?'],
    },
    SELLER: {
        welcome: 'Ask FARMGATE AI, or message a buyer you have an order or listing interest with.',
        suggestions: ['Summarize my sales.', 'Which products performed best?', 'Explain the selected report.'],
    },
    BUYER: {
        welcome: 'Ask FARMGATE AI, or message a seller connected to an order or listing interest.',
        suggestions: ['How do I track my order?', 'How can I cancel an order?', 'How do I submit a complaint?'],
    },
    RIDER: {
        welcome: 'Ask FARMGATE AI, or start a direct conversation with another account.',
        suggestions: ['Explain delivery statuses.', 'What should I do after accepting a delivery?', 'How should I handle a failed delivery?'],
    },
};

function formatInline(text: string): React.ReactNode[] {
    return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
        if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
        return part;
    });
}

function MessageContent({ content }: { content: string }) {
    const lines = content.split(/\r?\n/);
    const blocks: React.ReactNode[] = [];
    let list: string[] = [];

    const flushList = () => {
        if (!list.length) return;
        blocks.push(<ul key={`list-${blocks.length}`}>{list.map((line, index) => <li key={index}>{formatInline(line)}</li>)}</ul>);
        list = [];
    };

    lines.forEach((line, index) => {
        const item = line.match(/^\s*[-*]\s+(.+)$/);
        if (item) {
            list.push(item[1]);
            return;
        }
        flushList();
        if (line.trim()) blocks.push(<p key={`line-${index}`}>{formatInline(line)}</p>);
        else if (index > 0 && index < lines.length - 1) blocks.push(<br key={`break-${index}`} />);
    });
    flushList();

    return <div className="ai-chat-message-content">{blocks}</div>;
}

function reportTitle(report?: ChatReportContext | null): string | null {
    if (!report) return null;
    const dates = report.from || report.to ? ` · ${report.from || 'start'} – ${report.to || 'present'}` : '';
    const status = [report.status, report.order_status, report.payment_status, report.payment_method, report.role, report.account_status, report.complaint_type, report.resolution_status]
        .filter(Boolean)
        .join(', ');
    const statusLabel = status ? ` · ${status}` : '';
    const search = report.search ? ' · search filter applied' : '';
    const amount = report.amount_min || report.amount_max
        ? ` · amount ${report.amount_min || '0'}–${report.amount_max || 'any'}`
        : '';
    return `${report.title}${dates}${statusLabel}${amount}${search}`;
}

function conversationLabel(conversation: ChatConversation): string {
    if (conversation.kind === 'direct') return conversation.peer?.name ?? 'Direct conversation';
    return conversation.title || 'New AI conversation';
}

export function AIChatPage({ role, reportContext: incomingReport, onBack, initialConversationId, onUnreadMessagesRead, orderId }: {
    role: UserRole;
    reportContext?: ChatReportContext | null;
    onBack?: () => void;
    initialConversationId?: number;
    onUnreadMessagesRead?: () => void | Promise<void>;
    orderId?: number;
}) {
    const [conversations, setConversations] = React.useState<ChatConversation[]>([]);
    const [selected, setSelected] = React.useState<ChatConversation | null>(null);
    const [mode, setMode] = React.useState<ChatKind>('ai');
    const [report, setReport] = React.useState<ChatReportContext | null>(incomingReport ?? null);
    const [messages, setMessages] = React.useState<ChatMessage[]>([]);
    const [input, setInput] = React.useState('');
    const [loading, setLoading] = React.useState(false);
    const [loadingHistory, setLoadingHistory] = React.useState(true);
    const [error, setError] = React.useState('');
    const [failedMessage, setFailedMessage] = React.useState('');
    const [contextCleared, setContextCleared] = React.useState(false);
    const [recipientPickerOpen, setRecipientPickerOpen] = React.useState(false);
    const [recipientSearch, setRecipientSearch] = React.useState('');
    const [recipients, setRecipients] = React.useState<ChatPeer[]>([]);
    const [searchingRecipients, setSearchingRecipients] = React.useState(false);
    const [recipientError, setRecipientError] = React.useState('');
    const [orderContext, setOrderContext] = React.useState<ChatOrderContext | null>(null);
    const [orderContextLoading, setOrderContextLoading] = React.useState(false);
    const bottomRef = React.useRef<HTMLDivElement>(null);
    const requestLock = React.useRef(false);
    const pendingDirectAttempt = React.useRef<{ content: string; id: string } | null>(null);
    const lastReportRequest = React.useRef<number | string | null>(null);
    const lastInitialConversation = React.useRef<number | null>(null);
    const sendRef = React.useRef<(text: string, context?: ChatReportContext | null, conversation?: ChatConversation | null) => Promise<void>>(async () => {});
    const copy = roleCopy[role];

    const loadConversations = React.useCallback(async () => {
        const response = await api.get<{ data: ChatConversation[] }>('/api/chat/conversations');
        setConversations(response.data.data);
    }, []);

    React.useEffect(() => {
        let active = true;
        api.get<{ data: ChatConversation[] }>('/api/chat/conversations')
            .then((response) => { if (active) setConversations(response.data.data); })
            .catch((requestError: { userMessage?: string }) => { if (active) setError(requestError.userMessage ?? 'Conversation history could not be loaded.'); })
            .finally(() => { if (active) setLoadingHistory(false); });
        return () => { active = false; };
    }, []);

    React.useEffect(() => {
        if (!recipientPickerOpen || recipientSearch.trim().length < 2) {
            setRecipients([]);
            setSearchingRecipients(false);
            setRecipientError('');
            return;
        }

        let active = true;
        const timer = window.setTimeout(() => {
            setSearchingRecipients(true);
            setRecipientError('');
            api.get<{ data: ChatPeer[] }>(`/api/chat/recipients?search=${encodeURIComponent(recipientSearch.trim())}`)
                .then((response) => { if (active) setRecipients(response.data.data); })
                .catch((requestError: { userMessage?: string }) => {
                    if (active) setRecipientError(requestError.userMessage ?? 'Recipient search is unavailable. Try again.');
                })
                .finally(() => { if (active) setSearchingRecipients(false); });
        }, 250);
        return () => {
            active = false;
            window.clearTimeout(timer);
        };
    }, [recipientPickerOpen, recipientSearch]);

    React.useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [messages, loading]);

    const sendMessage = React.useCallback(async (text: string, context: ChatReportContext | null = report, conversation: ChatConversation | null = selected) => {
        const trimmed = text.trim();
        if (!trimmed || requestLock.current) return;
        requestLock.current = true;
        setLoading(true);
        setError('');
        setFailedMessage('');
        try {
            if (mode === 'direct') {
                if (!conversation || conversation.kind !== 'direct') throw new Error('Choose a direct conversation first.');
                const attempt = pendingDirectAttempt.current?.content === trimmed
                    ? pendingDirectAttempt.current
                    : { content: trimmed, id: crypto.randomUUID() };
                pendingDirectAttempt.current = attempt;
                const response = await api.post<{ conversation: ChatConversation; message: ChatMessage }>(`/api/chat/conversations/${conversation.id}/messages`, {
                    message: trimmed,
                    client_message_id: attempt.id,
                });
                pendingDirectAttempt.current = null;
                setSelected(response.data.conversation);
                setMessages((current) => [...current, response.data.message]);
            } else {
                const payload = {
                    conversation_id: conversation?.kind === 'ai' ? conversation.id : null,
                    message: trimmed,
                    ...(context ? { report: {
                        type: context.type,
                        from: context.from,
                        to: context.to,
                        status: context.status,
                        search: context.search,
                        order_status: context.order_status,
                        payment_status: context.payment_status,
                        payment_method: context.payment_method,
                        role: context.role,
                        account_status: context.account_status,
                        complaint_type: context.complaint_type,
                        resolution_status: context.resolution_status,
                        amount_min: context.amount_min,
                        amount_max: context.amount_max,
                    } } : {}),
                    ...(contextCleared && !context ? { clear_report_context: true } : {}),
                };
                const response = await api.post<ChatResponse>('/api/chat/messages', payload);
                setSelected(response.data.conversation);
                setMessages((current) => [...current, response.data.user_message, response.data.assistant_message]);
                if (!conversation) setReport(context);
            }
            void loadConversations().catch(() => setError('Your message was sent, but conversation history could not be refreshed.'));
        } catch (requestError: any) {
            setError(requestError.userMessage ?? requestError.response?.data?.message ?? requestError.message ?? 'Your message could not be sent. Please try again.');
            setFailedMessage(trimmed);
        } finally {
            requestLock.current = false;
            setLoading(false);
        }
    }, [contextCleared, loadConversations, mode, report, selected]);
    sendRef.current = sendMessage;

    React.useEffect(() => {
        if (!incomingReport) return;
        const key = incomingReport.requestId ?? JSON.stringify(incomingReport);
        if (lastReportRequest.current === key) return;
        lastReportRequest.current = key;
        setMode('ai');
        setSelected(null);
        setMessages([]);
        setReport(incomingReport);
        setContextCleared(false);
        void sendRef.current('Please analyze the selected report. Explain the verified data, key patterns, and any limitations without assuming causes.', incomingReport, null);
    }, [incomingReport]);

    async function openConversation(conversationId: number) {
        setLoading(true);
        setError('');
        setFailedMessage('');
        try {
            const response = await api.get<{ conversation: ChatConversation; messages: ChatMessage[] }>(`/api/chat/conversations/${conversationId}`);
            setSelected(response.data.conversation);
            setMode(response.data.conversation.kind);
            setMessages(response.data.messages);
            if (response.data.conversation.kind === 'direct') onUnreadMessagesRead?.();
            setReport(response.data.conversation.report_context
                ? { ...response.data.conversation.report_context, title: `${response.data.conversation.report_context.type[0].toUpperCase()}${response.data.conversation.report_context.type.slice(1)} report` }
                : null);
            setContextCleared(false);
            setRecipientPickerOpen(false);
            pendingDirectAttempt.current = null;
        } catch (requestError: any) {
            setError(requestError.userMessage ?? 'This conversation could not be loaded.');
        } finally {
            setLoading(false);
        }
    }

    React.useEffect(() => {
        if (!initialConversationId || lastInitialConversation.current === initialConversationId) return;
        lastInitialConversation.current = initialConversationId;
        void openConversation(initialConversationId);
    }, [initialConversationId]);

    React.useEffect(() => {
        if (!orderId) {
            setOrderContext(null);
            return undefined;
        }

        let active = true;
        setOrderContextLoading(true);
        api.get<{ order: ChatOrderContext }>(`/api/orders/${orderId}`)
            .then((response) => {
                if (!active) return;
                setOrderContext(response.data.order);
                setInput((current) => current || `Hi, I have a concern about order ${response.data.order.order_reference}. `);
            })
            .catch((requestError: { userMessage?: string }) => {
                if (active) setError(requestError.userMessage ?? 'The order context could not be loaded.');
            })
            .finally(() => { if (active) setOrderContextLoading(false); });

        return () => { active = false; };
    }, [orderId]);

    function startNewAIChat() {
        setSelected(null);
        setMode('ai');
        setMessages([]);
        setReport(null);
        setContextCleared(false);
        setInput('');
        setError('');
        setFailedMessage('');
        setRecipientPickerOpen(false);
        pendingDirectAttempt.current = null;
    }

    function startDirectDraft() {
        startNewAIChat();
        setRecipientPickerOpen(true);
        setRecipientSearch('');
        setRecipientError('');
    }

    async function startDirectConversation(recipient: ChatPeer) {
        setLoading(true);
        setError('');
        try {
            const response = await api.post<{ conversation: ChatConversation }>('/api/chat/direct-conversations', { recipient_id: recipient.id });
            await loadConversations();
            await openConversation(response.data.conversation.id);
            setRecipientPickerOpen(false);
            setRecipientSearch('');
        } catch (requestError: any) {
            setError(requestError.userMessage ?? requestError.response?.data?.message ?? 'This conversation could not be started.');
        } finally {
            setLoading(false);
        }
    }

    async function clearReportContext() {
        if (selected?.kind === 'ai') {
            try {
                await api.patch(`/api/chat/conversations/${selected.id}/report-context`);
            } catch (requestError: any) {
                setError(requestError.userMessage ?? 'The selected report context could not be cleared.');
                return;
            }
        }
        setReport(null);
        setContextCleared(true);
        setError('');
    }

    async function deleteConversation(conversation: ChatConversation) {
        if (conversation.kind !== 'ai') return;
        if (!await confirmAction({ title: 'Delete this AI conversation?', text: 'Its saved messages and report context will be permanently deleted.', confirmText: 'Delete conversation', danger: true })) return;
        try {
            await api.delete(`/api/chat/conversations/${conversation.id}`);
            setConversations((current) => current.filter((item) => item.id !== conversation.id));
            if (selected?.id === conversation.id) startNewAIChat();
        } catch (requestError: any) {
            setError(requestError.userMessage ?? 'This conversation could not be deleted.');
        }
    }

    function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const text = input.trim();
        if (!text || loading) return;
        setInput('');
        void sendMessage(text);
    }

    const selectedAI = selected?.kind === 'ai';

    return <section className="ai-chat-page" aria-label="FARMGATE conversations">
        <aside className="ai-chat-sidebar">
            <div className="ai-chat-sidebar-heading"><h2>Conversations</h2></div>
            <div className="chat-start-actions">
                <button type="button" onClick={startNewAIChat}>New AI chat</button>
                <button type="button" onClick={startDirectDraft}>New message</button>
            </div>
            {selectedAI && <button type="button" className="ai-chat-delete" onClick={() => void deleteConversation(selected)}>Delete selected AI chat</button>}
            {loadingHistory ? <p className="ai-chat-history-note">Loading history...</p> : conversations.length ? <nav aria-label="Chat history">
                {conversations.map((conversation) => <button type="button" key={conversation.id} className={conversation.id === selected?.id ? 'active' : ''} onClick={() => void openConversation(conversation.id)}>
                    <strong>{conversationLabel(conversation)}</strong>
                    <small>{conversation.kind === 'direct' ? `${conversation.peer?.role ?? 'Direct message'} · ` : 'FARMGATE AI · '}{new Date(conversation.updated_at).toLocaleDateString()}</small>
                </button>)}
            </nav> : <p className="ai-chat-history-note">Saved AI and direct conversations will appear here.</p>}
        </aside>
        <div className="ai-chat-panel">
            <header className="ai-chat-header"><div>
                {onBack && <button type="button" className="ai-chat-back" onClick={onBack}>← Delivery dashboard</button>}
                <p className="eyebrow">FARMGATE · {role}</p>
                <h1>Chats</h1>
                <p>{mode === 'direct' && selected?.peer ? `Direct conversation with ${selected.peer.name}.` : 'One place for direct messages and your saved FARMGATE AI conversations.'}</p>
            </div>{report && selectedAI && <button type="button" className="ai-chat-clear-context" onClick={() => void clearReportContext()}>Clear report context</button>}</header>
            {orderId && <aside className="ai-chat-order-context" aria-label="Order being discussed">
                {orderContextLoading ? <p role="status">Loading order context...</p> : orderContext ? <>
                    <strong>Discussing order {orderContext.order_reference}</strong>
                    <span>{orderContext.seller?.name ?? 'Seller'} · {orderContext.status.replaceAll('_', ' ')}</span>
                    <small>{orderContext.items.map((item) => `${item.quantity} × ${item.listing?.name ?? 'Removed listing'}`).join(', ')}</small>
                    <small>Add your concern to the draft message below before sending.</small>
                </> : <p>Order context is unavailable.</p>}
            </aside>}
            {recipientPickerOpen && <section className="chat-recipient-picker" aria-label="Find a person to message">
                <label htmlFor="chat-recipient-search">Find someone to message</label>
                <input id="chat-recipient-search" value={recipientSearch} onChange={(event) => setRecipientSearch(event.target.value)} maxLength={60} minLength={2} placeholder="Search by name (at least 2 characters)" autoComplete="off" />
                <p>Only names and roles are shown. Buyer–seller messages require an order or listing interest.</p>
                {searchingRecipients && <p role="status">Searching eligible accounts...</p>}
                {recipientError && <p className="ai-chat-error" role="alert">{recipientError}</p>}
                {!searchingRecipients && recipientSearch.trim().length >= 2 && !recipients.length && !recipientError && <p>No eligible people found for that name.</p>}
                {recipients.length > 0 && <ul>{recipients.map((recipient) => <li key={recipient.id}>
                    <button type="button" disabled={loading} onClick={() => void startDirectConversation(recipient)}><strong>{recipient.name}</strong><span>{recipient.role}</span></button>
                </li>)}</ul>}
            </section>}
            {report && selectedAI && <aside className="ai-chat-report-context"><strong>Analyzing: {reportTitle(report)}</strong><small>Farmgate rechecks report access and calculates summary data on the server.</small></aside>}
            <div className="ai-chat-messages" role="log" aria-live="polite" aria-label="Conversation messages">
                {!messages.length && <div className="ai-chat-welcome"><span className="ai-chat-ai-mark" aria-hidden="true">{mode === 'ai' ? 'AI' : 'DM'}</span><h2>{mode === 'ai' ? 'How can I help?' : selected?.peer ? `Message ${selected.peer.name}` : 'Choose a conversation'}</h2><p>{mode === 'ai' ? copy.welcome : selected ? 'Messages are visible to the conversation participants.' : 'Start a new message or select a conversation from your inbox.'}</p>{mode === 'ai' && <div className="ai-chat-suggestions">{copy.suggestions.map((suggestion) => <button type="button" key={suggestion} disabled={loading} onClick={() => void sendMessage(suggestion)}>{suggestion}</button>)}</div>}</div>}
                {messages.map((message) => <article key={message.id} className={`ai-chat-message ${message.is_mine ? 'user' : 'assistant'}`}><span>{mode === 'direct' ? (message.is_mine ? 'You' : selected?.peer?.name ?? 'Participant') : (message.role === 'assistant' ? 'FARMGATE AI' : 'You')}</span><MessageContent content={message.content} /></article>)}
                {loading && <div className="ai-chat-typing" role="status">{mode === 'ai' ? 'FARMGATE AI is thinking...' : 'Sending message...'}</div>}
                {error && <div className="ai-chat-error" role="alert"><span>{error}</span>{failedMessage && <button type="button" disabled={loading} onClick={() => void sendMessage(failedMessage)}>Retry</button>}</div>}
                <div ref={bottomRef} />
            </div>
            <form className="ai-chat-composer" onSubmit={submit}>
                <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                    }
                }} placeholder={mode === 'ai' ? 'Ask FARMGATE AI... (Enter to send, Shift+Enter for a new line)' : 'Write a message... (Enter to send, Shift+Enter for a new line)'} maxLength={2000} rows={2} disabled={loading || (mode === 'direct' && !selected)} aria-label={mode === 'ai' ? 'Message to FARMGATE AI' : 'Direct message'} />
                <button type="submit" disabled={loading || !input.trim() || (mode === 'direct' && !selected)}>{loading ? 'Sending...' : 'Send'}</button>
            </form>
        </div>
    </section>;
}
