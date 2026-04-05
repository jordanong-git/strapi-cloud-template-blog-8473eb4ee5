/// <reference path="../../../types/admin-custom.d.ts" />
// @ts-check

import React from "react";

import { Alert, Box, Button, Field, Flex, Textarea, Typography } from "@strapi/design-system";
import { Pencil } from "@strapi/icons";
import { useField } from "@strapi/admin/strapi-admin";
import { loadMathType } from "./loadMathType";

const MATHTYPE_ENABLED =
  String(process.env.STRAPI_ADMIN_MATHTYPE_ENABLED || "").toLowerCase() === "true";
const MATHTYPE_CONFIGURATION_SERVICE =
  process.env.STRAPI_ADMIN_MATHTYPE_CONFIGURATION_SERVICE || "";
const MATHTYPE_LANGUAGE = process.env.STRAPI_ADMIN_MATHTYPE_LANGUAGE || "en";
const MATHTYPE_IS_CONFIGURED = MATHTYPE_ENABLED && Boolean(MATHTYPE_CONFIGURATION_SERVICE);

/**
 * @typedef {object} MathTypeTextInputProps
 * @property {string} name
 * @property {string} [label]
 * @property {string} [hint]
 * @property {boolean} [required]
 * @property {boolean} [disabled]
 * @property {React.ReactNode} [labelAction]
 */

/**
 * @param {import("react").ForwardedRef<HTMLElement>} ref
 * @param {HTMLElement | null} node
 * @returns {void}
 */
const assignForwardedRef = (ref, node) => {
  if (typeof ref === "function") {
    ref(node);
    return;
  }

  if (ref && "current" in ref) {
    ref.current = node;
  }
};

/**
 * @param {string} value
 * @returns {string}
 */
const escapeHtml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/**
 * @param {unknown} value
 * @returns {string}
 */
const normalizeStoredValue = (value) => {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || typeof value === "undefined") {
    return "";
  }

  return String(value);
};

/**
 * @param {string} value
 * @returns {string}
 */
const textToEditorHtml = (value) => {
  if (!value) {
    return "";
  }

  return escapeHtml(value).replace(/\r\n/g, "\n").replace(/\n/g, "<br>");
};

/**
 * @param {string} html
 * @returns {string}
 */
const htmlToPlainText = (html) => {
  const normalizedHtml = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li|ul|ol|h[1-6])>/gi, "\n")
    .replace(/<(div|p|li|ul|ol|h[1-6])[^>]*>/gi, "");

  const container = document.createElement("div");
  container.innerHTML = normalizedHtml;

  return (container.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/\n{3,}/g, "\n\n");
};

/**
 * @param {string} html
 * @returns {string}
 */
const serializeEditorHtml = (html) => {
  if (!html) {
    return "";
  }

  const parser = window.WirisPlugin?.Parser;
  const parsedHtml = parser ? parser.initParse(html) : html;

  return htmlToPlainText(parsedHtml);
};

/**
 * @param {Node} node
 * @param {number} offset
 * @returns {void}
 */
const setCaretWithinNode = (node, offset) => {
  const selection = window.getSelection();

  if (!selection) {
    return;
  }

  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
};

/**
 * @param {string} text
 * @returns {boolean}
 */
const insertTextAtCursor = (text) => {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return false;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();

  const textNode = document.createTextNode(text);
  range.insertNode(textNode);
  setCaretWithinNode(textNode, text.length);
  return true;
};

/**
 * @param {HTMLElement} editorElement
 * @returns {void}
 */
const insertMathPlaceholder = (editorElement) => {
  editorElement.focus();

  if (insertTextAtCursor("$$$$")) {
    const selection = window.getSelection();

    if (selection?.rangeCount) {
      const range = selection.getRangeAt(0);
      const node = range.startContainer;
      const offset = range.startOffset;

      if (node.nodeType === Node.TEXT_NODE && offset >= 2) {
        setCaretWithinNode(node, offset - 2);
      }
    }

    return;
  }

  const currentText = editorElement.textContent || "";
  editorElement.textContent = `${currentText}$$$$`;

  const lastNode = editorElement.lastChild;
  if (lastNode) {
    setCaretWithinNode(lastNode, Math.max((lastNode.textContent || "").length - 2, 0));
  }
};

const MathTypeTextInput = React.forwardRef(
  /**
   * @param {MathTypeTextInputProps} props
   * @param {import("react").ForwardedRef<HTMLElement>} ref
   */
  ({ name, label, hint, required, disabled, labelAction }, ref) => {
    const field = useField(name);
    /** @type {import("react").MutableRefObject<HTMLDivElement | null>} */
    const editorRef = React.useRef(null);
    /** @type {import("react").MutableRefObject<HTMLDivElement | null>} */
    const toolbarRef = React.useRef(null);
    /** @type {import("react").MutableRefObject<WirisIntegrationInstance | null>} */
    const integrationRef = React.useRef(null);
    const serializedValueRef = React.useRef(normalizeStoredValue(field.value));
    const [loadError, setLoadError] = React.useState("");
    const [mathTypeReady, setMathTypeReady] = React.useState(false);

    const plainValue = React.useMemo(
      () => normalizeStoredValue(field.value),
      [field.value],
    );

    const syncEditorToField = React.useCallback(() => {
      if (!editorRef.current) {
        return;
      }

      const nextValue = serializeEditorHtml(editorRef.current.innerHTML);
      serializedValueRef.current = nextValue;
      field.onChange(name, nextValue);
    }, [field, name]);

    React.useEffect(() => {
      if (!editorRef.current) {
        return;
      }

      const nextStoredValue = normalizeStoredValue(field.value);

      if (nextStoredValue === serializedValueRef.current) {
        return;
      }

      serializedValueRef.current = nextStoredValue;
      editorRef.current.innerHTML = textToEditorHtml(nextStoredValue);
    }, [field.value]);

    React.useEffect(() => {
      if (!MATHTYPE_IS_CONFIGURED) {
        return;
      }

      let cancelled = false;

      const setupMathType = async () => {
        try {
          await loadMathType();

          if (
            cancelled ||
            !editorRef.current ||
            !toolbarRef.current ||
            !window.WirisPlugin?.GenericIntegration
          ) {
            return;
          }

          /** @type {WirisIntegrationProperties} */
          const integrationProperties = {
            target: editorRef.current,
            toolbar: toolbarRef.current,
            integrationParameters: {
              editorParameters: {
                language: MATHTYPE_LANGUAGE,
              },
            },
          };

          integrationProperties.configurationService = MATHTYPE_CONFIGURATION_SERVICE;

          const instance = new window.WirisPlugin.GenericIntegration(integrationProperties);
          instance.init();
          instance.listeners.fire("onTargetReady", {});

          integrationRef.current = instance;
          window.WirisPlugin.currentInstance = instance;
          setMathTypeReady(true);
        } catch (error) {
          if (cancelled) {
            return;
          }

          const message = error instanceof Error ? error.message : "MathType failed to load.";
          setLoadError(message);
        }
      };

      setupMathType();

      return () => {
        cancelled = true;
      };
    }, []);

    const handleFocus = React.useCallback(() => {
      if (integrationRef.current && window.WirisPlugin) {
        window.WirisPlugin.currentInstance = integrationRef.current;
      }
    }, []);

    const handleInsertPlaceholder = React.useCallback(() => {
      if (!editorRef.current || disabled) {
        return;
      }

      insertMathPlaceholder(editorRef.current);
      syncEditorToField();
    }, [disabled, syncEditorToField]);

    if (!MATHTYPE_IS_CONFIGURED) {
      return (
        <Field.Root error={field.error} name={name} hint={hint} required={required}>
          <Flex direction="column" alignItems="stretch" gap={3}>
            <Field.Label action={labelAction}>{label}</Field.Label>
            <Box
              borderColor="neutral200"
              borderStyle="solid"
              borderWidth="1px"
              hasRadius
              padding={4}
            >
              <Flex direction="column" alignItems="stretch" gap={4}>
                <Alert
                  closeLabel="Close"
                  title="MathType is disabled"
                  variant="default"
                >
                  MathType authoring is only enabled when the Strapi admin bundle is built
                  with <strong>STRAPI_ADMIN_MATHTYPE_ENABLED=true</strong> and a valid{" "}
                  <strong>STRAPI_ADMIN_MATHTYPE_CONFIGURATION_SERVICE</strong> pointing to
                  your licensed WIRIS configuration service.
                </Alert>
                <Textarea
                  ref={
                    /** @param {HTMLTextAreaElement | null} node */ (node) =>
                      assignForwardedRef(ref, node)
                  }
                  name={name}
                  disabled={disabled}
                  value={plainValue}
                  onChange={
                    /** @param {{ target: { value: string } }} event */ (event) =>
                      field.onChange(name, event.target.value)
                  }
                  minRows={8}
                />
              </Flex>
            </Box>
            <Field.Hint />
            <Field.Error />
          </Flex>
        </Field.Root>
      );
    }

    return (
      <Field.Root error={field.error} name={name} hint={hint} required={required}>
        <Flex direction="column" alignItems="stretch" gap={3}>
          <Field.Label action={labelAction}>{label}</Field.Label>

          <Box
            borderColor="neutral200"
            borderStyle="solid"
            borderWidth="1px"
            hasRadius
            padding={4}
          >
            <Flex direction="column" alignItems="stretch" gap={4}>
              <Box padding={4} background="neutral100" hasRadius>
                <Flex direction="column" alignItems="stretch" gap={2}>
                  <Typography fontWeight="bold">
                    Use MathType to insert equations without losing raw LaTeX storage.
                  </Typography>
                  <Typography textColor="neutral600">
                    The field still saves plain text with equations wrapped as{" "}
                    <strong>$$...$$</strong>. Use <strong>Insert $$...$$</strong>, keep the
                    cursor between the markers, then click a MathType toolbar button.
                  </Typography>
                </Flex>
              </Box>

              <Flex gap={2} wrap="wrap">
                <Button
                  variant="secondary"
                  startIcon={<Pencil />}
                  onClick={handleInsertPlaceholder}
                  disabled={disabled}
                >
                  Insert $$...$$
                </Button>
              </Flex>

              <Box
                ref={toolbarRef}
                padding={2}
                background="neutral0"
                borderColor="neutral200"
                borderStyle="solid"
                borderWidth="1px"
                hasRadius
              />

              <Box
                tag="div"
                ref={
                  /** @param {HTMLDivElement | null} node */ (node) => {
                  editorRef.current = node;
                  assignForwardedRef(ref, node);
                  }
                }
                contentEditable={!disabled}
                suppressContentEditableWarning
                onInput={syncEditorToField}
                onBlur={syncEditorToField}
                onFocus={handleFocus}
                padding={4}
                background={disabled ? "neutral100" : "neutral0"}
                borderColor="neutral200"
                borderStyle="solid"
                borderWidth="1px"
                hasRadius
                minHeight="12rem"
                style={{
                  whiteSpace: "pre-wrap",
                  outline: "none",
                  overflowWrap: "anywhere",
                }}
              />

              {!mathTypeReady && !loadError ? (
                <Typography variant="pi" textColor="neutral600">
                  Loading MathType toolbar...
                </Typography>
              ) : null}

              {loadError ? (
                <Alert
                  closeLabel="Close"
                  title="MathType did not load"
                  variant="danger"
                >
                  {loadError}
                </Alert>
              ) : null}
            </Flex>
          </Box>

          <Field.Hint />
          <Field.Error />
        </Flex>
      </Field.Root>
    );
  },
);

MathTypeTextInput.displayName = "MathTypeTextInput";

export default MathTypeTextInput;
