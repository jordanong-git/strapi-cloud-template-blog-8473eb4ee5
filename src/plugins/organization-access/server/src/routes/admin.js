'use strict';

module.exports = {
  type: 'admin',
  routes: [
    {
      method: 'GET',
      path: '/context',
      handler: 'access.context',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
      },
    },
    {
      method: 'POST',
      path: '/memberships',
      handler: 'access.createMembership',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
      },
    },
  ],
};
