import './assets/main.css'
// 第 70 批（docs/55）：主题必须在样式之后、render 之前定下来（首帧不能是错的颜色）
// 第 81 批：密度同理 —— 一次把外观三项定完，避免首帧铺开后再跳
import { bootAppearance } from './theme'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

bootAppearance()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
