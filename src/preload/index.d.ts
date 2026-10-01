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
  ClaimResult,
  Tag,
  TagWithCount,
  DimensionGroup,
  TagSelection,
  ApplyTagsResult,
  SuggestTagsResult,
  UnboundProject,
  UpdatePackPatch,
  UpdatePackResult,
  RemoveProjectResult,
  RelocateSuggestion,
  PackVersion,
  CreateVersionInput,
  BindableFolder,
  BindVersionInput,
  TicketType,
  TicketListItem,
  TicketDetail,
  TicketStatus,
  TicketSaveConfigResult,
  TicketSyncResult,
  ScanProgress
} from '../shared/types'
