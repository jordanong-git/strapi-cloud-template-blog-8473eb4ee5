import React from "react";

import {
  Layouts,
  useFetchClient,
  useNotification,
} from "@strapi/admin/strapi-admin";
import {
  Alert,
  Badge,
  Box,
  Button,
  Combobox,
  ComboboxOption,
  Flex,
  Main,
  SingleSelect,
  SingleSelectOption,
  Typography,
} from "@strapi/design-system";
import { Briefcase, Check } from "@strapi/icons";

const ACTIVE_ORGANIZATION_STORAGE_KEY = "cms-active-organization";

const ROLE_LABELS = {
  super_admin: "Super Admin",
  org_admin: "Org Admin",
  editor: "Editor",
  viewer: "Viewer",
};

const getStoredActiveOrganizationId = () => {
  const storedValue = window.localStorage.getItem(ACTIVE_ORGANIZATION_STORAGE_KEY);
  const parsedValue = Number.parseInt(`${storedValue ?? ""}`.trim(), 10);
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : null;
};

const setStoredActiveOrganizationId = (organizationId) => {
  if (Number.isInteger(organizationId) && organizationId > 0) {
    window.localStorage.setItem(
      ACTIVE_ORGANIZATION_STORAGE_KEY,
      `${organizationId}`
    );
    return;
  }

  window.localStorage.removeItem(ACTIVE_ORGANIZATION_STORAGE_KEY);
};

const getRoleLabel = (role) => ROLE_LABELS[role] || "Member";
const getUserLabel = (user) => {
  const fullName = `${user.firstname || ""} ${user.lastname || ""}`.trim();

  if (fullName) {
    return `${fullName} (${user.email || user.username || "No email"})`;
  }

  return user.email || user.username || `User #${user.id}`;
};

const OrganizationAccessPage = () => {
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const [state, setState] = React.useState({
    isLoading: true,
    errorMessage: "",
    context: null,
    isSwitching: false,
    selectedUserId: "",
    selectedRole: "editor",
    isSubmittingMembership: false,
  });

  const loadContext = React.useCallback(
    async (signal) => {
      try {
        const response = await get("/organization-access/context", {
          signal,
        });
        const nextContext = response.data;
        const assignedOrganizationIds = new Set(
          (nextContext?.organizations || []).map((organization) => organization.id)
        );
        const storedActiveOrganizationId = getStoredActiveOrganizationId();
        const firstAvailableUserId = nextContext?.availableUsers?.[0]?.id;

        if (
          !storedActiveOrganizationId ||
          !assignedOrganizationIds.has(storedActiveOrganizationId)
        ) {
          setStoredActiveOrganizationId(nextContext?.activeOrganizationId || null);
        }

        setState((currentState) => ({
          ...currentState,
          isLoading: false,
          errorMessage: "",
          context: nextContext,
          selectedUserId:
            currentState.selectedUserId &&
            (nextContext?.availableUsers || []).some(
              (user) => `${user.id}` === `${currentState.selectedUserId}`
            )
              ? currentState.selectedUserId
              : firstAvailableUserId
                ? `${firstAvailableUserId}`
                : "",
          selectedRole: currentState.selectedRole || "editor",
          isSubmittingMembership: false,
        }));
      } catch (error) {
        if (signal?.aborted) {
          return;
        }

        setState((currentState) => ({
          ...currentState,
          isLoading: false,
          errorMessage:
            error?.message || "Unable to load your organization access.",
          isSubmittingMembership: false,
        }));
      }
    },
    [get]
  );

  React.useEffect(() => {
    const abortController = new AbortController();
    loadContext(abortController.signal);

    return () => {
      abortController.abort();
    };
  }, [loadContext]);

  const handleSwitchOrganization = (organizationId) => {
    setStoredActiveOrganizationId(organizationId);
    setState((currentState) => ({
      ...currentState,
      isSwitching: true,
    }));
    window.location.reload();
  };

  const handleCreateMembership = async () => {
    if (!state.selectedUserId) {
      toggleNotification({
        type: "warning",
        message: "Select a user first.",
      });
      return;
    }

    setState((currentState) => ({
      ...currentState,
      isSubmittingMembership: true,
    }));

    try {
      await post("/organization-access/memberships", {
        userId: Number.parseInt(state.selectedUserId, 10),
        role: state.selectedRole,
      });

      toggleNotification({
        type: "success",
        message: "User added to the organization.",
      });

      await loadContext();
    } catch (error) {
      setState((currentState) => ({
        ...currentState,
        isSubmittingMembership: false,
      }));

      toggleNotification({
        type: "danger",
        message: error?.message || "Could not add user to the organization.",
      });
    }
  };

  const context = state.context;
  const activeOrganizationId = context?.activeOrganizationId || null;
  const organizations = context?.organizations || [];
  const members = context?.members || [];
  const availableUsers = context?.availableUsers || [];

  return (
    <Main>
      <Layouts.Header
        title="Organizations"
        subtitle={
          context?.isSuperAdmin
            ? "Switch between all organizations while keeping super admin privileges."
            : "Switch between the organizations already assigned to your account."
        }
      />

      <Box paddingLeft={6} paddingRight={6} paddingBottom={6}>
        <Flex direction="column" alignItems="stretch" gap={4}>
          <Alert title="Visibility" variant="default">
            {context?.isSuperAdmin
              ? "Super admins can see every active organization."
              : "Only organizations already linked to your user are shown here."}
          </Alert>

          {state.errorMessage ? (
            <Alert title="Could not load organizations" variant="danger">
              {state.errorMessage}
            </Alert>
          ) : null}

          {state.isLoading ? (
            <Box
              background="neutral0"
              borderColor="neutral200"
              borderStyle="solid"
              borderWidth="1px"
              hasRadius
              padding={6}
              shadow="filterShadow"
            >
              <Typography textColor="neutral600">
                Loading organization access...
              </Typography>
            </Box>
          ) : null}

          {!state.isLoading && context?.isSuperAdmin ? (
            <Alert title="Super Admin Access" variant="success">
              Super admins can switch the active organization for scoped CMS
              browsing and still keep full organization-management privileges.
            </Alert>
          ) : null}

          {!state.isLoading &&
          organizations.length === 0 ? (
            <Alert title="No assigned organizations" variant="warning">
              {context?.isSuperAdmin
                ? "There are no active organizations to display yet."
                : "This account does not have any active organization membership yet."}
            </Alert>
          ) : null}

          {!state.isLoading &&
            organizations.map((organization) => {
              const isActive = organization.id === activeOrganizationId;

              return (
                <Box
                  key={organization.id}
                  background="neutral0"
                  borderColor={isActive ? "primary600" : "neutral200"}
                  borderStyle="solid"
                  borderWidth="1px"
                  hasRadius
                  padding={6}
                  shadow="filterShadow"
                >
                  <Flex direction="column" alignItems="stretch" gap={4}>
                    <Flex
                      justifyContent="space-between"
                      alignItems="flex-start"
                      gap={4}
                      wrap="wrap"
                    >
                      <Flex direction="column" alignItems="stretch" gap={2}>
                        <Flex alignItems="center" gap={2}>
                          <Briefcase />
                          <Typography variant="beta">
                            {organization.name}
                          </Typography>
                        </Flex>

                        {organization.slug ? (
                          <Typography textColor="neutral600">
                            {`Slug: ${organization.slug}`}
                          </Typography>
                        ) : null}
                      </Flex>

                      <Flex alignItems="center" gap={2} wrap="wrap">
                        <Badge variant={isActive ? "primary" : "secondary"}>
                          {isActive ? "Active" : "Available"}
                        </Badge>
                        <Badge variant="neutral">
                          {getRoleLabel(organization.role)}
                        </Badge>
                      </Flex>
                    </Flex>

                    <Flex justifyContent="space-between" alignItems="center" gap={4} wrap="wrap">
                      <Typography textColor="neutral600">
                        {isActive
                          ? "This organization is currently driving the CMS content scope."
                          : "Switch to this organization to load its scoped content and memberships."}
                      </Typography>

                      <Button
                        disabled={isActive || state.isSwitching}
                        onClick={() => handleSwitchOrganization(organization.id)}
                        startIcon={isActive ? <Check /> : null}
                      >
                        {isActive ? "Current organization" : "Switch organization"}
                      </Button>
                    </Flex>
                  </Flex>
                </Box>
              );
            })}

          {!state.isLoading && context?.activeOrganization ? (
            <Box
              background="neutral0"
              borderColor="neutral200"
              borderStyle="solid"
              borderWidth="1px"
              hasRadius
              padding={6}
              shadow="filterShadow"
            >
              <Flex direction="column" alignItems="stretch" gap={4}>
                <Flex direction="column" alignItems="stretch" gap={2}>
                  <Typography variant="beta">
                    {`People in ${context.activeOrganization.name}`}
                  </Typography>
                  <Typography textColor="neutral600">
                    Review who already has access to the currently active organization.
                  </Typography>
                </Flex>

                {members.length === 0 ? (
                  <Alert title="No members yet" variant="warning">
                    This organization does not have any active members yet.
                  </Alert>
                ) : (
                  members.map((membership) => (
                    <Box
                      key={membership.id}
                      background="neutral100"
                      borderColor="neutral200"
                      borderStyle="solid"
                      borderWidth="1px"
                      hasRadius
                      padding={4}
                    >
                      <Flex justifyContent="space-between" alignItems="center" gap={4} wrap="wrap">
                        <Flex direction="column" alignItems="stretch" gap={1}>
                          <Typography fontWeight="bold">
                            {getUserLabel(membership.user || {})}
                          </Typography>
                          <Typography textColor="neutral600">
                            {membership.user?.username
                              ? `Username: ${membership.user.username}`
                              : " "}
                          </Typography>
                        </Flex>

                        <Badge variant="neutral">
                          {getRoleLabel(membership.role)}
                        </Badge>
                      </Flex>
                    </Box>
                  ))
                )}
              </Flex>
            </Box>
          ) : null}

          {!state.isLoading &&
          context?.canManageMemberships &&
          context?.activeOrganization ? (
            <Box
              background="neutral0"
              borderColor="neutral200"
              borderStyle="solid"
              borderWidth="1px"
              hasRadius
              padding={6}
              shadow="filterShadow"
            >
              <Flex direction="column" alignItems="stretch" gap={4}>
                <Flex direction="column" alignItems="stretch" gap={2}>
                  <Typography variant="beta">
                    Add Person To Organization
                  </Typography>
                  <Typography textColor="neutral600">
                    {`Add an existing Strapi admin user into ${context.activeOrganization.name}.`}
                  </Typography>
                </Flex>

                {availableUsers.length === 0 ? (
                  <Alert title="No available users" variant="default">
                    Every active admin user is already assigned to this organization.
                  </Alert>
                ) : (
                  <Flex direction="column" alignItems="stretch" gap={4}>
                    <Combobox
                      label="Admin user"
                      placeholder="Select a user"
                      value={state.selectedUserId}
                      onChange={(value) =>
                        setState((currentState) => ({
                          ...currentState,
                          selectedUserId: value || "",
                        }))
                      }
                    >
                      {availableUsers.map((user) => (
                        <ComboboxOption key={user.id} value={`${user.id}`}>
                          {getUserLabel(user)}
                        </ComboboxOption>
                      ))}
                    </Combobox>

                    <SingleSelect
                      label="Organization role"
                      value={state.selectedRole}
                      onChange={(value) =>
                        setState((currentState) => ({
                          ...currentState,
                          selectedRole: value || "editor",
                        }))
                      }
                    >
                      <SingleSelectOption value="org_admin">
                        Org Admin
                      </SingleSelectOption>
                      <SingleSelectOption value="editor">
                        Editor
                      </SingleSelectOption>
                      <SingleSelectOption value="viewer">
                        Viewer
                      </SingleSelectOption>
                    </SingleSelect>

                    <Flex>
                      <Button
                        disabled={!state.selectedUserId || state.isSubmittingMembership}
                        onClick={handleCreateMembership}
                      >
                        {state.isSubmittingMembership ? "Adding..." : "Add user"}
                      </Button>
                    </Flex>
                  </Flex>
                )}
              </Flex>
            </Box>
          ) : null}
        </Flex>
      </Box>
    </Main>
  );
};

export default OrganizationAccessPage;
