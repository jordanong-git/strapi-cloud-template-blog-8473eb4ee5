import type React from "react";

declare module "*.css";
declare module "@wiris/mathtype-generic/styles.css";
declare module "@wiris/mathtype-generic/wirisplugin-generic";
declare module "@wiris/mathtype-generic/wirisplugin-generic.js";

declare global {
  interface WirisIntegrationProperties {
    target: HTMLDivElement;
    toolbar: HTMLDivElement;
    configurationService?: string;
    integrationParameters?: {
      editorParameters?: {
        language?: string;
      };
    };
  }

  interface WirisIntegrationInstance {
    init(): void;
    listeners: {
      fire(eventName: string, payload: Record<string, unknown>): void;
    };
  }

  interface WirisParser {
    initParse(html: string): string;
  }

  interface Window {
    WirisPlugin?: {
      Parser?: WirisParser;
      GenericIntegration?: new (
        properties: WirisIntegrationProperties
      ) => WirisIntegrationInstance;
      currentInstance?: WirisIntegrationInstance | null;
    };
  }
}

declare module "@strapi/design-system" {
  export const Alert: React.ComponentType<any>;
  export const Box: React.ComponentType<any>;
  export const Button: React.ComponentType<any>;
  export const Field: {
    Root: React.ComponentType<any>;
    Label: React.ComponentType<any>;
    Hint: React.ComponentType<any>;
    Error: React.ComponentType<any>;
  };
  export const Flex: React.ComponentType<any>;
  export const Textarea: React.ComponentType<any>;
  export const Typography: React.ComponentType<any>;
}

declare module "@strapi/icons" {
  export const Pencil: React.ComponentType<any>;
}

declare module "@strapi/admin/strapi-admin" {
  export function useField(name: string): {
    value: unknown;
    error?: string;
    onChange(fieldName: string, value: unknown): void;
  };
}

export {};
