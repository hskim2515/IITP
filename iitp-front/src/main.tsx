import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/theme.css'
import './index.css'
// modal-overlay/container/header/content/actions, close-btn, grid-header/grid-btn,
// transparent-table — HistoryModal/TypeSelectionModal/LeftPanel(닫기 버튼)/JsonGrid가 참조하는
// 클래스인데 이 파일이 그동안 어디서도 import되지 않아 전혀 적용되지 않고 있었다(발견: 라이트/
// 다크 모드 QA 중 "일부 팝업이 스타일 안 먹은 것 같다"는 제보로 확인).
import '@css/styles.css'
import App from './App'
import React from 'react'

createRoot(document.getElementById('root')!).render(
    <App />
)
