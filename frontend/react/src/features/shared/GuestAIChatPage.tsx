import React from 'react';
import api, { initializeCsrf } from '../../lib/api';

type GuestMessage = {
    id: number;
    role: 'user' | 'assistant';
    content: string;
};

type GuestHistoryMessage = Pick<GuestMessage, 'role' | 'content'>;

export function GuestAIChatPage({ onBack }: { onBack: () => void }) {
    const [messages, setMessages] = React.useState<GuestMessage[]>([]);
    const [input, setInput] = React.useState('');
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState('');
    const [retry, setRetry] = React.useState<{ message: string; history: GuestHistoryMessage[] } | null>(null);
    const messageId = React.useRef(0);
    const messagesPaneRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        const pane = messagesPaneRef.current;
        if (pane) pane.scrollTop = pane.scrollHeight;
    }, [messages, loading]);

    async function sendMessage(
        text: string,
        history = messages.slice(-10).map(({ role, content }) => ({ role, content })),
        appendUserMessage = true,
    ) {
        const content = text.trim();
        if (!content || loading) return;

        if (appendUserMessage) {
            setMessages((current) => [...current, {
                id: ++messageId.current,
                role: 'user',
                content,
            }]);
            setInput('');
        }
        setError('');
        setLoading(true);

        try {
            await initializeCsrf();
            const response = await api.post<{ assistant_message: { role: 'assistant'; content: string } }>('/api/chat/guest-messages', {
                message: content,
                history,
            });
            setMessages((current) => [...current, {
                id: ++messageId.current,
                role: 'assistant',
                content: response.data.assistant_message.content,
            }]);
            setRetry(null);
        } catch (requestError: unknown) {
            const userMessage = typeof requestError === 'object'
                && requestError !== null
                && 'userMessage' in requestError
                && typeof requestError.userMessage === 'string'
                ? requestError.userMessage
                : null;
            setError(userMessage ?? 'FARMGATE AI is temporarily unavailable. Please try again.');
            setRetry({ message: content, history });
        } finally {
            setLoading(false);
        }
    }

    return <section className="ai-chat-page guest-ai-chat-page" aria-label="FARMGATE AI chat">
        <div className="ai-chat-panel">
            <header className="ai-chat-header">
                <div className="ai-chat-header-identity">
                    <span className="ai-chat-header-avatar ai" aria-hidden="true">AI</span>
                    <div className="ai-chat-header-copy">
                        <button type="button" className="ai-chat-back" onClick={onBack}>← Marketplace</button>
                        <p className="eyebrow">FARMGATE · GUEST CHAT</p>
                        <h1>FARMGATE AI</h1>
                        <p>Ask general questions about using Farmgate.</p>
                    </div>
                </div>
            </header>
            <div className="ai-chat-contexts">
                <p className="guest-ai-chat-note">Guest chats are not saved. Sign in for account-specific support. FARMGATE AI cannot access your orders or private details.</p>
            </div>
            <div ref={messagesPaneRef} className="ai-chat-messages" role="log" aria-live="polite" aria-label="FARMGATE AI conversation" aria-busy={loading} tabIndex={0}>
                {!messages.length && !loading && <div className="ai-chat-welcome">
                    <span className="ai-chat-ai-mark" aria-hidden="true">AI</span>
                    <h2>How can I help?</h2>
                    <p>I'm FARMGATE AI, here to answer general questions about the marketplace.</p>
                    <div className="ai-chat-suggestions">
                        {['How do I browse livestock?', 'How does delivery work?', 'How do I create an account?'].map((suggestion) =>
                            <button type="button" key={suggestion} disabled={loading} onClick={() => void sendMessage(suggestion)}>{suggestion}</button>)}
                    </div>
                </div>}
                {messages.map((message) => <article key={message.id} className={`ai-chat-message ${message.role === 'user' ? 'user' : 'assistant'}`}>
                    <span>{message.role === 'user' ? 'You' : 'FARMGATE AI'}</span>
                    <div className="ai-chat-message-content"><p>{message.content}</p></div>
                </article>)}
                {loading && <div className="ai-chat-typing" role="status">FARMGATE AI is thinking...</div>}
                {error && <div className="ai-chat-error" role="alert">
                    <span>{error}</span>
                    {retry && <button type="button" disabled={loading} onClick={() => void sendMessage(retry.message, retry.history, false)}>Retry</button>}
                </div>}
            </div>
            <form className="ai-chat-composer" onSubmit={(event) => {
                event.preventDefault();
                void sendMessage(input);
            }}>
                <label className="sr-only" htmlFor="guest-ai-chat-input">Message FARMGATE AI</label>
                <textarea id="guest-ai-chat-input" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        void sendMessage(input);
                    }
                }} placeholder="Ask FARMGATE AI… (Enter to send)" maxLength={2000} rows={2} disabled={loading} />
                <button type="submit" disabled={loading || !input.trim()}>{loading ? 'Sending…' : 'Send'}</button>
            </form>
        </div>
    </section>;
}
