import React from "react";

import { useField } from "@strapi/admin/strapi-admin";

import MathTextEditor from "./MathTextEditor.jsx";

const MathPromptInput = React.forwardRef(
  ({ name, label, hint, required, disabled, labelAction, placeholder }, ref) => {
    const field = useField(name);

    const handleChange = React.useCallback(
      (nextValue) => {
        field.onChange(name, nextValue);
      },
      [field, name],
    );

    return (
      <MathTextEditor
        ref={ref}
        name={name}
        label={label}
        hint={hint}
        error={field.error}
        required={required}
        disabled={disabled}
        labelAction={labelAction}
        placeholder={placeholder}
        value={field.value}
        onChange={handleChange}
        multiline
        rows={8}
      />
    );
  },
);

MathPromptInput.displayName = "MathPromptInput";

export default MathPromptInput;
