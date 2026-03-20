import {
  documentsFetchAttachmentBlob,
  documentsUploadAttachment,
  type DocumentAttachment,
} from './documentsApi'
import {
  tasksFetchAttachmentBlob,
  tasksUploadAttachment,
  type TaskAttachment,
} from './tasksApi'
import type { AttachmentOwnerKind } from '@/utils/attachmentMarkdown'

export type OwnedAttachmentUpload = Pick<TaskAttachment, 'id' | 'file_name' | 'mime_type'>
  | Pick<DocumentAttachment, 'id' | 'file_name' | 'mime_type'>

export async function fetchOwnedAttachmentBlob(
  ownerKind: AttachmentOwnerKind,
  ownerId: string,
  attachmentId: string,
): Promise<Blob> {
  if (ownerKind === 'task') {
    return tasksFetchAttachmentBlob(ownerId, attachmentId)
  }
  return documentsFetchAttachmentBlob(ownerId, attachmentId)
}

export async function uploadOwnedAttachment(
  ownerKind: AttachmentOwnerKind,
  ownerId: string,
  file: File,
): Promise<OwnedAttachmentUpload> {
  if (ownerKind === 'task') {
    return tasksUploadAttachment(ownerId, file)
  }
  return documentsUploadAttachment(ownerId, file)
}
