import React from 'react'
import { useMutation, gql } from '@apollo/client'
import PeriodicScanner from './PeriodicScanner'
import { ScannerConcurrentWorkers } from './ScannerConcurrentWorkers'
import { SectionTitle, InputLabelDescription } from './SettingsPage'
import { useTranslation } from 'react-i18next'
import { scanAllMutation } from './__generated__/scanAllMutation'
import { Button } from '../../primitives/form/Input'

const SCAN_MUTATION = gql`
  mutation scanAllMutation {
    scanAll {
      success
      message
    }
  }
`

const REGENERATE_ATLAS_MUTATION = gql`
  mutation regenerateAtlasMutation {
    regenerateThumbnailAtlases
  }
`

const ScannerSection = () => {
  const { t } = useTranslation()
  const [startScanner, { called }] = useMutation<scanAllMutation>(SCAN_MUTATION)
  const [
    regenerateAtlases,
    { loading: atlasLoading, called: atlasCalled },
  ] = useMutation<{ regenerateThumbnailAtlases: boolean }>(
    REGENERATE_ATLAS_MUTATION
  )

  return (
    <div>
      <SectionTitle nospace>
        {t('settings.scanner.title', 'Scanner')}
      </SectionTitle>
      <InputLabelDescription>
        {t(
          'settings.scanner.description',
          'Will scan all users for new or updated media'
        )}
      </InputLabelDescription>
      <Button
        onClick={() => {
          startScanner()
        }}
        disabled={called}
      >
        {t('settings.scanner.scan_all_users', 'Scan all users')}
      </Button>
      <PeriodicScanner />
      <ScannerConcurrentWorkers />

      <InputLabelDescription>
        {t(
          'settings.scanner.atlas_description',
          'Rebuild the thumbnail sprite sheets used by the dense gallery views (bundling many photos into single images to speed up loading)'
        )}
      </InputLabelDescription>
      <Button
        onClick={() => {
          regenerateAtlases()
        }}
        disabled={atlasLoading}
      >
        {atlasLoading
          ? t('settings.scanner.atlas_running', 'Generating…')
          : atlasCalled
          ? t('settings.scanner.atlas_done', 'Regenerate thumbnail atlases ✓')
          : t('settings.scanner.atlas_button', 'Regenerate thumbnail atlases')}
      </Button>
    </div>
  )
}

export default ScannerSection
