import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router'

export function RouteFocus() {
  const { pathname } = useLocation()
  const previous = useRef(pathname)
  useEffect(() => {
    if (previous.current === pathname) return
    previous.current = pathname
    document.getElementById('main')?.focus()
  }, [pathname])
  return null
}
