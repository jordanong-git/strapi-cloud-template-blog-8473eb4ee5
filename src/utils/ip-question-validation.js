'use strict';

const { errors } = require('@strapi/utils');

const { ValidationError } = errors;

const QUESTION_UID = 'api::ip-question.ip-question';
const VALID_QUESTION_TYPES = new Set(['mcq', 'saq', 'laq']);

const normalizeResponseType = (value) => String(value || '').trim().toLowerCase();

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

  const responseType = normalizeResponseType(data.response_type);
  if (!VALID_QUESTION_TYPES.has(responseType)) {
    throw new ValidationError('response_type must be one of: mcq, saq, laq.');
  }

  if (!Number.isInteger(data.max_score) || data.max_score < 1) {
    throw new ValidationError('max_score must be an integer greater than or equal to 1.');
  }

  if (responseType === 'mcq') {
    validateMcqChoices(data.choices);
    return;
  }

  if (Array.isArray(data.choices) && data.choices.length > 0) {
    throw new ValidationError(`${responseType.toUpperCase()} questions must not include choices.`);
  }

  if (responseType === 'saq') {
    validateAcceptedAnswers(data.accepted_answers);
    return;
  }

  validateLaqGuidance(data);
};

const mergeExistingWithIncoming = (existingRecord, incomingData) => ({
  ...existingRecord,
  ...incomingData,
});

const registerQuestionValidationLifecycles = (strapi) => {
  strapi.db.lifecycles.subscribe({
    models: [QUESTION_UID],

    beforeCreate(event) {
      validateQuestionPayload(event.params?.data);
    },

    beforeCreateMany(event) {
      const items = Array.isArray(event.params?.data) ? event.params.data : [];
      items.forEach(validateQuestionPayload);
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
          'response_type',
          'choices',
          'accepted_answers',
          'sample_answer',
          'marking_rubric',
          'max_score',
        ],
      });

      validateQuestionPayload(mergeExistingWithIncoming(existingRecord || {}, event.params?.data || {}));
    },
  });
};

module.exports = {
  registerQuestionValidationLifecycles,
};
