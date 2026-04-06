// @ts-nocheck
'use strict';

const { errors } = require('@strapi/utils');

const { ValidationError } = errors;

const LEVEL_UID = 'api::level.level';
const MODULE_UID = 'api::module.module';
const TOPIC_UID = 'api::topic.topic';
const QUESTION_UID = 'api::ip-question.ip-question';
const VALID_QUESTION_TYPES = new Set(['mcq', 'saq', 'laq']);

const normalizeQuestionType = (value) => String(value || '').trim().toLowerCase();

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const validateMcqChoices = (choices) => {
  if (!Array.isArray(choices) || choices.length < 2) {
    throw new ValidationError('MCQ questions must include at least 2 choices.');
  }

  const normalizedChoices = choices.filter(
    (choice) => choice && typeof choice === 'object' && isNonEmptyString(choice.choice_text),
  );

  if (normalizedChoices.length < 2) {
    throw new ValidationError('MCQ questions must include at least 2 non-empty choices.');
  }

  if (!normalizedChoices.some((choice) => choice.is_correct === true)) {
    throw new ValidationError('MCQ questions must include at least 1 correct choice.');
  }
};

const validateAcceptedAnswers = (acceptedAnswers) => {
  if (!Array.isArray(acceptedAnswers) || acceptedAnswers.length < 1) {
    throw new ValidationError('SAQ questions must include at least 1 accepted answer.');
  }

  const normalizedAnswers = acceptedAnswers.filter(isNonEmptyString);
  if (normalizedAnswers.length < 1) {
    throw new ValidationError('SAQ questions must include at least 1 non-empty accepted answer.');
  }
};

const validateLaqGuidance = (data) => {
  const hasSampleAnswer = isNonEmptyString(data.sample_answer);
  const hasMarkingRubric = isNonEmptyString(data.marking_rubric);

  if (!hasSampleAnswer && !hasMarkingRubric) {
    throw new ValidationError(
      'LAQ questions must include a sample answer or a marking rubric for grading guidance.',
    );
  }
};

const validateQuestionPayload = (data) => {
  if (!data || typeof data !== 'object') {
    return;
  }

  const questionType = normalizeQuestionType(data.question_type);
  if (!VALID_QUESTION_TYPES.has(questionType)) {
    throw new ValidationError('question_type must be one of: mcq, saq, laq.');
  }

  if (!Number.isInteger(data.max_score) || data.max_score < 1) {
    throw new ValidationError('max_score must be an integer greater than or equal to 1.');
  }

  if (questionType === 'mcq') {
    validateMcqChoices(data.choices);
    return;
  }

  if (Array.isArray(data.choices) && data.choices.length > 0) {
    throw new ValidationError(`${questionType.toUpperCase()} questions must not include choices.`);
  }

  if (questionType === 'saq') {
    validateAcceptedAnswers(data.accepted_answers);
    return;
  }

  validateLaqGuidance(data);
};

const mergeExistingWithIncoming = (existingRecord, incomingData) => ({
  ...existingRecord,
  ...incomingData,
});

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

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

  if (isPlainObject(value)) {
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

const getLevelDisplayValue = (level) => level?.code || level?.name || level?.slug || 'unknown';
const getModuleDisplayValue = (moduleRecord) => moduleRecord?.name || moduleRecord?.slug || 'unknown';

const joinDisplayValues = (values) => values.filter(Boolean).join(', ');

const resolveLevelRecord = async (strapi, levelRef) => {
  const levelWhere = buildRelationWhereClause(levelRef);
  if (!levelWhere) {
    return null;
  }

  return strapi.db.query(LEVEL_UID).findOne({
    where: levelWhere,
    select: ['id', 'documentId', 'name', 'code', 'slug'],
  });
};

const resolveModuleRecord = async (strapi, moduleRef) => {
  const moduleWhere = buildRelationWhereClause(moduleRef);
  if (!moduleWhere) {
    return null;
  }

  return strapi.db.query(MODULE_UID).findOne({
    where: moduleWhere,
    select: ['id', 'documentId', 'name', 'slug'],
    populate: {
      level: {
        select: ['id', 'documentId', 'name', 'code', 'slug'],
      },
    },
  });
};

const validateModuleTopicConsistency = async (strapi, data) => {
  if (!data || typeof data !== 'object') {
    return;
  }

  const moduleRefs = normalizeRelationRefs(data.module);
  const topicRefs = normalizeRelationRefs(data.topics);
  const levelRefs = normalizeRelationRefs(data.level);

  if (moduleRefs.length === 0) {
    return;
  }

  const moduleRecords = await Promise.all(moduleRefs.map((moduleRef) => resolveModuleRecord(strapi, moduleRef)));
  if (moduleRecords.some((moduleRecord) => !moduleRecord)) {
    throw new ValidationError('Selected module could not be found.');
  }

  const selectedModuleRecords = moduleRecords.filter(Boolean);
  const selectedModuleRefs = selectedModuleRecords.map((moduleRecord) => normalizeRelationRef(moduleRecord));

  const levelRecords = await Promise.all(levelRefs.map((levelRef) => resolveLevelRecord(strapi, levelRef)));
  if (levelRecords.some((levelRecord) => !levelRecord)) {
    throw new ValidationError('Selected academic level could not be found.');
  }

  const selectedLevelRecords = levelRecords.filter(Boolean);
  const selectedLevelRefs = selectedLevelRecords.map((levelRecord) => normalizeRelationRef(levelRecord));
  const selectedLevelLabels = selectedLevelRecords.map(getLevelDisplayValue);

  if (selectedLevelRefs.length > 0) {
    const invalidModule = selectedModuleRecords.find((moduleRecord) => {
      const moduleLevelRefs = normalizeRelationRefs(moduleRecord.level);
      return (
        moduleLevelRefs.length > 0 &&
        !moduleLevelRefs.some((moduleLevelRef) =>
          selectedLevelRefs.some((selectedLevelRef) => refsMatch(moduleLevelRef, selectedLevelRef)),
        )
      );
    });

    if (invalidModule) {
      const allowedLevels = normalizeRelationRefs(invalidModule.level)
        .map((moduleLevelRef, index) => {
          const moduleLevel = invalidModule.level?.[index];
          return moduleLevel && refsMatch(moduleLevelRef, normalizeRelationRef(moduleLevel))
            ? getLevelDisplayValue(moduleLevel)
            : null;
        })
        .filter(Boolean);

      throw new ValidationError(
        `Module "${getModuleDisplayValue(invalidModule)}" does not belong to any selected academic levels "${joinDisplayValues(
          selectedLevelLabels,
        )}". Allowed levels: "${joinDisplayValues(allowedLevels)}".`,
      );
    }
  }

  if (topicRefs.length === 0) {
    return;
  }

  const topicRecords = await Promise.all(
    topicRefs.map(async (topicRef) => {
      const topicWhere = buildRelationWhereClause(topicRef);
      if (!topicWhere) {
        return null;
      }

      return strapi.db.query(TOPIC_UID).findOne({
        where: topicWhere,
        select: ['id', 'documentId', 'name'],
        populate: {
          module: {
            select: ['id', 'documentId', 'name'],
          },
          level: {
            select: ['id', 'documentId', 'name', 'code', 'slug'],
          },
        },
      });
    }),
  );

  const missingTopic = topicRecords.find((topic) => !topic);
  if (missingTopic) {
    throw new ValidationError('One or more selected topics could not be found.');
  }

  const invalidTopic = topicRecords.find((topic) => {
    const topicModule = normalizeRelationRef(topic?.module);
    return (
      !topicModule ||
      !selectedModuleRefs.some((selectedModuleRef) => refsMatch(topicModule, selectedModuleRef))
    );
  });

  if (invalidTopic) {
    throw new ValidationError(
      `Topic "${invalidTopic.name}" does not belong to any selected modules "${joinDisplayValues(
        selectedModuleRecords.map(getModuleDisplayValue),
      )}".`,
    );
  }

  if (selectedLevelRefs.length === 0) {
    return;
  }

  const invalidTopicLevel = topicRecords.find((topic) => {
    if (!topic?.level) {
      return false;
    }

    const topicLevels = normalizeRelationRefs(topic.level);
    return (
      topicLevels.length > 0 &&
      !topicLevels.some((topicLevel) =>
        selectedLevelRefs.some((selectedLevelRef) => refsMatch(topicLevel, selectedLevelRef)),
      )
    );
  });

  if (invalidTopicLevel) {
    throw new ValidationError(
      `Topic "${invalidTopicLevel.name}" does not belong to any selected academic levels "${joinDisplayValues(
        selectedLevelLabels,
      )}".`,
    );
  }
};

const registerQuestionValidationLifecycles = (strapi) => {
  strapi.db.lifecycles.subscribe({
    models: [QUESTION_UID],

    async beforeCreate(event) {
      validateQuestionPayload(event.params?.data);
      await validateModuleTopicConsistency(strapi, event.params?.data);
    },

    async beforeCreateMany(event) {
      const items = Array.isArray(event.params?.data) ? event.params.data : [];
      for (const item of items) {
        validateQuestionPayload(item);
        await validateModuleTopicConsistency(strapi, item);
      }
    },

    async beforeUpdate(event) {
      const where = event.params?.where;
      if (!where || typeof where !== 'object') {
        validateQuestionPayload(event.params?.data);
        return;
      }

      const existingRecord = await strapi.db.query(QUESTION_UID).findOne({
        where,
        select: [
          'question_type',
          'choices',
          'accepted_answers',
          'sample_answer',
          'marking_rubric',
          'max_score',
        ],
        populate: {
          module: {
            select: ['id', 'documentId', 'name'],
            populate: {
              level: {
                select: ['id', 'documentId', 'name', 'code', 'slug'],
              },
            },
          },
          topics: {
            select: ['id', 'documentId', 'name'],
          },
          level: {
            select: ['id', 'documentId', 'name', 'code', 'slug'],
          },
        },
      });

      const mergedPayload = mergeExistingWithIncoming(existingRecord || {}, event.params?.data || {});
      validateQuestionPayload(mergedPayload);
      await validateModuleTopicConsistency(strapi, mergedPayload);
    },
  });
};

module.exports = {
  registerQuestionValidationLifecycles,
};
