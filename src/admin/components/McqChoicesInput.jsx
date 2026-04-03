import React from "react";

import {
  Badge,
  Box,
  Button,
  Checkbox,
  Field,
  Flex,
  IconButton,
  NumberInput,
  TextInput,
  Typography,
} from "@strapi/design-system";
import { Plus, Trash } from "@strapi/icons";
import { useField } from "@strapi/admin/strapi-admin";

const EMPTY_CHOICE = {
  choice_text: "",
  is_correct: false,
  order_index: 0,
};

const normalizeChoices = (value) => {
  if (Array.isArray(value)) {
    return value.map((item, index) => ({
      choice_text:
        item && typeof item === "object" && typeof item.choice_text === "string"
          ? item.choice_text
          : "",
      is_correct: Boolean(item && typeof item === "object" && item.is_correct),
      order_index:
        item &&
        typeof item === "object" &&
        Number.isInteger(item.order_index) &&
        item.order_index > 0
          ? item.order_index
          : index + 1,
    }));
  }

  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return normalizeChoices(parsed);
    } catch {
      return [];
    }
  }

  return [];
};

const sortChoices = (choices) =>
  [...choices].sort((left, right) => {
    if (left.order_index === right.order_index) {
      return 0;
    }

    return left.order_index - right.order_index;
  });

const McqChoicesInput = React.forwardRef(
  ({ name, label, hint, required, disabled, labelAction }, ref) => {
    const field = useField(name);
    const choices = React.useMemo(
      () => sortChoices(normalizeChoices(field.value)),
      [field.value],
    );

    const updateChoices = React.useCallback(
      (nextChoices) => {
        field.onChange(name, nextChoices);
      },
      [field, name],
    );

    const addChoice = React.useCallback(() => {
      updateChoices([
        ...choices,
        {
          ...EMPTY_CHOICE,
          order_index: choices.length + 1,
        },
      ]);
    }, [choices, updateChoices]);

    const updateChoice = React.useCallback(
      (index, key, value) => {
        const nextChoices = choices.map((choice, choiceIndex) =>
          choiceIndex === index ? { ...choice, [key]: value } : choice,
        );
        updateChoices(nextChoices);
      },
      [choices, updateChoices],
    );

    const removeChoice = React.useCallback(
      (index) => {
        const nextChoices = choices
          .filter((_, choiceIndex) => choiceIndex !== index)
          .map((choice, choiceIndex) => ({
            ...choice,
            order_index: choice.order_index || choiceIndex + 1,
          }));

        updateChoices(nextChoices);
      },
      [choices, updateChoices],
    );

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
                    Add each answer option below.
                  </Typography>
                  <Typography textColor="neutral600">
                    Use <strong>Display Order</strong> to control which option appears first,
                    second, third, and so on for learners. Tick <strong>Correct answer</strong>{" "}
                    for the right option.
                  </Typography>
                </Flex>
              </Box>

              {choices.length === 0 ? (
                <Box padding={4} background="neutral100" hasRadius>
                  <Typography textColor="neutral600">
                    No choices yet. Add each option below, then tick the correct one.
                  </Typography>
                </Box>
              ) : null}

              {choices.map((choice, index) => (
                <Box
                  key={`${name}-choice-${index}`}
                  borderColor="neutral200"
                  borderStyle="solid"
                  borderWidth="1px"
                  hasRadius
                  padding={4}
                >
                  <Flex direction="column" alignItems="stretch" gap={3}>
                    <Flex justifyContent="space-between" alignItems="center" gap={3}>
                      <Flex alignItems="center" gap={2}>
                        <Badge>{`Choice ${index + 1}`}</Badge>
                        <Typography fontWeight="bold">
                          {choice.choice_text?.trim() || "Untitled choice"}
                        </Typography>
                      </Flex>
                      <IconButton
                        label={`Remove choice ${index + 1}`}
                        onClick={() => removeChoice(index)}
                        disabled={disabled}
                      >
                        <Trash />
                      </IconButton>
                    </Flex>

                    <TextInput
                      ref={index === 0 ? ref : undefined}
                      label="Choice text"
                      name={`${name}.${index}.choice_text`}
                      onChange={(event) =>
                        updateChoice(index, "choice_text", event.target.value)
                      }
                      value={choice.choice_text}
                      disabled={disabled}
                      placeholder="Enter the option shown to the learner"
                    />

                    <Flex gap={4} alignItems="end" wrap="wrap">
                      <Box minWidth="180px">
                        <NumberInput
                          label="Display Order"
                          name={`${name}.${index}.order_index`}
                          onValueChange={(value) =>
                            updateChoice(
                              index,
                              "order_index",
                              Number.isInteger(value) && value > 0 ? value : index + 1,
                            )
                          }
                          value={choice.order_index}
                          disabled={disabled}
                          min={1}
                        />
                        <Box paddingTop={1}>
                          <Typography variant="pi" textColor="neutral600">
                            Lower numbers appear earlier to the learner.
                          </Typography>
                        </Box>
                      </Box>

                      <Checkbox
                        onCheckedChange={(checked) =>
                          updateChoice(index, "is_correct", Boolean(checked))
                        }
                        checked={choice.is_correct}
                        disabled={disabled}
                        name={`${name}.${index}.is_correct`}
                      >
                        Correct answer
                      </Checkbox>
                    </Flex>
                  </Flex>
                </Box>
              ))}

              <Button
                variant="secondary"
                startIcon={<Plus />}
                onClick={addChoice}
                disabled={disabled}
              >
                Add answer option
              </Button>
            </Flex>
          </Box>
          <Field.Hint />
          <Field.Error />
        </Flex>
      </Field.Root>
    );
  },
);

McqChoicesInput.displayName = "McqChoicesInput";

export default McqChoicesInput;
