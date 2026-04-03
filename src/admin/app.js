const MUTATE_COLLECTION_TYPES_LINKS =
  "Admin/CM/pages/App/mutate-collection-types-links";
const MUTATE_EDIT_VIEW_LAYOUT =
  "Admin/CM/pages/EditView/mutate-edit-view-layout";
const MCQ_CHOICES_CUSTOM_FIELD_UID = "global::mcq-choices";

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
const IP_QUESTION_DISPLAY_NAME = "IP Question";
const IP_QUESTION_EDIT_ROWS = [
  ["question_type"],
  ["title"],
  ["prompt"],
  ["module", "level"],
  ["topics"],
  ["difficulty", "max_score"],
  ["choices"],
  ["accepted_answers"],
  ["sample_answer"],
  ["marking_rubric"],
  ["explanation", "contains_latex"],
];
const QUESTION_TYPE_VISIBILITY = {
  choices: {
    visible: {
      "==": [{ var: "question_type" }, "mcq"],
    },
  },
  accepted_answers: {
    visible: {
      "==": [{ var: "question_type" }, "saq"],
    },
  },
  sample_answer: {
    visible: {
      "==": [{ var: "question_type" }, "laq"],
    },
  },
  marking_rubric: {
    visible: {
      "==": [{ var: "question_type" }, "laq"],
    },
  },
};

const isInvalidSort = (sortValue) =>
  !sortValue ||
  sortValue === "undefined:undefined" ||
  sortValue.startsWith("undefined:") ||
  sortValue.endsWith(":undefined");

const isIpQuestionLayout = (layout) =>
  layout?.settings?.displayName === IP_QUESTION_DISPLAY_NAME;

const normalizeRow = (row) => {
  if (row.length <= 1) {
    return row.map((field) => ({ ...field, size: 12 }));
  }

  if (row.length === 2) {
    return row.map((field) => ({ ...field, size: 6 }));
  }

  return row;
};

const applyQuestionFieldVisibility = (field) => {
  const condition = QUESTION_TYPE_VISIBILITY[field.name];

  if (!condition) {
    return field;
  }

  return {
    ...field,
    attribute: {
      ...field.attribute,
      ...(field.name === "choices"
        ? {
            customField: MCQ_CHOICES_CUSTOM_FIELD_UID,
          }
        : {}),
      conditions: {
        ...(field.attribute.conditions || {}),
        ...condition,
      },
    },
  };
};

const reorderIpQuestionLayout = (layout) => {
  const flatFields = layout.layout.flatMap((panel) =>
    panel.flatMap((row) => row.map(applyQuestionFieldVisibility))
  );
  const fieldByName = new Map(flatFields.map((field) => [field.name, field]));
  const usedNames = new Set();
  const orderedRows = IP_QUESTION_EDIT_ROWS.map((fieldNames) => {
    const row = fieldNames
      .map((fieldName) => fieldByName.get(fieldName))
      .filter(Boolean);

    row.forEach((field) => usedNames.add(field.name));
    return normalizeRow(row);
  }).filter((row) => row.length > 0);
  const remainingRows = layout.layout
    .flatMap((panel) => panel)
    .map((row) =>
      row
        .map((field) => fieldByName.get(field.name) || applyQuestionFieldVisibility(field))
        .filter((field) => !usedNames.has(field.name))
    )
    .filter((row) => row.length > 0);

  return {
    ...layout,
    layout: [[...orderedRows, ...remainingRows]],
  };
};

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

const bootstrap = (app) => {
  sanitizeInvalidAdminSort();

  app.registerHook(MUTATE_COLLECTION_TYPES_LINKS, ({ ctLinks, ...rest }) => ({
    ...rest,
    ctLinks: ctLinks.map((link) => {
      const defaultSort = DEFAULT_COLLECTION_SORTS[link.uid];

      if (!defaultSort) {
        return link;
      }

      return {
        ...link,
        search: ensureCollectionLinkSearch(link.search, defaultSort),
      };
    }),
  }));

  app.registerHook(MUTATE_EDIT_VIEW_LAYOUT, ({ layout, ...rest }) => {
    if (!isIpQuestionLayout(layout)) {
      return { layout, ...rest };
    }

    return {
      ...rest,
      layout: reorderIpQuestionLayout(layout),
    };
  });
};

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
      Input: async () => import("./components/McqChoicesInput"),
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
