'use strict';

const {
  MEMBERSHIP_UID,
  ORGANIZATION_ADMIN_ROLE,
  getAccessContext,
} = require('../../../../../utils/cms-organizations');

const sanitizeMembership = (membership) => ({
  id: membership.id,
  role: membership.role,
  is_active: membership.is_active,
  user: membership.user
    ? {
        id: membership.user.id,
        email: membership.user.email || '',
        username: membership.user.username || '',
        firstname: membership.user.firstname || '',
        lastname: membership.user.lastname || '',
        isActive: membership.user.isActive,
        blocked: membership.user.blocked,
      }
    : null,
});

const sanitizeAdminUser = (user) => ({
  id: user.id,
  email: user.email || '',
  username: user.username || '',
  firstname: user.firstname || '',
  lastname: user.lastname || '',
  isActive: user.isActive,
  blocked: user.blocked,
});

const getCanManageMemberships = (accessContext) =>
  Boolean(
    accessContext?.isSuperAdmin ||
      accessContext?.activeMembership?.role === ORGANIZATION_ADMIN_ROLE,
  );

module.exports = {
  async context(ctx) {
    const accessContext = await getAccessContext(strapi);
    const canManageMemberships = getCanManageMemberships(accessContext);
    const activeOrganizationMembers = accessContext.activeOrganization?.id
      ? await strapi.db.query(MEMBERSHIP_UID).findMany({
          select: ['id', 'role', 'is_active'],
          where: {
            is_active: true,
          },
          populate: {
            user: {
              select: ['id', 'email', 'username', 'firstname', 'lastname', 'isActive', 'blocked'],
            },
          },
          orderBy: {
            id: 'asc',
          },
        })
      : [];
    const memberUserIds = new Set(
      activeOrganizationMembers.map((membership) => membership.user?.id).filter(Boolean),
    );
    const availableUsers =
      canManageMemberships && accessContext.activeOrganization?.id
        ? (
            await strapi.db.query('admin::user').findMany({
              select: ['id', 'email', 'username', 'firstname', 'lastname', 'isActive', 'blocked'],
              where: {
                isActive: true,
                blocked: false,
              },
              orderBy: {
                email: 'asc',
              },
            })
          ).filter((user) => !memberUserIds.has(user.id))
        : [];

    ctx.send({
      isSuperAdmin: accessContext.isSuperAdmin,
      canManageMemberships,
      activeOrganizationId: accessContext.activeOrganization?.id || null,
      activeOrganization: accessContext.activeOrganization
        ? {
            id: accessContext.activeOrganization.id,
            name: accessContext.activeOrganization.name,
            slug: accessContext.activeOrganization.slug,
          }
        : null,
      organizations: accessContext.organizations.map((organization) => {
        const membership = accessContext.membershipByOrganizationId.get(organization.id);

        return {
          id: organization.id,
          name: organization.name || '',
          slug: organization.slug || '',
          role: membership?.role || (accessContext.isSuperAdmin ? 'super_admin' : 'viewer'),
        };
      }),
      members: activeOrganizationMembers.map(sanitizeMembership),
      availableUsers: availableUsers.map(sanitizeAdminUser),
    });
  },

  async createMembership(ctx) {
    const accessContext = await getAccessContext(strapi);

    if (!getCanManageMemberships(accessContext)) {
      return ctx.forbidden('You do not have permission to manage this organization.');
    }

    if (!accessContext.activeOrganization?.id) {
      return ctx.badRequest('An active organization is required.');
    }

    const body = ctx.request.body && typeof ctx.request.body === 'object' ? ctx.request.body : {};
    const parsedUserId = Number.parseInt(`${body.userId ?? ''}`.trim(), 10);
    const role = `${body.role || 'editor'}`.trim() || 'editor';

    if (!Number.isInteger(parsedUserId) || parsedUserId < 1) {
      return ctx.badRequest('userId must be a positive integer.');
    }

    await strapi.db.query(MEMBERSHIP_UID).create({
      data: {
        organization: accessContext.activeOrganization.id,
        user: parsedUserId,
        role,
        is_active: true,
      },
    });

    ctx.send({
      ok: true,
    });
  },
};
