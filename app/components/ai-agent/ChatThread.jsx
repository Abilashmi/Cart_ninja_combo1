import { useRef, useEffect, useCallback } from "react";
import {
  Box, BlockStack, InlineStack, Text, Button, Icon, Avatar, Badge, TextField,
} from "@shopify/polaris";
import { ClockIcon, SendIcon } from "@shopify/polaris-icons";

function ChatBubble({ message, onAction }) {
  const isUser = message.role === "user";
  const hasActions = message.actions && message.actions.length > 0;

  const formattedText = message.text
    ? message.text.split("\n").map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <br key={i} />;
        const parts = trimmed.split(/(\*\*[^*]+\*\*)/g);
        return (
          <span key={i}>
            {parts.map((part, j) => {
              if (part.startsWith("**") && part.endsWith("**")) {
                return <strong key={j}>{part.slice(2, -2)}</strong>;
              }
              if (part.startsWith("\u2022")) {
                return <span key={j} style={{ display: "block", paddingLeft: 8 }}>{part}</span>;
              }
              if (/^\d+\./.test(part)) {
                return <span key={j} style={{ display: "block", paddingLeft: 8 }}>{part}</span>;
              }
              return <span key={j}>{part}</span>;
            })}
          </span>
        );
      })
    : null;

  return (
    <InlineStack gap="200" wrap={false} align={isUser ? "end" : "start"}>
      {!isUser && <Avatar name="AI" size="small" />}
      <BlockStack gap="150" style={{ maxWidth: "600px", alignItems: isUser ? "end" : "start" }}>
        <Box
          borderRadius="300"
          padding="300"
          background={isUser ? "bg-fill-brand" : "bg-surface-secondary"}
          style={{
            borderBottomRightRadius: isUser ? 4 : 12,
            borderBottomLeftRadius: isUser ? 12 : 4,
          }}
        >
          <Text
            as="p"
            variant="bodyMd"
            tone={isUser ? "text-brand-on-bg-fill" : undefined}
            style={{ lineHeight: 1.6 }}
          >
            {formattedText}
          </Text>
        </Box>

        {hasActions && (
          <InlineStack gap="200" wrap>
            {message.actions.map((act) => (
              <button
                key={act.action}
                onClick={() => onAction?.(act.action)}
                style={{
                  padding: "6px 16px",
                  borderRadius: "var(--p-border-radius-200)",
                  border: act.primary
                    ? "none"
                    : "1px solid var(--p-color-border)",
                  background: act.primary
                    ? "var(--p-color-bg-fill-brand)"
                    : "var(--p-color-bg-surface)",
                  color: act.primary
                    ? "var(--p-color-text-brand-on-bg-fill)"
                    : "var(--p-color-text)",
                  fontSize: "var(--p-font-size-300)",
                  fontWeight: 500,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  boxShadow: act.primary ? "var(--p-shadow-200)" : "none",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-1px)";
                  e.currentTarget.style.boxShadow = "var(--p-shadow-300)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "none";
                  e.currentTarget.style.boxShadow = act.primary ? "var(--p-shadow-200)" : "none";
                }}
              >
                {act.primary && "\u2713 "}
                {act.label}
              </button>
            ))}
          </InlineStack>
        )}
      </BlockStack>
    </InlineStack>
  );
}

export default function ChatThread({
  messages,
  typing,
  onSend,
  suggestions,
  onSuggestionClick,
  onToggleHistory,
  showHistory,
  insight,
  onAskFollowUp,
  onAction,
  input,
  setInput,
}) {
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, typing]);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setInput("");
  }, [input, onSend, setInput]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const hasMetrics = messages.some((m) => m.type === "metric");
  const hasActions = messages.some((m) => m.actions?.length > 0);

  return (
    <div className="ai-chat-panel">
      <Box padding="300" borderBlockEnd="025" background="bg-surface">
        <InlineStack gap="300" blockAlign="center">
          <Button
            variant="tertiary"
            icon={ClockIcon}
            onClick={onToggleHistory}
            accessibilityLabel={showHistory ? "Close history" : "Open history"}
          />
          <Avatar name="AI" size="small" />
          <BlockStack gap="025">
            <InlineStack gap="150" blockAlign="center">
              <Text as="span" variant="headingSm" fontWeight="medium">Cart Ninja AI</Text>
              <Badge tone="success" size="small">Online</Badge>
            </InlineStack>
            <Text as="span" variant="bodyXs" tone="subdued">
              {messages.length} messages · {hasActions ? "Actions available" : hasMetrics ? "Data loaded" : "Ask me anything"}
            </Text>
          </BlockStack>
        </InlineStack>
      </Box>

      <div className="ai-chat-messages" ref={scrollRef}>
        <div className="ai-chat-messages-inner">
          {messages.length === 0 && suggestions.length > 0 && (
            <Box paddingBlock="200">
              <BlockStack gap="200">
                <InlineStack gap="100" blockAlign="center">
                  <Icon source={ClockIcon} />
                  <Text as="p" variant="bodySm" tone="subdued">Try asking:</Text>
                </InlineStack>
                <InlineStack gap="200" wrap>
                  {suggestions.map((chip) => (
                    <button
                      key={chip.id}
                      onClick={() => onSuggestionClick(chip.text)}
                      style={{
                        padding: "8px 18px",
                        borderRadius: "var(--p-border-radius-300)",
                        border: "1px solid var(--p-color-border)",
                        background: "var(--p-color-bg-surface)",
                        color: "var(--p-color-text)",
                        fontSize: "var(--p-font-size-300)",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                        fontWeight: 450,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = "var(--p-color-border-hover)";
                        e.currentTarget.style.background = "var(--p-color-bg-surface-hover)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = "var(--p-color-border)";
                        e.currentTarget.style.background = "var(--p-color-bg-surface)";
                      }}
                    >
                      {chip.text}
                    </button>
                  ))}
                </InlineStack>
              </BlockStack>
            </Box>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className="ai-msg-fade-in">
              <ChatBubble message={msg} onAction={onAction} />
            </div>
          ))}

          {insight && onAskFollowUp && (
            <InlineStack gap="200" wrap={false} align="start">
              <Avatar name="AI" size="small" />
              <Box background="bg-surface-info" borderRadius="300" padding="300">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm">Want to dig deeper into this data?</Text>
                  <Button variant="tertiary" onClick={() => onAskFollowUp("Break down by source")}>
                    Break down by source \u2192
                  </Button>
                </BlockStack>
              </Box>
            </InlineStack>
          )}

          {typing && (
            <InlineStack gap="200" wrap={false} align="start">
              <Avatar name="AI" size="small" />
              <Box background="bg-surface-secondary" borderRadius="300" padding="300">
                <div className="ai-typing">
                  <span className="ai-typing-dot" />
                  <span className="ai-typing-dot" style={{ animationDelay: "0.2s" }} />
                  <span className="ai-typing-dot" style={{ animationDelay: "0.4s" }} />
                </div>
              </Box>
            </InlineStack>
          )}
        </div>
      </div>

      <Box padding="300" borderBlockStart="025" background="bg-surface">
        <InlineStack gap="200" wrap={false} blockAlign="center">
          <div style={{ flex: 1, minWidth: 0 }}>
            <TextField
              ref={inputRef}
              value={input}
              onChange={setInput}
              onKeyDown={handleKeyDown}
              placeholder="Type your message..."
              autoComplete="off"
              multiline={1}
            />
          </div>
          <Button
            variant="primary"
            icon={SendIcon}
            onClick={handleSend}
            disabled={!input.trim() || typing}
            accessibilityLabel="Send message"
          />
        </InlineStack>
      </Box>
    </div>
  );
}
