import { ElectronAPI } from '@electron-toolkit/preload'
import type { Api } from '../shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}

export type {
  Api,
  PackCard,
  AssetItem,
  WsInfo,
  PacksView,
  PackDetail,
  ScanResult,
  ClaimResult
} from '../shared/types'
