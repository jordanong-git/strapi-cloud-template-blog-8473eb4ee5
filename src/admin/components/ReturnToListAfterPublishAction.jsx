// @ts-check

import { useNavigate, useParams } from "react-router-dom";

const CONTENT_MANAGER_SEGMENT = "content-manager";
const CREATE_SEGMENT = "create";

/**
 * @typedef {import("@strapi/content-manager/strapi-admin").DocumentActionComponent} DocumentActionComponent
 */

/**
 * @typedef {import("@strapi/content-manager/strapi-admin").DocumentActionProps} DocumentActionProps
 */

/**
 * @typedef {import("react-router-dom").NavigateFunction} NavigateFunction
 */

/**
 * @typedef {{ contentManagerIndex: number, segments: string[], collectionType?: string, model?: string, documentId?: string }} ContentManagerRouteParts
 */

/**
 * @typedef {(...args: any[]) => Promise<any> | any} MaybeAsyncCallback
 */

/**
 * @param {string} pathname
 * @returns {ContentManagerRouteParts | null}
 */
const getContentManagerRouteParts = (pathname) => {
  const segments = pathname.split("/").filter(Boolean);
  const contentManagerIndex = segments.indexOf(CONTENT_MANAGER_SEGMENT);

  if (contentManagerIndex === -1) {
    return null;
  }

  return {
    contentManagerIndex,
    segments,
    collectionType: segments[contentManagerIndex + 1],
    model: segments[contentManagerIndex + 2],
    documentId: segments[contentManagerIndex + 3],
  };
};

/**
 * @param {string} pathname
 * @param {string} collectionType
 * @param {string} model
 * @returns {boolean}
 */
const isPublishedDocumentRoute = (pathname, collectionType, model) => {
  const route = getContentManagerRouteParts(pathname);

  if (!route) {
    return false;
  }

  return (
    route.collectionType === collectionType &&
    route.model === model &&
    Boolean(route.documentId) &&
    route.documentId !== CREATE_SEGMENT
  );
};

/**
 * @param {string} pathname
 * @param {string} collectionType
 * @param {string} model
 * @returns {string}
 */
const buildCollectionListPath = (pathname, collectionType, model) => {
  const route = getContentManagerRouteParts(pathname);

  if (!route) {
    return `/${CONTENT_MANAGER_SEGMENT}/${collectionType}/${model}`;
  }

  const pathSegments = [CONTENT_MANAGER_SEGMENT, collectionType, model];

  return `/${pathSegments.join("/")}`;
};

/**
 * @param {MaybeAsyncCallback | undefined} callback
 * @param {{ shouldRedirect: boolean, collectionType: string, model: string, navigate: NavigateFunction }} options
 * @returns {MaybeAsyncCallback}
 */
const wrapPublishCallback =
  (callback, { shouldRedirect, collectionType, model, navigate }) =>
  async (...args) => {
    const result = await callback?.(...args);

    if (!shouldRedirect) {
      return result;
    }

    if (!isPublishedDocumentRoute(window.location.pathname, collectionType, model)) {
      return result;
    }

    navigate(buildCollectionListPath(window.location.pathname, collectionType, model), {
      replace: true,
    });

    return result;
  };

/**
 * @param {DocumentActionComponent} OriginalPublishAction
 * @returns {DocumentActionComponent}
 */
export const createReturnToListAfterPublishAction = (OriginalPublishAction) => {
  /** @type {DocumentActionComponent} */
  const ReturnToListAfterPublishAction = (props) => {
    const navigate = useNavigate();
    const { id } = useParams();
    const action = OriginalPublishAction(props);

    if (!action) {
      return action;
    }

    const shouldRedirect =
      id === CREATE_SEGMENT && props.collectionType === "collection-types";

    return {
      ...action,
      onClick: wrapPublishCallback(action.onClick, {
        shouldRedirect,
        collectionType: props.collectionType,
        model: props.model,
        navigate,
      }),
      dialog:
        action.dialog?.type === "dialog"
          ? {
              ...action.dialog,
              onConfirm: wrapPublishCallback(action.dialog.onConfirm, {
                shouldRedirect,
                collectionType: props.collectionType,
                model: props.model,
                navigate,
              }),
            }
          : action.dialog,
    };
  };

  ReturnToListAfterPublishAction.type = OriginalPublishAction.type;
  ReturnToListAfterPublishAction.position = OriginalPublishAction.position;

  return ReturnToListAfterPublishAction;
};
