import { matchFileDocuments, type FileFindDocument, type FileFindOptions } from './file-find'
self.onmessage = (event: MessageEvent<{ documents: FileFindDocument[]; options: FileFindOptions }>) => {
  self.postMessage(matchFileDocuments(event.data.documents, event.data.options))
}
