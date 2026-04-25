import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import Landing from './components/Landing.jsx'
import { AuthProvider } from './contexts/AuthContext.jsx'

function Root() {
  const [showApp, setShowApp] = useState(
    () => window.location.pathname !== '/'
  )

  function handleEnter() {
    window.history.pushState({}, '', '/app')
    setShowApp(true)
  }

  if (!showApp) {
    return <Landing onEnter={handleEnter} />
  }

  return (
    <AuthProvider>
      <App />
    </AuthProvider>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
