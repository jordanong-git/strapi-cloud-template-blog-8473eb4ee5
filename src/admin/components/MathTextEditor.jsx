import React from "react";

import {
  Box,
  Button,
  Field,
  Flex,
  Modal,
  TextInput,
  Textarea,
  Typography,
} from "@strapi/design-system";

const TOOLBAR_SYMBOLS = [
  { label: "()", title: "Parentheses", value: "()", cursorOffset: -1 },
  { label: "[]", title: "Brackets", value: "[]", cursorOffset: -1 },
  { label: "x²", title: "Superscript", value: "^{}", cursorOffset: -1 },
  { label: "xₙ", title: "Subscript", value: "_{}", cursorOffset: -1 },
  { label: "±", title: "Plus minus", value: " \\pm " },
  { label: "×", title: "Multiply", value: " \\times " },
  { label: "÷", title: "Divide", value: " \\div " },
  { label: "≤", title: "Less than or equal", value: " \\le " },
  { label: "≥", title: "Greater than or equal", value: " \\ge " },
  { label: "π", title: "Pi", value: " \\pi " },
];

const SYMBOL_MAP = {
  pm: "±",
  times: "×",
  div: "÷",
  le: "≤",
  ge: "≥",
  pi: "π",
  theta: "θ",
  alpha: "α",
  beta: "β",
  gamma: "γ",
  cdot: "·",
};

const editorStyles = {
  shell: {
    border: "1px solid var(--strapi-colors-neutral200)",
    borderRadius: "18px",
    overflow: "hidden",
    background: "var(--strapi-colors-neutral0)",
  },
  toolbarWrap: {
    padding: "14px",
    borderBottom: "1px solid var(--strapi-colors-neutral200)",
    background: "var(--strapi-colors-neutral100)",
  },
  toolbarGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(56px, 1fr))",
    gap: "8px",
    width: "100%",
  },
  toolbarButton: {
    border: "1px solid var(--strapi-colors-neutral200)",
    background: "var(--strapi-colors-neutral0)",
    borderRadius: "14px",
    minWidth: "56px",
    minHeight: "44px",
    padding: "0 12px",
    cursor: "pointer",
    color: "inherit",
    font: "inherit",
    fontSize: "1rem",
    fontWeight: 600,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
  },
  inputWrap: {
    padding: "16px",
  },
  previewWrap: {
    padding: "0 16px 16px",
  },
  previewBox: {
    border: "1px solid var(--strapi-colors-neutral200)",
    borderRadius: "16px",
    background:
      "radial-gradient(circle at top left, rgba(124, 58, 237, 0.05), transparent 26%), var(--strapi-colors-neutral0)",
    padding: "16px",
    minHeight: "96px",
  },
  previewText: {
    fontSize: "1.1rem",
    lineHeight: 1.7,
    minHeight: "1.7em",
    wordBreak: "break-word",
  },
  helper: {
    padding: "0 16px 16px",
  },
};

const setForwardedRef = (ref, value) => {
  if (!ref) {
    return;
  }

  if (typeof ref === "function") {
    ref(value);
    return;
  }

  ref.current = value;
};

const createTextNode = (value) => ({
  type: "text",
  value,
});

const getTrailingTextCharacter = (node) => {
  if (!node) {
    return "";
  }

  if (node.type === "text") {
    return node.value.slice(-1);
  }

  if (node.type === "group") {
    return getTrailingTextCharacter(node.children?.[node.children.length - 1]);
  }

  if (node.type === "script") {
    return getTrailingTextCharacter(node.base);
  }

  return "";
};

const mergeTextNodes = (nodes) =>
  nodes.reduce((result, node) => {
    if (!node) {
      return result;
    }

    if (
      node.type === "text" &&
      result.length > 0 &&
      result[result.length - 1]?.type === "text"
    ) {
      result[result.length - 1] = createTextNode(
        `${result[result.length - 1].value}${node.value}`,
      );
      return result;
    }

    result.push(node);
    return result;
  }, []);

const parseLatexToNodes = (input) => {
  const value = typeof input === "string" ? input : "";
  let index = 0;

  const parseExpression = (stopCharacter) => {
    const nodes = [];

    while (index < value.length) {
      if (stopCharacter && value[index] === stopCharacter) {
        index += 1;
        break;
      }

      if (!stopCharacter && value[index] === "}") {
        nodes.push(createTextNode(value[index]));
        index += 1;
        continue;
      }

      const atom = parseAtom();
      const node = atom ? attachScripts(atom) : atom;

      if (node) {
        nodes.push(node);
      }
    }

    return mergeTextNodes(nodes);
  };

  const parseGroup = () => {
    if (value[index] !== "{") {
      return null;
    }

    index += 1;

    return {
      type: "group",
      children: parseExpression("}"),
    };
  };

  const parseCommand = () => {
    index += 1;

    if (index >= value.length) {
      return createTextNode("\\");
    }

    if (["(", ")", "[", "]"].includes(value[index])) {
      index += 1;
      return null;
    }

    let command = "";

    while (index < value.length && /[A-Za-z]/.test(value[index])) {
      command += value[index];
      index += 1;
    }

    if (!command) {
      const nextCharacter = value[index];
      index += 1;
      return createTextNode(nextCharacter || "");
    }

    if (command === "left" || command === "right") {
      if (index < value.length) {
        index += 1;
      }

      return null;
    }

    if (command === "frac") {
      const numerator = parseGroup() || createTextNode("?");
      const denominator = parseGroup() || createTextNode("?");

      return {
        type: "fraction",
        numerator,
        denominator,
      };
    }

    if (command === "sqrt") {
      const body = parseGroup() || createTextNode("?");

      return {
        type: "sqrt",
        body,
      };
    }

    if (SYMBOL_MAP[command]) {
      return createTextNode(SYMBOL_MAP[command]);
    }

    return createTextNode(`\\${command}`);
  };

  const parseAtom = () => {
    const character = value[index];

    if (character === "\\") {
      return parseCommand();
    }

    if (character === "{") {
      return parseGroup();
    }

    if (character === "$") {
      index += value[index + 1] === "$" ? 2 : 1;
      return null;
    }

    index += 1;
    return createTextNode(character);
  };

  const parseScriptArgument = () => {
    if (value[index] === "{") {
      return parseGroup() || createTextNode("");
    }

    return parseAtom() || createTextNode("");
  };

  const attachScripts = (baseNode) => {
    let node = baseNode;

    while (index < value.length && (value[index] === "^" || value[index] === "_")) {
      const marker = value[index];
      const trailingCharacter = getTrailingTextCharacter(node);
      const nextCharacter = value[index + 1] || "";

      const shouldTreatAsPlainText =
        !node ||
        /\s/.test(trailingCharacter) ||
        !nextCharacter ||
        /\s/.test(nextCharacter) ||
        nextCharacter === marker;

      if (shouldTreatAsPlainText) {
        break;
      }

      index += 1;
      const scriptNode = parseScriptArgument();

      if (node?.type === "script") {
        node = {
          ...node,
          [marker === "^" ? "sup" : "sub"]: scriptNode,
        };
      } else {
        node = {
          type: "script",
          base: node || createTextNode(""),
          sup: marker === "^" ? scriptNode : null,
          sub: marker === "_" ? scriptNode : null,
        };
      }
    }

    return node;
  };

  return parseExpression();
};

const renderMathNodes = (nodes, keyPrefix = "node") =>
  (Array.isArray(nodes) ? nodes : []).map((node, index) =>
    renderMathNode(node, `${keyPrefix}-${index}`),
  );

const renderMathNode = (node, key) => {
  if (!node) {
    return null;
  }

  if (node.type === "text") {
    return (
      <span key={key} style={{ whiteSpace: "pre-wrap" }}>
        {node.value}
      </span>
    );
  }

  if (node.type === "group") {
    return (
      <span
        key={key}
        style={{
          display: "inline-flex",
          alignItems: "baseline",
          flexWrap: "wrap",
        }}
      >
        {renderMathNodes(node.children, `${key}-group`)}
      </span>
    );
  }

  if (node.type === "fraction") {
    return (
      <span
        key={key}
        style={{
          display: "inline-flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          verticalAlign: "middle",
          margin: "0 0.2em",
          minWidth: "1.5em",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            justifyContent: "center",
            padding: "0 0.2em",
            fontSize: "0.9em",
          }}
        >
          {renderMathNode(node.numerator, `${key}-num`)}
        </span>
        <span
          style={{
            width: "100%",
            borderTop: "1px solid currentColor",
            margin: "0.08em 0",
          }}
        />
        <span
          style={{
            display: "inline-flex",
            justifyContent: "center",
            padding: "0 0.2em",
            fontSize: "0.9em",
          }}
        >
          {renderMathNode(node.denominator, `${key}-den`)}
        </span>
      </span>
    );
  }

  if (node.type === "sqrt") {
    return (
      <span
        key={key}
        style={{
          display: "inline-flex",
          alignItems: "flex-start",
          margin: "0 0.15em",
        }}
      >
        <span
          style={{
            fontSize: "1.15em",
            lineHeight: 1,
            paddingRight: "0.1em",
          }}
        >
          √
        </span>
        <span
          style={{
            borderTop: "1px solid currentColor",
            padding: "0.05em 0.2em 0 0.15em",
          }}
        >
          {renderMathNode(node.body, `${key}-body`)}
        </span>
      </span>
    );
  }

  if (node.type === "script") {
    return (
      <span
        key={key}
        style={{
          display: "inline-flex",
          alignItems: "flex-start",
          marginRight: "0.05em",
        }}
      >
        <span>{renderMathNode(node.base, `${key}-base`)}</span>
        <span
          style={{
            display: "inline-flex",
            flexDirection: "column",
            lineHeight: 1,
            marginLeft: "0.05em",
          }}
        >
          {node.sup ? (
            <span
              style={{
                fontSize: "0.7em",
                transform: "translateY(-0.2em)",
              }}
            >
              {renderMathNode(node.sup, `${key}-sup`)}
            </span>
          ) : null}
          {node.sub ? (
            <span
              style={{
                fontSize: "0.7em",
                transform: "translateY(0.1em)",
              }}
            >
              {renderMathNode(node.sub, `${key}-sub`)}
            </span>
          ) : null}
        </span>
      </span>
    );
  }

  return (
    <span key={key} style={{ whiteSpace: "pre-wrap" }}>
      {String(node)}
    </span>
  );
};

const Preview = ({ value }) => {
  const nodes = React.useMemo(() => parseLatexToNodes(value), [value]);

  return (
    <div style={editorStyles.previewBox}>
      <Flex direction="column" alignItems="stretch" gap={2}>
        <Typography variant="pi" fontWeight="bold">
          Visual Preview
        </Typography>
        <div style={editorStyles.previewText}>{renderMathNodes(nodes)}</div>
      </Flex>
    </div>
  );
};

const FractionButtonGlyph = () => (
  <span
    aria-hidden="true"
    style={{
      display: "inline-flex",
      flexDirection: "column",
      alignItems: "center",
      lineHeight: 1,
      minWidth: "1.25em",
    }}
  >
    <span style={{ fontSize: "0.68em" }}>a</span>
    <span
      style={{
        width: "100%",
        borderTop: "1px solid currentColor",
        margin: "0.08em 0",
      }}
    />
    <span style={{ fontSize: "0.68em" }}>b</span>
  </span>
);

const MathTextEditor = React.forwardRef(
  (
    {
      name,
      label,
      hint,
      error,
      required,
      disabled,
      labelAction,
      placeholder,
      value,
      onChange,
      multiline = false,
      rows = 6,
    },
    forwardedRef,
  ) => {
    const inputRef = React.useRef(null);
    const selectionRef = React.useRef(null);
    const [isFractionModalOpen, setIsFractionModalOpen] = React.useState(false);
    const [isSqrtModalOpen, setIsSqrtModalOpen] = React.useState(false);
    const [numerator, setNumerator] = React.useState("");
    const [denominator, setDenominator] = React.useState("");
    const [sqrtValue, setSqrtValue] = React.useState("");

    const currentValue = typeof value === "string" ? value : "";
    const InputComponent = multiline ? Textarea : TextInput;

    const assignInputRef = React.useCallback(
      (node) => {
        inputRef.current = node;
        setForwardedRef(forwardedRef, node);
      },
      [forwardedRef],
    );

    const emitValue = React.useCallback(
      (nextValue) => {
        onChange?.(nextValue);
      },
      [onChange],
    );

    const rememberSelection = React.useCallback(() => {
      const input = inputRef.current;

      if (!input) {
        selectionRef.current = null;
        return;
      }

      selectionRef.current = {
        start: input.selectionStart ?? currentValue.length,
        end: input.selectionEnd ?? currentValue.length,
      };
    }, [currentValue.length]);

    const insertSnippet = React.useCallback(
      (snippet, cursorOffset = 0) => {
        const selection = selectionRef.current || {
          start: inputRef.current?.selectionStart ?? currentValue.length,
          end: inputRef.current?.selectionEnd ?? currentValue.length,
        };

        const safeStart = Math.max(0, selection.start ?? 0);
        const safeEnd = Math.max(safeStart, selection.end ?? safeStart);
        const nextValue = `${currentValue.slice(0, safeStart)}${snippet}${currentValue.slice(
          safeEnd,
        )}`;

        emitValue(nextValue);

        window.requestAnimationFrame(() => {
          const input = inputRef.current;
          if (!input) {
            return;
          }

          const targetPosition = safeStart + snippet.length + cursorOffset;
          input.focus();
          input.setSelectionRange(targetPosition, targetPosition);
          selectionRef.current = {
            start: targetPosition,
            end: targetPosition,
          };
        });
      },
      [currentValue, emitValue],
    );

    const openFractionModal = React.useCallback(() => {
      rememberSelection();
      setNumerator("");
      setDenominator("");
      setIsFractionModalOpen(true);
    }, [rememberSelection]);

    const openSqrtModal = React.useCallback(() => {
      rememberSelection();
      setSqrtValue("");
      setIsSqrtModalOpen(true);
    }, [rememberSelection]);

    const insertFraction = React.useCallback(() => {
      const nextNumerator = numerator.trim() || "a";
      const nextDenominator = denominator.trim() || "b";

      insertSnippet(`\\frac{${nextNumerator}}{${nextDenominator}}`);
      setIsFractionModalOpen(false);
    }, [denominator, insertSnippet, numerator]);

    const insertSqrt = React.useCallback(() => {
      const nextSqrtValue = sqrtValue.trim() || "x";

      insertSnippet(`\\sqrt{${nextSqrtValue}}`);
      setIsSqrtModalOpen(false);
    }, [insertSnippet, sqrtValue]);

    const fractionPreviewValue = `\\frac{${numerator.trim() || "a"}}{${denominator.trim() || "b"}}`;
    const sqrtPreviewValue = `\\sqrt{${sqrtValue.trim() || "x"}}`;

    return (
      <Field.Root error={error} name={name} hint={hint} required={required}>
        <Flex direction="column" alignItems="stretch" gap={3}>
          {label ? <Field.Label action={labelAction}>{label}</Field.Label> : null}

          <div style={editorStyles.shell}>
            <div style={editorStyles.toolbarWrap}>
              <Flex direction="column" alignItems="stretch" gap={2}>
                <Typography variant="pi" textColor="neutral600">
                  Insert symbols
                </Typography>
                <div style={editorStyles.toolbarGrid}>
                  <button
                    type="button"
                    style={editorStyles.toolbarButton}
                    onClick={openFractionModal}
                    disabled={disabled}
                    title="Fraction"
                  >
                    <FractionButtonGlyph />
                  </button>

                  <button
                    type="button"
                    style={editorStyles.toolbarButton}
                    onClick={openSqrtModal}
                    disabled={disabled}
                    title="Square root"
                  >
                    √
                  </button>

                  {TOOLBAR_SYMBOLS.map((symbol) => (
                    <button
                      key={symbol.title}
                      type="button"
                      style={editorStyles.toolbarButton}
                      onClick={() => {
                        rememberSelection();
                        insertSnippet(symbol.value, symbol.cursorOffset ?? 0);
                      }}
                      disabled={disabled}
                      title={symbol.title}
                    >
                      {symbol.label}
                    </button>
                  ))}
                </div>
              </Flex>
            </div>

            <div style={editorStyles.inputWrap}>
              <InputComponent
                ref={assignInputRef}
                name={name}
                value={currentValue}
                onChange={(event) => emitValue(event.target.value)}
                onSelect={rememberSelection}
                onClick={rememberSelection}
                onKeyUp={rememberSelection}
                onFocus={rememberSelection}
                placeholder={placeholder}
                disabled={disabled}
                required={required}
                hasError={Boolean(error)}
                {...(multiline ? { rows, resizable: true } : {})}
              />
            </div>

            <div style={editorStyles.previewWrap}>
              <Preview value={currentValue} />
            </div>

            <div style={editorStyles.helper}>
              <Typography variant="pi" textColor="neutral600">
                Edit LaTeX in the input above. The preview updates immediately below it.
              </Typography>
            </div>
          </div>

          <Field.Hint />
          <Field.Error />

          <Modal.Root open={isFractionModalOpen} onOpenChange={setIsFractionModalOpen}>
            <Modal.Content>
              <Modal.Header>
                <Modal.Title>Insert Fraction</Modal.Title>
              </Modal.Header>

              <Modal.Body>
                <Flex direction="column" alignItems="stretch" gap={4}>
                  <TextInput
                    label="Numerator"
                    name={`${name}-fraction-numerator`}
                    value={numerator}
                    onChange={(event) => setNumerator(event.target.value)}
                    placeholder="Example: x + 1"
                    autoFocus
                  />

                  <TextInput
                    label="Denominator"
                    name={`${name}-fraction-denominator`}
                    value={denominator}
                    onChange={(event) => setDenominator(event.target.value)}
                    placeholder="Example: 2"
                  />

                  <Preview value={fractionPreviewValue} />
                </Flex>
              </Modal.Body>

              <Modal.Footer>
                <Button
                  type="button"
                  variant="tertiary"
                  onClick={() => setIsFractionModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="button" onClick={insertFraction}>
                  Insert Fraction
                </Button>
              </Modal.Footer>
            </Modal.Content>
          </Modal.Root>

          <Modal.Root open={isSqrtModalOpen} onOpenChange={setIsSqrtModalOpen}>
            <Modal.Content>
              <Modal.Header>
                <Modal.Title>Insert Square Root</Modal.Title>
              </Modal.Header>

              <Modal.Body>
                <Flex direction="column" alignItems="stretch" gap={4}>
                  <TextInput
                    label="Inside square root"
                    name={`${name}-sqrt-value`}
                    value={sqrtValue}
                    onChange={(event) => setSqrtValue(event.target.value)}
                    placeholder="Example: 54"
                    autoFocus
                  />

                  <Preview value={sqrtPreviewValue} />
                </Flex>
              </Modal.Body>

              <Modal.Footer>
                <Button
                  type="button"
                  variant="tertiary"
                  onClick={() => setIsSqrtModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="button" onClick={insertSqrt}>
                  Insert Square Root
                </Button>
              </Modal.Footer>
            </Modal.Content>
          </Modal.Root>
        </Flex>
      </Field.Root>
    );
  },
);

MathTextEditor.displayName = "MathTextEditor";

export default MathTextEditor;
