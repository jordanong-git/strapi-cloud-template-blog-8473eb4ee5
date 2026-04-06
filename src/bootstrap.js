// @ts-nocheck
'use strict';

const fs = require('fs-extra');
const path = require('path');
const mime = require('mime-types');
const { global, about } = require('../data/data.json');
const { registerOwnershipLifecycles } = require('./utils/ip-vault-ownership');
const { registerQuestionValidationLifecycles } = require('./utils/ip-question-validation');
const { registerTaxonomyLifecycles } = require('./utils/ip-vault-taxonomy');

async function seedExampleApp() {
  const shouldImportSeedData = await isFirstRun();

  if (shouldImportSeedData) {
    try {
      console.log('Setting up the template...');
      await importSeedData();
      console.log('Ready to go');
    } catch (error) {
      console.log('Could not import seed data');
      console.error(error);
    }
  } else {
    console.log(
      'Seed data has already been imported. We cannot reimport unless you clear your database first.'
    );
  }
}

async function removeSensitiveApiPermissions() {
  const roles = await strapi.query('plugin::users-permissions.role').findMany({
    where: {
      type: {
        $in: ['public', 'authenticated'],
      },
    },
  });

  if (!roles.length) {
    return;
  }

  const sensitiveActions = [
    'api::ip-question.ip-question.find',
    'api::ip-question.ip-question.findOne',
    'api::ip-question.ip-question.create',
    'api::ip-question.ip-question.update',
    'api::ip-question.ip-question.delete',
    'api::ip-asset.ip-asset.find',
    'api::ip-asset.ip-asset.findOne',
    'api::ip-asset.ip-asset.create',
    'api::ip-asset.ip-asset.update',
    'api::ip-asset.ip-asset.delete',
    'api::ip-audit-log.ip-audit-log.find',
    'api::ip-audit-log.ip-audit-log.findOne',
    'api::ip-audit-log.ip-audit-log.create',
    'api::ip-audit-log.ip-audit-log.update',
    'api::ip-audit-log.ip-audit-log.delete',
    'api::topic.topic.find',
    'api::topic.topic.findOne',
    'api::topic.topic.create',
    'api::topic.topic.update',
    'api::topic.topic.delete',
    'api::level.level.find',
    'api::level.level.findOne',
    'api::level.level.create',
    'api::level.level.update',
    'api::level.level.delete',
    'api::module.module.find',
    'api::module.module.findOne',
    'api::module.module.create',
    'api::module.module.update',
    'api::module.module.delete',
    'api::difficulty.difficulty.find',
    'api::difficulty.difficulty.findOne',
    'api::difficulty.difficulty.create',
    'api::difficulty.difficulty.update',
    'api::difficulty.difficulty.delete',
  ];

  await Promise.all(
    roles.map((role) =>
      strapi.query('plugin::users-permissions.permission').deleteMany({
        where: {
          role: role.id,
          action: {
            $in: sensitiveActions,
          },
        },
      })
    )
  );
}

async function updateContentManagerConfiguration(key, mutator) {
  const row = await strapi.db.connection('strapi_core_store_settings').where({ key }).first();

  if (!row?.value) {
    return;
  }

  const currentValue = JSON.parse(row.value);
  const nextValue = mutator(currentValue);

  if (JSON.stringify(nextValue) === JSON.stringify(currentValue)) {
    return;
  }

  await strapi.db
    .connection('strapi_core_store_settings')
    .where({ key })
    .update({ value: JSON.stringify(nextValue) });
}

function mergeQuestionFieldMetadata(metadata, fieldName, editOverrides, listOverrides = {}) {
  const currentMetadata = metadata[fieldName] || {};

  metadata[fieldName] = {
    ...currentMetadata,
    edit: {
      ...(currentMetadata.edit || {}),
      ...editOverrides,
    },
    list: {
      ...(currentMetadata.list || {}),
      ...listOverrides,
    },
  };
}

async function updateIpQuestionContentManagerConfiguration() {
  const key = 'plugin_content_manager_configuration_content_types::api::ip-question.ip-question';

  await updateContentManagerConfiguration(key, (configuration) => {
    const nextConfiguration = {
      ...configuration,
      settings: {
        ...(configuration.settings || {}),
        mainField: 'title',
        defaultSortBy: 'title',
        defaultSortOrder: 'ASC',
      },
      layouts: {
        ...(configuration.layouts || {}),
      },
      metadatas: {
        ...(configuration.metadatas || {}),
      },
    };

    mergeQuestionFieldMetadata(nextConfiguration.metadatas, 'question_type', {
      label: 'Question Type',
      description: 'Choose the answer format first: MCQ, SAQ, or LAQ.',
      placeholder: 'Select MCQ, SAQ, or LAQ',
    });
    mergeQuestionFieldMetadata(nextConfiguration.metadatas, 'title', {
      label: 'Internal Title',
      description: 'Internal label for HQ only. This is not shown to learners.',
      placeholder: 'Example: P3 Fractions Addition Q1',
    });
    mergeQuestionFieldMetadata(nextConfiguration.metadatas, 'prompt', {
      label: 'Question Text',
      description: 'The actual question shown to the learner. Raw LaTeX is allowed here.',
      placeholder: 'Example: What is \\\\( \\\\frac{1}{2} + \\\\frac{1}{4} \\\\)?',
    });
    mergeQuestionFieldMetadata(nextConfiguration.metadatas, 'module', {
      label: 'Curriculum Module',
      description:
        'Select one or more curriculum modules for the chosen academic levels, such as Core, Essential, or Data Analysis. Each selected module must belong to at least one selected academic level.',
      placeholder: 'Select one or more curriculum modules',
    });
    mergeQuestionFieldMetadata(nextConfiguration.metadatas, 'topics', {
      label: 'Topics',
      description:
        'Select one or more topics within the selected curriculum module, such as Fractions or Measurement.',
      placeholder: 'Select one or more topics',
    });
    mergeQuestionFieldMetadata(nextConfiguration.metadatas, 'level', {
      label: 'Academic Level',
      description: 'Select one or more managed academic levels, such as P1, P2, P3, or S1.',
      placeholder: 'Select one or more target levels',
    });
    mergeQuestionFieldMetadata(nextConfiguration.metadatas, 'difficulty', {
      label: 'Difficulty',
      description: 'Select the managed difficulty level for this question.',
      placeholder: 'Select a difficulty level',
    });
    mergeQuestionFieldMetadata(nextConfiguration.metadatas, 'max_score', {
      label: 'Max Score',
      description: 'Maximum marks available for this question.',
      placeholder: 'Example: 1',
    });
    mergeQuestionFieldMetadata(nextConfiguration.metadatas, 'choices', {
      label: 'Choices (MCQ only)',
      description:
        'Fill this only for MCQ. Use the editor below to add answer options, mark the correct one, and control display order. Leave empty for SAQ and LAQ.',
      placeholder: '',
    });
    mergeQuestionFieldMetadata(nextConfiguration.metadatas, 'accepted_answers', {
      label: 'Accepted Answers (SAQ only)',
      description:
        'Fill this only for SAQ. Enter acceptable short answers as a JSON array. Leave empty for MCQ and LAQ. Example: ["3/4", "\\\\frac{3}{4}", "0.75"]',
      placeholder: '[\"3/4\", \"\\\\frac{3}{4}\", \"0.75\"]',
    });
    mergeQuestionFieldMetadata(nextConfiguration.metadatas, 'sample_answer', {
      label: 'Sample Answer (LAQ mainly)',
      description:
        'Mainly for LAQ. Provide a model answer or sample working for teachers and grading reference. Example: Convert both fractions to quarters, add the numerators, then simplify the final answer to 3/4.',
      placeholder:
        'Example: Convert both fractions to quarters, add the numerators, then simplify the final answer to 3/4.',
    });
    mergeQuestionFieldMetadata(nextConfiguration.metadatas, 'marking_rubric', {
      label: 'Marking Rubric (LAQ mainly)',
      description:
        'Mainly for LAQ. Describe how marks are awarded, such as method marks, working marks, and final answer marks. Example: 1 mark for correct method, 2 marks for correct working, 1 mark for correct final answer.',
      placeholder:
        'Example: 1 mark for correct method, 2 marks for correct working, 1 mark for correct final answer.',
    });
    mergeQuestionFieldMetadata(nextConfiguration.metadatas, 'explanation', {
      label: 'Explanation',
      description: 'Optional teaching explanation or solution notes.',
      placeholder: 'Explain the method or common mistake here.',
    });
    mergeQuestionFieldMetadata(nextConfiguration.metadatas, 'contains_latex', {
      label: 'Contains LaTeX',
      description: 'Turn this on if the question text or answers include raw LaTeX markup.',
      placeholder: '',
    });

    nextConfiguration.layouts.list = [
      'title',
      'question_type',
      'level',
      'module',
      'difficulty',
      'max_score',
      'updatedAt',
    ];

    nextConfiguration.layouts.edit = [
      [{ name: 'question_type', size: 4 }, { name: 'title', size: 8 }],
      [{ name: 'prompt', size: 12 }],
      [
        { name: 'level', size: 4 },
        { name: 'module', size: 4 },
        { name: 'difficulty', size: 4 },
      ],
      [{ name: 'topics', size: 8 }, { name: 'max_score', size: 4 }],
      [{ name: 'choices', size: 12 }],
      [{ name: 'accepted_answers', size: 12 }],
      [
        { name: 'sample_answer', size: 6 },
        { name: 'contains_latex', size: 3 },
        { name: 'is_active', size: 3 },
      ],
      [{ name: 'marking_rubric', size: 12 }],
      [{ name: 'explanation', size: 12 }],
      [{ name: 'metadata', size: 12 }],
    ];

    return nextConfiguration;
  });
}

async function updateModuleContentManagerConfiguration() {
  const key = 'plugin_content_manager_configuration_content_types::api::module.module';

  await updateContentManagerConfiguration(key, (configuration) => {
    const nextConfiguration = {
      ...configuration,
      settings: {
        ...(configuration.settings || {}),
        mainField: 'name',
        defaultSortBy: 'name',
        defaultSortOrder: 'ASC',
      },
      metadatas: {
        ...(configuration.metadatas || {}),
      },
    };

    mergeQuestionFieldMetadata(nextConfiguration.metadatas, 'level', {
      label: 'Academic Level',
      description: 'Select one or more academic levels for this module.',
      placeholder: 'Select one or more academic levels',
      mainField: 'name',
    }, {
      label: 'Academic Level',
      searchable: true,
      sortable: true,
    });

    return nextConfiguration;
  });
}

async function updateTopicContentManagerConfiguration() {
  const key = 'plugin_content_manager_configuration_content_types::api::topic.topic';

  await updateContentManagerConfiguration(key, (configuration) => {
    const nextConfiguration = {
      ...configuration,
      settings: {
        ...(configuration.settings || {}),
        mainField: 'name',
        defaultSortBy: 'name',
        defaultSortOrder: 'ASC',
      },
      metadatas: {
        ...(configuration.metadatas || {}),
      },
      layouts: {
        ...(configuration.layouts || {}),
      },
    };

    mergeQuestionFieldMetadata(nextConfiguration.metadatas, 'module', {
      label: 'Curriculum Module',
      description: 'Select the curriculum module first.',
      placeholder: 'Select a curriculum module',
      mainField: 'name',
    }, {
      label: 'Curriculum Module',
      searchable: true,
      sortable: true,
    });

    mergeQuestionFieldMetadata(nextConfiguration.metadatas, 'level', {
      label: 'Academic Level',
      description: 'Select one or more academic levels for this topic within the chosen module.',
      placeholder: 'Select one or more academic levels',
      mainField: 'name',
    }, {
      label: 'Academic Level',
      searchable: true,
      sortable: true,
    });

    nextConfiguration.layouts.list = ['id', 'name', 'module', 'level', 'slug'];
    nextConfiguration.layouts.edit = [
      [{ name: 'name', size: 6 }, { name: 'slug', size: 6 }],
      [{ name: 'module', size: 6 }, { name: 'level', size: 6 }],
      [{ name: 'description', size: 6 }],
      [{ name: 'is_active', size: 4 }, { name: 'sort_order', size: 4 }],
      [{ name: 'questions', size: 6 }, { name: 'assets', size: 6 }],
    ];

    return nextConfiguration;
  });
}

async function isFirstRun() {
  const pluginStore = strapi.store({
    environment: strapi.config.environment,
    type: 'type',
    name: 'setup',
  });
  const initHasRun = await pluginStore.get({ key: 'initHasRun' });
  await pluginStore.set({ key: 'initHasRun', value: true });
  return !initHasRun;
}

async function setPublicPermissions(newPermissions) {
  // Find the ID of the public role
  const publicRole = await strapi.query('plugin::users-permissions.role').findOne({
    where: {
      type: 'public',
    },
  });

  // Create the new permissions and link them to the public role
  const allPermissionsToCreate = [];
  Object.keys(newPermissions).map((controller) => {
    const actions = newPermissions[controller];
    const permissionsToCreate = actions.map((action) => {
      return strapi.query('plugin::users-permissions.permission').create({
        data: {
          action: `api::${controller}.${controller}.${action}`,
          role: publicRole.id,
        },
      });
    });
    allPermissionsToCreate.push(...permissionsToCreate);
  });
  await Promise.all(allPermissionsToCreate);
}

function getFileSizeInBytes(filePath) {
  const stats = fs.statSync(filePath);
  const fileSizeInBytes = stats['size'];
  return fileSizeInBytes;
}

function getFileData(fileName) {
  const filePath = path.join('data', 'uploads', fileName);
  // Parse the file metadata
  const size = getFileSizeInBytes(filePath);
  const ext = fileName.split('.').pop();
  const mimeType = mime.lookup(ext || '') || '';

  return {
    filepath: filePath,
    originalFileName: fileName,
    size,
    mimetype: mimeType,
  };
}

async function uploadFile(file, name) {
  return strapi
    .plugin('upload')
    .service('upload')
    .upload({
      files: file,
      data: {
        fileInfo: {
          alternativeText: `An image uploaded to Strapi called ${name}`,
          caption: name,
          name,
        },
      },
    });
}

// Create an entry and attach files if there are any
async function createEntry({ model, entry }) {
  try {
    // Actually create the entry in Strapi
    await strapi.documents(`api::${model}.${model}`).create({
      data: entry,
    });
  } catch (error) {
    console.error({ model, entry, error });
  }
}

async function checkFileExistsBeforeUpload(files) {
  const existingFiles = [];
  const uploadedFiles = [];
  const filesCopy = [...files];

  for (const fileName of filesCopy) {
    // Check if the file already exists in Strapi
    const fileWhereName = await strapi.query('plugin::upload.file').findOne({
      where: {
        name: fileName.replace(/\..*$/, ''),
      },
    });

    if (fileWhereName) {
      // File exists, don't upload it
      existingFiles.push(fileWhereName);
    } else {
      // File doesn't exist, upload it
      const fileData = getFileData(fileName);
      const fileNameNoExtension = fileName.split('.').shift();
      const [file] = await uploadFile(fileData, fileNameNoExtension);
      uploadedFiles.push(file);
    }
  }
  const allFiles = [...existingFiles, ...uploadedFiles];
  // If only one file then return only that file
  return allFiles.length === 1 ? allFiles[0] : allFiles;
}

async function updateBlocks(blocks) {
  const updatedBlocks = [];
  for (const block of blocks) {
    if (block.__component === 'shared.media') {
      const uploadedFiles = await checkFileExistsBeforeUpload([block.file]);
      // Copy the block to not mutate directly
      const blockCopy = { ...block };
      // Replace the file name on the block with the actual file
      blockCopy.file = uploadedFiles;
      updatedBlocks.push(blockCopy);
    } else if (block.__component === 'shared.slider') {
      // Get files already uploaded to Strapi or upload new files
      const existingAndUploadedFiles = await checkFileExistsBeforeUpload(block.files);
      // Copy the block to not mutate directly
      const blockCopy = { ...block };
      // Replace the file names on the block with the actual files
      blockCopy.files = existingAndUploadedFiles;
      // Push the updated block
      updatedBlocks.push(blockCopy);
    } else {
      // Just push the block as is
      updatedBlocks.push(block);
    }
  }

  return updatedBlocks;
}

async function importGlobal() {
  const favicon = await checkFileExistsBeforeUpload(['favicon.png']);
  const shareImage = await checkFileExistsBeforeUpload(['default-image.png']);
  return createEntry({
    model: 'global',
    entry: {
      ...global,
      favicon,
      // Make sure it's not a draft
      publishedAt: Date.now(),
      defaultSeo: {
        ...global.defaultSeo,
        shareImage,
      },
    },
  });
}

async function importAbout() {
  const updatedBlocks = await updateBlocks(about.blocks);

  await createEntry({
    model: 'about',
    entry: {
      ...about,
      blocks: updatedBlocks,
      // Make sure it's not a draft
      publishedAt: Date.now(),
    },
  });
}

async function importSeedData() {
  // Allow read of application content types
  await setPublicPermissions({
    global: ['find', 'findOne'],
    about: ['find', 'findOne'],
  });

  // Create all entries
  await importGlobal();
  await importAbout();
}

async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  app.log.level = 'error';

  await seedExampleApp();
  await app.destroy();

  process.exit(0);
}


module.exports = async () => {
  registerOwnershipLifecycles(strapi);
  registerTaxonomyLifecycles(strapi);
  registerQuestionValidationLifecycles(strapi);
  await seedExampleApp();
  await removeSensitiveApiPermissions();
  await updateIpQuestionContentManagerConfiguration();
  await updateModuleContentManagerConfiguration();
  await updateTopicContentManagerConfiguration();
};
