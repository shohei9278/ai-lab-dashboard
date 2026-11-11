import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Next 16 で増えた React の書き方の助言。今動いているコードを一度に書き換えないよう、エラーにはしない
  { rules: { "react-hooks/set-state-in-effect": "warn", "react-hooks/purity": "warn", "react-hooks/refs": "warn", "react-hooks/immutability": "warn" } },
  globalIgnores(["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "lp-site/**", ]),
]);
