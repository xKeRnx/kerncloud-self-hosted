# Workspace appearance

Users choose Light, Dark or System in the account menu or Settings. Existing accounts stay light until they choose otherwise. The preference belongs to the account, across workspaces and devices; refresh/focus synchronization uses the existing state refresh without model calls. System uses a native prefers-color-scheme media query, including changes while the app is open.

The server reads the authenticated preference before rendering the workspace wrapper, preventing a light first paint for dark accounts. Account settings are not stored in browser storage or inferred from arbitrary user IDs. Viewer roles can update their own preference. Support mode cannot change customer appearance. Logout resets the wrapper. A failed save restores the previous choice and announces an error.

Migration 033 adds a separate user_appearance_preferences table, cascade deleted with the user. The account privacy export includes the preference. It does not modify tasks, budgets, models, bridge approvals or credentials. The public landing page, photographs and isolated result previews retain their own presentation.
