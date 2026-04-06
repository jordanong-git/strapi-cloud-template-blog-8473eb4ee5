// @ts-nocheck
'use strict';

const { randomUUID } = require('crypto');

const { GetObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { factories } = require('@strapi/strapi');
const { errors } = require('@strapi/utils');

const { NotFoundError, ValidationError } = errors;

const QUESTION_UID = 'api::ip-question.ip-question';
const ASSET_UID = 'api::ip-asset.ip-asset';
const AUDIT_UID = 'api::ip-audit-log.ip-audit-log';

const DEFAULT_SIGNED_URL_EXPIRY_SECONDS = 3600;
const MAX_SIGNED_URL_EXPIRY_SECONDS = 3600;
const MAX_GENERATED_ITEMS = 100;
const S3_SIGNABLE_ASSET_TYPES = new Set(['worksheet', 'video', 'pdf']);

const parseMultiStringValues = (value, name) => {
  const rawValues = Array.isArray(value) ? value : [value];
  const normalized = rawValues
    .flatMap((item) => String(item || '').split(','))
    .map((item) => item.trim())
    .filter(Boolean);

  if (normalized.length === 0) {
    throw new ValidationError(`${name} is required`);
  }

  return [...new Set(normalized)];
};

const parseSingleQueryValue = (value) => {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
};

const parseRequiredString = (value, name) => {
  const normalized = parseSingleQueryValue(value)?.trim();
  if (!normalized) {
    throw new ValidationError(`${name} is required`);
  }

  return normalized;
};

const parseOptionalString = (value) => {
  const normalized = parseSingleQueryValue(value)?.trim();
  return normalized || undefined;
};

const parseCount = (value) => {
  const raw = parseRequiredString(value, 'count');
  const count = Number.parseInt(raw, 10);

  if (!Number.isInteger(count) || count < 1 || count > MAX_GENERATED_ITEMS) {
    throw new ValidationError(`count must be an integer between 1 and ${MAX_GENERATED_ITEMS}`);
  }

  return count;
};

const shuffle = (items) => {
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }

  return copy;
};

const toDispositionFileName = (value, fallback) =>
  ((value || fallback)
    .replace(/[^\w.\- ]+/g, '')
    .trim()
    .slice(0, 120)) || fallback;

const parseBooleanEnv = (value, defaultValue) => {
  if (value === undefined) {
    return defaultValue;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
};

const getS3Client = () => {
  const endpoint = (process.env.CMS_STORAGE_ENDPOINT || '').trim();
  const region = (process.env.CMS_STORAGE_REGION || 'auto').trim();
  const accessKeyId = (process.env.CMS_STORAGE_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (process.env.CMS_STORAGE_SECRET_ACCESS_KEY || '').trim();

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new ValidationError(
      'CMS storage signing is not configured. Set CMS_STORAGE_ENDPOINT, CMS_STORAGE_ACCESS_KEY_ID, and CMS_STORAGE_SECRET_ACCESS_KEY.',
    );
  }

  return new S3Client({
    region,
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: parseBooleanEnv(process.env.CMS_STORAGE_FORCE_PATH_STYLE, true),
  });
};

const buildTopicRelationFilter = (topics, ownerId) => ({
  $and: [
    {
      $or: topics.flatMap((topic) => [
        { slug: { $eqi: topic } },
        { name: { $eqi: topic } },
      ]),
    },
    {
      owner_id: ownerId,
    },
    {
      is_active: true,
    },
    {
      publishedAt: {
        $notNull: true,
      },
    },
  ],
});

const buildDifficultyRelationFilter = (difficultyValue, ownerId) => {
  const filters = [
    { slug: { $eqi: difficultyValue } },
    { name: { $eqi: difficultyValue } },
  ];
  const levelNumber = Number.parseInt(difficultyValue, 10);
  if (Number.isInteger(levelNumber)) {
    filters.push({ level_number: levelNumber });
  }

  return {
    $and: [
      {
        $or: filters,
      },
      {
        owner_id: ownerId,
      },
      {
        is_active: true,
      },
      {
        publishedAt: {
          $notNull: true,
        },
      },
    ],
  };
};

const buildLevelRelationFilter = (levelValue, ownerId) => ({
  $and: [
    {
      $or: [
        { slug: { $eqi: levelValue } },
        { code: { $eqi: levelValue } },
        { name: { $eqi: levelValue } },
      ],
    },
    {
      owner_id: ownerId,
    },
    {
      is_active: true,
    },
    {
      publishedAt: {
        $notNull: true,
      },
    },
  ],
});

const buildModuleRelationFilter = (moduleValue, ownerId) => ({
  $and: [
    {
      $or: [
        { slug: { $eqi: moduleValue } },
        { name: { $eqi: moduleValue } },
      ],
    },
    {
      owner_id: ownerId,
    },
    {
      is_active: true,
    },
    {
      publishedAt: {
        $notNull: true,
      },
    },
  ],
});

const buildQuestionFilters = (query) => {
  const ownerId = parseRequiredString(query.ownerId, 'ownerId');
  const topics = parseMultiStringValues(query.topic ?? query.subTopic ?? query.sub_topic, 'topic');
  const module = parseOptionalString(query.module);
  const level = parseRequiredString(query.level, 'level');
  const difficulty = parseRequiredString(query.difficulty, 'difficulty');
  const questionType = parseOptionalString(
    query.questionType ?? query.question_type ?? query.responseType ?? query.response_type,
  );

  const where = {
    owner_id: ownerId,
    level: buildLevelRelationFilter(level, ownerId),
    asset_type: 'question',
    is_active: true,
    topics: buildTopicRelationFilter(topics, ownerId),
    difficulty: buildDifficultyRelationFilter(difficulty, ownerId),
    publishedAt: {
      $notNull: true,
    },
  };

  if (questionType) {
    where.question_type = questionType;
  }

  if (module) {
    where.module = buildModuleRelationFilter(module, ownerId);
  }

  return {
    where,
    ownerId,
    module,
    topics,
    level,
    difficulty,
    questionType,
  };
};

const mapTopics = (topics) =>
  Array.isArray(topics)
    ? topics
        .map((topic) => topic?.name || topic?.slug || null)
        .filter(Boolean)
    : [];

const mapModule = (module) => {
  const modules = Array.isArray(module) ? module : module ? [module] : [];
  const moduleNames = modules.map((item) => item?.name || item?.slug || null).filter(Boolean);
  const moduleSlugs = modules.map((item) => item?.slug || null).filter(Boolean);

  if (moduleNames.length === 0) {
    return {
      module: null,
      module_slug: null,
      modules: [],
      module_slugs: [],
    };
  }

  return {
    module: moduleNames[0] ?? null,
    module_slug: moduleSlugs[0] ?? null,
    modules: moduleNames,
    module_slugs: moduleSlugs,
  };
};

const mapLevel = (level) => {
  const levels = Array.isArray(level) ? level : level ? [level] : [];
  const levelValues = levels.map((item) => item?.code || item?.slug || item?.name || null).filter(Boolean);
  const levelNames = levels.map((item) => item?.name || null).filter(Boolean);
  const levelSlugs = levels.map((item) => item?.slug || null).filter(Boolean);

  if (levelValues.length === 0) {
    return {
      level: null,
      level_name: null,
      level_slug: null,
      levels: [],
      level_names: [],
      level_slugs: [],
    };
  }

  return {
    level: levelValues[0] ?? null,
    level_name: levelNames[0] ?? null,
    level_slug: levelSlugs[0] ?? null,
    levels: levelValues,
    level_names: levelNames,
    level_slugs: levelSlugs,
  };
};

const mapDifficulty = (difficulty) => {
  if (!difficulty || typeof difficulty !== 'object') {
    return {
      difficulty: null,
      difficulty_slug: null,
      difficulty_level: null,
    };
  }

  return {
    difficulty: difficulty.name || difficulty.slug || null,
    difficulty_slug: difficulty.slug || null,
    difficulty_level: Number.isInteger(difficulty.level_number) ? difficulty.level_number : null,
  };
};

const mapQuestion = (question) => {
  const topics = mapTopics(question.topics);
  const mappedModule = mapModule(question.module);
  const mappedLevel = mapLevel(question.level);
  const mappedDifficulty = mapDifficulty(question.difficulty);

  return {
    id: question.id,
    documentId: question.documentId,
    title: question.title,
    prompt: question.prompt,
    question_type: question.question_type,
    choices: question.choices ?? null,
    accepted_answers: question.accepted_answers ?? null,
    sample_answer: question.sample_answer ?? null,
    marking_rubric: question.marking_rubric ?? null,
    max_score: Number.isInteger(question.max_score) ? question.max_score : 1,
    explanation: question.explanation ?? null,
    module: mappedModule.module,
    module_slug: mappedModule.module_slug,
    modules: mappedModule.modules,
    module_slugs: mappedModule.module_slugs,
    topic: topics[0] ?? null,
    topics,
    level: mappedLevel.level,
    level_name: mappedLevel.level_name,
    level_slug: mappedLevel.level_slug,
    levels: mappedLevel.levels,
    level_names: mappedLevel.level_names,
    level_slugs: mappedLevel.level_slugs,
    difficulty: mappedDifficulty.difficulty,
    difficulty_slug: mappedDifficulty.difficulty_slug,
    difficulty_level: mappedDifficulty.difficulty_level,
    asset_type: question.asset_type,
    owner_id: question.owner_id,
    contains_latex: Boolean(question.contains_latex),
    metadata: question.metadata ?? null,
  };
};

const readRequesterContext = (ctx) => ({
  request_id: ctx.get('x-request-id')?.trim() || ctx.request.body?.request_id || randomUUID(),
  requesting_user_id: ctx.get('x-request-user-id')?.trim() || ctx.request.body?.requesting_user_id || null,
  requesting_user_email:
    ctx.get('x-request-user-email')?.trim() || ctx.request.body?.requesting_user_email || null,
  outlet_id: ctx.get('x-request-outlet-id')?.trim() || ctx.request.body?.outlet_id || null,
  outlet_name: ctx.get('x-request-outlet-name')?.trim() || ctx.request.body?.outlet_name || null,
});

const createAuditLog = async (strapi, action, ctx, payload) => {
  const requester = readRequesterContext(ctx);

  await strapi.db.query(AUDIT_UID).create({
    data: {
      action,
      request_id: requester.request_id,
      requesting_user_id: requester.requesting_user_id,
      requesting_user_email: requester.requesting_user_email,
      outlet_id: requester.outlet_id,
      outlet_name: requester.outlet_name,
      owner_id: payload.ownerId ?? null,
      module: payload.module ?? null,
      topic: Array.isArray(payload.topics) ? payload.topics.join(', ') : null,
      level: payload.level ?? null,
      difficulty: payload.difficulty ?? null,
      requested_count: payload.requestedCount ?? null,
      returned_count: payload.returnedCount ?? null,
      asset_id: payload.assetId ?? null,
      query_params: payload.queryParams ?? null,
      requested_at: new Date().toISOString(),
      success: payload.success,
      notes: payload.notes ?? null,
    },
  });
};

const queryQuestions = async (strapi, where) =>
  strapi.db.query(QUESTION_UID).findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    populate: {
      level: true,
      module: true,
      topics: true,
      difficulty: true,
    },
  });

const getPublishedAsset = async (strapi, assetId) =>
  strapi.db.query(ASSET_UID).findOne({
    where: {
      id: assetId,
      is_active: true,
      publishedAt: {
        $notNull: true,
      },
    },
    populate: {
      level: true,
      module: true,
      topics: true,
      difficulty: true,
    },
  });

module.exports = factories.createCoreController(QUESTION_UID, ({ strapi }) => ({
  async generateQuestions(ctx) {
    const count = parseCount(ctx.query.count);
    const filters = buildQuestionFilters(ctx.query);

    try {
      const questionPool = await queryQuestions(strapi, filters.where);
      const selectedQuestions = shuffle(questionPool).slice(0, count);

      await createAuditLog(strapi, 'generate_questions', ctx, {
        ownerId: filters.ownerId,
        module: filters.module,
        topics: filters.topics,
        level: filters.level,
        difficulty: filters.difficulty,
        requestedCount: count,
        returnedCount: selectedQuestions.length,
        queryParams: ctx.query,
        success: true,
      });

      ctx.body = {
        data: selectedQuestions.map(mapQuestion),
        meta: {
          requested_count: count,
          returned_count: selectedQuestions.length,
        },
      };
    } catch (error) {
      await createAuditLog(strapi, 'generate_questions', ctx, {
        ownerId: filters.ownerId,
        module: filters.module,
        topics: filters.topics,
        level: filters.level,
        difficulty: filters.difficulty,
        requestedCount: count,
        returnedCount: 0,
        queryParams: ctx.query,
        success: false,
        notes: error.message,
      });

      throw error;
    }
  },

  async generateWorksheet(ctx) {
    const count = parseCount(ctx.query.count);
    const filters = buildQuestionFilters(ctx.query);

    try {
      const questionPool = await queryQuestions(strapi, filters.where);
      const selectedQuestions = shuffle(questionPool).slice(0, count);

      await createAuditLog(strapi, 'generate_worksheet', ctx, {
        ownerId: filters.ownerId,
        module: filters.module,
        topics: filters.topics,
        level: filters.level,
        difficulty: filters.difficulty,
        requestedCount: count,
        returnedCount: selectedQuestions.length,
        queryParams: ctx.query,
        success: true,
      });

      ctx.body = {
        data: {
          format: 'json',
          worksheet: {
            title: `${filters.topics.join(', ')} Worksheet`,
            owner_id: filters.ownerId,
            module: filters.module,
            topic: filters.topics[0] ?? null,
            topics: filters.topics,
            level: filters.level,
            difficulty: filters.difficulty,
            generated_at: new Date().toISOString(),
            items: selectedQuestions.map(mapQuestion),
          },
        },
        meta: {
          requested_count: count,
          returned_count: selectedQuestions.length,
        },
      };
    } catch (error) {
      await createAuditLog(strapi, 'generate_worksheet', ctx, {
        ownerId: filters.ownerId,
        module: filters.module,
        topics: filters.topics,
        level: filters.level,
        difficulty: filters.difficulty,
        requestedCount: count,
        returnedCount: 0,
        queryParams: ctx.query,
        success: false,
        notes: error.message,
      });

      throw error;
    }
  },

  async assetUrl(ctx) {
    const rawAssetId = parseRequiredString(ctx.query.assetId, 'assetId');
    const ownerId = parseRequiredString(ctx.query.ownerId, 'ownerId');
    const assetId = Number.parseInt(rawAssetId, 10);

    if (!Number.isInteger(assetId) || assetId < 1) {
      throw new ValidationError('assetId must be a positive integer');
    }

    try {
      const asset = await getPublishedAsset(strapi, assetId);

      if (!asset) {
        throw new NotFoundError('Asset not found');
      }

      if (asset.owner_id !== ownerId) {
        throw new NotFoundError('Asset not found');
      }

      if (!S3_SIGNABLE_ASSET_TYPES.has(asset.asset_type)) {
        throw new ValidationError('Only stored files, worksheets, PDFs, and videos can be signed');
      }

      if (!asset.object_key?.trim()) {
        throw new ValidationError('Asset does not have an object key configured');
      }

      const s3Client = getS3Client();
      const bucket = (process.env.CMS_STORAGE_BUCKET || '').trim();
      if (!bucket) {
        throw new ValidationError('CMS_STORAGE_BUCKET is required');
      }

      const parsedExpiresIn = Number.parseInt(
        process.env.CMS_SIGNED_URL_EXPIRES_SECONDS || `${DEFAULT_SIGNED_URL_EXPIRY_SECONDS}`,
        10,
      );
      const expiresIn =
        Number.isInteger(parsedExpiresIn) && parsedExpiresIn > 0
          ? Math.min(parsedExpiresIn, MAX_SIGNED_URL_EXPIRY_SECONDS)
          : DEFAULT_SIGNED_URL_EXPIRY_SECONDS;
      const fileName = toDispositionFileName(asset.file_name, asset.title);

      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: asset.object_key,
        ResponseContentType: asset.mime_type || undefined,
        ResponseContentDisposition: `inline; filename="${fileName}"`,
      });

      const url = await getSignedUrl(s3Client, command, {
        expiresIn,
      });
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

      await createAuditLog(strapi, 'asset_url', ctx, {
        ownerId,
        module: mapModule(asset.module).module,
        topics: mapTopics(asset.topics),
        level: mapLevel(asset.level).level,
        difficulty: mapDifficulty(asset.difficulty).difficulty,
        assetId,
        queryParams: ctx.query,
        success: true,
      });

      ctx.body = {
        data: {
          id: asset.id,
          documentId: asset.documentId,
          title: asset.title,
          module: mapModule(asset.module).module,
          asset_type: asset.asset_type,
          owner_id: asset.owner_id,
          object_key: asset.object_key,
          mime_type: asset.mime_type ?? null,
          file_name: asset.file_name ?? null,
          expires_at: expiresAt,
          url,
        },
      };
    } catch (error) {
      await createAuditLog(strapi, 'asset_url', ctx, {
        ownerId,
        assetId,
        queryParams: ctx.query,
        success: false,
        notes: error.message,
      });

      throw error;
    }
  },
}));
