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

const normalizeRelationRefs = (value) => {
  if (Array.isArray(value)) {
    return value.map(normalizeRelationRef).filter(Boolean);
  }

  if (value && typeof value === 'object') {
    if (Array.isArray(value.set)) {
      return value.set.map(normalizeRelationRef).filter(Boolean);
    }

    if (Array.isArray(value.connect)) {
      return value.connect.map(normalizeRelationRef).filter(Boolean);
    }
  }

  const singleRef = normalizeRelationRef(value);
  return singleRef ? [singleRef] : [];
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

const buildModuleSlug = (levels, name) => {
  const normalizedLevels = [...new Set(
    (Array.isArray(levels) ? levels : [])
      .map((level) => slugify(level?.code || level?.slug || level?.name))
      .filter(Boolean),
  )].sort();
  const normalizedName = slugify(name);

  if (normalizedLevels.length === 0 || !normalizedName) {
    throw new ValidationError('Module must include at least one academic level and a name.');
  }

  return `${normalizedLevels.join('-')}-${normalizedName}`;
};

const buildTopicSlug = (moduleRecord, levelRecords, name) => {
  const moduleSlug = slugify(moduleRecord?.slug);
  const levelSlug = [...new Set(
    (Array.isArray(levelRecords) ? levelRecords : [])
      .map((level) => slugify(level?.code || level?.slug || level?.name))
      .filter(Boolean),
  )].sort().join('-');
  const normalizedName = slugify(name);

  if (!moduleSlug || !levelSlug || !normalizedName) {
    throw new ValidationError('Topic must include a module, at least one academic level, and a name.');
  }

  return `${moduleSlug}-${levelSlug}-${normalizedName}`;
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

const resolveLevelRecords = async (strapi, value) => {
  const levelRefs = normalizeRelationRefs(value);

  const levelRecords = await Promise.all(
    levelRefs.map(async (levelRef) => {
      const levelWhere = buildRelationWhereClause(levelRef);

      if (!levelWhere) {
        return null;
      }

      return strapi.db.query(LEVEL_UID).findOne({
        where: levelWhere,
        select: ['id', 'documentId', 'name', 'code', 'slug'],
      });
    }),
  );

  return levelRecords.filter(Boolean);
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

const resolveTopicLevels = async (strapi, data, where) => {
  const incomingLevelRecords = await resolveLevelRecords(strapi, data?.level);
  if (incomingLevelRecords.length > 0) {
    return incomingLevelRecords;
  }

  if (!where || typeof where !== 'object') {
    return [];
  }

  const existingTopic = await strapi.db.query(TOPIC_UID).findOne({
    where,
    populate: {
      level: {
        select: ['id', 'documentId', 'name', 'code', 'slug'],
      },
    },
  });

  if (Array.isArray(existingTopic?.level)) {
    return existingTopic.level;
  }

  return existingTopic?.level ? [existingTopic.level] : [];
};

const refsMatch = (left, right) => {
  if (!left || !right) {
    return false;
  }

  if (Number.isInteger(left.id) && Number.isInteger(right.id)) {
    return left.id === right.id;
  }

  if (isNonEmptyString(left.documentId) && isNonEmptyString(right.documentId)) {
    return left.documentId.trim() === right.documentId.trim();
  }

  return false;
};

const registerTaxonomyLifecycles = (strapi) => {
  strapi.db.lifecycles.subscribe({
    models: [MODULE_UID],

    async beforeCreate(event) {
      const data = event.params?.data || {};
      const levelRecords = await resolveLevelRecords(strapi, data.level);

      if (levelRecords.length === 0) {
        throw new ValidationError('Module must belong to at least one valid academic level.');
      }

      data.slug = buildModuleSlug(levelRecords, data.name);
    },

    async beforeUpdate(event) {
      const data = event.params?.data || {};
      const existingModule = await getExistingModule(strapi, event.params?.where);
      const hasIncomingLevels = Object.prototype.hasOwnProperty.call(data, 'level');
      const incomingLevelRecords = await resolveLevelRecords(strapi, data.level);

      const levelRecords = hasIncomingLevels
        ? incomingLevelRecords
        : Array.isArray(existingModule?.level)
          ? existingModule.level
          : existingModule?.level
            ? [existingModule.level]
            : [];
      const name = data.name || existingModule?.name;

      if (levelRecords.length === 0 || !name) {
        throw new ValidationError('Module must include at least one academic level and a name.');
      }

      data.slug = buildModuleSlug(levelRecords, name);
    },
  });

  strapi.db.lifecycles.subscribe({
    models: [TOPIC_UID],

    async beforeCreate(event) {
      const data = event.params?.data || {};
      const moduleRecord = await resolveTopicModule(strapi, data);
      const levelRecords = await resolveTopicLevels(strapi, data);

      if (!moduleRecord) {
        throw new ValidationError('Topic must belong to a valid module.');
      }

      if (levelRecords.length === 0) {
        throw new ValidationError('Topic must belong to at least one valid academic level.');
      }

      const moduleLevelRefs = normalizeRelationRefs(moduleRecord.level);
      const invalidTopicLevel = levelRecords.find((levelRecord) => {
        const topicLevelRef = normalizeRelationRef(levelRecord);
        return (
          moduleLevelRefs.length > 0 &&
          !moduleLevelRefs.some((moduleLevelRef) => refsMatch(moduleLevelRef, topicLevelRef))
        );
      });

      if (invalidTopicLevel) {
        throw new ValidationError(
          `Topic academic level "${invalidTopicLevel.code || invalidTopicLevel.name}" must be one of the selected module academic levels.`,
        );
      }

      data.slug = buildTopicSlug(moduleRecord, levelRecords, data.name);
    },

    async beforeUpdate(event) {
      const data = event.params?.data || {};
      const moduleRecord = await resolveTopicModule(strapi, data, event.params?.where);
      const levelRecords = await resolveTopicLevels(strapi, data, event.params?.where);
      const topicName = data.name;

      if (!moduleRecord) {
        throw new ValidationError('Topic must belong to a valid module.');
      }

      if (levelRecords.length === 0) {
        throw new ValidationError('Topic must belong to at least one valid academic level.');
      }

      const moduleLevelRefs = normalizeRelationRefs(moduleRecord.level);
      const invalidTopicLevel = levelRecords.find((levelRecord) => {
        const topicLevelRef = normalizeRelationRef(levelRecord);
        return (
          moduleLevelRefs.length > 0 &&
          !moduleLevelRefs.some((moduleLevelRef) => refsMatch(moduleLevelRef, topicLevelRef))
        );
      });

      if (invalidTopicLevel) {
        throw new ValidationError(
          `Topic academic level "${invalidTopicLevel.code || invalidTopicLevel.name}" must be one of the selected module academic levels.`,
        );
      }

      if (!topicName) {
        const existingTopic = await strapi.db.query(TOPIC_UID).findOne({
          where: event.params?.where,
          select: ['name'],
        });
        data.slug = buildTopicSlug(moduleRecord, levelRecords, existingTopic?.name);
        return;
      }

      data.slug = buildTopicSlug(moduleRecord, levelRecords, topicName);
    },
  });
};

module.exports = {
  registerTaxonomyLifecycles,
};
