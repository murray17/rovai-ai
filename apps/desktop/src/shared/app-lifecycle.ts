export const APP_PREPARE_QUIT_CHANNEL = 'rovai:app-prepare-quit'

export type AppQuitPreparationResponse =
  | { status: 'prepared' }
  | { status: 'failed'; message: string }
