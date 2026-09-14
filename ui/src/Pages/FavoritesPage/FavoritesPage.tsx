import React from 'react'
import { useTranslation } from 'react-i18next'
import Layout from '../../components/layout/Layout'
import TimelineGallery from '../../components/timelineGallery/TimelineGallery'

const FavoritesPage = () => {
  const { t } = useTranslation()

  return (
    <Layout title={t('favorites_page.title', 'Favorites')}>
      <h1 className="text-2xl font-bold mb-4">
        {t('favorites_page.title', 'Favorites')}
      </h1>
      <TimelineGallery forceFavorites />
    </Layout>
  )
}

export default FavoritesPage
