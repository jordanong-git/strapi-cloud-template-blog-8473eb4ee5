'use strict';

const { errors } = require('@strapi/utils');

const { ValidationError } = errors;

const LEVEL_UID = 'api::level.level';
const MODULE_UID = 'api::module.module';
const TOPIC_UID = 'api::topic.topic';

const slugify = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const normalizeRelationRef = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number') {
    return { id: value };
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) {
      return null;
    }

    const numericValue = Number.parseInt(normalized, 10);
    if (Number.isInteger(numericValue) && `${numericValue}` === normalized) {
      return { id: numericValue };
    }

    return { documentId: normalized };
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  if (Number.isInteger(value.id)) {
    return { id: value.id };
  }

  if (isNonEmptyString(value.documentId)) {
    return { documentId: value.documentId.trim() };
  }

  if (Array.isArray(value.set) && value.set.length > 0) {
    return normalizeRelationRef(value.set[0]);
  }

  if (Array.isArray(value.connect) && value.connect.length > 0) {
    return normalizeRelationRef(value.connect[0]);
  }

  return null;
};

const buildRelationWhereClause = (ref) => {
  if (!ref) {
    return null;
  }

  if (Number.isInteger(ref.id)) {
    return { id: ref.id };
  }

  if (isNonEmptyString(ref.documentId)) {
    return { documentId: ref.documentId.trim() };
  }

  return null;
};

const buildModuleSlug = (level, name) => {
  const normalizedLevel = slugify(level);
  const normalizedName = slugify(name);

  if (!normalizedLevel || !normalizedName) {
    throw new ValidationError('Module must include both level and name.');
  }

  return `${normalizedLevel}-${normalizedName}`;
};

const buildTopicSlug = (moduleRecord, name) => {
  const moduleSlug = slugify(moduleRecord?.slug);
  const normalizedName = slugify(name);

  if (!moduleSlug || !normalizedName) {
    throw new ValidationError('Topic must include a module and a name.');
  }

  return `${moduleSlug}-${normalizedName}`;
};

const getExistingModule = async (strapi, where) => {
  if (!where || typeof where !== 'object') {
    return null;
  }

  return strapi.db.query(MODULE_UID).findOne({
    where,
    select: ['id', 'documentId', 'name', 'slug'],
    populate: {
      level: {
        select: ['id', 'documentId', 'name', 'code', 'slug'],
      },
    },
  });
};

const resolveLevelRecord = async (strapi, value) => {
  const levelRef = normalizeRelationRef(value);
  const levelWhere = buildRelationWhereClause(levelRef);

  if (!levelWhere) {
    return null;
  }

  return strapi.db.query(LEVEL_UID).findOne({
    where: levelWhere,
    select: ['id', 'documentId', 'name', 'code', 'slug'],
  });
};

const resolveTopicModule = async (strapi, data, where) => {
  const incomingModuleRef = normalizeRelationRef(data?.module);
  const moduleWhere = buildRelationWhereClause(incomingModuleRef);

  if (moduleWhere) {
    return strapi.db.query(MODULE_UID).findOne({
      where: moduleWhere,
      select: ['id', 'documentId', 'name', 'slug'],
      populate: {
        level: {
          select: ['id', 'documentId', 'name', 'code', 'slug'],
        },
      },
    });
  }

  if (!where || typeof where !== 'object') {
    return null;
  }

  const existingTopic = await strapi.db.query(TOPIC_UID).findOne({
    where,
    populate: {
      module: {
        select: ['id', 'documentId', 'name', 'slug'],
        populate: {
          level: {
            select: ['id', 'documentId', 'name', 'code', 'slug'],
          },
        },
      },
    },
  });

  return existingTopic?.module || null;
};

const registerTaxonomyLifecycles = (strapi) => {
  strapi.db.lifecycles.subscribe({
    models: [MODULE_UID],

    async beforeCreate(event) {
      const data = event.params?.data || {};
      const levelRecord = await resolveLevelRecord(strapi, data.level);

      if (!levelRecord) {
        throw new ValidationError('Module must belong to a valid academic level.');
      }

      data.slug = buildModuleSlug(levelRecord.code || levelRecord.slug || levelRecord.name, data.name);
    },

    async beforeUpdate(event) {
      const data = event.params?.data || {};
      const existingModule = await getExistingModule(strapi, event.params?.where);

      const levelRecord =
        (await resolveLevelRecord(strapi, data.level)) ||
        existingModule?.level ||
        null;
      const name = data.name || existingModule?.name;

      if (!levelRecord || !name) {
        throw new ValidationError('Module must include both level and name.');
      }

      data.slug = buildModuleSlug(
        levelRecord.code || levelRecord.slug || levelRecord.name,
        name,
      );
    },
  });

  strapi.db.lifecycles.subscribe({
    models: [TOPIC_UID],

    async beforeCreate(event) {
      const data = event.params?.data || {};
      const moduleRecord = await resolveTopicModule(strapi, data);

      if (!moduleRecord) {
        throw new ValidationError('Topic must belong to a valid module.');
      }

      data.slug = buildTopicSlug(moduleRecord, data.name);
    },

    async beforeUpdate(event) {
      const data = event.params?.data || {};
      const moduleRecord = await resolveTopicModule(strapi, data, event.params?.where);
      const topicName = data.name;

      if (!moduleRecord) {
        throw new ValidationError('Topic must belong to a valid module.');
      }

      if (!topicName) {
        const existingTopic = await strapi.db.query(TOPIC_UID).findOne({
          where: event.params?.where,
          select: ['name'],
        });
        data.slug = buildTopicSlug(moduleRecord, existingTopic?.name);
        return;
      }

      data.slug = buildTopicSlug(moduleRecord, topicName);
    },
  });
};

module.exports = {
  registerTaxonomyLifecycles,
};
