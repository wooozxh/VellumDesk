import './assets/main.css'
// 第 70 批（docs/55）：主题必须在样式之后、render 之前定下来（首帧不能是错的颜色）
import { bootTheme } from './theme'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

bootTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
