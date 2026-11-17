import * as React from "react"

const MOBILE_BREAKPOINT = 768

// Reads the viewport width via an external store instead of an effect+setState
// pair, so the first client render can't cascade into a second one.
function subscribe(onChange: () => void) {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

function getSnapshot() {
  return window.innerWidth < MOBILE_BREAKPOINT
}

// The server has no viewport; defaulting to desktop avoids ever flashing
// the mobile sheet layout before hydration confirms otherwise.
function getServerSnapshot() {
  return false
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
