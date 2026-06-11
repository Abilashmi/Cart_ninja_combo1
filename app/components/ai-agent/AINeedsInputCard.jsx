import { useState, useMemo } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  TextField,
  Icon,
} from "@shopify/polaris";
import { QuestionCircleIcon } from "@shopify/polaris-icons";

function parseOptions(question) {
  const match = question.match(/\(([^)]+)\)/);
  if (!match) return null;
  return match[1].split(/[,|]|\sor\s/).map((s) => s.trim()).filter(Boolean);
}

function labelForQuestion(question) {
  const lower = question.toLowerCase();
  if (/colou?r|theme/.test(lower)) return "Select option";
  if (/threshold|goal|amount/.test(lower)) return "Enter amount";
  if (/text|message|content/.test(lower)) return "Enter text";
  return "Choose an option";
}

export default function AINeedsInputCard({ question, onSubmit }) {
  const options = useMemo(() => parseOptions(question), [question]);
  const [textVal, setTextVal] = useState("");

  if (options && options.length > 0) {
    return (
      <div className="aia-needs-input aia-slide-in">
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="200" align="start">
              <Icon source={QuestionCircleIcon} tone="info" />
              <Text as="span" variant="bodyMd">
                {question}
              </Text>
            </InlineStack>
            <div className="aia-option-grid">
              {options.map((opt) => (
                <Button
                  key={opt}
                  onClick={() => onSubmit(opt)}
                  variant="secondary"
                >
                  {opt.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                </Button>
              ))}
            </div>
          </BlockStack>
        </Card>
      </div>
    );
  }

  return (
    <div className="aia-needs-input aia-slide-in">
      <Card>
        <BlockStack gap="300">
          <InlineStack gap="200" align="start">
            <Icon source={QuestionCircleIcon} tone="info" />
            <Text as="span" variant="bodyMd">
              {question}
            </Text>
          </InlineStack>
          <InlineStack gap="200" align="start" blockAlign="end">
            <div style={{ flex: 1 }}>
              <TextField
                label={labelForQuestion(question)}
                labelHidden
                value={textVal}
                onChange={setTextVal}
                autoComplete="off"
                placeholder={labelForQuestion(question)}
              />
            </div>
            <Button
              variant="primary"
              disabled={!textVal.trim()}
              onClick={() => { onSubmit(textVal.trim()); setTextVal(""); }}
            >
              Submit
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>
    </div>
  );
}
