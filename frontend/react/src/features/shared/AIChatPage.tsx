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
    report_context: Omit<ChatReportContext, 'title' | 'requestId'> | null;
    needs_human_attention: boolean;
    ai_paused: boolean;
    unread?: boolean;
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
        welcome: 'Ask FARMGATE AI, or start a direct conversation with another account.',
        suggestions: ['Summarize marketplace performance.', 'Explain the selected report.', 'What should I review in platform operations?'],
    },
    SELLER: {
        welcome: 'Ask FARMGATE AI, or message a buyer you have an order or listing interest with.',
        suggestions: ['Summarize my sales.', 'Which livestock listings performed best?', 'Explain the selected report.'],
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
    return conversation.title || 'New AI conversation';
}

function conversationInitials(name: string): string {
    return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || 'FG';
}

export function AIChatPage({ role, reportContext: incomingReport, onBack, initialConversationId, onUnreadMessagesRead, orderId, onOpenOrder }: {
    role: UserRole;
    reportContext?: ChatReportContext | null;
    onBack?: () => void;
    initialConversationId?: number;
    onUnreadMessagesRead?: () => void | Promise<void>;
    orderId?: number;
    onOpenOrder?: (orderId: number) => void;
}) {
    const [conversations, setConversations] = React.useState<ChatConversation[]>([]);
    const [selected, setSelected] = React.useState<ChatConversation | null>(null);
    const [mode, setMode] = React.useState<ChatKind>('ai');
    const [report, setReport] = React.useState<ChatReportContext | null>(incomingReport ?? null);
    const [messages, setMessages] = React.useState<ChatMessage[]>([]);
    const [input, setInput] = React.useState('');
    const [loading, setLoading] = React.useState(false);
    const [loadingHistory, setLoadingHistory] = React.useState(true);
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
    const messagesPaneRef = React.useRef<HTMLDivElement>(null);
    const messageInputRef = React.useRef<HTMLTextAreaElement>(null);
    const shouldScrollToLatestRef = React.useRef(true);
    const prependScrollHeightRef = React.useRef<number | null>(null);
    const requestLock = React.useRef(false);
    const pendingDirectAttempt = React.useRef<{ content: string; id: string } | null>(null);
    const conversationRequestId = React.useRef(0);
    const historyRequestVersion = React.useRef(0);
    const listingContextStarted = React.useRef(false);
    const lastReportRequest = React.useRef<number | string | null>(null);
    const lastInitialConversation = React.useRef<number | null>(null);
    const sendRef = React.useRef<(text: string, context?: ChatReportContext | null, conversation?: ChatConversation | null) => Promise<void>>(async () => {});
    const copy = roleCopy[role];

    const fetchConversations = React.useCallback((search: string, page = 1) => api.get<{
        data: ChatConversation[];
        current_page: number;
        last_page: number;
    }>('/api/chat/conversations', { params: { page, ...(search ? { search } : {}) } }), []);

    const loadConversations = React.useCallback(async (search = conversationSearch.trim(), page = 1, append = false) => {
        const requestVersion = ++historyRequestVersion.current;
        try {
            const response = await fetchConversations(search, page);
            if (requestVersion !== historyRequestVersion.current) return;
            setConversations((current) => append
                ? [...current, ...response.data.data.filter((conversation) => !current.some((item) => item.id === conversation.id))]
                : response.data.data);
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
                    setConversations(response.data.data);
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
                    ? { ...response.data.conversation, unread: false }
                    : item));
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
                shouldScrollToLatestRef.current = true;
                setMessages((current) => [...current, response.data.user_message, response.data.assistant_message]);
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
        if (!incomingReport) return;
        const key = incomingReport.requestId ?? JSON.stringify(incomingReport);
        if (lastReportRequest.current === key) return;
        lastReportRequest.current = key;
        setMobileThreadOpen(true);
        setMode('ai');
        setSelected(null);
        shouldScrollToLatestRef.current = true;
        setMessages([]);
        setReport(incomingReport);
        setContextCleared(false);
        setContextCardDismissed(false);
        void sendRef.current('Please analyze the selected report. Explain the verified data, key patterns, and any limitations without assuming causes.', incomingReport, null);
    }, [incomingReport]);

    async function openConversation(conversationId: number) {
        const requestId = ++conversationRequestId.current;
        const summary = conversations.find((item) => item.id === conversationId);
        setMobileThreadOpen(true);
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
            shouldScrollToLatestRef.current = true;
            setMessages(response.data.messages);
            setMessagesHaveMore(response.data.messages_has_more);
            if (response.data.conversation.kind === 'direct') onUnreadMessagesRead?.();
            setConversations((current) => current.map((item) => item.id === conversationId ? { ...item, unread: false } : item));
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

    async function loadMoreConversations() {
        if (loadingMoreHistory || historyPage >= historyLastPage) return;
        const requestVersion = ++historyRequestVersion.current;
        setLoadingMoreHistory(true);
        setHistoryError('');
        try {
            const response = await fetchConversations(conversationSearch.trim(), historyPage + 1);
            if (requestVersion !== historyRequestVersion.current) return;
            setConversations((current) => [...current, ...response.data.data.filter((conversation) => !current.some((item) => item.id === conversation.id))]);
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

    function startNewAIChat() {
        conversationRequestId.current += 1;
        setConversationLoading(false);
        setMobileThreadOpen(true);
        setSelected(null);
        setMode('ai');
        shouldScrollToLatestRef.current = true;
        setMessages([]);
        setMessagesHaveMore(false);
        setReport(null);
        setContextCleared(false);
        setContextCardDismissed(false);
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

    async function startDirectConversation(recipient: ChatPeer, listingId?: number) {
        setMobileThreadOpen(true);
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
        void sendMessage(text);
    }

    const selectedAI = selected?.kind === 'ai';
    const selectedPeer = selected?.kind === 'direct' ? selected.peer : null;
    const threadTitle = mode === 'direct' ? selectedPeer?.name ?? 'New message' : selected?.title || 'FARMGATE AI';

    return <section className={`ai-chat-page${mobileThreadOpen ? ' mobile-thread-open' : ''}`} aria-label="FARMGATE conversations">
        <aside className="ai-chat-sidebar">
            <div className="ai-chat-sidebar-heading"><h2>Messages</h2></div>
            <div className="chat-start-actions">
                <button type="button" onClick={startNewAIChat}>New AI chat</button>
                <button type="button" onClick={startDirectDraft}>New message</button>
            </div>
            <label className="ai-chat-search">
                <span className="sr-only">Search conversations</span>
                <input type="search" value={conversationSearch} onChange={(event) => setConversationSearch(event.target.value)} placeholder="Search conversations" autoComplete="off" />
                {conversationSearch && <button type="button" aria-label="Clear conversation search" onClick={() => setConversationSearch('')}>×</button>}
            </label>
            {historyError ? <div className="ai-chat-history-error" role="alert">
                <p>{historyError}</p>
                <button type="button" onClick={() => void retryConversationHistory()}>Try again</button>
            </div> : loadingHistory ? <p className="ai-chat-history-note" role="status">Loading conversations...</p> : conversations.length ? <nav aria-label="Chat history" aria-busy={loadingMoreHistory} tabIndex={0}>
                {conversations.map((conversation) => <button type="button" key={conversation.id} className={`${conversation.id === selected?.id ? 'active' : ''}${conversation.kind === 'ai' ? ' ai-conversation' : ''}`} aria-current={conversation.id === selected?.id ? 'true' : undefined} onClick={() => void openConversation(conversation.id)}>
                    <span className={`ai-chat-conversation-avatar${conversation.kind === 'ai' ? ' ai' : ''}`} aria-hidden="true">
                        {conversation.kind === 'ai' ? 'AI' : conversationInitials(conversationLabel(conversation))}
                    </span>
                    <span className="ai-chat-conversation-copy">
                        <strong>{conversationLabel(conversation)}</strong>
                        <small>{conversation.last_message_preview || (conversation.kind === 'ai' ? 'FARMGATE AI conversation' : `${conversation.peer?.role ?? 'Direct message'} conversation`)}</small>
                        <span className="ai-chat-conversation-meta">
                            <span>{conversation.kind === 'direct' ? conversation.peer?.role ?? 'Direct message' : 'FARMGATE AI'}</span>
                            <time dateTime={conversation.updated_at}>{new Date(conversation.updated_at).toLocaleDateString()}</time>
                        </span>
                        {conversation.unread && <span className="ai-chat-unread" aria-label="Unread messages">Unread</span>}
                    </span>
                </button>)}
                {historyPage < historyLastPage && <button type="button" className="ai-chat-load-more" disabled={loadingMoreHistory} onClick={() => void loadMoreConversations()}>{loadingMoreHistory ? 'Loading more...' : 'Load more conversations'}</button>}
            </nav> : conversationSearch.trim() ? <div className="ai-chat-history-empty">
                <p>No conversations match “{conversationSearch.trim()}”.</p>
                <button type="button" onClick={() => setConversationSearch('')}>Clear search</button>
            </div> : <div className="ai-chat-history-empty">
                <p>Your conversations will appear here.</p>
                <span>Start an AI chat or message someone to get started.</span>
            </div>}
        </aside>
        <div className="ai-chat-panel">
            <header className="ai-chat-header">
                <div className="ai-chat-header-identity">
                    <button type="button" className="ai-chat-mobile-back" aria-label="Back to messages" title="Back to messages" onClick={() => setMobileThreadOpen(false)}>
                        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                            <path d="M19 12H5m7 7-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                    <span className={`ai-chat-header-avatar${mode === 'ai' ? ' ai' : ''}`} aria-hidden="true">
                        {mode === 'direct' ? conversationInitials(selectedPeer?.name ?? 'Direct message') : 'AI'}
                    </span>
                    <div className="ai-chat-header-copy">
                        {onBack && <button type="button" className="ai-chat-back" onClick={onBack}>← Delivery dashboard</button>}
                        <p className="eyebrow">{mode === 'direct' ? selectedPeer?.role ?? 'DIRECT MESSAGE' : `FARMGATE · ${role}`}</p>
                        <h1>{threadTitle}</h1>
                        <p>{mode === 'direct'
                            ? selectedPeer ? 'Direct conversation' : 'Choose a conversation or find someone to message.'
                            : selected?.title ? 'Saved FARMGATE AI conversation' : 'Ask FARMGATE AI about Farmgate.'}</p>
                    </div>
                </div>
                {selectedAI && <div className="ai-chat-header-actions">
                    <button type="button" className="ai-chat-delete" onClick={() => void deleteConversation(selected)}>Delete chat</button>
                    {report && <button type="button" className="ai-chat-clear-context" onClick={() => void clearReportContext()}>Clear report context</button>}
                </div>}
            </header>
            <div className="ai-chat-contexts">
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
                {!conversationLoading && !messages.length && <div className="ai-chat-welcome"><span className={`ai-chat-ai-mark${mode === 'direct' ? ' direct' : ''}`} aria-hidden="true">{mode === 'ai' ? 'AI' : 'DM'}</span><h2>{mode === 'ai' ? 'How can I help?' : selected?.peer ? `Message ${selected.peer.name}` : 'Choose a conversation'}</h2><p>{mode === 'ai' ? copy.welcome : selected ? 'Messages are visible to the conversation participants.' : 'Start a new message or select a conversation from your inbox.'}</p>{mode === 'ai' && <div className="ai-chat-suggestions">{copy.suggestions.map((suggestion) => <button type="button" key={suggestion} disabled={loading} onClick={() => void sendMessage(suggestion)}>{suggestion}</button>)}</div>}</div>}
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
