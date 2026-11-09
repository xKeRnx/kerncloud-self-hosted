# Languages

English is the default for the website, workspace, administration and desktop launcher. German is an optional, deliberate selection. A German browser or operating system no longer changes the initial application language.

Priority: explicit `?lang=en` / `?lang=de`, then the existing `kc_locale` preference cookie, then the configured default (English). The language switch stores a one-year preference. Only a deliberate choice sets this cookie. Switching languages does not rewrite customer files, prompts, saved agent instructions, names, logs or model output.

The one-time 034 migration sets the installation default to English and keeps German enabled. It does not change preference cookies or account data. Later administrator changes remain intact after restarts. The admin language form controls enabled languages and the installation default.

The Bridge and local desktop launcher start in English and offer a German selector. Their separate local preferences remain on the device. Windows installers default to English; German can be selected explicitly.

Application-owned UI text uses `components/language.tsx` and `src/core/ui-en.json`. New UI must include English copy. Custom pages and legal texts require their own translations; they are never silently machine-translated. Test with a German browser header, explicit German selection, refresh and a return to English. Integration tests must use a dedicated database ending in `_test`.
