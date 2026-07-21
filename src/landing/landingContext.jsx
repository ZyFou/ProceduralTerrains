import React, { createContext, useContext } from 'react';

const LandingContext = createContext(null);

export function LandingProvider({ children, value }) {
  return <LandingContext.Provider value={value}>{children}</LandingContext.Provider>;
}

export function useLanding() {
  return useContext(LandingContext);
}
