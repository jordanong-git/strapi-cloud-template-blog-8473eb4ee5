'use strict';

const { errors } = require('@strapi/utils');

const { ForbiddenError, ValidationError } = errors;

const ORGANIZATION_UID = 'api::organization.organization';
const MEMBERSHIP_UID = 'api::organization-membership.organization-membership';
const ORG_SCOPED_MODELS = [
  'api::level.level',
  'api::module.module',
  'api::topic.topic',
  'api::difficulty.difficulty',
  'api::ip-question.ip-question',
  'api::ip-asset.ip-asset',
  'api::ip-audit-log.ip-audit-log',
];
const SUPER_ADMIN_ROLE_CODE = 'strapi-super-admin';
const ORGANIZATION_ADMIN_ROLE = 'org_admin';
const ACCESS_CONTEXT_PROMISE_KEY = '__cmsOrganizationAccessContextPromise';
const ACCESS_CONTEXT_RESOLUTION_DEPTH_KEY = '__cmsOrganizationAccessContextResolutionDepth';
const accessContextCache = new Map();

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeOwnerId = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');

const slugify = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const toTitleCase = (value) =>
  String(value || '')
    .split(/[_\-. ]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const getLegacyOwnerId = (organization) =>
  normalizeOwnerId(organization?.legacy_owner_id || organization?.slug || organization?.name);

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

  if (!isPlainObject(value)) {
    return null;
  }

  if (Number.isInteger(value.id)) {
    return { id: value.id };
  }

  if (typeof value.documentId === 'string' && value.documentId.trim()) {
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

  if (typeof ref.documentId === 'string' && ref.documentId.trim()) {
    return { documentId: ref.documentId.trim() };
  }

  return null;
};

const mergeWhereWithAnd = (currentWhere, nextWhere) => {
  if (!currentWhere || Object.keys(currentWhere).length === 0) {
    return nextWhere;
  }

  if (!nextWhere || Object.keys(nextWhere).length === 0) {
    return currentWhere;
  }

  return {
    $and: [currentWhere, nextWhere],
  };
};

const getRequestAdminUser = (strapi) => strapi.requestContext.get()?.state?.user ?? null;
const getRequestState = (strapi) => {
  const state = strapi.requestContext.get()?.state;
  return state && typeof state === 'object' ? state : null;
};
const getAccessContextResolutionDepth = (strapi) => {
  const requestState = getRequestState(strapi);
  const depth = Number.parseInt(`${requestState?.[ACCESS_CONTEXT_RESOLUTION_DEPTH_KEY] ?? 0}`, 10);
  return Number.isInteger(depth) && depth > 0 ? depth : 0;
};
const isResolvingAccessContext = (strapi) => getAccessContextResolutionDepth(strapi) > 0;
const withAccessContextResolution = async (strapi, handler) => {
  const requestState = getRequestState(strapi);
  if (!requestState) {
    return handler();
  }

  requestState[ACCESS_CONTEXT_RESOLUTION_DEPTH_KEY] = getAccessContextResolutionDepth(strapi) + 1;

  try {
    return await handler();
  } finally {
    const nextDepth = getAccessContextResolutionDepth(strapi) - 1;
    if (nextDepth > 0) {
      requestState[ACCESS_CONTEXT_RESOLUTION_DEPTH_KEY] = nextDepth;
    } else {
      delete requestState[ACCESS_CONTEXT_RESOLUTION_DEPTH_KEY];
    }
  }
};
const getAccessContextCacheTtlMs = () => {
  const parsedValue = Number.parseInt(process.env.CMS_ACCESS_CONTEXT_CACHE_TTL_MS || '5000', 10);
  return Number.isInteger(parsedValue) && parsedValue >= 0 ? parsedValue : 5000;
};
const buildEmptyAccessContext = ({ hasRequestUser, user = null, isSuperAdmin }) => ({
  hasRequestUser,
  user,
  isSuperAdmin,
  memberships: [],
  organizations: [],
  organizationIds: [],
  organizationIdSet: new Set(),
  membershipByOrganizationId: new Map(),
  scopedOrganizationWhere: hasRequestUser && !isSuperAdmin ? { id: { $in: [] } } : null,
  scopedOrganizationRelationWhere:
    hasRequestUser && !isSuperAdmin ? { organization: { id: { $in: [] } } } : null,
});
const buildScopedAccessContext = (user, memberships) => {
  const organizations = [];
  const organizationIds = [];
  const organizationIdSet = new Set();
  const membershipByOrganizationId = new Map();

  memberships.forEach((membership) => {
    const organization = membership.organization;
    if (!organization?.id || organizationIdSet.has(organization.id)) {
      return;
    }

    organizations.push(organization);
    organizationIds.push(organization.id);
    organizationIdSet.add(organization.id);
    membershipByOrganizationId.set(organization.id, membership);
  });

  const scopedOrganizationWhere =
    organizationIds.length > 0 ? { id: { $in: organizationIds } } : { id: { $in: [] } };

  return {
    hasRequestUser: true,
    user,
    isSuperAdmin: false,
    memberships,
    organizations,
    organizationIds,
    organizationIdSet,
    membershipByOrganizationId,
    scopedOrganizationWhere,
    scopedOrganizationRelationWhere: { organization: scopedOrganizationWhere },
  };
};
const readCachedAccessContext = (userId) => {
  const entry = accessContextCache.get(userId);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt < Date.now()) {
    accessContextCache.delete(userId);
    return null;
  }

  return entry.promise;
};
const writeCachedAccessContext = (userId, promise) => {
  accessContextCache.set(userId, {
    promise,
    expiresAt: Date.now() + getAccessContextCacheTtlMs(),
  });
};
const clearCachedAccessContext = (userId, promise = null) => {
  const entry = accessContextCache.get(userId);
  if (!entry) {
    return;
  }

  if (!promise || entry.promise === promise) {
    accessContextCache.delete(userId);
  }
};

const loadAdminUserWithRoles = async (strapi, userId) => {
  if (!Number.isInteger(userId)) {
    return null;
  }

  return strapi.db.query('admin::user').findOne({
    where: { id: userId },
    select: ['id', 'email', 'username', 'firstname', 'lastname', 'isActive', 'blocked'],
    populate: {
      roles: {
        select: ['id', 'name', 'code'],
      },
    },
  });
};

const isSuperAdminUser = (user) =>
  Boolean(
    user &&
      Array.isArray(user.roles) &&
      user.roles.some((role) => role?.code === SUPER_ADMIN_ROLE_CODE),
  );

const findOrganizationById = async (strapi, id) =>
  Number.isInteger(id)
    ? strapi.db.query(ORGANIZATION_UID).findOne({
        where: { id },
        select: ['id', 'name', 'slug', 'legacy_owner_id', 'is_active'],
      })
    : null;

const findOrganizationBySlug = async (strapi, slug) => {
  const normalizedSlug = slugify(slug);
  if (!normalizedSlug) {
    return null;
  }

  return strapi.db.query(ORGANIZATION_UID).findOne({
    where: { slug: normalizedSlug },
    select: ['id', 'name', 'slug', 'legacy_owner_id', 'is_active'],
  });
};

const findOrganizationByOwnerId = async (strapi, ownerId) => {
  const normalizedOwnerId = normalizeOwnerId(ownerId);
  if (!normalizedOwnerId) {
    return null;
  }

  return strapi.db.query(ORGANIZATION_UID).findOne({
    where: {
      $or: [{ legacy_owner_id: normalizedOwnerId }, { slug: normalizedOwnerId }],
    },
    select: ['id', 'name', 'slug', 'legacy_owner_id', 'is_active'],
  });
};

const getConfiguredDefaultOrganization = async (strapi) => {
  const configuredOwnerId = normalizeOwnerId(process.env.CMS_DEFAULT_OWNER_ID);
  if (configuredOwnerId) {
    const byOwnerId = await findOrganizationByOwnerId(strapi, configuredOwnerId);
    if (byOwnerId) {
      return byOwnerId;
    }
  }

  const configuredSlug = slugify(process.env.CMS_DEFAULT_ORGANIZATION_SLUG || '');
  if (configuredSlug) {
    return findOrganizationBySlug(strapi, configuredSlug);
  }

  return null;
};

const resolveOrganizationFromRelationValue = async (strapi, value) => {
  const relationRef = normalizeRelationRef(value);
  if (!relationRef) {
    return null;
  }

  const relationWhere = buildRelationWhereClause(relationRef);
  if (!relationWhere) {
    return null;
  }

  return strapi.db.query(ORGANIZATION_UID).findOne({
    where: relationWhere,
    select: ['id', 'name', 'slug', 'legacy_owner_id', 'is_active'],
  });
};

const resolveRequestedOrganization = async (strapi, data = {}, accessContext = null) => {
  const directOrganization =
    (await resolveOrganizationFromRelationValue(strapi, data.organization)) ||
    (await resolveOrganizationFromRelationValue(strapi, data.organization_id)) ||
    (await resolveOrganizationFromRelationValue(strapi, data.organizationId));

  if (directOrganization) {
    return directOrganization;
  }

  const ownerId = normalizeOwnerId(data.owner_id || data.ownerId);
  if (ownerId) {
    const organizationByOwnerId = await findOrganizationByOwnerId(strapi, ownerId);
    if (organizationByOwnerId) {
      return organizationByOwnerId;
    }
  }

  if (accessContext?.hasRequestUser) {
    if (accessContext.organizations.length === 1) {
      return accessContext.organizations[0];
    }

    return null;
  }

  const configuredDefaultOrganization = await getConfiguredDefaultOrganization(strapi);
  if (configuredDefaultOrganization) {
    return configuredDefaultOrganization;
  }

  return null;
};

const getAccessContext = async (strapi) => {
  const requestState = getRequestState(strapi);
  if (requestState?.[ACCESS_CONTEXT_PROMISE_KEY]) {
    return requestState[ACCESS_CONTEXT_PROMISE_KEY];
  }

  const requestAdminUser = getRequestAdminUser(strapi);
  const cacheableUserId = Number.isInteger(requestAdminUser?.id) ? requestAdminUser.id : null;
  if (cacheableUserId) {
    const cachedPromise = readCachedAccessContext(cacheableUserId);
    if (cachedPromise) {
      if (requestState) {
        requestState[ACCESS_CONTEXT_PROMISE_KEY] = cachedPromise;
      }
      return cachedPromise;
    }
  }

  const accessContextPromise = (async () => {
    if (!requestAdminUser?.id) {
      return buildEmptyAccessContext({
        hasRequestUser: false,
        user: null,
        isSuperAdmin: true,
      });
    }

    const adminUser = await loadAdminUserWithRoles(strapi, requestAdminUser.id);
    if (!adminUser) {
      return buildEmptyAccessContext({
        hasRequestUser: true,
        user: null,
        isSuperAdmin: false,
      });
    }

    if (isSuperAdminUser(adminUser)) {
      return buildEmptyAccessContext({
        hasRequestUser: true,
        user: adminUser,
        isSuperAdmin: true,
      });
    }

    const memberships = await withAccessContextResolution(strapi, async () =>
      strapi.db.query(MEMBERSHIP_UID).findMany({
        select: ['id', 'role', 'is_active'],
        where: {
          is_active: true,
          user: {
            id: adminUser.id,
          },
          organization: {
            is_active: true,
          },
        },
        populate: {
          organization: {
            select: ['id', 'name', 'slug', 'legacy_owner_id', 'is_active'],
          },
        },
      })
    );

    return buildScopedAccessContext(adminUser, memberships);
  })();

  if (requestState) {
    requestState[ACCESS_CONTEXT_PROMISE_KEY] = accessContextPromise;
  }
  if (cacheableUserId) {
    writeCachedAccessContext(cacheableUserId, accessContextPromise);
  }

  try {
    return await accessContextPromise;
  } catch (error) {
    if (requestState?.[ACCESS_CONTEXT_PROMISE_KEY] === accessContextPromise) {
      delete requestState[ACCESS_CONTEXT_PROMISE_KEY];
    }
    if (cacheableUserId) {
      clearCachedAccessContext(cacheableUserId, accessContextPromise);
    }
    throw error;
  }
};

const assertOrganizationAccess = (accessContext, organizationId, { requireAdmin = false } = {}) => {
  if (!accessContext?.hasRequestUser || accessContext.isSuperAdmin) {
    return;
  }

  if (!Number.isInteger(organizationId) || !accessContext.organizationIdSet.has(organizationId)) {
    throw new ForbiddenError('You do not have access to this organization.');
  }

  if (!requireAdmin) {
    return;
  }

  const membership = accessContext.membershipByOrganizationId.get(organizationId);
  if (!membership || membership.role !== ORGANIZATION_ADMIN_ROLE) {
    throw new ForbiddenError('Only organization admins can manage memberships.');
  }
};

const applyOrganizationScopeToWhere = async (strapi, event, accessContext = null) => {
  const resolvedAccessContext = accessContext || (await getAccessContext(strapi));
  if (!resolvedAccessContext.hasRequestUser || resolvedAccessContext.isSuperAdmin) {
    return resolvedAccessContext;
  }

  event.params = event.params || {};
  event.params.where = mergeWhereWithAnd(
    event.params.where,
    resolvedAccessContext.scopedOrganizationRelationWhere,
  );

  return resolvedAccessContext;
};

const assignOrganizationToData = (data, organization) => {
  if (!data || !organization?.id) {
    return;
  }

  data.organization = organization.id;
  data.owner_id = getLegacyOwnerId(organization);
};

const loadExistingOrganizationForRecord = async (strapi, modelUid, where) => {
  if (!where || typeof where !== 'object') {
    return null;
  }

  const existingRecord = await strapi.db.query(modelUid).findOne({
    where,
    populate: {
      organization: {
        select: ['id', 'name', 'slug', 'legacy_owner_id', 'is_active'],
      },
    },
  });

  return existingRecord?.organization || null;
};

const registerOwnershipLifecycles = (strapi) => {
  strapi.db.lifecycles.subscribe({
    models: ORG_SCOPED_MODELS,

    async beforeFindMany(event) {
      await applyOrganizationScopeToWhere(strapi, event);
    },

    async beforeFindOne(event) {
      await applyOrganizationScopeToWhere(strapi, event);
    },

    async beforeCount(event) {
      await applyOrganizationScopeToWhere(strapi, event);
    },

    async beforeCreate(event) {
      const accessContext = await getAccessContext(strapi);
      const organization = await resolveRequestedOrganization(strapi, event.params?.data || {}, accessContext);

      if (!organization) {
        throw new ValidationError('Organization is required for organization-scoped CMS content.');
      }

      assertOrganizationAccess(accessContext, organization.id);
      assignOrganizationToData(event.params?.data, organization);
    },

    async beforeCreateMany(event) {
      const accessContext = await getAccessContext(strapi);
      const items = Array.isArray(event.params?.data) ? event.params.data : [];

      for (const item of items) {
        const organization = await resolveRequestedOrganization(strapi, item, accessContext);
        if (!organization) {
          throw new ValidationError('Organization is required for organization-scoped CMS content.');
        }

        assertOrganizationAccess(accessContext, organization.id);
        assignOrganizationToData(item, organization);
      }
    },

    async beforeUpdate(event) {
      const accessContext = await applyOrganizationScopeToWhere(strapi, event);
      const existingOrganization = await loadExistingOrganizationForRecord(
        strapi,
        event.model.uid,
        event.params?.where,
      );

      if (!existingOrganization) {
        return;
      }

      assertOrganizationAccess(accessContext, existingOrganization.id);
      assignOrganizationToData(event.params?.data, existingOrganization);
    },

    async beforeUpdateMany(event) {
      await applyOrganizationScopeToWhere(strapi, event);
      if (event.params?.data && typeof event.params.data === 'object') {
        delete event.params.data.organization;
        delete event.params.data.owner_id;
      }
    },

    async beforeDelete(event) {
      await applyOrganizationScopeToWhere(strapi, event);
    },

    async beforeDeleteMany(event) {
      await applyOrganizationScopeToWhere(strapi, event);
    },
  });
};

const registerOrganizationManagementLifecycles = (strapi) => {
  strapi.db.lifecycles.subscribe({
    models: [ORGANIZATION_UID],

    async beforeFindMany(event) {
      if (isResolvingAccessContext(strapi)) {
        return;
      }
      const accessContext = await getAccessContext(strapi);
      if (!accessContext.hasRequestUser || accessContext.isSuperAdmin) {
        return;
      }
      event.params = event.params || {};
      event.params.where = mergeWhereWithAnd(event.params.where, accessContext.scopedOrganizationWhere);
    },

    async beforeFindOne(event) {
      if (isResolvingAccessContext(strapi)) {
        return;
      }
      const accessContext = await getAccessContext(strapi);
      if (!accessContext.hasRequestUser || accessContext.isSuperAdmin) {
        return;
      }
      event.params = event.params || {};
      event.params.where = mergeWhereWithAnd(event.params.where, accessContext.scopedOrganizationWhere);
    },

    async beforeCreate() {
      const accessContext = await getAccessContext(strapi);
      if (accessContext.hasRequestUser && !accessContext.isSuperAdmin) {
        throw new ForbiddenError('Only Strapi super admins can create organizations.');
      }
    },

    async beforeUpdate(event) {
      const accessContext = await getAccessContext(strapi);
      if (!accessContext.hasRequestUser || accessContext.isSuperAdmin) {
        return;
      }

      const existingOrganization = await strapi.db.query(ORGANIZATION_UID).findOne({
        where: event.params?.where,
        select: ['id'],
      });
      if (!existingOrganization?.id) {
        return;
      }

      assertOrganizationAccess(accessContext, existingOrganization.id, { requireAdmin: true });

      if (event.params?.data && typeof event.params.data === 'object') {
        delete event.params.data.slug;
        delete event.params.data.legacy_owner_id;
        delete event.params.data.is_active;
      }
    },

    async beforeDelete() {
      const accessContext = await getAccessContext(strapi);
      if (accessContext.hasRequestUser && !accessContext.isSuperAdmin) {
        throw new ForbiddenError('Only Strapi super admins can delete organizations.');
      }
    },
  });

  strapi.db.lifecycles.subscribe({
    models: [MEMBERSHIP_UID],

    async beforeFindMany(event) {
      if (isResolvingAccessContext(strapi)) {
        return;
      }
      const accessContext = await getAccessContext(strapi);
      if (!accessContext.hasRequestUser || accessContext.isSuperAdmin) {
        return;
      }
      event.params = event.params || {};
      event.params.where = mergeWhereWithAnd(
        event.params.where,
        accessContext.scopedOrganizationRelationWhere,
      );
    },

    async beforeFindOne(event) {
      if (isResolvingAccessContext(strapi)) {
        return;
      }
      const accessContext = await getAccessContext(strapi);
      if (!accessContext.hasRequestUser || accessContext.isSuperAdmin) {
        return;
      }
      event.params = event.params || {};
      event.params.where = mergeWhereWithAnd(
        event.params.where,
        accessContext.scopedOrganizationRelationWhere,
      );
    },

    async beforeCreate(event) {
      const accessContext = await getAccessContext(strapi);
      const organization = await resolveRequestedOrganization(strapi, event.params?.data || {}, accessContext);

      if (!organization?.id) {
        throw new ValidationError('Organization membership must target a valid organization.');
      }

      assertOrganizationAccess(accessContext, organization.id, { requireAdmin: true });

      const userRelation = normalizeRelationRef(event.params?.data?.user);
      if (!userRelation) {
        throw new ValidationError('Organization membership must target a valid Strapi admin user.');
      }

      const userWhere = buildRelationWhereClause(userRelation);
      const existingMembership = await strapi.db.query(MEMBERSHIP_UID).findOne({
        where: {
          organization: { id: organization.id },
          user: userWhere,
        },
        select: ['id'],
      });
      if (existingMembership?.id) {
        throw new ValidationError('This Strapi admin user is already assigned to the selected organization.');
      }

      event.params.data.organization = organization.id;
    },

    async beforeUpdate(event) {
      const accessContext = await getAccessContext(strapi);
      const existingMembership = await strapi.db.query(MEMBERSHIP_UID).findOne({
        where: event.params?.where,
        select: ['id', 'role'],
        populate: {
          organization: {
            select: ['id'],
          },
          user: {
            select: ['id'],
          },
        },
      });

      if (!existingMembership?.organization?.id) {
        return;
      }

      assertOrganizationAccess(accessContext, existingMembership.organization.id, { requireAdmin: true });

      if (event.params?.data && typeof event.params.data === 'object') {
        delete event.params.data.organization;
        delete event.params.data.user;
      }
    },

    async beforeDelete(event) {
      const accessContext = await getAccessContext(strapi);
      const existingMembership = await strapi.db.query(MEMBERSHIP_UID).findOne({
        where: event.params?.where,
        select: ['id'],
        populate: {
          organization: {
            select: ['id'],
          },
        },
      });

      if (!existingMembership?.organization?.id) {
        return;
      }

      assertOrganizationAccess(accessContext, existingMembership.organization.id, { requireAdmin: true });
    },
  });
};

const ensureOrganizationForOwnerId = async (strapi, ownerId) => {
  const normalizedOwnerId = normalizeOwnerId(ownerId);
  if (!normalizedOwnerId) {
    return null;
  }

  const existingOrganization = await findOrganizationByOwnerId(strapi, normalizedOwnerId);
  if (existingOrganization) {
    return existingOrganization;
  }

  const slugBase = slugify(normalizedOwnerId) || 'organization';
  let candidateSlug = slugBase;
  let suffix = 1;

  while (await findOrganizationBySlug(strapi, candidateSlug)) {
    suffix += 1;
    candidateSlug = `${slugBase}-${suffix}`;
  }

  return strapi.db.query(ORGANIZATION_UID).create({
    data: {
      name: toTitleCase(normalizedOwnerId) || 'Organization',
      slug: candidateSlug,
      legacy_owner_id: normalizedOwnerId,
      is_active: true,
    },
  });
};

const ensureConfiguredDefaultOrganization = async (strapi) => {
  const configuredOwnerId = normalizeOwnerId(process.env.CMS_DEFAULT_OWNER_ID);
  const configuredSlug = slugify(process.env.CMS_DEFAULT_ORGANIZATION_SLUG || configuredOwnerId || '');

  if (!configuredOwnerId && !configuredSlug) {
    return null;
  }

  const existingOrganization =
    (configuredOwnerId && (await findOrganizationByOwnerId(strapi, configuredOwnerId))) ||
    (configuredSlug && (await findOrganizationBySlug(strapi, configuredSlug)));
  if (existingOrganization) {
    return existingOrganization;
  }

  return strapi.db.query(ORGANIZATION_UID).create({
    data: {
      name:
        (process.env.CMS_DEFAULT_ORGANIZATION_NAME || '').trim() ||
        toTitleCase(configuredOwnerId || configuredSlug) ||
        'Default Organization',
      slug: configuredSlug || 'default-organization',
      legacy_owner_id: configuredOwnerId || normalizeOwnerId(configuredSlug),
      is_active: true,
    },
  });
};

const backfillLegacyOrganizations = async (strapi) => {
  const distinctOwnerIds = new Set();

  for (const modelUid of ORG_SCOPED_MODELS) {
    const records = await strapi.db.query(modelUid).findMany({
      select: ['id', 'owner_id'],
      populate: {
        organization: {
          select: ['id', 'slug', 'legacy_owner_id'],
        },
      },
    });

    records.forEach((record) => {
      const ownerId = normalizeOwnerId(record?.owner_id);
      if (ownerId) {
        distinctOwnerIds.add(ownerId);
      }
    });
  }

  const configuredDefaultOrganization = await ensureConfiguredDefaultOrganization(strapi);
  const organizationByOwnerId = new Map();

  for (const ownerId of distinctOwnerIds) {
    const organization = await ensureOrganizationForOwnerId(strapi, ownerId);
    if (organization?.id) {
      organizationByOwnerId.set(ownerId, organization);
    }
  }

  for (const modelUid of ORG_SCOPED_MODELS) {
    const records = await strapi.db.query(modelUid).findMany({
      select: ['id', 'owner_id'],
      populate: {
        organization: {
          select: ['id', 'slug', 'legacy_owner_id'],
        },
      },
    });

    for (const record of records) {
      const ownerId = normalizeOwnerId(record?.owner_id);
      const organization =
        record?.organization ||
        (ownerId ? organizationByOwnerId.get(ownerId) : null) ||
        configuredDefaultOrganization;

      if (!organization?.id) {
        continue;
      }

      const desiredOwnerId = getLegacyOwnerId(organization);
      const hasOrganizationMismatch = record.organization?.id !== organization.id;
      const hasOwnerMismatch = normalizeOwnerId(record.owner_id) !== desiredOwnerId;

      if (!hasOrganizationMismatch && !hasOwnerMismatch) {
        continue;
      }

      await strapi.db.query(modelUid).update({
        where: { id: record.id },
        data: {
          organization: organization.id,
          owner_id: desiredOwnerId,
        },
      });
    }
  }
};

const resolvePublicOrganizationFromQuery = async (strapi, query = {}) => {
  const organizationIdValue =
    query.organizationId ?? query.organization_id ?? query.orgId ?? query.org_id;
  const organizationSlugValue =
    query.organizationSlug ?? query.organization_slug ?? query.orgSlug ?? query.org_slug;
  const ownerIdValue = query.ownerId ?? query.owner_id;

  let organization = null;

  if (organizationIdValue !== undefined && organizationIdValue !== null && `${organizationIdValue}`.trim()) {
    const parsedOrganizationId = Number.parseInt(`${organizationIdValue}`.trim(), 10);
    if (!Number.isInteger(parsedOrganizationId) || parsedOrganizationId < 1) {
      throw new ValidationError('organization_id must be a positive integer');
    }
    organization = await findOrganizationById(strapi, parsedOrganizationId);
  } else if (organizationSlugValue) {
    organization = await findOrganizationBySlug(strapi, organizationSlugValue);
  } else if (ownerIdValue) {
    organization = await findOrganizationByOwnerId(strapi, ownerIdValue);
  } else {
    organization = await getConfiguredDefaultOrganization(strapi);
  }

  if (!organization?.id || organization.is_active === false) {
    throw new ValidationError('A valid active organization identifier is required.');
  }

  return organization;
};

module.exports = {
  ORGANIZATION_ADMIN_ROLE,
  ORGANIZATION_UID,
  MEMBERSHIP_UID,
  ORG_SCOPED_MODELS,
  applyOrganizationScopeToWhere,
  assertOrganizationAccess,
  assignOrganizationToData,
  backfillLegacyOrganizations,
  buildRelationWhereClause,
  getAccessContext,
  getLegacyOwnerId,
  normalizeOwnerId,
  normalizeRelationRef,
  registerOrganizationManagementLifecycles,
  registerOwnershipLifecycles,
  resolvePublicOrganizationFromQuery,
  resolveRequestedOrganization,
  slugify,
};
