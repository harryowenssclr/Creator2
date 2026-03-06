import { Routes, Route } from 'react-router-dom'
import Layout from './components/common/Layout'
import HomePage from './pages/HomePage'
import ManualEditor from './pages/ManualEditor'
import SocialGenerator from './pages/SocialGenerator'
import WebsiteAssets from './pages/WebsiteAssets'
import MP4Converter from './pages/MP4Converter'
import DCOPage from './pages/DCOPage'
import AdobeImport from './pages/AdobeImport'

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/dco" element={<DCOPage />} />
        <Route path="/adobe-import" element={<AdobeImport />} />
        <Route path="/manual" element={<ManualEditor />} />
        <Route path="/social" element={<SocialGenerator />} />
        <Route path="/website-assets" element={<WebsiteAssets />} />
        <Route path="/mp4-converter" element={<MP4Converter />} />
      </Routes>
    </Layout>
  )
}

export default App
