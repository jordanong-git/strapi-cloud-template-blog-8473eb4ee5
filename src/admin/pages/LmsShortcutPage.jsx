import React from "react";

import { Layouts } from "@strapi/admin/strapi-admin";
import { Box, Flex, LinkButton, Main, Typography } from "@strapi/design-system";
import { Earth, ExternalLink } from "@strapi/icons";

const DEFAULT_LMS_URL = "https://app.realms.oljmedia.com/";
const SITE_NAME = "Question Bank";

const LmsShortcutPage = () => {
  return (
    <Main>
      <Layouts.Header
        title="Open LMS"
        subtitle={`Jump from ${SITE_NAME} straight to your LMS.`}
      />

      <Box paddingLeft={6} paddingRight={6} paddingBottom={6}>
        <Box
          background="neutral0"
          borderColor="neutral200"
          borderWidth="1px"
          borderStyle="solid"
          hasRadius
          padding={6}
          shadow="filterShadow"
        >
          <Flex direction="column" alignItems="stretch" gap={4}>
            <Flex direction="column" alignItems="stretch" gap={2}>
              <Typography variant="beta">LMS Shortcut</Typography>
              <Typography textColor="neutral600">
                Open the LMS directly from the CMS when you are ready to continue the
                question-bank workflow in the learning platform.
              </Typography>
            </Flex>

            <Flex direction="column" alignItems="stretch" gap={3}>
              <Box background="neutral100" hasRadius padding={4}>
                <Flex direction="column" alignItems="stretch" gap={2}>
                  <Typography fontWeight="bold">Current LMS URL</Typography>
                  <Typography textColor="neutral700">{DEFAULT_LMS_URL}</Typography>
                </Flex>
              </Box>

              <Flex>
                <LinkButton
                  href={DEFAULT_LMS_URL}
                  isExternal
                  startIcon={<Earth />}
                  endIcon={<ExternalLink />}
                >
                  Open LMS
                </LinkButton>
              </Flex>
            </Flex>
          </Flex>
        </Box>
      </Box>
    </Main>
  );
};

export default LmsShortcutPage;
