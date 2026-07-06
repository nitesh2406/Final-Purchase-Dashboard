import { Readable } from "stream";
import { getDriveClient } from "./driveClient";

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const ROOT_FOLDER_NAME = "Finance Uploads";

export type ConflictStrategy = "ask" | "replace" | "keep_both" | "use_existing";

export interface DriveFileInfo {
  fileId: string;
  fileName: string;
  viewUrl: string;
  downloadUrl: string;
}

export interface DriveFolderInfo {
  folderId: string;
  folderUrl: string;
  folderName: string;
}

export type UploadResult =
  | ({ status: "uploaded" } & DriveFileInfo)
  | { status: "conflict"; fileName: string; existing: DriveFileInfo }
  | { status: "used_existing"; fileName: string; existing: DriveFileInfo }
  | { status: "failed"; fileName: string; error: string };

// Escapes single quotes for safe use inside a Drive `q` query string literal.
function escapeQueryValue(value: string): string {
  return value.replace(/'/g, "\\'");
}

/**
 * Encapsulates every Google Drive operation behind a small, storage-agnostic
 * surface so business logic never talks to the Drive API directly, and the
 * backing provider can be swapped later without touching callers.
 */
class DriveStorageService {
  private rootFolderId: string | null = null;
  private readonly batchFolderCache = new Map<string, DriveFolderInfo>();
  private readonly shipmentFolderCache = new Map<string, DriveFolderInfo>();

  private async findFolder(name: string, parentId: string): Promise<DriveFolderInfo | null> {
    const drive = getDriveClient();
    const q = [
      `name = '${escapeQueryValue(name)}'`,
      `'${escapeQueryValue(parentId)}' in parents`,
      `mimeType = '${FOLDER_MIME_TYPE}'`,
      "trashed = false"
    ].join(" and ");

    const res = await drive.files.list({
      q,
      fields: "files(id, name, webViewLink)",
      spaces: "drive"
    });

    const file = res.data.files?.[0];
    if (!file?.id) return null;

    return {
      folderId: file.id,
      folderUrl: file.webViewLink || `https://drive.google.com/drive/folders/${file.id}`,
      folderName: file.name || name
    };
  }

  private async createFolder(name: string, parentId: string): Promise<DriveFolderInfo> {
    const drive = getDriveClient();
    const res = await drive.files.create({
      requestBody: {
        name,
        mimeType: FOLDER_MIME_TYPE,
        parents: [parentId]
      },
      fields: "id, name, webViewLink"
    });

    const file = res.data;
    if (!file.id) throw new Error(`Failed to create Drive folder "${name}"`);

    return {
      folderId: file.id,
      folderUrl: file.webViewLink || `https://drive.google.com/drive/folders/${file.id}`,
      folderName: file.name || name
    };
  }

  private async findOrCreateFolder(name: string, parentId: string): Promise<DriveFolderInfo> {
    const existing = await this.findFolder(name, parentId);
    if (existing) return existing;
    return this.createFolder(name, parentId);
  }

  async getOrCreateRootFolder(): Promise<DriveFolderInfo> {
    if (this.rootFolderId) {
      const drive = getDriveClient();
      const res = await drive.files.get({ fileId: this.rootFolderId, fields: "id, name, webViewLink" });
      return {
        folderId: res.data.id!,
        folderUrl: res.data.webViewLink || `https://drive.google.com/drive/folders/${res.data.id}`,
        folderName: res.data.name || ROOT_FOLDER_NAME
      };
    }

    const configuredId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
    if (configuredId) {
      this.rootFolderId = configuredId;
      return this.getOrCreateRootFolder();
    }

    const folder = await this.findOrCreateFolder(ROOT_FOLDER_NAME, "root");
    this.rootFolderId = folder.folderId;
    console.log(
      `[DriveStorageService] "${ROOT_FOLDER_NAME}" folder resolved at ID ${folder.folderId}. ` +
      `Consider pinning GOOGLE_DRIVE_ROOT_FOLDER_ID=${folder.folderId} to avoid a repeat search.`
    );
    return folder;
  }

  async getOrCreateBatchFolder(batchId: string): Promise<DriveFolderInfo> {
    const cached = this.batchFolderCache.get(batchId);
    if (cached) return cached;

    const root = await this.getOrCreateRootFolder();
    const folder = await this.findOrCreateFolder(batchId, root.folderId);
    this.batchFolderCache.set(batchId, folder);
    return folder;
  }

  async getOrCreateShipmentFolder(batchId: string, shipmentId: string): Promise<DriveFolderInfo> {
    const cacheKey = `${batchId}/${shipmentId}`;
    const cached = this.shipmentFolderCache.get(cacheKey);
    if (cached) return cached;

    const batchFolder = await this.getOrCreateBatchFolder(batchId);
    const folder = await this.findOrCreateFolder(shipmentId, batchFolder.folderId);
    this.shipmentFolderCache.set(cacheKey, folder);
    return folder;
  }

  async getFolder(folderId: string): Promise<DriveFolderInfo> {
    const drive = getDriveClient();
    const res = await drive.files.get({ fileId: folderId, fields: "id, name, webViewLink" });
    return {
      folderId: res.data.id!,
      folderUrl: res.data.webViewLink || `https://drive.google.com/drive/folders/${res.data.id}`,
      folderName: res.data.name || ""
    };
  }

  async findFileByName(folderId: string, fileName: string): Promise<DriveFileInfo | null> {
    const drive = getDriveClient();
    const q = [
      `name = '${escapeQueryValue(fileName)}'`,
      `'${escapeQueryValue(folderId)}' in parents`,
      "trashed = false"
    ].join(" and ");

    const res = await drive.files.list({
      q,
      fields: "files(id, name, webViewLink, webContentLink)",
      spaces: "drive"
    });

    const file = res.data.files?.[0];
    if (!file?.id) return null;

    return this.toFileInfo(file);
  }

  private toFileInfo(file: { id?: string | null; name?: string | null; webViewLink?: string | null; webContentLink?: string | null }): DriveFileInfo {
    return {
      fileId: file.id!,
      fileName: file.name || "",
      viewUrl: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
      downloadUrl: file.webContentLink || `https://drive.google.com/uc?id=${file.id}&export=download`
    };
  }

  // Scans existing names in the folder to find the next free "Name (n).ext" suffix.
  private async nextAvailableName(folderId: string, fileName: string): Promise<string> {
    const dotIndex = fileName.lastIndexOf(".");
    const base = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
    const ext = dotIndex > 0 ? fileName.slice(dotIndex) : "";

    let attempt = 1;
    // Bounded loop — a shipment folder realistically never has hundreds of
    // same-named files, this just avoids an unbounded loop on unexpected state.
    while (attempt < 1000) {
      const candidate = `${base} (${attempt})${ext}`;
      const existing = await this.findFileByName(folderId, candidate);
      if (!existing) return candidate;
      attempt++;
    }
    throw new Error(`Could not find an available name for "${fileName}" after 999 attempts`);
  }

  async uploadFile(params: {
    folderId: string;
    fileName: string;
    mimeType: string;
    buffer: Buffer;
    onConflict?: ConflictStrategy;
  }): Promise<UploadResult> {
    const { folderId, fileName, mimeType, buffer } = params;
    const onConflict = params.onConflict || "ask";
    const drive = getDriveClient();

    try {
      const existing = await this.findFileByName(folderId, fileName);

      if (existing && onConflict === "ask") {
        return { status: "conflict", fileName, existing };
      }

      if (existing && onConflict === "use_existing") {
        return { status: "used_existing", fileName, existing };
      }

      if (existing && onConflict === "replace") {
        const res = await drive.files.update({
          fileId: existing.fileId,
          media: { mimeType, body: Readable.from(buffer) },
          fields: "id, name, webViewLink, webContentLink"
        });
        return { status: "uploaded", ...this.toFileInfo(res.data) };
      }

      // No collision, or explicit keep_both: pick a free name and create.
      const targetName = existing && onConflict === "keep_both"
        ? await this.nextAvailableName(folderId, fileName)
        : fileName;

      const res = await drive.files.create({
        requestBody: { name: targetName, parents: [folderId] },
        media: { mimeType, body: Readable.from(buffer) },
        fields: "id, name, webViewLink, webContentLink"
      });
      return { status: "uploaded", ...this.toFileInfo(res.data) };
    } catch (err: any) {
      return { status: "failed", fileName, error: err.message || "Unknown Drive upload error" };
    }
  }

  async deleteFile(fileId: string): Promise<void> {
    const drive = getDriveClient();
    await drive.files.update({ fileId, requestBody: { trashed: true } });
  }

  async moveFile(fileId: string, newParentId: string, oldParentId: string): Promise<void> {
    const drive = getDriveClient();
    await drive.files.update({
      fileId,
      addParents: newParentId,
      removeParents: oldParentId,
      fields: "id, parents"
    });
  }
}

export const driveStorageService = new DriveStorageService();
