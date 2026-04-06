// @ts-check

import { createReturnToListAfterPublishAction } from "./components/ReturnToListAfterPublishAction";

const MCQ_CHOICES_CUSTOM_FIELD_UID = "global::mcq-choices";

/**
 * @typedef {import("@strapi/content-manager/strapi-admin").DocumentActionComponent} DocumentActionComponent
 */

/**
 * @typedef {{
 *   customFields: { register: (config: Record<string, unknown>) => void },
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
    name: "mcq-choices",
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
};

export default {
  config: {
    locales: [],
  },
  bootstrap,
  register,
};
