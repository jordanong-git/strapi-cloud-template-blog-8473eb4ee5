'use strict';

const { timingSafeEqual } = require('crypto');

const { errors } = require('@strapi/utils');

const { UnauthorizedError, ValidationError } = errors;

const safeEquals = (left, right) => {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
};

module.exports = (policyContext) => {
  const configuredKey = (process.env.CMS_IP_VAULT_MASTER_KEY || '').trim();
  if (!configuredKey) {
    throw new ValidationError('CMS_IP_VAULT_MASTER_KEY is not configured');
  }

  const headerKey = policyContext.request.header['x-ip-vault-key']?.trim();
  const authorization = policyContext.request.header.authorization?.trim();
  const bearerKey = authorization?.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : undefined;
  const providedKey = headerKey || bearerKey;

  if (!providedKey || !safeEquals(providedKey, configuredKey)) {
    throw new UnauthorizedError('Invalid IP vault credentials');
  }

  return true;
};
