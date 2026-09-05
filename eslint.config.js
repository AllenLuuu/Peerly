import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/coverage/**", "**/node_modules/**", ".pnpm-store/**", "data/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
);
