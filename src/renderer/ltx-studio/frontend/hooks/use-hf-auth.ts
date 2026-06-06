import { useState, useEffect, useCallback } from 'react'
import { ApiClient, type ApiSuccessOf } from '../lib/api-client'
import { logger } from '../lib/logger'

type HfAuthStatus = ApiSuccessOf<'getHuggingFaceAuthStatus'>['status']

interface UseHfAuthResult {
  hfAuthStatus: HfAuthStatus
  hfAuthPolling: boolean
  startHuggingFaceLogin: () => Promise<void>
  handleHuggingFaceLogout: () => Promise<void>
}

const NOOP = async () => {}

export function useHfAuth(enabled: boolean): UseHfAuthResult {
  const gatingEnabled = window.electronAPI.hfGatingEnabled
  const [hfAuthStatus, setHfAuthStatus] = useState<HfAuthStatus>(
    gatingEnabled ? 'not_authenticated' : 'authenticated',
  )
  const [hfAuthPolling, setHfAuthPolling] = useState(false)

  // One-time check when enabled becomes true
  useEffect(() => {
    if (!gatingEnabled) return
    if (!enabled) return
    const checkAuth = async () => {
      const result = await ApiClient.getHuggingFaceAuthStatus()
      if (!result.ok) {
        logger.error(`HF auth status check failed: ${result.error.message}`)
        return
      }
      setHfAuthStatus(result.data.status)
    }
    void checkAuth()
  }, [enabled, gatingEnabled])

  // Poll while waiting for user to complete auth in browser
  useEffect(() => {
    if (!gatingEnabled) return
    if (!hfAuthPolling) return
    const interval = setInterval(async () => {
      const result = await ApiClient.getHuggingFaceAuthStatus()
      if (!result.ok) {
        logger.error(`HF auth status check failed: ${result.error.message}`)
        return
      }
      const { status } = result.data
      setHfAuthStatus(status)
      if (status === 'authenticated') setHfAuthPolling(false)
    }, 2000)
    return () => clearInterval(interval)
  }, [hfAuthPolling, gatingEnabled])

  const startHuggingFaceLogin = useCallback(async () => {
    const result = await ApiClient.startHuggingFaceLogin()
    if (!result.ok) {
      logger.error(`HF login failed: ${result.error.message}`)
      return
    }

    const params = result.data
    setHfAuthPolling(true)
    await window.electronAPI.openHuggingFaceAuth({
      clientId: params.client_id,
      redirectUri: params.redirect_uri,
      scope: params.scope,
      state: params.state,
      codeChallenge: params.code_challenge,
      codeChallengeMethod: params.code_challenge_method,
    })
  }, [])

  const handleHuggingFaceLogout = useCallback(async () => {
    const result = await ApiClient.huggingFaceLogout()
    if (!result.ok) {
      logger.error(`HF logout failed: ${result.error.message}`)
      return
    }
    setHfAuthStatus('not_authenticated')
  }, [])

  if (!gatingEnabled) {
    return {
      hfAuthStatus: 'authenticated',
      hfAuthPolling: false,
      startHuggingFaceLogin: NOOP,
      handleHuggingFaceLogout: NOOP,
    }
  }

  return { hfAuthStatus, hfAuthPolling, startHuggingFaceLogin, handleHuggingFaceLogout }
}
