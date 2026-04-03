'use strict';

const { errors } = require('@strapi/utils');

const { ValidationError } = errors;

const OWNED_MODELS = [
  'api::level.level',
  'api::module.module',
  'api::ip-question.ip-question',
  'api::ip-asset.ip-asset',
  'api::topic.topic',
  'api::difficulty.difficulty',
];

const normalizeOwnerId = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');

const getConfiguredOwnerId = () => normalizeOwnerId(process.env.CMS_DEFAULT_OWNER_ID);

const getRequestAdminUser = (strapi) => strapi.requestContext.get()?.state?.user ?? null;

const getFallbackOwnerIdFromAdminUser = (adminUser) => {
  if (!adminUser || typeof adminUser !== 'object') {
    return '';
  }

  return normalizeOwnerId(adminUser.email || adminUser.username || `admin_${adminUser.id || ''}`);
};

const resolveOwnerId = (strapi) => {
  const configuredOwnerId = getConfiguredOwnerId();
  if (configuredOwnerId) {
    return configuredOwnerId;
  }

  const fallbackOwnerId = getFallbackOwnerIdFromAdminUser(getRequestAdminUser(strapi));
  if (fallbackOwnerId) {
    return fallbackOwnerId;
  }

  throw new ValidationError(
    'Unable to resolve owner_id. Set CMS_DEFAULT_OWNER_ID or create content through an authenticated admin request.',
  );
};

const assignOwnerId = (data, ownerId) => {
  if (!data || typeof data !== 'object') {
    return;
  }

  data.owner_id = ownerId;
};

const findExistingOwnerId = async (strapi, model, where) => {
  if (!where || typeof where !== 'object') {
    return null;
  }

  const existingRecord = await strapi.db.query(model).findOne({
    where,
    select: ['owner_id'],
  });

  return existingRecord?.owner_id || null;
};

const registerOwnershipLifecycles = (strapi) => {
  strapi.db.lifecycles.subscribe({
    models: OWNED_MODELS,

    beforeCreate(event) {
      assignOwnerId(event.params?.data, resolveOwnerId(strapi));
    },

    beforeCreateMany(event) {
      const ownerId = resolveOwnerId(strapi);
      const items = Array.isArray(event.params?.data) ? event.params.data : [];

      items.forEach((item) => assignOwnerId(item, ownerId));
    },

    async beforeUpdate(event) {
      const currentOwnerId = await findExistingOwnerId(strapi, event.model, event.params?.where);
      assignOwnerId(event.params?.data, currentOwnerId || resolveOwnerId(strapi));
    },

    beforeUpdateMany(event) {
      if (event.params?.data && typeof event.params.data === 'object') {
        delete event.params.data.owner_id;
      }
    },
  });
};

module.exports = {
  registerOwnershipLifecycles,
};
