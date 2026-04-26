'use strict';

const { errors } = require('@strapi/utils');
const { resolveRequestedOrganization } = require('./cms-organizations');

const { ValidationError } = errors;

const LEVEL_UID = 'api::level.level';
const MODULE_UID = 'api::module.module';
const TOPIC_UID = 'api::topic.topic';
const DIFFICULTY_UID = 'api::difficulty.difficulty';
const isOrganizationBackfillActive = () => process.env.CMS_ORGANIZATION_BACKFILL_ACTIVE === '1';

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

const getRelationRecordsArray = (value) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (value) {
    return [value];
  }

  return [];
};

const getRecordOrganizationId = (record) => {
  if (Number.isInteger(record)) {
    return record;
  }

  if (!record || typeof record !== 'object') {
    return null;
  }

  if (Number.isInteger(record.organization)) {
    return record.organization;
  }

  return Number.isInteger(record.organization?.id) ? record.organization.id : null;
};

const getRelationRefKey = (value) => {
  const normalizedRef = normalizeRelationRef(value);

  if (!normalizedRef) {
    return null;
  }

  if (Number.isInteger(normalizedRef.id)) {
    return `id:${normalizedRef.id}`;
  }

  if (isNonEmptyString(normalizedRef.documentId)) {
    return `documentId:${normalizedRef.documentId.trim()}`;
  }

  return null;
};

const dedupeRelationRecords = (records) => {
  const seen = new Set();

  return getRelationRecordsArray(records).filter((record) => {
    const relationKey = getRelationRefKey(record);

    if (!relationKey || seen.has(relationKey)) {
      return false;
    }

    seen.add(relationKey);
    return true;
  });
};

const buildModuleSlug = (levels, name) => {
  const normalizedLevels = [...new Set(
    (Array.isArray(levels) ? levels : [])
      .map((level) => slugify(level?.code || level?.slug || level?.name))
      .filter(Boolean),
  )].sort();
  const normalizedName = slugify(name);

  if (normalizedLevels.length === 0 || !normalizedName) {
    throw new ValidationError('Module must include at least one academic level and a name. The slug is generated automatically.');
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
      organization: {
        select: ['id'],
      },
      level: {
        select: ['id', 'documentId', 'name', 'code', 'slug'],
        populate: {
          organization: {
            select: ['id'],
          },
        },
      },
    },
  });
};

const getExistingModuleByDocumentId = async (strapi, documentId) => {
  if (!isNonEmptyString(documentId)) {
    return null;
  }

  const sharedQuery = {
    where: { documentId: documentId.trim() },
    select: ['id', 'documentId', 'name', 'slug', 'publishedAt'],
    populate: {
      organization: {
        select: ['id'],
      },
      level: {
        select: ['id', 'documentId', 'name', 'code', 'slug'],
        populate: {
          organization: {
            select: ['id'],
          },
        },
      },
    },
  };

  const draftModule = await strapi.db.query(MODULE_UID).findOne({
    ...sharedQuery,
    where: {
      ...sharedQuery.where,
      publishedAt: null,
    },
  });

  if (draftModule) {
    return draftModule;
  }

  return strapi.db.query(MODULE_UID).findOne(sharedQuery);
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
        populate: {
          organization: {
            select: ['id'],
          },
        },
      });
    }),
  );

  return levelRecords.filter(Boolean);
};

const resolveMergedLevelRecords = async (strapi, existingRecords, incomingValue) => {
  if (incomingValue === undefined) {
    return dedupeRelationRecords(existingRecords);
  }

  if (Array.isArray(incomingValue)) {
    return dedupeRelationRecords(await resolveLevelRecords(strapi, incomingValue));
  }

  if (incomingValue && typeof incomingValue === 'object') {
    if (Object.prototype.hasOwnProperty.call(incomingValue, 'set')) {
      return dedupeRelationRecords(await resolveLevelRecords(strapi, incomingValue.set));
    }

    const hasConnect = Object.prototype.hasOwnProperty.call(incomingValue, 'connect');
    const hasDisconnect = Object.prototype.hasOwnProperty.call(incomingValue, 'disconnect');

    if (hasConnect || hasDisconnect) {
      let mergedRecords = dedupeRelationRecords(existingRecords);

      if (hasDisconnect) {
        const disconnectRecords = await resolveLevelRecords(strapi, incomingValue.disconnect);

        mergedRecords = mergedRecords.filter((existingRecord) => {
          const existingRef = normalizeRelationRef(existingRecord);

          return !disconnectRecords.some((disconnectRecord) =>
            refsMatch(existingRef, normalizeRelationRef(disconnectRecord)));
        });
      }

      if (hasConnect) {
        const connectRecords = await resolveLevelRecords(strapi, incomingValue.connect);

        for (const connectRecord of connectRecords) {
          const connectRef = normalizeRelationRef(connectRecord);
          const isAlreadyPresent = mergedRecords.some((existingRecord) =>
            refsMatch(normalizeRelationRef(existingRecord), connectRef));

          if (!isAlreadyPresent) {
            mergedRecords.push(connectRecord);
          }
        }
      }

      return dedupeRelationRecords(mergedRecords);
    }
  }

  return dedupeRelationRecords(await resolveLevelRecords(strapi, incomingValue));
};

const validateModuleData = async (strapi, data = {}, existingModule = null) => {
  const organization = await resolveRequestedOrganization(strapi, data, null);
  const levelRecords = await resolveMergedLevelRecords(
    strapi,
    getRelationRecordsArray(existingModule?.level),
    data.level,
  );
  const hasIncomingName = Object.prototype.hasOwnProperty.call(data, 'name');
  const name = hasIncomingName ? data.name : existingModule?.name;

  if (levelRecords.length === 0 || !isNonEmptyString(name)) {
    throw new ValidationError('Module must include at least one academic level and a name. The slug is generated automatically.');
  }

  const organizationId = organization?.id || getRecordOrganizationId(existingModule);
  if (!Number.isInteger(organizationId)) {
    if (isOrganizationBackfillActive()) {
      return {
        levelRecords,
        name,
      };
    }
    throw new ValidationError('Module must belong to a valid organization.');
  }

  const invalidLevel = levelRecords.find((levelRecord) => getRecordOrganizationId(levelRecord) !== organizationId);
  if (invalidLevel) {
    throw new ValidationError(
      `Academic level "${invalidLevel.code || invalidLevel.name}" belongs to a different organization.`,
    );
  }

  return {
    levelRecords,
    name,
  };
};

const resolveTopicModule = async (strapi, data, where) => {
  const incomingModuleRef = normalizeRelationRef(data?.module);
  const moduleWhere = buildRelationWhereClause(incomingModuleRef);

  if (moduleWhere) {
    return strapi.db.query(MODULE_UID).findOne({
      where: moduleWhere,
      select: ['id', 'documentId', 'name', 'slug'],
      populate: {
        organization: {
          select: ['id'],
        },
        level: {
          select: ['id', 'documentId', 'name', 'code', 'slug'],
          populate: {
            organization: {
              select: ['id'],
            },
          },
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
          organization: {
            select: ['id'],
          },
          level: {
            select: ['id', 'documentId', 'name', 'code', 'slug'],
            populate: {
              organization: {
                select: ['id'],
              },
            },
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
        populate: {
          organization: {
            select: ['id'],
          },
        },
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
  strapi.documents.use(async (context, next) => {
    if (context.uid !== MODULE_UID) {
      return next();
    }

    if (!['create', 'update', 'publish'].includes(context.action)) {
      return next();
    }

    if (context.action === 'publish') {
      const existingModule = await getExistingModuleByDocumentId(strapi, context.params?.documentId);

      if (existingModule) {
        await validateModuleData(strapi, {}, existingModule);
      }

      return next();
    }

    const data = context.params?.data || {};
    const existingModule = context.action === 'update'
      ? await getExistingModuleByDocumentId(strapi, context.params?.documentId)
      : null;

    if (context.action === 'update' && !existingModule) {
      return next();
    }

    const { levelRecords, name } = await validateModuleData(strapi, data, existingModule);
    data.slug = buildModuleSlug(levelRecords, name);

    return next();
  });

  strapi.db.lifecycles.subscribe({
    models: [LEVEL_UID],

    async beforeCreate(event) {
      const data = event.params?.data || {};
      if (!isNonEmptyString(data.code)) {
        throw new ValidationError('Academic level code is required.');
      }
      data.slug = slugify(data.code);
    },

    async beforeUpdate(event) {
      const data = event.params?.data || {};
      if (isNonEmptyString(data.code)) {
        data.slug = slugify(data.code);
        return;
      }

      const existingLevel = await strapi.db.query(LEVEL_UID).findOne({
        where: event.params?.where,
        select: ['code'],
      });
      if (existingLevel?.code) {
        data.slug = slugify(existingLevel.code);
      }
    },
  });

  strapi.db.lifecycles.subscribe({
    models: [DIFFICULTY_UID],

    async beforeCreate(event) {
      const data = event.params?.data || {};
      if (!isNonEmptyString(data.name)) {
        throw new ValidationError('Difficulty name is required.');
      }
      data.slug = slugify(data.name);
    },

    async beforeUpdate(event) {
      const data = event.params?.data || {};
      if (isNonEmptyString(data.name)) {
        data.slug = slugify(data.name);
        return;
      }

      const existingDifficulty = await strapi.db.query(DIFFICULTY_UID).findOne({
        where: event.params?.where,
        select: ['name'],
      });
      if (existingDifficulty?.name) {
        data.slug = slugify(existingDifficulty.name);
      }
    },
  });

  strapi.db.lifecycles.subscribe({
    models: [MODULE_UID],

    async beforeCreate(event) {
      const data = event.params?.data || {};
      const { levelRecords, name } = await validateModuleData(strapi, data);

      data.slug = buildModuleSlug(levelRecords, name);
    },

    async beforeUpdate(event) {
      const data = event.params?.data || {};
      const existingModule = await getExistingModule(strapi, event.params?.where);
      const { levelRecords, name } = await validateModuleData(strapi, data, existingModule);

      data.slug = buildModuleSlug(levelRecords, name);
    },
  });

  strapi.db.lifecycles.subscribe({
    models: [TOPIC_UID],

    async beforeCreate(event) {
      const data = event.params?.data || {};
      const organization = await resolveRequestedOrganization(strapi, data, null);
      const moduleRecord = await resolveTopicModule(strapi, data);
      const levelRecords = await resolveTopicLevels(strapi, data);

      if (!organization?.id) {
        if (isOrganizationBackfillActive()) {
          return;
        }
        throw new ValidationError('Topic must belong to a valid organization.');
      }

      if (!moduleRecord) {
        throw new ValidationError('Topic must belong to a valid module.');
      }

      if (getRecordOrganizationId(moduleRecord) !== organization.id) {
        throw new ValidationError('Topic module must belong to the same organization.');
      }

      if (levelRecords.length === 0) {
        throw new ValidationError('Topic must belong to at least one valid academic level.');
      }

      const invalidLevelOrganization = levelRecords.find(
        (levelRecord) => getRecordOrganizationId(levelRecord) !== organization.id,
      );
      if (invalidLevelOrganization) {
        throw new ValidationError(
          `Topic academic level "${invalidLevelOrganization.code || invalidLevelOrganization.name}" belongs to a different organization.`,
        );
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
      const existingTopic = await strapi.db.query(TOPIC_UID).findOne({
        where: event.params?.where,
        populate: {
          organization: {
            select: ['id'],
          },
        },
      });
      const organization = (await resolveRequestedOrganization(strapi, data, null)) || existingTopic?.organization;
      const moduleRecord = await resolveTopicModule(strapi, data, event.params?.where);
      const levelRecords = await resolveTopicLevels(strapi, data, event.params?.where);
      const topicName = data.name;

      if (!organization?.id) {
        if (isOrganizationBackfillActive()) {
          return;
        }
        throw new ValidationError('Topic must belong to a valid organization.');
      }

      if (!moduleRecord) {
        throw new ValidationError('Topic must belong to a valid module.');
      }

      if (getRecordOrganizationId(moduleRecord) !== organization.id) {
        throw new ValidationError('Topic module must belong to the same organization.');
      }

      if (levelRecords.length === 0) {
        throw new ValidationError('Topic must belong to at least one valid academic level.');
      }

      const invalidLevelOrganization = levelRecords.find(
        (levelRecord) => getRecordOrganizationId(levelRecord) !== organization.id,
      );
      if (invalidLevelOrganization) {
        throw new ValidationError(
          `Topic academic level "${invalidLevelOrganization.code || invalidLevelOrganization.name}" belongs to a different organization.`,
        );
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
        const existingTopicNameRecord = await strapi.db.query(TOPIC_UID).findOne({
          where: event.params?.where,
          select: ['name'],
        });
        data.slug = buildTopicSlug(moduleRecord, levelRecords, existingTopicNameRecord?.name);
        return;
      }

      data.slug = buildTopicSlug(moduleRecord, levelRecords, topicName);
    },
  });
};

module.exports = {
  registerTaxonomyLifecycles,
};
