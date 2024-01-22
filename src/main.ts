import * as core from '@actions/core'
import * as google from '@googleapis/drive'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

// Google Authorization scopes
const SCOPES = ['https://www.googleapis.com/auth/drive.file']

// Inputs
export const INPUT_CREDENTIALS = 'credentials'
export const INPUT_PARENT_FOLDER_ID = 'parent-folder-id'
export const INPUT_SOURCE_FILEPATH = 'source-filepath'
export const INPUT_TARGET_FILEPATH = 'target-filepath'
export const INPUT_OVERWRITE = 'overwrite'
export const INPUT_CREATE_CHECKSUM = 'create-checksum'

// Outputs
export const OUTPUT_FILE_ID = 'file-id'

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    // Get inputs
    const credentials = core.getInput(INPUT_CREDENTIALS, { required: true })
    const parentFolderId = core.getInput(INPUT_PARENT_FOLDER_ID, { required: true })
    const sourceFilePath = core.getInput(INPUT_SOURCE_FILEPATH, { required: true })
    const targetFilePath = core.getInput(INPUT_TARGET_FILEPATH)
    const overwrite = core.getBooleanInput(INPUT_OVERWRITE)
    const createChecksum = core.getBooleanInput(INPUT_CREATE_CHECKSUM)

    // Init Google Drive API instance
    const drive = initDriveAPI(credentials)

    const fileId = await uploadFile(drive, parentFolderId, sourceFilePath, targetFilePath, overwrite)
    if (fileId && createChecksum) {
      let checksumTargetFilePath = ''
      if (!targetFilePath) {
        const paths = sourceFilePath.split(path.sep)
        checksumTargetFilePath = `${paths[paths.length - 1]}.sha256`
      } else {
        checksumTargetFilePath = `${targetFilePath}.sha256`
      }
      const checksumFile = `${sourceFilePath}.sha256`
      fs.writeFileSync(checksumFile, await generateHash(sourceFilePath, 'sha256'))
      await uploadFile(drive, parentFolderId, checksumFile, checksumTargetFilePath, true)
    }

    // Set outputs
    core.setOutput(OUTPUT_FILE_ID, fileId)
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed(`Error: ${error}`)
    }
  }
}

function initDriveAPI(credentials: string): google.drive_v3.Drive {
  const credentialsJSON = JSON.parse(Buffer.from(credentials, 'base64').toString())
  const auth = new google.auth.GoogleAuth({
    credentials: credentialsJSON,
    scopes: SCOPES
  })
  return google.drive({ version: 'v3', auth })
}

async function uploadFile(
  drive: google.drive_v3.Drive,
  parentId: string,
  sourceFilePath: string,
  targetFilePath: string | null,
  overwrite: boolean
): Promise<string | null> {
  if (!targetFilePath) {
    const paths = sourceFilePath.split(path.sep)
    targetFilePath = paths[paths.length - 1]
  }

  const targetPaths = targetFilePath.split(path.sep)
  while (targetPaths.length > 1) {
    const folderName = targetPaths.shift()
    if (folderName !== undefined) {
      parentId = await createFolder(drive, parentId, folderName)
    }
  }

  const fileName = targetPaths[0]
  const fileId = await getFileId(drive, parentId, fileName)
  if (fileId && !overwrite) {
    throw new Error(
      `A file with name '${fileName}' already exists in folder identified by '${parentId}'. ` +
        `Use 'overwrite' option to overwrite existing file.`
    )
  } else if (fileId && overwrite) {
    core.debug(`Updating existing file '${fileName}' in folder identified by '${parentId}'`)
    return await updateFile(drive, fileId, sourceFilePath)
  } else {
    core.debug(`Creating file '${fileName}' in folder identified by '${parentId}'`)
    return await createFile(drive, parentId, fileName, sourceFilePath)
  }
}

async function getFileId(drive: google.drive_v3.Drive, parentId: string, fileName: string): Promise<string | null> {
  core.debug(`Getting file with name '${fileName}' under folder '${parentId}'`)
  const requestParams: google.drive_v3.Params$Resource$Files$List = {
    q: `name='${fileName}' and '${parentId}' in parents and trashed=false`,
    fields: 'files(id)',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true
  }
  const response = await drive.files.list(requestParams)

  const files: google.drive_v3.Schema$File[] | undefined = response.data.files
  if (files === undefined || files.length === 0) {
    core.debug(`No entry matches the file name '${fileName}'`)
    return null
  }
  if (files.length > 1) {
    throw new Error(`More than one entry match the file name '${fileName}'`)
  }
  return files[0].id || null
}

async function createFolder(drive: google.drive_v3.Drive, parentId: string, folderName: string): Promise<string> {
  // Check if folder already exists and is unique
  const folderId = await getFileId(drive, parentId, folderName)
  if (folderId !== null) {
    core.debug(`Folder '${folderName}' already exists in folder '${parentId}'`)
    return folderId
  }

  core.debug(`Creating folder '${folderName}' in folder '${parentId}'`)
  const requestParams: google.drive_v3.Params$Resource$Files$Create = {
    requestBody: {
      parents: [parentId],
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder'
    },
    fields: 'id',
    supportsAllDrives: true
  }
  const response = await drive.files.create(requestParams)
  const folder: google.drive_v3.Schema$File = response.data
  core.debug(`Folder id: ${folder.id}`)
  if (!folder.id) {
    throw new Error(`Failed to create folder ${folderName} in ${parentId}`)
  }
  return folder.id
}

async function createFile(
  drive: google.drive_v3.Drive,
  parentId: string,
  fileName: string,
  sourceFilePath: string
): Promise<string> {
  const requestParams: google.drive_v3.Params$Resource$Files$Create = {
    requestBody: {
      parents: [parentId],
      name: fileName
    },
    media: {
      body: fs.createReadStream(sourceFilePath)
    },
    fields: 'id,md5Checksum',
    supportsAllDrives: true
  }
  const response = await drive.files.create(requestParams)
  const file: google.drive_v3.Schema$File = response.data
  core.debug(`File id: ${file.id}`)
  if (!file.id) {
    throw new Error(`Failed to create file '${fileName}' in folder identified by '${parentId}'`)
  }
  const sourceFileMD5Hash = await generateHash(sourceFilePath, 'md5')
  if (sourceFileMD5Hash !== file.md5Checksum) {
    throw new Error(`Upload error: invalid file md5 checksum detected after upload for ${file.id}!`)
  }
  return file.id
}

async function updateFile(drive: google.drive_v3.Drive, fileId: string, sourceFilePath: string): Promise<string> {
  const requestParams: google.drive_v3.Params$Resource$Files$Update = {
    fileId,
    media: {
      body: fs.createReadStream(sourceFilePath)
    },
    fields: 'id,md5Checksum',
    supportsAllDrives: true
  }
  const response = await drive.files.update(requestParams)
  const file: google.drive_v3.Schema$File = response.data
  core.debug(`File id: ${file.id}`)
  if (!file.id) {
    throw new Error(`Failed to update file identified by '${fileId}'`)
  }

  const sourceFileMD5Hash = await generateHash(sourceFilePath, 'md5')
  if (sourceFileMD5Hash !== file.md5Checksum) {
    throw new Error(`Upload error: invalid file md5 checksum detected after upload for ${file.id} !`)
  }
  return file.id
}

async function generateHash(filePath: string, algorithm: 'md5' | 'sha256'): Promise<string> {
  const hash = crypto.createHash(algorithm)
  const input = fs.createReadStream(filePath)
  for await (const chunk of input) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}
