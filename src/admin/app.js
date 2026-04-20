// @ts-check

import { Earth } from "@strapi/icons";

import { createReturnToListAfterPublishAction } from "./components/ReturnToListAfterPublishAction";

const MCQ_CHOICES_CUSTOM_FIELD_NAME = "mcq-choices";
const MATH_TEXT_CUSTOM_FIELD_NAME = "math-text";
const LMS_SHORTCUT_PATH = "lms-shortcut";

/**
 * @typedef {import("@strapi/content-manager/strapi-admin").DocumentActionComponent} DocumentActionComponent
 */

/**
 * @typedef {{
 *   customFields: { register: (config: Record<string, unknown>) => void },
 *   addMenuLink?: (config: Record<string, unknown>) => void,
 *   getPlugin: (pluginId: string) => {
 *     apis?: {
 *       addDocumentAction?: (reducer: (actions: DocumentActionComponent[]) => DocumentActionComponent[]) => void
 *     }
 *   }
 * }} AdminApp
 */

/**
 * @param {string | null | undefined} sortValue
 * @returns {boolean}
 */
const isInvalidSort = (sortValue) =>
  !sortValue ||
  sortValue === "undefined:undefined" ||
  sortValue.startsWith("undefined:") ||
  sortValue.endsWith(":undefined");

/** @returns {void} */
const sanitizeInvalidAdminSort = () => {
  const url = new URL(window.location.href);
  const sort = url.searchParams.get("sort");

  if (!isInvalidSort(sort)) {
    return;
  }

  const path = url.pathname;
  const isContentManagerRoute =
    path.includes("/content-manager/collection-types/") ||
    path.includes("/content-manager/single-types/");

  if (!isContentManagerRoute) {
    return;
  }

  url.searchParams.delete("sort");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
};

/**
 * @param {AdminApp} app
 * @returns {void}
 */
const bootstrap = (app) => {
  sanitizeInvalidAdminSort();

  const addDocumentAction = app.getPlugin("content-manager").apis?.addDocumentAction;

  if (!addDocumentAction) {
    return;
  }

  addDocumentAction((actions) =>
    actions.map((action) =>
      action.type === "publish"
        ? createReturnToListAfterPublishAction(action)
        : action
    )
  );
};

/**
 * @param {AdminApp} app
 * @returns {void}
 */
const register = (app) => {
  app.customFields.register({
    name: MCQ_CHOICES_CUSTOM_FIELD_NAME,
    type: "json",
    intlLabel: {
      id: "ip-vault.custom-fields.mcq-choices.label",
      defaultMessage: "MCQ Choices",
    },
    intlDescription: {
      id: "ip-vault.custom-fields.mcq-choices.description",
      defaultMessage: "Structured editor for MCQ answer choices.",
    },
    components: {
      Input: async () => import("./components/McqChoicesInput.jsx"),
    },
  });

  app.customFields.register({
    name: MATH_TEXT_CUSTOM_FIELD_NAME,
    type: "text",
    intlLabel: {
      id: "ip-vault.custom-fields.math-text.label",
      defaultMessage: "Math Text",
    },
    intlDescription: {
      id: "ip-vault.custom-fields.math-text.description",
      defaultMessage: "Text editor with a lightweight math symbol toolbar.",
    },
    components: {
      Input: async () => import("./components/MathPromptInput.jsx"),
    },
  });

  app.addMenuLink?.({
    to: LMS_SHORTCUT_PATH,
    icon: Earth,
    intlLabel: {
      id: "ip-vault.lms-shortcut.menu-label",
      defaultMessage: "LMS",
    },
    Component: () => import("./pages/LmsShortcutPage.jsx"),
  });
};

export default {
  config: {
    locales: [],
    auth: {
      logo: "/logo.png",
    },
    menu: {
      logo: "/logo.png",
    },
  },
  bootstrap,
  register,
};
