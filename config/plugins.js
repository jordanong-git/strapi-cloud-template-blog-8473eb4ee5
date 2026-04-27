module.exports = ({ env }) => {
  const maxUploadSizeBytes = env.int('R2_MAX_UPLOAD_SIZE_BYTES', 100 * 1024 * 1024);
  const rootPath = env('R2_ROOT_PATH', '').trim().replace(/^\/+|\/+$/g, '');
  const hasR2Config =
    Boolean(env('R2_ACCESS_KEY_ID')) &&
    Boolean(env('R2_SECRET_ACCESS_KEY')) &&
    Boolean(env('R2_BUCKET_NAME')) &&
    Boolean(env('R2_ENDPOINT_URL'));

  const uploadConfig = {
    sizeLimit: maxUploadSizeBytes,
    breakpoints: {
      xlarge: 1920,
      large: 1000,
      medium: 750,
      small: 500,
      xsmall: 64,
    },
  };

  if (hasR2Config) {
    uploadConfig.provider = 'aws-s3';
    uploadConfig.providerOptions = {
      ...(rootPath ? { rootPath } : {}),
      s3Options: {
        credentials: {
          accessKeyId: env('R2_ACCESS_KEY_ID'),
          secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
        },
        region: env('R2_REGION', 'auto'),
        endpoint: env('R2_ENDPOINT_URL'),
        forcePathStyle: true,
        params: {
          Bucket: env('R2_BUCKET_NAME'),
          signedUrlExpires: env.int('R2_SIGNED_DOWNLOAD_EXPIRY_SECONDS', 900),
        },
      },
    };
    uploadConfig.actionOptions = {
      upload: {},
      uploadStream: {},
      delete: {},
    };
  }

  return {
    upload: {
      config: uploadConfig,
    },
  };
};
