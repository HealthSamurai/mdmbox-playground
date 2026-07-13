import { useEffect } from 'react'

export function VersionLogger({ getBackendVersion }: {
  getBackendVersion: () => Promise<{ commitHash: string }>
}) {
  useEffect(() => {
    getBackendVersion()
        .then((data) => {
          console.log('Backend commit:', data.commitHash)
        })
        .catch((error) => {
          console.error('Failed to fetch backend version:', error)
        })
  }, [])

  return null
}
