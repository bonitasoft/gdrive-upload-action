import * as core from '@actions/core'
import * as google from '@googleapis/drive'
import * as fs from 'fs'
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
    const parentFolderId = core.getInput('parentFolderId', { required: true })
    const sourceFilePath = core.getInput('sourceFilePath', { required: true })
    const targetFilePath = core.getInput('targetFilePath')
    const force = core.getBooleanInput('force')

    const fileId = await createFile(
      parentFolderId,
      sourceFilePath,
      targetFilePath,
      force
    )

    // Set outputs
    core.setOutput('fileId', fileId)
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed(JSON.stringify(error))
    }
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
    core.debug(`No entry match the file name '${fileName}'`)
    return null
  }
  if (files.length > 1) {
    throw new Error(`More than one entry match the file name '${fileName}'`)
  }
  return files[0].id || null
}

async function createFolder(
  parentId: string,
  folderName: string | undefined
): Promise<string> {
  // Check if folder already exists and is unique
  const {
    data: { files }
  } = await drive.files.list({
    q: `name='${folderName}' and '${parentId}' in parents and trashed=false`,
    fields: 'files(id)',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true
  })

  if (files && files.length > 1) {
    throw new Error(
      `More than one entry match ${folderName} folder name in folder ${parentId}`
    )
  }
  if (files && files.length === 1 && files[0] && files[0].id) {
    core.debug(`Folder '${folderName}' already exists in folder '${parentId}'`)
    return files[0].id
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
  sourceFilePath: string,
  targetFilePath: string | null,
  force: boolean
): Promise<string | null> {
  if (!targetFilePath) {
    const paths = sourceFilePath.split(path.sep)
    targetFilePath = paths[paths.length - 1]
  }
  const targetPaths = targetFilePath.split(path.sep)
  while (targetPaths.length > 1) {
    const folderName = targetPaths.shift()
    parentId = await createFolder(parentId, folderName)
  }
  const fileName = targetPaths[0]
  const fileId = await getFileId(parentId, fileName)
  if (fileId && !force) {
    throw new Error(
      `A file with name '${fileName}' already exists in folder with id '${parentId}'. Use 'force' option to overwrite existing file.`
    )
  } else if (fileId && force) {
    core.debug(
      `Updating existing file '${fileName}' under folder '${parentId}'`
    )
    const requestParams: google.drive_v3.Params$Resource$Files$Update = {
      media: {
        body: fs.createReadStream(sourceFilePath)
      },
      fileId,
      fields: 'id',
      supportsAllDrives: true
    }
    const response = await drive.files.update(requestParams)
    const file: google.drive_v3.Schema$File = response.data
    core.debug(`File id: ${file.id}`)
    return file.id || null
  } else {
    core.debug(`Creating file '${fileName}' under folder '${parentId}'`)
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
    return file.id || null
  }
}
