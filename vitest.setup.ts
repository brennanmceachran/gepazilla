import "@testing-library/jest-dom/vitest";
import React from "react";

type GlobalWithReact = typeof globalThis & { React: typeof React };

(globalThis as GlobalWithReact).React = React;

// Silence Next.js-specific warnings during unit tests.
process.env.NEXT_PUBLIC_DEBUG_TELEMETRY ??= "false";
process.env.NEXT_PUBLIC_DEBUG_PROGRESS ??= "false";
