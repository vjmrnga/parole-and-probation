import { createContext, useContext } from 'react';

// Split into its own file (rather than living in App.jsx) so screen
// components can import useApp() without creating a circular import with
// App.jsx itself.
export const AppContext = createContext(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppContext.Provider');
  return ctx;
}
