import { useEffect, useState } from 'react'
import { getCurrentBrand, KOLBO_CONFIG_READY_EVENT } from '../lib/kolbo-init'

export function useKolboBrand(): { name: string; logoUrl?: string } {
  const [brand, setBrand] = useState(getCurrentBrand)
  useEffect(() => {
    const handler = () => setBrand(getCurrentBrand())
    window.addEventListener(KOLBO_CONFIG_READY_EVENT, handler as EventListener)
    return () => window.removeEventListener(KOLBO_CONFIG_READY_EVENT, handler as EventListener)
  }, [])
  return brand
}
