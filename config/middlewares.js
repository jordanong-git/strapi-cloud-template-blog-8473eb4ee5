module.exports = ({ env }) => {
  const maxUploadSizeBytes = env.int('R2_MAX_UPLOAD_SIZE_BYTES', 100 * 1024 * 1024);
  const allowedOrigins = Array.from(
    new Set(
      [env('R2_ENDPOINT_URL'), env('R2_PUBLIC_URL')]
        .map((value) => {
          if (!value) {
            return null;
          }

          try {
            return new URL(value).origin;
          } catch (error) {
            return null;
          }
        })
        .filter(Boolean),
    ),
  );

  return [
    'strapi::logger',
    'strapi::errors',
    {
      name: 'strapi::security',
      config: {
        contentSecurityPolicy: {
          useDefaults: true,
          directives: {
            'connect-src': ["'self'", 'https:'],
            'img-src': ["'self'", 'data:', 'blob:', 'market-assets.strapi.io', ...allowedOrigins],
            'media-src': ["'self'", 'data:', 'blob:', 'market-assets.strapi.io', ...allowedOrigins],
            upgradeInsecureRequests: null,
          },
        },
      },
    },
    'strapi::cors',
    'strapi::poweredBy',
    'strapi::query',
    {
      name: 'strapi::body',
      config: {
        formLimit: '100mb',
        jsonLimit: '100mb',
        textLimit: '100mb',
        formidable: {
          maxFileSize: maxUploadSizeBytes,
        },
      },
    },
    'strapi::session',
    'strapi::favicon',
    'strapi::public',
  ];
};
