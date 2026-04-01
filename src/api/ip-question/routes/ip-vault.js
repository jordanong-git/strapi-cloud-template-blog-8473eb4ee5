'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/ip-vault/generate-questions',
      handler: 'ip-question.generateQuestions',
      config: {
        auth: false,
        policies: ['global::ip-vault-auth'],
      },
    },
    {
      method: 'GET',
      path: '/ip-vault/generate-worksheet',
      handler: 'ip-question.generateWorksheet',
      config: {
        auth: false,
        policies: ['global::ip-vault-auth'],
      },
    },
    {
      method: 'GET',
      path: '/ip-vault/asset-url',
      handler: 'ip-question.assetUrl',
      config: {
        auth: false,
        policies: ['global::ip-vault-auth'],
      },
    },
  ],
};
