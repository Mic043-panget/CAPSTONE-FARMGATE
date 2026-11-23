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
type ChatPeer = { id: number; name: string; role: UserRole; profile_photo_url?: string | null };
type ChatOrderPreview = {
    order_id: number;
    order_reference: string;
    item_count: number;
    items: { name: string; quantity: number; image_url: string | null }[];
};
type ChatMessage = {
    id: number;
    role: 'user' | 'assistant' | 'participant';
    sender_id: number | null;
    is_mine: boolean;
    content: string;
    order_previews?: ChatOrderPreview[];
    created_at: string;
};
type ChatConversation = {
    id: number;
    kind: ChatKind;
    title: string | null;
    last_message_preview?: string | null;
    messages_count?: number;
    report_context: Omit<ChatReportContext, 'title' | 'requestId'> | null;
    needs_human_attention: boolean;
    ai_paused: boolean;
    unread?: boolean;
    unread_count?: number;
    listing?: { name: string; image_url: string | null; href: string } | null;
    peer?: ChatPeer | null;
    updated_at: string;
};
type ChatResponse = {
    conversation: ChatConversation;
    user_message: ChatMessage;
    assistant_message: ChatMessage;
};
type DirectChatResponse = {
    conversation: ChatConversation;
    message: ChatMessage;
    ai_message: ChatMessage | null;
    ai_status: 'answered' | 'handed_off' | 'unavailable' | 'not_applicable';
};

type ChatOrderContext = {
    order_reference: string;
    items: { quantity: number; listing?: { name: string; image_url: string | null } | null }[];
};

const roleCopy: Record<UserRole, { welcome: string; suggestions: string[] }> = {
    ADMIN: {
        welcome: 'Ask FARMGATE AI about Farmgate operations, reports, and account information.',
        suggestions: ['Summarize marketplace performance.', 'Explain the selected report.', 'What should I review in platform operations?'],
    },
    SELLER: {
        welcome: 'Ask FARMGATE AI about your sales, livestock listings, and seller tools.',
        suggestions: ['Summarize my sales.', 'Which livestock listings performed best?', 'Explain the selected report.'],
    },
    BUYER: {
        welcome: 'Ask FARMGATE AI about browsing, orders, and buyer support.',
        suggestions: ['How do I track my order?', 'How can I cancel an order?', 'How do I submit a complaint?'],
    },
    RIDER: {
        welcome: 'Ask FARMGATE AI about delivery tasks, statuses, and rider tools.',
        suggestions: ['Explain delivery statuses.', 'What should I do after accepting a delivery?', 'How should I handle a failed delivery?'],
    },
};

const chatOrderReferencePattern = /(?<![A-Z0-9])FG-[A-Z]{2}-S\d{5,}-P\d{5,}-[23456789A-HJ-NP-Z]{16}(?![A-Z0-9-])/gi;

function formatOrderReferences(text: string, previews: ChatOrderPreview[], onOpenOrder?: (orderId: number) => void): React.ReactNode[] {
    const previewsByReference = new Map(previews.map((preview) => [preview.order_reference.toUpperCase(), preview]));
    const nodes: React.ReactNode[] = [];
    let cursor = 0;
    for (const match of text.matchAll(chatOrderReferencePattern)) {
        const reference = match[0];
        const start = match.index ?? 0;
        if (start > cursor) nodes.push(text.slice(cursor, start));
        const preview = previewsByReference.get(reference.toUpperCase());
        nodes.push(preview && onOpenOrder
            ? <a key={`${reference}-${start}`} href={`#order/${preview.order_id}`} onClick={(event) => {
                event.preventDefault();
                onOpenOrder(preview.order_id);
            }}>{reference}</a>
            : reference);
        cursor = start + reference.length;
    }
    if (cursor < text.length) nodes.push(text.slice(cursor));
    return nodes.length ? nodes : [text];
}

function formatInline(text: string, previews: ChatOrderPreview[], onOpenOrder?: (orderId: number) => void): React.ReactNode[] {
    return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).flatMap((part, index) => {
        if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{formatOrderReferences(part.slice(2, -2), previews, onOpenOrder)}</strong>;
        if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{formatOrderReferences(part.slice(1, -1), previews, onOpenOrder)}</code>;
        return formatOrderReferences(part, previews, onOpenOrder).map((node, nodeIndex) => <React.Fragment key={`${index}-${nodeIndex}`}>{node}</React.Fragment>);
    });
}

function MessageContent({ content, previews, onOpenOrder }: { content: string; previews: ChatOrderPreview[]; onOpenOrder?: (orderId: number) => void }) {
    const lines = content.split(/\r?\n/);
    const blocks: React.ReactNode[] = [];
    let list: string[] = [];

    const flushList = () => {
        if (!list.length) return;
        blocks.push(<ul key={`list-${blocks.length}`}>{list.map((line, index) => <li key={index}>{formatInline(line, previews, onOpenOrder)}</li>)}</ul>);
        list = [];
    };

    lines.forEach((line, index) => {
        const item = line.match(/^\s*[-*]\s+(.+)$/);
        if (item) {
            list.push(item[1]);
            return;
        }
        flushList();
        if (line.trim()) blocks.push(<p key={`line-${index}`}>{formatInline(line, previews, onOpenOrder)}</p>);
        else if (index > 0 && index < lines.length - 1) blocks.push(<br key={`break-${index}`} />);
    });
    flushList();

    return <div className="ai-chat-message-content">{blocks}</div>;
}

function ChatOrderPreviewCard({ preview, onOpenOrder }: { preview: ChatOrderPreview; onOpenOrder?: (orderId: number) => void }) {
    const [failedImages, setFailedImages] = React.useState<number[]>([]);
    React.useEffect(() => setFailedImages([]), [preview.order_id]);
    const items = preview.items.slice(0, 4);
    const href = `#order/${preview.order_id}`;

    return <a className="ai-chat-order-preview" href={href} onClick={(event) => {
        if (!onOpenOrder) return;
        event.preventDefault();
        onOpenOrder(preview.order_id);
    }} aria-label={`Open order ${preview.order_reference} details`}>
        {items.some((item, index) => item.image_url && !failedImages.includes(index)) && <span className="ai-chat-order-preview-gallery" aria-hidden="true">
            {items.map((item, index) => item.image_url && !failedImages.includes(index)
                ? <img key={`${index}-${item.image_url}`} src={item.image_url} alt="" onError={() => setFailedImages((current) => [...current, index])} />
                : null)}
        </span>}
        <span className="ai-chat-order-preview-copy">
            <small>Order {preview.order_reference}</small>
            {items.length ? items.slice(0, 2).map((item, index) => <strong key={`${item.name}-${index}`}>{item.quantity} × {item.name}</strong>) : <strong>Livestock details unavailable</strong>}
            {preview.item_count > Math.min(items.length, 2) && <span>+ {preview.item_count - Math.min(items.length, 2)} more {preview.item_count - Math.min(items.length, 2) === 1 ? 'listing' : 'listings'}</span>}
            {preview.item_count === 0 && <span>Item details are unavailable.</span>}
            <em>View order details</em>
        </span>
    </a>;
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
    return 'FARMGATE AI';
}

function conversationInitials(name: string): string {
    return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || 'FG';
}

function formatChatTimestamp(value: string): string {
    const date = new Date(value);
    const today = new Date();
    return date.toDateString() === today.toDateString()
        ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function ConversationAvatar({ conversation, size = 'list' }: { conversation: ChatConversation; size?: 'list' | 'header' }) {
    const [imageFailed, setImageFailed] = React.useState(false);
    const peer = conversation.kind === 'direct' ? conversation.peer : null;
    const imageUrl = peer?.profile_photo_url;

    React.useEffect(() => setImageFailed(false), [imageUrl]);

    return <span className={`ai-chat-${size === 'header' ? 'header' : 'conversation'}-avatar${conversation.kind === 'ai' ? ' ai' : ''}`} aria-hidden="true">
        {imageUrl && !imageFailed
            ? <img src={imageUrl} alt="" onError={() => setImageFailed(true)} />
            : conversation.kind === 'ai' ? 'AI' : conversationInitials(peer?.name ?? 'Direct message')}
    </span>;
}

export function AIChatPage({ role, reportContext: incomingReport, onBack, initialConversationId, onUnreadMessagesRead, onReportContextHandled, orderId, onOpenOrder }: {
    role: UserRole;
    reportContext?: ChatReportContext | null;
    onBack?: () => void;
    initialConversationId?: number;
    onUnreadMessagesRead?: () => void | Promise<void>;
    onReportContextHandled?: () => void;
    orderId?: number;
    onOpenOrder?: (orderId: number) => void;
}) {
    const [conversations, setConversations] = React.useState<ChatConversation[]>([]);
    const [aiConversation, setAIConversation] = React.useState<ChatConversation | null>(null);
    const [selected, setSelected] = React.useState<ChatConversation | null>(null);
    const [mode, setMode] = React.useState<ChatKind>('ai');
    const [mobileArea, setMobileArea] = React.useState<'conversations' | 'ai'>('conversations');
    const [report, setReport] = React.useState<ChatReportContext | null>(incomingReport ?? null);
    const [messages, setMessages] = React.useState<ChatMessage[]>([]);
    const [input, setInput] = React.useState('');
    const [loading, setLoading] = React.useState(false);
    const [loadingHistory, setLoadingHistory] = React.useState(true);
    const [aiHistoryReady, setAIHistoryReady] = React.useState(false);
    const [aiHistoryLoading, setAIHistoryLoading] = React.useState(true);
    const [aiHistoryError, setAIHistoryError] = React.useState('');
    const [loadingMoreHistory, setLoadingMoreHistory] = React.useState(false);
    const [historyError, setHistoryError] = React.useState('');
    const [conversationSearch, setConversationSearch] = React.useState('');
    const [historyPage, setHistoryPage] = React.useState(1);
    const [historyLastPage, setHistoryLastPage] = React.useState(1);
    const [mobileThreadOpen, setMobileThreadOpen] = React.useState(false);
    const [conversationLoading, setConversationLoading] = React.useState(false);
    const [orderContextError, setOrderContextError] = React.useState('');
    const [messagesHaveMore, setMessagesHaveMore] = React.useState(false);
    const [loadingOlder, setLoadingOlder] = React.useState(false);
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
    const [contextCardDismissed, setContextCardDismissed] = React.useState(false);
    const [historyNoticeVisible, setHistoryNoticeVisible] = React.useState(true);
    const messagesPaneRef = React.useRef<HTMLDivElement>(null);
    const messageInputRef = React.useRef<HTMLTextAreaElement>(null);
    const shouldScrollToLatestRef = React.useRef(true);
    const prependScrollHeightRef = React.useRef<number | null>(null);
    const requestLock = React.useRef(false);
    const pendingDirectAttempt = React.useRef<{ content: string; id: string } | null>(null);
    const pendingAIAttempt = React.useRef<{ content: string; id: string } | null>(null);
    const aiHistoryRequest = React.useRef<Promise<ChatConversation | null> | null>(null);
    const conversationRequestId = React.useRef(0);
    const historyRequestVersion = React.useRef(0);
    const listingContextStarted = React.useRef(false);
    const lastReportRequest = React.useRef<number | string | null>(null);
    const lastInitialConversation = React.useRef<number | null>(null);
    const sendRef = React.useRef<(text: string, context?: ChatReportContext | null, conversation?: ChatConversation | null, sendMode?: ChatKind) => Promise<void>>(async () => {});
    const copy = roleCopy[role];

    const fetchConversations = React.useCallback((search: string, page = 1) => api.get<{
        data: ChatConversation[];
        current_page: number;
        last_page: number;
    }>('/api/chat/conversations', { params: { page, kind: 'direct', ...(search ? { search } : {}) } }), []);

    const loadConversations = React.useCallback(async (search = conversationSearch.trim(), page = 1, append = false) => {
        const requestVersion = ++historyRequestVersion.current;
        try {
            const response = await fetchConversations(search, page);
            if (requestVersion !== historyRequestVersion.current) return;
            const directConversations = response.data.data.filter((conversation) => conversation.kind === 'direct');
            setConversations((current) => append
                ? [...current, ...directConversations.filter((conversation) => !current.some((item) => item.id === conversation.id))]
                : directConversations);
            setHistoryPage(response.data.current_page);
            setHistoryLastPage(response.data.last_page);
            setHistoryError('');
        } finally {
            if (requestVersion === historyRequestVersion.current) {
                setLoadingHistory(false);
                setLoadingMoreHistory(false);
            }
        }
    }, [conversationSearch, fetchConversations]);

    React.useEffect(() => {
        let active = true;
        const requestVersion = ++historyRequestVersion.current;
        setLoadingMoreHistory(false);
        const timer = window.setTimeout(() => {
            setLoadingHistory(true);
            setHistoryError('');
            fetchConversations(conversationSearch.trim())
                .then((response) => {
                    if (!active || requestVersion !== historyRequestVersion.current) return;
                    setConversations(response.data.data.filter((conversation) => conversation.kind === 'direct'));
                    setHistoryPage(response.data.current_page);
                    setHistoryLastPage(response.data.last_page);
                })
                .catch((requestError: { userMessage?: string }) => {
                    if (active && requestVersion === historyRequestVersion.current) setHistoryError(requestError.userMessage ?? 'Conversation history could not be loaded.');
                })
                .finally(() => {
                    if (active && requestVersion === historyRequestVersion.current) setLoadingHistory(false);
                });
        }, conversationSearch.trim() ? 250 : 0);
        return () => {
            active = false;
            window.clearTimeout(timer);
        };
    }, [conversationSearch, fetchConversations]);

    const fetchAIConversation = React.useCallback((): Promise<ChatConversation | null> => {
        if (aiHistoryRequest.current) return aiHistoryRequest.current;
        setAIHistoryLoading(true);
        setAIHistoryError('');
        const request = api.get<{ conversation: ChatConversation | null }>('/api/chat/ai-conversation')
            .then((response) => {
                setAIConversation(response.data.conversation);
                return response.data.conversation;
            })
            .catch((requestError: { userMessage?: string }) => {
                setAIHistoryError(requestError.userMessage ?? 'Your Farmgate AI history could not be loaded.');
                throw requestError;
            })
            .finally(() => {
                setAIHistoryReady(true);
                setAIHistoryLoading(false);
                aiHistoryRequest.current = null;
            });
        aiHistoryRequest.current = request;
        return request;
    }, []);

    React.useEffect(() => {
        void fetchAIConversation().catch(() => undefined);
    }, [fetchAIConversation]);

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

    React.useLayoutEffect(() => {
        const pane = messagesPaneRef.current;
        if (!pane) return;
        if (prependScrollHeightRef.current !== null) {
            pane.scrollTop += pane.scrollHeight - prependScrollHeightRef.current;
            prependScrollHeightRef.current = null;
            shouldScrollToLatestRef.current = false;
            return;
        }
        if (!shouldScrollToLatestRef.current) return;
        shouldScrollToLatestRef.current = false;
        const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
        pane.scrollTo({ top: pane.scrollHeight, behavior });
    }, [messages]);

    React.useLayoutEffect(() => {
        const textarea = messageInputRef.current;
        if (!textarea) return;
        textarea.style.height = 'auto';
        const height = Math.min(textarea.scrollHeight, 128);
        textarea.style.height = `${height}px`;
        textarea.style.overflowY = textarea.scrollHeight > 128 ? 'auto' : 'hidden';
    }, [input]);

    const sendMessage = React.useCallback(async (text: string, context: ChatReportContext | null = report, conversation: ChatConversation | null = selected, sendMode: ChatKind = mode) => {
        const trimmed = text.trim();
        if (!trimmed || requestLock.current) return;
        requestLock.current = true;
        setLoading(true);
        setError('');
        setFailedMessage('');
        try {
            if (sendMode === 'direct') {
                if (!conversation || conversation.kind !== 'direct') throw new Error('Choose a direct conversation first.');
                const attempt = pendingDirectAttempt.current?.content === trimmed
                    ? pendingDirectAttempt.current
                    : { content: trimmed, id: crypto.randomUUID() };
                pendingDirectAttempt.current = attempt;
                const response = await api.post<DirectChatResponse>(`/api/chat/conversations/${conversation.id}/messages`, {
                    message: trimmed,
                    client_message_id: attempt.id,
                    ...(orderContext && orderId !== undefined ? { order_id: orderId } : {}),
                });
                pendingDirectAttempt.current = null;
                setSelected(response.data.conversation);
                shouldScrollToLatestRef.current = true;
                setMessages((current) => {
                    const additions = [response.data.message, response.data.ai_message].filter((message): message is ChatMessage => message !== null);
                    return [...current, ...additions.filter((message) => !current.some((existing) => existing.id === message.id))];
                });
                setConversations((current) => current.map((item) => item.id === response.data.conversation.id
                    ? { ...response.data.conversation, unread: false, unread_count: 0 }
                    : item));
            } else {
                const attempt = pendingAIAttempt.current?.content === trimmed
                    ? pendingAIAttempt.current
                    : { content: trimmed, id: crypto.randomUUID() };
                pendingAIAttempt.current = attempt;
                const payload = {
                    conversation_id: conversation?.kind === 'ai' ? conversation.id : null,
                    client_message_id: attempt.id,
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
                pendingAIAttempt.current = null;
                const updatedConversation = { ...response.data.conversation, last_message_preview: response.data.assistant_message.content };
                setAIConversation(updatedConversation);
                setSelected(updatedConversation);
                shouldScrollToLatestRef.current = true;
                setMessages((current) => {
                    const additions = [response.data.user_message, response.data.assistant_message];
                    return [...current, ...additions.filter((message) => !current.some((existing) => existing.id === message.id))];
                });
                if (!conversation) setReport(context);
            }
            setInput((current) => current.trim() === trimmed ? '' : current);
            void loadConversations().catch(() => setHistoryError('Your message was sent, but conversation history could not be refreshed.'));
        } catch (requestError: any) {
            setError(requestError.userMessage ?? requestError.response?.data?.message ?? requestError.message ?? 'Your message could not be sent. Please try again.');
            setFailedMessage(trimmed);
        } finally {
            requestLock.current = false;
            setLoading(false);
        }
    }, [contextCleared, loadConversations, mode, orderContext, orderId, report, selected]);
    sendRef.current = sendMessage;

    React.useEffect(() => {
        if (!incomingReport || !aiHistoryReady) return;
        const key = incomingReport.requestId ?? JSON.stringify(incomingReport);
        if (lastReportRequest.current === key) return;
        lastReportRequest.current = key;
        const prompt = 'Please analyze the selected report. Explain the verified data, key patterns, and any limitations without assuming causes.';
        setMobileThreadOpen(true);
        setMobileArea('ai');
        setMode('ai');
        setReport(incomingReport);
        setContextCleared(false);
        setContextCardDismissed(false);
        void (async () => {
            let conversation = aiConversation;
            if (aiHistoryError) {
                try {
                    conversation = await fetchAIConversation();
                } catch {
                    setError(aiHistoryError);
                    setFailedMessage(prompt);
                    onReportContextHandled?.();
                    return;
                }
            }

            if (conversation) {
                const requestId = ++conversationRequestId.current;
                setConversationLoading(true);
                try {
                    const response = await api.get<{ conversation: ChatConversation; messages: ChatMessage[]; messages_has_more: boolean }>(`/api/chat/conversations/${conversation.id}`);
                    if (requestId !== conversationRequestId.current) return;
                    conversation = response.data.conversation;
                    setAIConversation(conversation);
                    setSelected(conversation);
                    setMessages(response.data.messages);
                    setMessagesHaveMore(response.data.messages_has_more);
                    shouldScrollToLatestRef.current = true;
                } catch (requestError: any) {
                    setError(requestError.userMessage ?? 'Your Farmgate AI history could not be loaded.');
                    setFailedMessage(prompt);
                    onReportContextHandled?.();
                    return;
                } finally {
                    setConversationLoading(false);
                }
            } else {
                setSelected(null);
                setMessages([]);
                setMessagesHaveMore(false);
            }

            await sendRef.current(prompt, incomingReport, conversation, 'ai');
            onReportContextHandled?.();
        })();
    }, [aiConversation, aiHistoryError, aiHistoryReady, fetchAIConversation, incomingReport]);

    async function openConversation(conversationId: number, revealOnMobile = true) {
        const requestId = ++conversationRequestId.current;
        const summary = conversations.find((item) => item.id === conversationId)
            ?? (aiConversation?.id === conversationId ? aiConversation : null);
        if (revealOnMobile) {
            setMobileThreadOpen(true);
            setMobileArea(summary?.kind === 'ai' ? 'ai' : 'conversations');
        }
        setConversationLoading(true);
        setError('');
        setFailedMessage('');
        setMessages([]);
        if (summary) {
            setSelected(summary);
            setMode(summary.kind);
        }
        try {
            const response = await api.get<{ conversation: ChatConversation; messages: ChatMessage[]; messages_has_more: boolean }>(`/api/chat/conversations/${conversationId}`);
            if (requestId !== conversationRequestId.current) return;
            setSelected(response.data.conversation);
            setMode(response.data.conversation.kind);
            if (revealOnMobile) setMobileArea(response.data.conversation.kind === 'ai' ? 'ai' : 'conversations');
            if (response.data.conversation.kind === 'ai') {
                setAIConversation({
                    ...response.data.conversation,
                    last_message_preview: summary?.last_message_preview,
                    messages_count: summary?.messages_count,
                    unread_count: 0,
                });
            }
            shouldScrollToLatestRef.current = true;
            setMessages(response.data.messages);
            setMessagesHaveMore(response.data.messages_has_more);
            if (response.data.conversation.kind === 'direct') onUnreadMessagesRead?.();
            setConversations((current) => current.map((item) => item.id === conversationId ? { ...item, unread: false, unread_count: 0 } : item));
            setReport(response.data.conversation.report_context
                ? { ...response.data.conversation.report_context, title: `${response.data.conversation.report_context.type[0].toUpperCase()}${response.data.conversation.report_context.type.slice(1)} report` }
                : null);
            setContextCleared(false);
            setContextCardDismissed(false);
            setRecipientPickerOpen(false);
            pendingDirectAttempt.current = null;
        } catch (requestError: any) {
            if (requestId === conversationRequestId.current) setError(requestError.userMessage ?? 'This conversation could not be loaded.');
        } finally {
            if (requestId === conversationRequestId.current) setConversationLoading(false);
        }
    }

    React.useEffect(() => {
        if (!aiHistoryReady || !aiConversation || initialConversationId || incomingReport || recipientPickerOpen) return;
        if (window.matchMedia('(max-width: 760px)').matches) return;
        if (selected?.kind === 'direct' || selected?.id === aiConversation.id) return;
        void openConversation(aiConversation.id, false);
    }, [aiConversation?.id, aiHistoryReady, incomingReport, initialConversationId, recipientPickerOpen, selected?.id, selected?.kind]);

    async function loadMoreConversations() {
        if (loadingMoreHistory || historyPage >= historyLastPage) return;
        const requestVersion = ++historyRequestVersion.current;
        setLoadingMoreHistory(true);
        setHistoryError('');
        try {
            const response = await fetchConversations(conversationSearch.trim(), historyPage + 1);
            if (requestVersion !== historyRequestVersion.current) return;
            const directConversations = response.data.data.filter((conversation) => conversation.kind === 'direct');
            setConversations((current) => [...current, ...directConversations.filter((conversation) => !current.some((item) => item.id === conversation.id))]);
            setHistoryPage(response.data.current_page);
            setHistoryLastPage(response.data.last_page);
        } catch (requestError: any) {
            if (requestVersion === historyRequestVersion.current) setHistoryError(requestError.userMessage ?? 'More conversations could not be loaded.');
        } finally {
            if (requestVersion === historyRequestVersion.current) setLoadingMoreHistory(false);
        }
    }

    async function retryConversationHistory() {
        setLoadingHistory(true);
        setHistoryError('');
        try {
            await loadConversations(conversationSearch.trim());
        } catch (requestError: any) {
            setHistoryError(requestError.userMessage ?? 'Conversation history could not be loaded.');
        } finally {
            setLoadingHistory(false);
        }
    }

    async function loadOlderMessages() {
        if (!selected || !messagesHaveMore || loadingOlder || !messages.length) return;
        setLoadingOlder(true);
        try {
            const response = await api.get<{ messages: ChatMessage[]; messages_has_more: boolean }>(
                `/api/chat/conversations/${selected.id}`,
                { params: { before_id: messages[0].id } },
            );
            prependScrollHeightRef.current = response.data.messages.length > 0
                ? messagesPaneRef.current?.scrollHeight ?? null
                : null;
            setMessages((current) => [...response.data.messages, ...current]);
            setMessagesHaveMore(response.data.messages_has_more);
        } catch (requestError: any) {
            setError(requestError.userMessage ?? 'Older conversation messages could not be loaded.');
        } finally {
            setLoadingOlder(false);
        }
    }

    async function setProductAiPaused(paused: boolean) {
        if (!selected || selected.kind !== 'direct' || !selected.listing || role !== 'SELLER') return;
        setLoading(true);
        setError('');
        try {
            const response = await api.patch<{ conversation: ChatConversation }>(`/api/chat/conversations/${selected.id}/product-ai`, { paused });
            setSelected(response.data.conversation);
            setConversations((current) => current.map((item) => item.id === selected.id ? response.data.conversation : item));
        } catch (requestError: any) {
            setError(requestError.userMessage ?? requestError.response?.data?.message ?? 'Product chat mode could not be updated.');
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
        setContextCardDismissed(false);
    }, [selected?.id, orderId]);

    React.useEffect(() => {
        if (!orderId) {
            setOrderContext(null);
            setOrderContextError('');
            setOrderContextLoading(false);
            return undefined;
        }

        let active = true;
        setOrderContext(null);
        setOrderContextError('');
        setOrderContextLoading(true);
        api.get<{ order: ChatOrderContext }>(`/api/orders/${orderId}/chat-context`)
            .then((response) => {
                if (!active) return;
                setOrderContext(response.data.order);
                setInput((current) => current || `Hi, I have a concern about order ${response.data.order.order_reference}. `);
            })
            .catch((requestError: { userMessage?: string }) => {
                if (active) setOrderContextError(requestError.userMessage ?? 'The order context could not be loaded.');
            })
            .finally(() => { if (active) setOrderContextLoading(false); });

        return () => { active = false; };
    }, [orderId]);

    async function continueAIChat() {
        conversationRequestId.current += 1;
        setConversationLoading(false);
        setMobileThreadOpen(true);
        setMobileArea('ai');
        setMode('ai');
        setRecipientPickerOpen(false);
        setError('');
        setFailedMessage('');
        let conversation = aiConversation;
        if (!aiHistoryReady || aiHistoryError) {
            try {
                conversation = await fetchAIConversation();
            } catch {
                return;
            }
        }
        if (conversation) {
            await openConversation(conversation.id);
            return;
        }
        setSelected(null);
        shouldScrollToLatestRef.current = true;
        setMessages([]);
        setMessagesHaveMore(false);
        setReport(null);
        setContextCleared(false);
        setContextCardDismissed(false);
        setInput('');
        pendingDirectAttempt.current = null;
        pendingAIAttempt.current = null;
    }

    function startDirectDraft() {
        conversationRequestId.current += 1;
        setConversationLoading(false);
        setMobileThreadOpen(true);
        setMobileArea('conversations');
        setSelected(null);
        setMode('direct');
        shouldScrollToLatestRef.current = true;
        setMessages([]);
        setMessagesHaveMore(false);
        setReport(null);
        setContextCleared(false);
        setContextCardDismissed(false);
        setInput('');
        setError('');
        setFailedMessage('');
        pendingDirectAttempt.current = null;
        pendingAIAttempt.current = null;
        setRecipientPickerOpen(true);
        setRecipientSearch('');
        setRecipientError('');
    }

    async function startDirectConversation(recipient: ChatPeer, listingId?: number) {
        setMobileThreadOpen(true);
        setMobileArea('conversations');
        setLoading(true);
        setError('');
        try {
            const response = await api.post<{ conversation: ChatConversation }>('/api/chat/direct-conversations', {
                recipient_id: recipient.id,
                ...(listingId ? { listing_id: listingId } : {}),
            });
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

    React.useEffect(() => {
        if (listingContextStarted.current) return;
        const pending = sessionStorage.getItem('farmgate.chat_listing_context');
        if (!pending) return;
        sessionStorage.removeItem('farmgate.chat_listing_context');
        listingContextStarted.current = true;
        try {
            const context = JSON.parse(pending) as { listing_id?: unknown; recipient_id?: unknown };
            if (Number.isSafeInteger(context.listing_id) && Number.isSafeInteger(context.recipient_id)) {
                void startDirectConversation({
                    id: Number(context.recipient_id),
                    name: '',
                    role: 'SELLER',
                }, Number(context.listing_id));
            }
        } catch {
            setError('The listing chat could not be started. Please open the listing and try again.');
        }
    }, []);

    async function clearReportContext() {
        if (selected?.kind === 'ai') {
            try {
                await api.patch(`/api/chat/conversations/${selected.id}/report-context`);
                setSelected((current) => current?.kind === 'ai' ? { ...current, report_context: null } : current);
                setAIConversation((current) => current ? { ...current, report_context: null } : current);
            } catch (requestError: any) {
                setError(requestError.userMessage ?? 'The selected report context could not be cleared.');
                return;
            }
        }
        setReport(null);
        setContextCleared(true);
        setError('');
    }

    async function clearAIChat(conversation: ChatConversation) {
        if (conversation.kind !== 'ai') return;
        if (!await confirmAction({
            title: 'Clear Farmgate AI history?',
            text: 'This permanently deletes all AI messages and saved report context from your account. Your single AI conversation will remain, and future messages will continue there.',
            confirmText: 'Clear AI chat',
            danger: true,
        })) return;
        try {
            const response = await api.delete<{ conversation: ChatConversation }>(`/api/chat/conversations/${conversation.id}`);
            setAIConversation(response.data.conversation);
            if (selected?.id === conversation.id) {
                setSelected(response.data.conversation);
                setMessages([]);
                setMessagesHaveMore(false);
                setReport(null);
                setContextCleared(false);
                setInput('');
                setError('');
                setFailedMessage('');
                pendingAIAttempt.current = null;
            }
        } catch (requestError: any) {
            setError(requestError.userMessage ?? 'Your Farmgate AI history could not be cleared.');
        }
    }

    function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const text = input.trim();
        if (!text || loading) return;
        void sendMessage(text);
    }

    const selectedAI = selected?.kind === 'ai';
    const selectedPeer = selected?.kind === 'direct' ? selected.peer : null;
    const threadTitle = mode === 'direct' ? selectedPeer?.name ?? 'New message' : 'FARMGATE AI';

    return <section className={`ai-chat-page${mobileThreadOpen ? ' mobile-thread-open' : ''}`} data-mobile-area={mobileArea} aria-label="Farmgate Chats">
        <div className="ai-chat-area-tabs" role="tablist" aria-label="Chat areas">
            <button type="button" role="tab" id="chat-conversations-tab" aria-selected={mobileArea === 'conversations'} aria-controls="chat-conversations-panel" onClick={() => {
                setMobileArea('conversations');
                setMobileThreadOpen(false);
            }}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H7l-4 2v-5a7.5 7.5 0 1 1 17-4.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/></svg>
                <span>Conversations</span>
            </button>
            <button type="button" role="tab" id="chat-ai-tab" aria-selected={mobileArea === 'ai'} aria-controls="chat-ai-panel" onClick={() => void continueAIChat()}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="m12 2 1.65 6.35L20 10l-6.35 1.65L12 18l-1.65-6.35L4 10l6.35-1.65L12 2Zm7 13 .82 3.18L23 19l-3.18.82L19 23l-.82-3.18L15 19l3.18-.82L19 15Z"/></svg>
                <span>Farmgate AI</span>
                {(aiConversation?.unread_count ?? 0) > 0 && <span className="ai-chat-tab-unread" aria-label={`${aiConversation?.unread_count} unread AI notifications`}>{aiConversation?.unread_count}</span>}
            </button>
        </div>
        <aside className="ai-chat-sidebar" id="chat-conversations-panel" role="tabpanel" aria-labelledby="chat-conversations-tab">
            <div className="ai-chat-sidebar-heading"><h2>Conversations</h2></div>
            <div className="chat-start-actions">
                <button type="button" onClick={() => void continueAIChat()}>Continue AI chat</button>
                <button type="button" onClick={startDirectDraft}>New message</button>
            </div>
            <label className="ai-chat-search">
                <span className="sr-only">Search conversations</span>
                <input type="search" value={conversationSearch} onChange={(event) => setConversationSearch(event.target.value)} placeholder="Search conversations" autoComplete="off" />
                {conversationSearch && <button type="button" aria-label="Clear conversation search" onClick={() => setConversationSearch('')}>×</button>}
            </label>
            <button type="button" className={`ai-chat-ai-shortcut${selectedAI ? ' active' : ''}`} onClick={() => void continueAIChat()}>
                <span className="ai-chat-conversation-avatar ai" aria-hidden="true">AI</span>
                <span className="ai-chat-conversation-copy">
                    <strong>Farmgate AI</strong>
                    <small>{aiConversation?.last_message_preview || (aiHistoryError ? 'History could not be loaded' : 'Your private AI history')}</small>
                    <span className="ai-chat-conversation-meta">
                        <span>One account · One history</span>
                        {aiConversation && <time dateTime={aiConversation.updated_at}>{formatChatTimestamp(aiConversation.updated_at)}</time>}
                    </span>
                </span>
                {(aiConversation?.unread_count ?? 0) > 0 && <span className="ai-chat-unread" aria-label={`${aiConversation?.unread_count} unread AI alerts`}>{aiConversation?.unread_count}</span>}
                <span className="ai-chat-card-chevron" aria-hidden="true">›</span>
            </button>
            {historyError ? <div className="ai-chat-history-error" role="alert">
                <p>{historyError}</p>
                <button type="button" onClick={() => void retryConversationHistory()}>Try again</button>
            </div> : loadingHistory ? <p className="ai-chat-history-note" role="status">Loading conversations...</p> : conversations.length ? <nav aria-label="Human conversations" aria-busy={loadingMoreHistory} tabIndex={0}>
                {conversations.map((conversation) => <button type="button" key={conversation.id} className={conversation.id === selected?.id ? 'active' : ''} aria-current={conversation.id === selected?.id ? 'true' : undefined} aria-label={`${conversationLabel(conversation)}. ${conversation.last_message_preview || 'Open conversation'}`} onClick={() => void openConversation(conversation.id)}>
                    <ConversationAvatar conversation={conversation} />
                    <span className="ai-chat-conversation-copy">
                        <strong>{conversationLabel(conversation)}</strong>
                        <small>{conversation.last_message_preview || `${conversation.peer?.role ?? 'Direct message'} conversation`}</small>
                        <span className="ai-chat-conversation-meta">
                            <span>{conversation.peer?.role ?? 'Direct message'}</span>
                            <time dateTime={conversation.updated_at}>{formatChatTimestamp(conversation.updated_at)}</time>
                        </span>
                        {(conversation.unread_count ?? 0) > 0
                            ? <span className="ai-chat-unread" aria-label={`${conversation.unread_count} unread messages`}>{conversation.unread_count}</span>
                            : conversation.unread && <span className="ai-chat-unread" aria-label="Unread messages">Unread</span>}
                    </span>
                    <span className="ai-chat-card-chevron" aria-hidden="true">›</span>
                </button>)}
                {historyPage < historyLastPage && <button type="button" className="ai-chat-load-more" disabled={loadingMoreHistory} onClick={() => void loadMoreConversations()}>{loadingMoreHistory ? 'Loading more...' : 'Load more conversations'}</button>}
            </nav> : conversationSearch.trim() ? <div className="ai-chat-history-empty">
                <p>No conversations match “{conversationSearch.trim()}”.</p>
                <button type="button" onClick={() => setConversationSearch('')}>Clear search</button>
            </div> : <div className="ai-chat-history-empty">
                <p>No direct conversations yet.</p>
                <span>Choose New message to start a conversation with an eligible account.</span>
            </div>}
        </aside>
        <div className="ai-chat-panel" id="chat-ai-panel" role={mobileArea === 'ai' ? 'tabpanel' : undefined} aria-labelledby={mobileArea === 'ai' ? 'chat-ai-tab' : undefined}>
            <header className="ai-chat-header">
                <div className="ai-chat-header-identity">
                    {mode === 'direct' && <button type="button" className="ai-chat-mobile-back" aria-label="Back to conversations" title="Back to conversations" onClick={() => setMobileThreadOpen(false)}>
                        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                            <path d="M19 12H5m7 7-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>}
                    {selected
                        ? <ConversationAvatar conversation={selected} size="header" />
                        : <span className={`ai-chat-header-avatar${mode === 'ai' ? ' ai' : ''}`} aria-hidden="true">{mode === 'direct' ? 'DM' : 'AI'}</span>}
                    <div className="ai-chat-header-copy">
                        {onBack && <button type="button" className="ai-chat-back" onClick={onBack}>← Delivery dashboard</button>}
                        <p className="eyebrow">{mode === 'direct' ? selectedPeer?.role ?? 'DIRECT MESSAGE' : `FARMGATE · ${role}`}</p>
                        <h1>{threadTitle}</h1>
                        <p>{mode === 'direct'
                            ? selectedPeer ? 'Direct conversation' : 'Find someone to message.'
                            : 'Your private AI chat.'}</p>
                    </div>
                </div>
                {selectedAI && <div className="ai-chat-header-actions">
                    <button type="button" className="ai-chat-delete" aria-label="Clear AI chat" disabled={loading || conversationLoading} onClick={() => void clearAIChat(selected)}>Clear AI chat</button>
                    {report && <button type="button" className="ai-chat-clear-context" aria-label="Clear report context" title="Clear report context" onClick={() => void clearReportContext()}>Clear context</button>}
                </div>}
            </header>
            <div className="ai-chat-contexts">
            {mode === 'ai' && historyNoticeVisible && <aside className="ai-chat-history-notice" role="status">
                <span>Your AI messages stay in one conversation history.</span>
                <button type="button" aria-label="Dismiss AI history notice" title="Dismiss notice" onClick={() => setHistoryNoticeVisible(false)}>×</button>
            </aside>}
            {orderId && orderContextLoading && <p className="ai-chat-context-loading" role="status">Loading order context...</p>}
            {orderId && !orderContextLoading && !orderContext && <p className="ai-chat-context-error" role="alert">{orderContextError || 'Order context is unavailable. You can still chat without it.'}</p>}
            {!contextCardDismissed && orderId && orderContext && <aside className="ai-chat-order-context" aria-label="Order context">
                <div className="ai-chat-context-copy">
                    {orderContext.items[0]?.listing?.image_url
                        ? <img src={orderContext.items[0].listing.image_url} alt="" />
                        : <span className="ai-chat-context-placeholder" aria-hidden="true">FG</span>}
                    <span>
                        <small>ORDER CONTEXT</small>
                        <strong>{orderContext.items[0]?.listing?.name ?? 'Livestock order'}</strong>
                        <em>Order {orderContext.order_reference}{orderContext.items.length > 1 ? ` · ${orderContext.items.length} listings` : ''}</em>
                    </span>
                </div>
                <button type="button" className="ai-chat-context-dismiss" aria-label="Dismiss order context" onClick={() => setContextCardDismissed(true)}>×</button>
            </aside>}
            {!contextCardDismissed && !orderId && selected?.kind === 'direct' && selected.listing && <aside className="ai-chat-listing-context" aria-label="Listing context">
                <a href={selected.listing.href} aria-label={`Open listing: ${selected.listing.name}`}>
                    {selected.listing.image_url ? <img src={selected.listing.image_url} alt="" /> : <span aria-hidden="true">{selected.listing.name.slice(0, 1)}</span>}
                    <span><small>LISTING CONTEXT</small><strong>{selected.listing.name}</strong><em>Open listing</em></span>
                </a>
                <button type="button" className="ai-chat-context-dismiss" aria-label="Dismiss listing context" onClick={() => setContextCardDismissed(true)}>×</button>
            </aside>}
            {selected?.kind === 'direct' && selected.listing && role === 'SELLER' && selected.peer?.role === 'BUYER' && <aside className="ai-chat-product-ai-control" aria-label="Product chat assistant settings">
                <p>{selected.ai_paused ? 'Farmgate AI is paused. You are handling buyer replies.' : 'Farmgate AI can answer listing questions and hand off when seller input is needed.'}</p>
                <button type="button" disabled={loading} onClick={() => void setProductAiPaused(!selected.ai_paused)}>{selected.ai_paused ? 'Resume Farmgate AI' : 'Take over conversation'}</button>
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
            {selected?.needs_human_attention && <aside className="ai-chat-attention" role="status">This conversation needs human attention. Farmgate AI does not make refund, complaint, or other policy decisions.</aside>}
            </div>
            <div ref={messagesPaneRef} className="ai-chat-messages" role="log" aria-live="polite" aria-label="Conversation messages" aria-busy={conversationLoading || loading} tabIndex={0}>
                {messagesHaveMore && <button className="ai-chat-load-older" type="button" disabled={loadingOlder} onClick={() => void loadOlderMessages()}>{loadingOlder ? 'Loading earlier messages…' : 'Load earlier messages'}</button>}
                {conversationLoading && <div className="ai-chat-loading-state" role="status">Loading conversation...</div>}
                {!conversationLoading && mode === 'ai' && aiHistoryLoading && !aiHistoryReady && <div className="ai-chat-loading-state" role="status">Loading your Farmgate AI history...</div>}
                {!conversationLoading && mode === 'ai' && aiHistoryError && <div className="ai-chat-history-error" role="alert">
                    <p>{aiHistoryError}</p>
                    <button type="button" onClick={() => void continueAIChat()}>Try again</button>
                </div>}
                {!conversationLoading && !messages.length && !(mode === 'ai' && (!aiHistoryReady || aiHistoryError)) && <div className="ai-chat-welcome"><span className={`ai-chat-ai-mark${mode === 'direct' ? ' direct' : ''}`} aria-hidden="true">{mode === 'ai' ? 'AI' : 'DM'}</span><h2>{mode === 'ai' ? 'How can I help?' : selected?.peer ? `Message ${selected.peer.name}` : 'Choose a conversation'}</h2><p>{mode === 'ai' ? copy.welcome : selected ? 'Messages are visible to the conversation participants.' : 'Start a new message or select a conversation from your inbox.'}</p>{mode === 'ai' && <div className="ai-chat-suggestions">{copy.suggestions.map((suggestion) => <button type="button" key={suggestion} disabled={loading} onClick={() => void sendMessage(suggestion)}>{suggestion}</button>)}</div>}</div>}
                {messages.map((message) => {
                    const orderPreviews = message.order_previews ?? [];
                    return <article key={message.id} className={`ai-chat-message ${message.is_mine ? 'user' : 'assistant'}${message.role === 'assistant' && mode === 'direct' ? ' ai-chat-product-answer' : ''}`}>
                        <span>{mode === 'direct' ? (message.role === 'assistant' ? 'Farmgate AI' : message.is_mine ? 'You' : selected?.peer?.name ?? 'Participant') : (message.role === 'assistant' ? 'Automated · FARMGATE AI' : 'You')}</span>
                        <MessageContent content={message.content} previews={orderPreviews} onOpenOrder={onOpenOrder} />
                        {orderPreviews.length > 0 && <div className="ai-chat-order-previews" aria-label="Livestock mentioned in this message">
                            {orderPreviews.map((preview) => <ChatOrderPreviewCard key={preview.order_id} preview={preview} onOpenOrder={onOpenOrder} />)}
                        </div>}
                        <time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString()}</time>
                    </article>;
                })}
                {loading && <div className="ai-chat-typing" role="status">{recipientPickerOpen ? 'Starting conversation...' : mode === 'ai' ? 'FARMGATE AI is thinking...' : 'Sending message...'}</div>}
                {error && <div className="ai-chat-error" role="alert"><span>{error}</span>{failedMessage && <button type="button" disabled={loading} onClick={() => void sendMessage(failedMessage)}>Retry</button>}</div>}
            </div>
            <form className="ai-chat-composer" onSubmit={submit}>
                <textarea ref={messageInputRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                    }
                }} placeholder={mode === 'ai' ? 'Ask FARMGATE AI… (Enter to send, Shift+Enter for a new line)' : 'Write a message… (Enter to send, Shift+Enter for a new line)'} maxLength={2000} rows={2} disabled={loading || conversationLoading || orderContextLoading || (mode === 'direct' && (!selected || (orderId !== undefined && !orderContext)))} aria-label={mode === 'ai' ? 'Message to FARMGATE AI' : 'Direct message'} />
                <button type="submit" aria-label={loading ? 'Sending message' : 'Send message'} disabled={loading || conversationLoading || !input.trim() || (mode === 'direct' && (!selected || (orderId !== undefined && !orderContext)))}>{loading ? 'Sending…' : 'Send'}</button>
            </form>
        </div>
    </section>;
}
