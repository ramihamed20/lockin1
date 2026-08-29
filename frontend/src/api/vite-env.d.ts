/// <reference types="vite-plugin-pwa/client" />

import "react";
import "csstype";

declare global {
  interface ImportMetaEnv {
    readonly BASE_URL: string;
    readonly DEV: boolean;
    readonly PROD: boolean;
    readonly VITE_API_BASE_URL?: string;
    readonly VITE_BASE_PATH?: string;
    readonly VITE_LEGAL_ENTITY?: string;
    readonly VITE_LEGAL_ADDRESS?: string;
    readonly VITE_LEGAL_JURISDICTION?: string;
    readonly VITE_SUPPORT_EMAIL?: string;
    readonly VITE_POLICY_VERSION?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  const __APP_VERSION__: string;

  interface Window {
    pdfjsLib?: any;
    __lockInFocusGesture?: Record<string, unknown>;
    __lockInFocusElastic?: Record<string, unknown>;
    __lockInFocusPerformance?: Record<string, unknown>;
    __lockInInkDiagnostics?: Record<string, unknown>;
  }
}

declare module "react" {
  interface HTMLAttributes<T> {
    inert?: boolean | "";
    popover?: "auto" | "manual" | "hint";
  }
}

declare module "csstype" {
  interface Properties<TLength = (string & {}) | 0, TTime = string & {}> {
    [customProperty: `--${string}`]: string | number | undefined;
  }
}
