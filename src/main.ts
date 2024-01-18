import * as core from '@actions/core'
import * as google from '@googleapis/drive'
import fs from 'fs'
import path from 'path'

// Google Authorization scopes
const SCOPES = ['https://www.googleapis.com/auth/drive.file']

// Init Google Drive API instance
const drive = initDriveAPI()

function initDriveAPI(): google.drive_v3.Drive {
  const credentials = core.getInput('credentials', { required: true })
  const credentialsJSON = JSON.parse(
    Buffer.from(credentials, 'base64').toString()
  )
  const auth = new google.auth.GoogleAuth({
    credentials: credentialsJSON,
    scopes: SCOPES
  })
  return google.drive({ version: 'v3', auth })
}

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    // Get inputs
    const parentFolderId = core.getInput('parent-folder-id', { required: true })
    const sourceFilePath = core.getInput('source-filepath', { required: true })
    const targetFilePath = core.getInput('target-filepath')
    const overwrite = core.getBooleanInput('overwrite')

    const fileId = await uploadFile(
      parentFolderId,
      sourceFilePath,
      targetFilePath,
      overwrite
    )

    // Set outputs
    core.setOutput('file-id', fileId)
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed(JSON.stringify(error))
    }
  }
}

async function uploadFile(
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
      parentId = await createFolder(parentId, folderName)
    }
  }

  const fileName = targetPaths[0]
  const fileId = await getFileId(parentId, fileName)
  if (fileId && !overwrite) {
    throw new Error(
      `A file with name '${fileName}' already exists in folder identified by '${parentId}'. ` +
        `Use 'overwrite' option to overwrite existing file.`
    )
  } else if (fileId && overwrite) {
    core.debug(
      `Updating existing file '${fileName}' in folder identified by '${parentId}'`
    )
    return await updateFile(fileId, sourceFilePath)
  } else {
    core.debug(
      `Creating file '${fileName}' in folder identified by '${parentId}'`
    )
    return await createFile(parentId, fileName, sourceFilePath)
  }
}

async function getFileId(
  parentId: string,
  fileName: string
): Promise<string | null> {
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

async function createFolder(
  parentId: string,
  folderName: string
): Promise<string> {
  // Check if folder already exists and is unique
  const folderId = await getFileId(parentId, folderName)
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
    fields: 'id',
    supportsAllDrives: true
  }
  const response = await drive.files.create(requestParams)
  const file: google.drive_v3.Schema$File = response.data
  core.debug(`File id: ${file.id}`)
  if (!file.id) {
    throw new Error(
      `Failed to create file '${fileName}' in folder identified by '${parentId}'`
    )
  }
  return file.id
}

async function updateFile(
  fileId: string,
  sourceFilePath: string
): Promise<string> {
  const requestParams: google.drive_v3.Params$Resource$Files$Update = {
    fileId,
    media: {
      body: fs.createReadStream(sourceFilePath)
    },
    fields: 'id',
    supportsAllDrives: true
  }
  const response = await drive.files.update(requestParams)
  const file: google.drive_v3.Schema$File = response.data
  core.debug(`File id: ${file.id}`)
  if (!file.id) {
    throw new Error(`Failed to update file identified by '${fileId}'`)
  }
  return file.id
}
