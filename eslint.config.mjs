import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      /**
       * The React Compiler flags the house data-fetching pattern:
       *
       *   const load = useCallback(async () => { setLoading(true); … }, [deps]);
       *   useEffect(() => { load(); }, [load]);
       *
       * The warning is fair — the synchronous setState costs one extra render —
       * but the pattern is the CMMS's established convention (SPEC §4) and is
       * used on every list screen in both apps. Downgraded to a warning rather
       * than silenced: an error that fires 8 times on correct, deliberate code
       * teaches everyone to ignore lint output, which is worse than the render.
       *
       * Revisit if these screens ever show a visible double-render.
       */
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
  // ecosystem.config.cjs: pm2 process config, plain CommonJS, not part of the
  // app — and eslint-config-next's react-hooks plugin isn't wired up for
  // .cjs, which turns the rule override above into a hard error rather than
  // a lint result the moment such a file is in scope.
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "ecosystem.config.cjs"]),
]);

export default eslintConfig;
