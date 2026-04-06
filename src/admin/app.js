// @ts-check

const MUTATE_COLLECTION_TYPES_LINKS =
  "Admin/CM/pages/App/mutate-collection-types-links";
const MCQ_CHOICES_CUSTOM_FIELD_UID = "global::mcq-choices";

/** @typedef {keyof typeof DEFAULT_COLLECTION_SORTS} SupportedCollectionUid */
/** @typedef {{ uid?: string, search?: string } & Record<string, unknown>} CollectionTypeLink */
/** @typedef {{ ctLinks?: CollectionTypeLink[] } & Record<string, unknown>} CollectionTypesHookPayload */
/** @typedef {{ registerHook: (name: string, handler: (payload: CollectionTypesHookPayload) => CollectionTypesHookPayload) => void, customFields: { register: (config: Record<string, unknown>) => void } }} AdminApp */

/** @type {Record<string, string>} */
const DEFAULT_COLLECTION_SORTS = {
  "api::ip-question.ip-question": "title:ASC",
  "api::ip-asset.ip-asset": "title:ASC",
  "api::level.level": "code:ASC",
  "api::module.module": "name:ASC",
  "api::topic.topic": "name:ASC",
  "api::difficulty.difficulty": "name:ASC",
  "api::ip-audit-log.ip-audit-log": "request_id:ASC",
};

const DEFAULT_PAGE_SIZE = "10";

/**
 * @param {string | null | undefined} sortValue
 * @returns {boolean}
 */
const isInvalidSort = (sortValue) =>
  !sortValue ||
  sortValue === "undefined:undefined" ||
  sortValue.startsWith("undefined:") ||
  sortValue.endsWith(":undefined");

/**
 * @param {string | null | undefined} search
 * @param {string} defaultSort
 * @returns {string}
 */
const ensureCollectionLinkSearch = (search, defaultSort) => {
  const params = new URLSearchParams(search ?? "");

  if (isInvalidSort(params.get("sort"))) {
    params.set("sort", defaultSort);
  }

  if (!params.get("page")) {
    params.set("page", "1");
  }

  if (!params.get("pageSize")) {
    params.set("pageSize", DEFAULT_PAGE_SIZE);
  }

  return params.toString();
};

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
 * @param {string | undefined} uid
 * @returns {string | undefined}
 */
const getDefaultSort = (uid) => {
  if (!uid || !(uid in DEFAULT_COLLECTION_SORTS)) {
    return undefined;
  }

  return DEFAULT_COLLECTION_SORTS[/** @type {SupportedCollectionUid} */ (uid)];
};

/**
 * @param {AdminApp} app
 * @returns {void}
 */
const bootstrap = (app) => {
  sanitizeInvalidAdminSort();

  app.registerHook(MUTATE_COLLECTION_TYPES_LINKS, ({ ctLinks = [], ...rest }) => ({
    ...rest,
    ctLinks: ctLinks.map((link) => {
      const defaultSort = getDefaultSort(link.uid);

      if (!defaultSort) {
        return link;
      }

      return {
        ...link,
        search: ensureCollectionLinkSearch(link.search, defaultSort),
      };
    }),
  }));

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
